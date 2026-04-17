import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
    ExpressionPlanSidecar,
    HumanizationStyle,
    HumanizeResult,
    SectionHarmonicRealizationSummary,
    SectionPlan,
    SectionPhraseBreathSummary,
    SectionOrnamentSummary,
    SectionTempoMotionSummary,
} from "../pipeline/types.js";
import { config } from "../config.js";
import { logger } from "../logging/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WORKER_SCRIPT = path.join(__dirname, "../../workers/humanizer/humanize.py");

interface WorkerResponse {
    ok: boolean;
    outputPath?: string;
    notesModified?: number;
    sectionPhraseBreath?: SectionPhraseBreathSummary[];
    sectionHarmonicRealization?: SectionHarmonicRealizationSummary[];
    sectionTempoMotion?: SectionTempoMotionSummary[];
    sectionOrnaments?: SectionOrnamentSummary[];
    error?: string;
}

interface HumanizeOptions {
    style?: HumanizationStyle;
    reflection?: string;
    expressionPlan?: ExpressionPlanSidecar;
    sections?: SectionPlan[];
}

export function buildHumanizeWorkerInput(
    inputPath: string,
    outputPath: string,
    options?: HumanizeOptions,
) {
    return {
        inputPath,
        outputPath,
        ...(options?.style ? { style: options.style } : {}),
        ...(options?.reflection ? { reflection: options.reflection } : {}),
        ...(options?.expressionPlan ? { expressionPlan: options.expressionPlan } : {}),
        ...(options?.sections?.length ? { sections: options.sections } : {}),
    };
}

export async function humanize(midiData: Buffer, songId: string, options?: HumanizeOptions): Promise<HumanizeResult> {
    logger.info("Humanizing", {
        songId,
        style: options?.style,
    });

    const songDir = path.join(config.outputDir, songId);
    if (!fs.existsSync(songDir)) {
        fs.mkdirSync(songDir, { recursive: true });
    }

    // 입력 MIDI를 임시 파일로 저장
    const inputPath = path.join(songDir, "pre_humanize.mid");
    const outputPath = path.join(songDir, "humanized.mid");
    fs.writeFileSync(inputPath, midiData);

    const workerInput = JSON.stringify(buildHumanizeWorkerInput(inputPath, outputPath, options));

    const result = await new Promise<WorkerResponse>((resolve, reject) => {
        const child = execFile(
            config.pythonBin,
            [WORKER_SCRIPT],
            {
                timeout: config.humanizeWorkerTimeoutMs,
                maxBuffer: 4 * 1024 * 1024,
                env: { ...process.env, PYTHONWARNINGS: "ignore" },
            },
            (err, stdout, stderr) => {
                if (stderr) {
                    logger.warn("Humanizer worker stderr", { songId, stderr: stderr.trim() });
                }
                if (err) {
                    return reject(new Error(`Humanizer worker failed: ${err.message}`));
                }
                try {
                    resolve(JSON.parse(stdout.trim()));
                } catch {
                    reject(new Error(`Humanizer worker returned invalid JSON: ${stdout}`));
                }
            },
        );
        child.stdin?.write(workerInput);
        child.stdin?.end();
    });

    if (!result.ok) {
        throw new Error(`Humanizer worker error: ${result.error}`);
    }

    const humanizedData = fs.readFileSync(outputPath);

    logger.info("Humanization complete", {
        songId,
        notesModified: result.notesModified,
    });

    return {
        midiData: humanizedData,
        sectionPhraseBreath: result.sectionPhraseBreath,
        sectionHarmonicRealization: result.sectionHarmonicRealization,
        sectionTempoMotion: result.sectionTempoMotion,
        sectionOrnaments: result.sectionOrnaments,
    };
}
