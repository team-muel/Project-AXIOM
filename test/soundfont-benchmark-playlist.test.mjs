import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const CASES = [
    { caseDir: "", variants: ["default_sf2", "musescore_general_sf3", "generaluser_gs_203"] },
    { caseDir: "strings_chamber", variants: ["default_sf2", "musescore_general_sf3", "generaluser_gs_203"] },
    { caseDir: "winds_brass", variants: ["default_sf2", "musescore_general_sf3", "generaluser_gs_203"] },
];

test("generate-soundfont-benchmark-playlist writes corpus and blind listening artifacts", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "axiom-soundfont-playlist-"));

    try {
        for (const benchmarkCase of CASES) {
            for (const variant of benchmarkCase.variants) {
                const outputPath = benchmarkCase.caseDir
                    ? path.join(tempRoot, benchmarkCase.caseDir, variant, "output.wav")
                    : path.join(tempRoot, variant, "output.wav");
                fs.mkdirSync(path.dirname(outputPath), { recursive: true });
                fs.writeFileSync(outputPath, "placeholder");
            }
        }

        const stdout = execFileSync(
            process.execPath,
            ["scripts/generate-soundfont-benchmark-playlist.mjs", "--root", tempRoot],
            { cwd: repoRoot, encoding: "utf8" },
        );

        const payload = JSON.parse(String(stdout).trim());
        assert.equal(payload.ok, true);
        assert.equal(payload.caseCount, 3);
        assert.equal(payload.variantCount, 9);

        const corpusJsonPath = path.join(tempRoot, "benchmark-corpus.json");
        const corpusMarkdownPath = path.join(tempRoot, "benchmark-corpus.md");
        const playlistPath = path.join(tempRoot, "benchmark-playlist.m3u");
        const blindPlaylistPath = path.join(tempRoot, "benchmark-playlist-blind.m3u");
        const blindMapPath = path.join(tempRoot, "benchmark-playlist-blind-map.json");

        assert.equal(fs.existsSync(corpusJsonPath), true);
        assert.equal(fs.existsSync(corpusMarkdownPath), true);
        assert.equal(fs.existsSync(playlistPath), true);
        assert.equal(fs.existsSync(blindPlaylistPath), true);
        assert.equal(fs.existsSync(blindMapPath), true);

        const corpus = JSON.parse(fs.readFileSync(corpusJsonPath, "utf8"));
        assert.equal(corpus.cases.length, 3);
        assert.equal(corpus.cases[0].variants.length, 3);
        assert.equal(corpus.cases[1].blindOrder.length, 3);

        const labeledPlaylist = fs.readFileSync(playlistPath, "utf8");
        assert.match(labeledPlaylist, /#EXTM3U/);
        assert.match(labeledPlaylist, /AXIOM Benchmark - Piano-led miniature - default\.sf2/);
        assert.match(labeledPlaylist, /strings_chamber\/default_sf2\/output\.wav/);

        const blindPlaylist = fs.readFileSync(blindPlaylistPath, "utf8");
        assert.match(blindPlaylist, /AXIOM Blind Benchmark - Piano-led miniature - sample [A-C]/);
        assert.doesNotMatch(blindPlaylist, /MuseScore_General\.sf3/);
        assert.doesNotMatch(blindPlaylist, /GeneralUser GS 2\.0\.3/);

        const blindMap = JSON.parse(fs.readFileSync(blindMapPath, "utf8"));
        assert.equal(blindMap.cases.length, 3);
        assert.equal(blindMap.cases[2].blindVariants.length, 3);
        assert.equal(typeof blindMap.cases[0].blindVariants[0].variantTitle, "string");

        const corpusMarkdown = fs.readFileSync(corpusMarkdownPath, "utf8");
        assert.match(corpusMarkdown, /# AXIOM SoundFont Benchmark Corpus/);
        assert.match(corpusMarkdown, /benchmark-playlist-blind\.m3u/);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});