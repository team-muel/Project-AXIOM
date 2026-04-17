import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const VARIANTS = [
    { id: "default_sf2", title: "default.sf2" },
    { id: "musescore_general_sf3", title: "MuseScore_General.sf3" },
    { id: "generaluser_gs_203", title: "GeneralUser GS 2.0.3" },
];

const CASES = [
    {
        id: "piano_led",
        title: "Piano-led miniature",
        caseDir: "",
        sourceMidi: "outputs/01fa088c-b281-49a6-9d1b-072f81be51cd/humanized.mid",
    },
    {
        id: "strings_chamber",
        title: "Sustained strings texture",
        caseDir: "strings_chamber",
        sourceMidi: "outputs/10316926-ddff-4a9b-a088-4e2394c46e36/humanized.mid",
    },
    {
        id: "winds_brass",
        title: "Brass-led color study",
        caseDir: "winds_brass",
        sourceMidi: "outputs/584277bd-a799-4379-b046-ce02d589b0c5/humanized.mid",
    },
];

const DEFAULT_ROOT = path.join(repoRoot, "outputs", "_validation_render_preview");

function readOption(name) {
    const prefix = `--${name}=`;
    const exactIndex = process.argv.indexOf(`--${name}`);
    if (exactIndex >= 0) {
        return process.argv[exactIndex + 1];
    }

    const prefixed = process.argv.find((entry) => entry.startsWith(prefix));
    if (prefixed) {
        return prefixed.slice(prefix.length);
    }

    return undefined;
}

function fail(message, details) {
    console.error(JSON.stringify({ ok: false, message, details }, null, 2));
    process.exit(1);
}

function toPosixPath(value) {
    return value.split(path.sep).join("/");
}

function relativeToRepo(filePath) {
    return toPosixPath(path.relative(repoRoot, filePath));
}

function relativeToRoot(rootDir, filePath) {
    return toPosixPath(path.relative(rootDir, filePath));
}

function resolveRoot() {
    const explicit = readOption("root") || process.env.AXIOM_SOUNDFONT_BENCHMARK_ROOT;
    return explicit ? path.resolve(explicit) : DEFAULT_ROOT;
}

function stableHash(value) {
    let hash = 2166136261;
    for (const character of value) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function resolveOutputPath(rootDir, name, override) {
    return override ? path.resolve(override) : path.join(rootDir, name);
}

function collectInventory(rootDir) {
    const missingFiles = [];
    const inventory = CASES.map((benchmarkCase) => {
        const variants = VARIANTS.map((variant) => {
            const variantDir = benchmarkCase.caseDir
                ? path.join(rootDir, benchmarkCase.caseDir, variant.id)
                : path.join(rootDir, variant.id);
            const wavPath = path.join(variantDir, "output.wav");
            if (!fs.existsSync(wavPath)) {
                missingFiles.push(relativeToRepo(wavPath));
            }

            return {
                id: variant.id,
                title: variant.title,
                path: wavPath,
                playlistPath: relativeToRoot(rootDir, wavPath),
            };
        });

        return {
            id: benchmarkCase.id,
            title: benchmarkCase.title,
            caseDir: benchmarkCase.caseDir,
            sourceMidi: benchmarkCase.sourceMidi,
            variants,
        };
    });

    if (missingFiles.length > 0) {
        fail("Missing benchmark WAV inputs", { missingFiles });
    }

    return inventory;
}

function buildBlindInventory(inventory) {
    return inventory.map((benchmarkCase) => {
        const orderedVariants = benchmarkCase.variants
            .map((variant) => ({
                ...variant,
                blindRank: stableHash(`${benchmarkCase.id}:${variant.id}:axiom-benchmark-blind-v1`),
            }))
            .sort((left, right) => left.blindRank - right.blindRank || left.id.localeCompare(right.id));

        return {
            ...benchmarkCase,
            blindVariants: orderedVariants.map((variant, index) => {
                const blindLabel = String.fromCharCode(65 + index);
                return {
                    blindId: `${benchmarkCase.id}_${blindLabel}`,
                    blindLabel,
                    id: variant.id,
                    title: variant.title,
                    path: variant.path,
                    playlistPath: variant.playlistPath,
                };
            }),
        };
    });
}

function buildCorpusJson(rootDir, inventory, blindInventory) {
    return {
        generated_at: new Date().toISOString(),
        root: relativeToRepo(rootDir),
        cases: inventory.map((benchmarkCase) => ({
            id: benchmarkCase.id,
            title: benchmarkCase.title,
            sourceMidi: benchmarkCase.sourceMidi,
            variants: benchmarkCase.variants.map((variant) => ({
                id: variant.id,
                title: variant.title,
                path: relativeToRepo(variant.path),
            })),
            blindOrder: blindInventory
                .find((entry) => entry.id === benchmarkCase.id)
                ?.blindVariants.map((variant) => ({
                    blindId: variant.blindId,
                    blindLabel: variant.blindLabel,
                    variantId: variant.id,
                    variantTitle: variant.title,
                })) || [],
        })),
    };
}

function buildCorpusMarkdown(inventory, blindInventory) {
    const lines = [
        "# AXIOM SoundFont Benchmark Corpus",
        "",
        "This corpus packages the current validation renders for labeled and blind listening passes.",
        "",
        "## Files",
        "",
        "- `benchmark-playlist.m3u` — labeled listening order",
        "- `benchmark-playlist-blind.m3u` — blind listening order",
        "- `benchmark-playlist-blind-map.json` — hidden blind label mapping",
        "",
    ];

    for (const benchmarkCase of inventory) {
        lines.push(`## ${benchmarkCase.title}`);
        lines.push("");
        lines.push(`- Source MIDI: \`${benchmarkCase.sourceMidi}\``);

        for (const variant of benchmarkCase.variants) {
            lines.push(`- ${variant.title}: \`${relativeToRepo(variant.path)}\``);
        }

        const blindCase = blindInventory.find((entry) => entry.id === benchmarkCase.id);
        if (blindCase) {
            lines.push("");
            lines.push("Blind labels:");
            for (const blindVariant of blindCase.blindVariants) {
                lines.push(`- ${blindVariant.blindLabel}: ${blindVariant.title}`);
            }
        }

        lines.push("");
    }

    return lines.join("\n");
}

function buildPlaylist(inventory) {
    const lines = ["#EXTM3U"];

    for (const benchmarkCase of inventory) {
        lines.push(``);
        lines.push(`# ${benchmarkCase.title}`);
        for (const variant of benchmarkCase.variants) {
            lines.push(`#EXTINF:-1,AXIOM Benchmark - ${benchmarkCase.title} - ${variant.title}`);
            lines.push(variant.playlistPath);
        }
    }

    return lines.join("\n");
}

function buildBlindPlaylist(blindInventory) {
    const lines = ["#EXTM3U"];

    for (const benchmarkCase of blindInventory) {
        lines.push("");
        lines.push(`# ${benchmarkCase.title}`);
        for (const variant of benchmarkCase.blindVariants) {
            lines.push(`#EXTINF:-1,AXIOM Blind Benchmark - ${benchmarkCase.title} - sample ${variant.blindLabel}`);
            lines.push(variant.playlistPath);
        }
    }

    return lines.join("\n");
}

function buildBlindMapJson(rootDir, blindInventory) {
    return {
        generated_at: new Date().toISOString(),
        root: relativeToRepo(rootDir),
        cases: blindInventory.map((benchmarkCase) => ({
            id: benchmarkCase.id,
            title: benchmarkCase.title,
            blindVariants: benchmarkCase.blindVariants.map((variant) => ({
                blindId: variant.blindId,
                blindLabel: variant.blindLabel,
                variantId: variant.id,
                variantTitle: variant.title,
                path: relativeToRepo(variant.path),
            })),
        })),
    };
}

function main() {
    const rootDir = resolveRoot();
    if (!fs.existsSync(rootDir)) {
        fail("Benchmark root does not exist", { rootDir: relativeToRepo(rootDir) });
    }

    const inventory = collectInventory(rootDir);
    const blindInventory = buildBlindInventory(inventory);

    const outputCorpusJsonPath = resolveOutputPath(rootDir, "benchmark-corpus.json", readOption("output-corpus-json"));
    const outputCorpusMarkdownPath = resolveOutputPath(rootDir, "benchmark-corpus.md", readOption("output-corpus-md"));
    const outputPlaylistPath = resolveOutputPath(rootDir, "benchmark-playlist.m3u", readOption("output-playlist"));
    const outputBlindPlaylistPath = resolveOutputPath(rootDir, "benchmark-playlist-blind.m3u", readOption("output-blind-playlist"));
    const outputBlindMapPath = resolveOutputPath(rootDir, "benchmark-playlist-blind-map.json", readOption("output-blind-map"));

    const corpusJson = buildCorpusJson(rootDir, inventory, blindInventory);
    const corpusMarkdown = buildCorpusMarkdown(inventory, blindInventory);
    const playlist = buildPlaylist(inventory);
    const blindPlaylist = buildBlindPlaylist(blindInventory);
    const blindMap = buildBlindMapJson(rootDir, blindInventory);

    fs.writeFileSync(outputCorpusJsonPath, `${JSON.stringify(corpusJson, null, 2)}\n`);
    fs.writeFileSync(outputCorpusMarkdownPath, `${corpusMarkdown}\n`);
    fs.writeFileSync(outputPlaylistPath, `${playlist}\n`);
    fs.writeFileSync(outputBlindPlaylistPath, `${blindPlaylist}\n`);
    fs.writeFileSync(outputBlindMapPath, `${JSON.stringify(blindMap, null, 2)}\n`);

    console.log(JSON.stringify({
        ok: true,
        root: relativeToRepo(rootDir),
        outputCorpusJson: relativeToRepo(outputCorpusJsonPath),
        outputCorpusMarkdown: relativeToRepo(outputCorpusMarkdownPath),
        outputPlaylist: relativeToRepo(outputPlaylistPath),
        outputBlindPlaylist: relativeToRepo(outputBlindPlaylistPath),
        outputBlindMap: relativeToRepo(outputBlindMapPath),
        caseCount: inventory.length,
        variantCount: inventory.reduce((sum, benchmarkCase) => sum + benchmarkCase.variants.length, 0),
    }, null, 2));
}

try {
    main();
} catch (error) {
    fail("generate-soundfont-benchmark-playlist crashed", {
        error: error instanceof Error ? error.message : String(error),
    });
}