import type { OverseerHistoryEntry, OverseerHistorySummary, OverseerRepeatedWarning } from "./storage.js";
import type {
    AudioRetryBreakdownRow,
    AudioRetryStatsSummary,
    ManifestOrchestrationTrendRow,
    ManifestSectionPatternSummaryRow,
    AudioRetryWindowSummary,
    ManifestTrackingSummary,
    ManifestOperationalSummary,
} from "../memory/manifestAnalytics.js";

interface DashboardPayload {
    refreshedAt: string;
    limit: number;
    windowHours: number;
    status: Record<string, unknown>;
    lastReport: Record<string, unknown>;
    history: Record<string, unknown>;
    summary: Record<string, unknown>;
}

function escapeHtml(value: unknown): string {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatTimestamp(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) {
        return "-";
    }

    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
        return escapeHtml(value);
    }

    return escapeHtml(new Date(parsed).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }));
}

function asEntries(value: unknown): OverseerHistoryEntry[] {
    return Array.isArray(value) ? value as OverseerHistoryEntry[] : [];
}

function asSummary(value: unknown): OverseerHistorySummary | null {
    return value && typeof value === "object" && Array.isArray((value as OverseerHistorySummary).repeatedWarnings)
        ? value as OverseerHistorySummary
        : null;
}

function asManifestOperationalSummary(value: unknown): ManifestOperationalSummary | null {
    return value && typeof value === "object" && value !== null && "audioRetryStats" in (value as Record<string, unknown>)
        ? value as ManifestOperationalSummary
        : null;
}

function formatPercent(value: unknown): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "-";
    }

    return `${(value * 100).toFixed(1)}%`;
}

function formatSignedNumber(value: unknown): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "-";
    }

    return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
}

function renderAudioRetryComboRows(stats: AudioRetryStatsSummary | null): string {
    if (!stats || stats.topCombinations.length === 0) {
        return `<tr><td colspan="5">audio retry directive 이력이 아직 없습니다.</td></tr>`;
    }

    return stats.topCombinations.slice(0, 5).map((combo) => `
        <tr>
            <td>${escapeHtml(combo.combinationKey)}</td>
            <td>${escapeHtml(combo.totalCount)}</td>
            <td>${escapeHtml(formatPercent(combo.immediateSuccessRate))}</td>
            <td>${escapeHtml(formatPercent(combo.eventualSuccessRate))}</td>
            <td>${formatTimestamp(combo.lastSeenAt)}</td>
        </tr>
    `).join("");
}

function renderAudioRetrySeriesRows(window: AudioRetryWindowSummary | null): string {
    if (!window || window.dailySeries.length === 0) {
        return `<tr><td colspan="5">시계열 데이터가 아직 없습니다.</td></tr>`;
    }

    return window.dailySeries.map((point) => `
        <tr>
            <td>${escapeHtml(point.day)}</td>
            <td>${escapeHtml(point.totalRetryEvents)}</td>
            <td>${escapeHtml(formatPercent(point.immediateSuccessRate))}</td>
            <td>${escapeHtml(formatPercent(point.eventualSuccessRate))}</td>
            <td>${escapeHtml(point.topCombinationKey ?? "-")}</td>
        </tr>
    `).join("");
}

function renderBreakdownRows(rows: AudioRetryBreakdownRow[]): string {
    if (rows.length === 0) {
        return `<tr><td colspan="5">분해 가능한 audio retry 이력이 아직 없습니다.</td></tr>`;
    }

    return rows.slice(0, 6).map((row) => `
        <tr>
            <td>${escapeHtml(row.value)}</td>
            <td>${escapeHtml(row.totalRetryEvents)}</td>
            <td>${escapeHtml(formatPercent(row.immediateSuccessRate))}</td>
            <td>${escapeHtml(formatPercent(row.eventualSuccessRate))}</td>
            <td>${escapeHtml(row.topCombinationKey ?? "-")}</td>
        </tr>
    `).join("");
}

function renderSparkline(window: AudioRetryWindowSummary | null): string {
    if (!window || window.dailySeries.length === 0) {
        return `<div class="series-empty">sparkline data unavailable</div>`;
    }

    const width = 280;
    const height = 74;
    const padding = 10;
    const step = window.dailySeries.length > 1 ? (width - padding * 2) / (window.dailySeries.length - 1) : 0;
    const points = window.dailySeries.map((point, index) => {
        const x = padding + index * step;
        const y = height - padding - point.immediateSuccessRate * (height - padding * 2);
        return { x, y, point };
    });
    const polyline = points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");

    return `
        <div class="series-visual">
            <div class="series-visual-label">Immediate Success Sparkline</div>
            <svg class="series-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Immediate success rate sparkline">
                <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="rgba(54, 43, 30, 0.18)" stroke-width="1" />
                <line x1="${padding}" y1="${height / 2}" x2="${width - padding}" y2="${height / 2}" stroke="rgba(154, 91, 44, 0.18)" stroke-width="1" stroke-dasharray="4 4" />
                <polyline fill="none" stroke="rgba(154, 91, 44, 0.95)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${polyline}" />
                ${points.map((point) => `
                    <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="3.5" fill="rgba(85, 107, 47, 0.92)">
                        <title>${escapeHtml(`${point.point.day} immediate ${formatPercent(point.point.immediateSuccessRate)} / retries ${point.point.totalRetryEvents}`)}</title>
                    </circle>
                `).join("")}
            </svg>
        </div>
    `;
}

function formatSectionRoute(tonalities: ManifestTrackingSummary["sectionTonalities"] | undefined): string {
    if (!tonalities || tonalities.length === 0) {
        return "-";
    }

    return tonalities
        .map((entry) => `${entry.role}:${entry.tonalCenter}`)
        .join(" -> ");
}

function formatOrchestrationFamilyLabel(family: string): string {
    return family === "string_trio" ? "trio" : family;
}

function formatOrchestrationSummary(item: ManifestTrackingSummary): string {
    if (!item.orchestration) {
        return "-";
    }

    const family = formatOrchestrationFamilyLabel(item.orchestration.family);
    const weakSections = item.orchestration.weakSectionIds.length > 0
        ? item.orchestration.weakSectionIds.join(",")
        : "none";
    const doubling = typeof item.orchestration.doublingPressureFit === "number"
        ? ` / dbl ${formatPercent(item.orchestration.doublingPressureFit)}`
        : "";
    const rotation = typeof item.orchestration.textureRotationFit === "number"
        ? ` / rot ${formatPercent(item.orchestration.textureRotationFit)}`
        : "";
    const handoff = typeof item.orchestration.sectionHandoffFit === "number"
        ? ` / hnd ${formatPercent(item.orchestration.sectionHandoffFit)}`
        : "";

    return `${family} rng ${formatPercent(item.orchestration.idiomaticRangeFit)} / bal ${formatPercent(item.orchestration.registerBalanceFit)} / conv ${formatPercent(item.orchestration.ensembleConversationFit)}${doubling}${rotation}${handoff} · weak ${weakSections}`;
}

function renderOrchestrationTrendRows(rows: ManifestOrchestrationTrendRow[]): string {
    if (rows.length === 0) {
        return `<tr><td colspan="8">성공 manifest 기준 orchestration trend 데이터가 아직 없습니다.</td></tr>`;
    }

    return rows.slice(0, 6).map((row) => `
        <tr>
            <td>${escapeHtml(formatOrchestrationFamilyLabel(row.family))}</td>
            <td>${escapeHtml(row.instrumentNames.join(" / ") || "-")}</td>
            <td>${escapeHtml(row.manifestCount)}<br /><span class="subtle">conv sec ${escapeHtml(typeof row.averageConversationalSectionCount === "number" ? row.averageConversationalSectionCount.toFixed(1) : "-")} / avg sections ${escapeHtml(typeof row.averageSectionCount === "number" ? row.averageSectionCount.toFixed(1) : "-")}</span></td>
            <td>${escapeHtml(formatPercent(row.averageIdiomaticRangeFit))}</td>
            <td>${escapeHtml(formatPercent(row.averageRegisterBalanceFit))}</td>
            <td>${escapeHtml(formatPercent(row.averageEnsembleConversationFit))}<br /><span class="subtle">dbl ${escapeHtml(formatPercent(row.averageDoublingPressureFit))} / rot ${escapeHtml(formatPercent(row.averageTextureRotationFit))} / hnd ${escapeHtml(formatPercent(row.averageSectionHandoffFit))}</span></td>
            <td>${escapeHtml(`weak ${row.weakManifestCount}/${row.manifestCount}`)}<br /><span class="subtle">avg weak sections ${escapeHtml(typeof row.averageWeakSectionCount === "number" ? row.averageWeakSectionCount.toFixed(1) : "-")}</span></td>
            <td>${formatTimestamp(row.lastSeenAt)}</td>
        </tr>
    `).join("");
}

function renderManifestTrackingRows(items: ManifestTrackingSummary[]): string {
    if (items.length === 0) {
        return `<tr><td colspan="8">최근 manifest key route 추적 데이터가 아직 없습니다.</td></tr>`;
    }

    return items.map((item) => `
        <tr>
            <td>
                <strong>${escapeHtml(item.songId)}</strong>
                <div class="history-preview">${escapeHtml(formatSectionRoute(item.sectionTonalities))}</div>
            </td>
            <td>${escapeHtml(item.state)}<br /><span class="subtle">${escapeHtml(item.workflow ?? "-")}</span></td>
            <td>${formatTimestamp(item.updatedAt)}</td>
            <td>${escapeHtml(formatPercent(item.audioNarrative.harmonicRouteFit))}<br /><span class="subtle">tonal ${escapeHtml(formatPercent(item.audioNarrative.tonalReturnFit))}</span></td>
            <td>${escapeHtml(formatPercent(item.audioNarrative.chromaHarmonicRouteFit))}<br /><span class="subtle">tonal ${escapeHtml(formatPercent(item.audioNarrative.chromaTonalReturnFit))}</span></td>
            <td>${escapeHtml(formatPercent(item.structureNarrative.registerPlanFit))}<br /><span class="subtle">cad ${escapeHtml(formatPercent(item.structureNarrative.cadenceApproachPlanFit))}</span><br /><span class="subtle">orch ${escapeHtml(formatOrchestrationSummary(item))}</span></td>
            <td>${escapeHtml(item.latestAudioRetryReason ?? "-")}</td>
            <td>
                ${escapeHtml(item.audioWeakestSections[0]?.sectionId ?? "-")}: ${escapeHtml(item.audioWeakestSections[0]?.topIssue ?? "-")}
                <br /><span class="subtle">structure ${escapeHtml(item.weakestSections[0]?.topIssue ?? "-")}</span>
                <br /><span class="subtle">reg ${escapeHtml(formatPercent(item.weakestSections[0]?.registerCenterFit ?? null))} / cad ${escapeHtml(formatPercent(item.weakestSections[0]?.cadenceApproachFit ?? null))}</span>
                <br /><span class="subtle">drift ${escapeHtml(formatSignedNumber(item.weakestSections[0]?.registerCenterDrift ?? null))}</span>
            </td>
        </tr>
    `).join("");
}

function renderSectionPatternRows(rows: ManifestSectionPatternSummaryRow[], emptyMessage: string): string {
    if (rows.length === 0) {
        return `<tr><td colspan="6">${escapeHtml(emptyMessage)}</td></tr>`;
    }

    return rows.slice(0, 6).map((row) => `
        <tr>
            <td>${escapeHtml(row.form)}</td>
            <td>${escapeHtml(row.role)}</td>
            <td>${escapeHtml(row.value)}</td>
            <td>${escapeHtml(row.count)}<br /><span class="subtle">${escapeHtml(row.manifestCount)} manifests</span></td>
            <td>${escapeHtml(formatPercent(row.averageScore))}</td>
            <td>${formatTimestamp(row.lastSeenAt)}</td>
        </tr>
    `).join("");
}

function renderHeatmap(window: AudioRetryWindowSummary | null): string {
    if (!window || window.dailySeries.length === 0) {
        return `<div class="series-empty">heatmap data unavailable</div>`;
    }

    const width = 280;
    const height = 46;
    const padding = 6;
    const gap = 3;
    const slotWidth = (width - padding * 2 - gap * (window.dailySeries.length - 1)) / window.dailySeries.length;
    const maxRetries = Math.max(1, ...window.dailySeries.map((point) => point.totalRetryEvents));

    return `
        <div class="series-visual">
            <div class="series-visual-label">Retry Volume Heatmap</div>
            <svg class="series-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily retry volume heatmap">
                ${window.dailySeries.map((point, index) => {
        const x = padding + index * (slotWidth + gap);
        const intensity = point.totalRetryEvents <= 0 ? 0.08 : 0.22 + 0.68 * (point.totalRetryEvents / maxRetries);
        const fill = point.totalRetryEvents <= 0
            ? `rgba(106, 98, 87, ${intensity.toFixed(3)})`
            : `rgba(154, 91, 44, ${intensity.toFixed(3)})`;
        return `
                        <rect x="${x.toFixed(2)}" y="${padding}" width="${slotWidth.toFixed(2)}" height="${height - padding * 2}" rx="4" fill="${fill}">
                            <title>${escapeHtml(`${point.day} retries ${point.totalRetryEvents} / eventual ${formatPercent(point.eventualSuccessRate)}`)}</title>
                        </rect>
                    `;
    }).join("")}
            </svg>
        </div>
    `;
}

function dashboardUrl(payload: DashboardPayload): string {
    return `/overseer/dashboard?windowHours=${encodeURIComponent(String(payload.windowHours))}&limit=${encodeURIComponent(String(payload.limit))}`;
}

function renderHistoryRows(entries: OverseerHistoryEntry[]): string {
    if (entries.length === 0) {
        return `<tr><td colspan="4">히스토리가 아직 없습니다.</td></tr>`;
    }

    return entries.map((entry) => {
        const kindLabel = entry.kind === "failure" ? "failure" : entry.healthy ? "healthy" : "warning";
        const detail = entry.kind === "failure"
            ? entry.error
            : entry.issueSignatures.length > 0
                ? entry.issueSignatures.join(" | ")
                : "issues none";
        const preview = entry.kind === "failure"
            ? entry.report
            : entry.report.slice(0, 160);

        return `
            <tr>
                <td><span class="pill pill-${escapeHtml(kindLabel)}">${escapeHtml(kindLabel)}</span></td>
                <td>${formatTimestamp(entry.generatedAt)}</td>
                <td>${escapeHtml(detail)}</td>
                <td><div class="history-preview">${escapeHtml(preview)}</div></td>
            </tr>
        `;
    }).join("");
}

function renderWarningAction(
    warning: OverseerRepeatedWarning,
    action: "/overseer/warnings/acknowledge" | "/overseer/warnings/unacknowledge",
    buttonLabel: string,
    payload: DashboardPayload,
): string {
    const noteField = action === "/overseer/warnings/acknowledge"
        ? `
            <label class="note-label">
                <span>운영 메모</span>
                <input class="note-input" type="text" name="note" maxlength="160" placeholder="왜 잠깐 무시하는지 메모" />
            </label>
        `
        : "";

    return `
        <form class="warning-form" method="post" action="${action}">
            <input type="hidden" name="warningKey" value="${escapeHtml(warning.warningKey)}" />
            <input type="hidden" name="warning" value="${escapeHtml(warning.warning)}" />
            <input type="hidden" name="lastSeenAt" value="${escapeHtml(warning.lastSeenAt)}" />
            <input type="hidden" name="redirectTo" value="${escapeHtml(dashboardUrl(payload))}" />
            ${noteField}
            <button class="action-button" type="submit">${escapeHtml(buttonLabel)}</button>
        </form>
    `;
}

function renderActiveWarningList(summary: OverseerHistorySummary | null, payload: DashboardPayload): string {
    if (!summary || summary.repeatedWarnings.length === 0) {
        return `<li>현재 active repeated warning 없음</li>`;
    }

    return summary.repeatedWarnings.map((warning) => `
        <li class="warning-item">
            <strong>${escapeHtml(warning.warning)}</strong>
            <span>${warning.count}회 반복 · last seen ${formatTimestamp(warning.lastSeenAt)}</span>
            <span>key ${escapeHtml(warning.warningKey)}</span>
            ${renderWarningAction(warning, "/overseer/warnings/acknowledge", "Acknowledge", payload)}
        </li>
    `).join("");
}

function renderAcknowledgedWarningList(summary: OverseerHistorySummary | null, payload: DashboardPayload): string {
    if (!summary || summary.acknowledgedWarnings.length === 0) {
        return `<li>acknowledged warning 없음</li>`;
    }

    return summary.acknowledgedWarnings.map((warning) => `
        <li class="warning-item warning-item-acknowledged">
            <strong>${escapeHtml(warning.warning)}</strong>
            <span>${warning.count}회 반복 · acknowledged ${formatTimestamp(warning.acknowledgedAt)}</span>
            <span>last seen ${formatTimestamp(warning.lastSeenAt)}</span>
            ${warning.note ? `<span>note ${escapeHtml(warning.note)}</span>` : ""}
            ${renderWarningAction(warning, "/overseer/warnings/unacknowledge", "Acknowledge 해제", payload)}
        </li>
    `).join("");
}

function renderFailureList(summary: OverseerHistorySummary | null): string {
    if (!summary || summary.recentFailures.length === 0) {
        return `<li>최근 ${escapeHtml(summary?.windowHours ?? 24)}시간 실패 없음</li>`;
    }

    return summary.recentFailures.map((failure) => `
        <li>
            <strong>${formatTimestamp(failure.generatedAt)}</strong>
            <span>${escapeHtml(failure.error)}</span>
        </li>
    `).join("");
}

export function renderOverseerDashboard(payload: DashboardPayload): string {
    const status = payload.status;
    const lastReport = payload.lastReport;
    const historyEntries = asEntries(payload.history.entries);
    const summary = asSummary(payload.summary);
    const manifestAudioRetry = asManifestOperationalSummary((payload.summary as Record<string, unknown> | null)?.manifestAudioRetry);
    const audioRetryStats = manifestAudioRetry?.audioRetryStats ?? null;
    const audioRetry7d = manifestAudioRetry?.audioRetryWindows.last7Days ?? null;
    const audioRetry30d = manifestAudioRetry?.audioRetryWindows.last30Days ?? null;
    const audioRetryBreakdowns = manifestAudioRetry?.audioRetryBreakdowns ?? null;
    const successfulSectionPatterns = manifestAudioRetry?.successfulSectionPatterns ?? null;
    const orchestrationTrends = manifestAudioRetry?.orchestrationTrends ?? null;
    const recentManifestTracking = manifestAudioRetry?.recentManifestTracking ?? [];
    const lastSuccessfulHistory = historyEntries.find((entry) => entry.kind === "success");
    const lastReportText = typeof lastReport.report === "object" && lastReport.report && typeof (lastReport.report as Record<string, unknown>).report === "string"
        ? (lastReport.report as Record<string, unknown>).report as string
        : lastSuccessfulHistory?.kind === "success"
            ? lastSuccessfulHistory.report
            : typeof lastReport.error === "string"
                ? lastReport.error
                : "자동 리포트가 아직 없습니다.";
    const scheduler = status.scheduler as Record<string, unknown> | undefined;
    const reachable = status.reachable === true;

    return `<!doctype html>
<html lang="ko">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="60" />
    <title>AXIOM Overseer Dashboard</title>
    <style>
        :root {
            --paper: #f4efe2;
            --paper-strong: #fbf7ee;
            --ink: #1f1b16;
            --muted: #6a6257;
            --line: rgba(54, 43, 30, 0.18);
            --accent: #9a5b2c;
            --accent-soft: rgba(154, 91, 44, 0.14);
            --olive: #556b2f;
            --crimson: #9f3a2d;
            --shadow: 0 24px 60px rgba(52, 37, 24, 0.12);
            --font-body: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
            --font-mono: "IBM Plex Mono", "Cascadia Mono", Consolas, monospace;
        }

        * { box-sizing: border-box; }
        body {
            margin: 0;
            color: var(--ink);
            font-family: var(--font-body);
            background:
                radial-gradient(circle at top left, rgba(154, 91, 44, 0.18), transparent 28%),
                radial-gradient(circle at top right, rgba(85, 107, 47, 0.16), transparent 32%),
                linear-gradient(180deg, #efe7d4, #f7f3ea 55%, #efe8da);
        }

        .shell {
            max-width: 1240px;
            margin: 0 auto;
            padding: 32px 20px 48px;
        }

        .hero {
            background: linear-gradient(135deg, rgba(251, 247, 238, 0.96), rgba(240, 231, 213, 0.92));
            border: 1px solid var(--line);
            border-radius: 28px;
            padding: 28px;
            box-shadow: var(--shadow);
        }

        .eyebrow {
            margin: 0 0 8px;
            text-transform: uppercase;
            letter-spacing: 0.18em;
            font-size: 12px;
            color: var(--muted);
        }

        h1 {
            margin: 0 0 10px;
            font-size: clamp(30px, 4vw, 46px);
            line-height: 1.05;
        }

        .hero p {
            margin: 0;
            max-width: 780px;
            color: var(--muted);
            font-size: 17px;
        }

        .hero-meta, .links {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 18px;
        }

        .pill, .link-pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            border-radius: 999px;
            border: 1px solid var(--line);
            background: rgba(255, 255, 255, 0.74);
            font-size: 13px;
        }

        .pill-healthy { color: var(--olive); }
        .pill-warning { color: var(--accent); }
        .pill-failure { color: var(--crimson); }

        .link-pill {
            color: inherit;
            text-decoration: none;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(12, minmax(0, 1fr));
            gap: 18px;
            margin-top: 20px;
        }

        .card {
            background: rgba(251, 247, 238, 0.92);
            border: 1px solid var(--line);
            border-radius: 24px;
            padding: 20px;
            box-shadow: var(--shadow);
        }

        .span-3 { grid-column: span 3; }
        .span-4 { grid-column: span 4; }
        .span-5 { grid-column: span 5; }
        .span-6 { grid-column: span 6; }
        .span-7 { grid-column: span 7; }
        .span-8 { grid-column: span 8; }
        .span-12 { grid-column: span 12; }

        .label {
            font-size: 12px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--muted);
            margin-bottom: 8px;
        }

        .metric {
            font-size: clamp(24px, 3vw, 36px);
            line-height: 1;
            margin: 0 0 6px;
        }

        .subtle {
            margin: 0;
            color: var(--muted);
            font-size: 14px;
        }

        pre {
            margin: 0;
            padding: 18px;
            border-radius: 18px;
            border: 1px solid rgba(54, 43, 30, 0.12);
            background: rgba(255, 255, 255, 0.78);
            font-family: var(--font-mono);
            font-size: 13px;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }

        ul {
            margin: 0;
            padding-left: 18px;
        }

        li {
            margin-bottom: 10px;
            color: var(--ink);
        }

        li span {
            display: block;
            color: var(--muted);
            font-size: 13px;
            margin-top: 2px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
        }

        th, td {
            border-top: 1px solid rgba(54, 43, 30, 0.12);
            text-align: left;
            vertical-align: top;
            padding: 12px 10px;
        }

        th {
            color: var(--muted);
            font-size: 12px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        .history-preview {
            max-width: 420px;
            color: var(--muted);
        }

        .warning-item {
            list-style: none;
            margin: 0 0 14px;
            padding: 14px;
            border: 1px solid rgba(54, 43, 30, 0.12);
            border-radius: 18px;
            background: rgba(255, 255, 255, 0.72);
        }

        .warning-item-acknowledged {
            background: rgba(85, 107, 47, 0.08);
        }

        .warning-form {
            margin-top: 10px;
        }

        .note-label {
            display: block;
            margin-bottom: 10px;
            font-size: 12px;
            color: var(--muted);
        }

        .note-label span {
            display: block;
            margin-bottom: 6px;
        }

        .note-input {
            width: 100%;
            border: 1px solid rgba(54, 43, 30, 0.16);
            border-radius: 12px;
            padding: 10px 12px;
            background: rgba(255, 255, 255, 0.9);
            color: var(--ink);
            font: inherit;
        }

        .action-button {
            appearance: none;
            border: 1px solid rgba(54, 43, 30, 0.18);
            background: linear-gradient(180deg, rgba(154, 91, 44, 0.12), rgba(154, 91, 44, 0.22));
            color: var(--ink);
            border-radius: 999px;
            padding: 8px 12px;
            font: inherit;
            cursor: pointer;
        }

        .footer-note {
            margin-top: 18px;
            color: var(--muted);
            font-size: 13px;
        }

        .series-visual-stack {
            display: grid;
            gap: 12px;
            margin-bottom: 16px;
        }

        .series-visual {
            border: 1px solid rgba(54, 43, 30, 0.12);
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.72);
            padding: 12px;
        }

        .series-visual-label {
            margin-bottom: 8px;
            color: var(--muted);
            font-size: 12px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        .series-svg {
            width: 100%;
            height: auto;
            display: block;
        }

        .series-empty {
            border: 1px dashed rgba(54, 43, 30, 0.18);
            border-radius: 16px;
            padding: 14px;
            color: var(--muted);
            background: rgba(255, 255, 255, 0.58);
        }

        @media (max-width: 980px) {
            .span-3, .span-4, .span-5, .span-6, .span-7, .span-8 {
                grid-column: span 12;
            }
        }
    </style>
</head>
<body>
    <div class="shell">
        <section class="hero">
            <p class="eyebrow">MCP-backed operations view</p>
            <h1>AXIOM Overseer Dashboard</h1>
            <p>자동 Overseer 최신 리포트, 일자별 히스토리, 최근 ${escapeHtml(payload.windowHours)}시간 요약을 같은 화면에서 읽는 운영 대시보드입니다.</p>
            <div class="hero-meta">
                <span class="pill ${reachable ? "pill-healthy" : "pill-failure"}">${reachable ? "Ollama reachable" : "Ollama unreachable"}</span>
                <span class="pill ${scheduler?.running ? "pill-warning" : "pill-healthy"}">scheduler ${scheduler?.running ? "running" : "idle"}</span>
                <span class="pill">last run ${formatTimestamp(summary?.lastRunAt ?? scheduler?.lastCompletedAt)}</span>
                <span class="pill">refreshed ${formatTimestamp(payload.refreshedAt)}</span>
            </div>
            <div class="links">
                <a class="link-pill" href="/overseer/status">/overseer/status</a>
                <a class="link-pill" href="/overseer/last-report">/overseer/last-report</a>
                <a class="link-pill" href="/overseer/history?limit=${escapeHtml(payload.limit)}">/overseer/history</a>
                <a class="link-pill" href="/overseer/summary?windowHours=${escapeHtml(payload.windowHours)}&limit=${escapeHtml(payload.limit)}">/overseer/summary</a>
                <a class="link-pill" href="/overseer/dashboard?windowHours=${escapeHtml(payload.windowHours)}&limit=${escapeHtml(payload.limit)}">refresh</a>
            </div>
        </section>

        <section class="grid">
            <article class="card span-3">
                <div class="label">Recent 24h Failures</div>
                <p class="metric">${escapeHtml(summary?.recentFailureCount ?? 0)}</p>
                <p class="subtle">최근 ${escapeHtml(summary?.windowHours ?? payload.windowHours)}시간 자동 Overseer 실패 수</p>
            </article>
            <article class="card span-3">
                <div class="label">Repeated Warnings</div>
                <p class="metric">${escapeHtml(summary?.activeRepeatedWarningCount ?? 0)}</p>
                <p class="subtle">active repeated warnings · ack ${escapeHtml(summary?.acknowledgedWarningCount ?? 0)}</p>
            </article>
            <article class="card span-3">
                <div class="label">Last Healthy Report</div>
                <p class="metric">${formatTimestamp(summary?.lastHealthyReportAt)}</p>
                <p class="subtle">이슈 없음으로 판단된 마지막 자동 리포트</p>
            </article>
            <article class="card span-3">
                <div class="label">Sampled Entries</div>
                <p class="metric">${escapeHtml(summary?.sampledEntries ?? historyEntries.length)}</p>
                <p class="subtle">최근 윈도우 내 분석에 사용한 히스토리 건수</p>
            </article>

            <article class="card span-3">
                <div class="label">Audio Retry Events</div>
                <p class="metric">${escapeHtml(audioRetryStats?.totalRetryEvents ?? 0)}</p>
                <p class="subtle">manifest history에서 수집한 전체 audio retry 이벤트</p>
            </article>

            <article class="card span-3">
                <div class="label">Audio Immediate Rate</div>
                <p class="metric">${escapeHtml(formatPercent(audioRetryStats?.immediateSuccessRate ?? null))}</p>
                <p class="subtle">directive 적용 직후 바로 통과한 비율</p>
            </article>

            <article class="card span-3">
                <div class="label">Last 7 Days</div>
                <p class="metric">${escapeHtml(formatPercent(audioRetry7d?.stats.immediateSuccessRate ?? null))}</p>
                <p class="subtle">${escapeHtml(audioRetry7d?.stats.totalRetryEvents ?? 0)} retries · ${escapeHtml(audioRetry7d?.manifestCount ?? 0)} manifests</p>
            </article>

            <article class="card span-3">
                <div class="label">Last 30 Days</div>
                <p class="metric">${escapeHtml(formatPercent(audioRetry30d?.stats.immediateSuccessRate ?? null))}</p>
                <p class="subtle">${escapeHtml(audioRetry30d?.stats.totalRetryEvents ?? 0)} retries · ${escapeHtml(audioRetry30d?.manifestCount ?? 0)} manifests</p>
            </article>

            <article class="card span-7">
                <div class="label">Latest Automatic Report</div>
                <pre>${escapeHtml(lastReportText)}</pre>
                <p class="footer-note">MCP tool: axiom_overseer_last_report</p>
            </article>

            <article class="card span-5">
                <div class="label">Repeated Warnings</div>
                <ul>${renderActiveWarningList(summary, payload)}</ul>
                <div class="label" style="margin-top: 18px;">Acknowledged Warnings</div>
                <ul>${renderAcknowledgedWarningList(summary, payload)}</ul>
                <div class="label" style="margin-top: 18px;">Recent Failures</div>
                <ul>${renderFailureList(summary)}</ul>
            </article>

            <article class="card span-6">
                <div class="label">Audio Retry Combos</div>
                <table>
                    <thead>
                        <tr>
                            <th>Directive Combo</th>
                            <th>Retries</th>
                            <th>Immediate</th>
                            <th>Eventual</th>
                            <th>Last Seen</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderAudioRetryComboRows(audioRetryStats)}
                    </tbody>
                </table>
                <p class="footer-note">manifest retry stats · overall</p>
            </article>

            <article class="card span-6">
                <div class="label">Audio Retry Windows</div>
                <table>
                    <thead>
                        <tr>
                            <th>Window</th>
                            <th>Retries</th>
                            <th>Immediate</th>
                            <th>Eventual</th>
                            <th>Top Combo</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Last 7 Days</td>
                            <td>${escapeHtml(audioRetry7d?.stats.totalRetryEvents ?? 0)}</td>
                            <td>${escapeHtml(formatPercent(audioRetry7d?.stats.immediateSuccessRate ?? null))}</td>
                            <td>${escapeHtml(formatPercent(audioRetry7d?.stats.eventualSuccessRate ?? null))}</td>
                            <td>${escapeHtml(audioRetry7d?.stats.topCombinations[0]?.combinationKey ?? "-")}</td>
                        </tr>
                        <tr>
                            <td>Last 30 Days</td>
                            <td>${escapeHtml(audioRetry30d?.stats.totalRetryEvents ?? 0)}</td>
                            <td>${escapeHtml(formatPercent(audioRetry30d?.stats.immediateSuccessRate ?? null))}</td>
                            <td>${escapeHtml(formatPercent(audioRetry30d?.stats.eventualSuccessRate ?? null))}</td>
                            <td>${escapeHtml(audioRetry30d?.stats.topCombinations[0]?.combinationKey ?? "-")}</td>
                        </tr>
                    </tbody>
                </table>
                <p class="footer-note">recent 7d/30d operational windows</p>
            </article>

            <article class="card span-6">
                <div class="label">Bass Motion Trends</div>
                <table>
                    <thead>
                        <tr>
                            <th>Form</th>
                            <th>Role</th>
                            <th>Pattern</th>
                            <th>Count</th>
                            <th>Mean Fit</th>
                            <th>Last Seen</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderSectionPatternRows(
        successfulSectionPatterns?.bassMotionProfiles ?? [],
        "성공한 bass motion 패턴 데이터가 아직 없습니다.",
    )}
                    </tbody>
                </table>
                <p class="footer-note">successful manifests ${escapeHtml(successfulSectionPatterns?.sampledManifestCount ?? 0)} · sampled sections ${escapeHtml(successfulSectionPatterns?.sampledSectionCount ?? 0)}</p>
            </article>

            <article class="card span-6">
                <div class="label">Section Style Trends</div>
                <table>
                    <thead>
                        <tr>
                            <th>Form</th>
                            <th>Role</th>
                            <th>Pattern</th>
                            <th>Count</th>
                            <th>Mean Fit</th>
                            <th>Last Seen</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderSectionPatternRows(
        successfulSectionPatterns?.sectionStyles ?? [],
        "성공한 section style 패턴 데이터가 아직 없습니다.",
    )}
                    </tbody>
                </table>
                <p class="footer-note">planner memory와 같은 gating으로 집계한 recent successful section artifacts</p>
            </article>

            <article class="card span-12">
                <div class="label">Orchestration Trends</div>
                <table>
                    <thead>
                        <tr>
                            <th>Family</th>
                            <th>Instruments</th>
                            <th>Manifests</th>
                            <th>Avg Range</th>
                            <th>Avg Balance</th>
                            <th>Avg Conversation</th>
                            <th>Weak Pressure</th>
                            <th>Last Seen</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderOrchestrationTrendRows(orchestrationTrends?.familyRows ?? [])}
                    </tbody>
                </table>
                <p class="footer-note">successful orchestration snapshots only · ensemble writing competence, not SoundFont or timbre quality · sampled manifests ${escapeHtml(orchestrationTrends?.sampledManifestCount ?? 0)}</p>
            </article>

            <article class="card span-12">
                <div class="label">Recent Key Route Tracking</div>
                <table>
                    <thead>
                        <tr>
                            <th>Song / Route</th>
                            <th>State</th>
                            <th>Updated</th>
                            <th>Audio Route</th>
                            <th>Chroma Route</th>
                            <th>Structure / Orch</th>
                            <th>Latest Retry</th>
                            <th>Weakest / Structure</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderManifestTrackingRows(recentManifestTracking)}
                    </tbody>
                </table>
                <p class="footer-note">sectionTonalities + audio harmonic-route metrics + structure register/cadence fit + orchestration competence from recent manifests</p>
            </article>

            <article class="card span-12">
                <div class="label">History Timeline</div>
                <table>
                    <thead>
                        <tr>
                            <th>Kind</th>
                            <th>Generated</th>
                            <th>Issue / Error</th>
                            <th>Preview</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderHistoryRows(historyEntries)}
                    </tbody>
                </table>
                <p class="footer-note">MCP tools: axiom_overseer_history, axiom_overseer_summary</p>
            </article>

            <article class="card span-6">
                <div class="label">Audio Retry Daily Series · Last 7 Days</div>
                <div class="series-visual-stack">
                    ${renderSparkline(audioRetry7d)}
                    ${renderHeatmap(audioRetry7d)}
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Day</th>
                            <th>Retries</th>
                            <th>Immediate</th>
                            <th>Eventual</th>
                            <th>Top Combo</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderAudioRetrySeriesRows(audioRetry7d)}
                    </tbody>
                </table>
            </article>

            <article class="card span-6">
                <div class="label">Audio Retry Daily Series · Last 30 Days</div>
                <div class="series-visual-stack">
                    ${renderSparkline(audioRetry30d)}
                    ${renderHeatmap(audioRetry30d)}
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Day</th>
                            <th>Retries</th>
                            <th>Immediate</th>
                            <th>Eventual</th>
                            <th>Top Combo</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderAudioRetrySeriesRows(audioRetry30d)}
                    </tbody>
                </table>
            </article>

            <article class="card span-3">
                <div class="label">Form Breakdown</div>
                <table>
                    <thead>
                        <tr>
                            <th>Form</th>
                            <th>Retries</th>
                            <th>Immediate</th>
                            <th>Eventual</th>
                            <th>Top Combo</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderBreakdownRows(audioRetryBreakdowns?.byForm ?? [])}
                    </tbody>
                </table>
            </article>

            <article class="card span-3">
                <div class="label">Workflow Breakdown</div>
                <table>
                    <thead>
                        <tr>
                            <th>Workflow</th>
                            <th>Retries</th>
                            <th>Immediate</th>
                            <th>Eventual</th>
                            <th>Top Combo</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderBreakdownRows(audioRetryBreakdowns?.byWorkflow ?? [])}
                    </tbody>
                </table>
            </article>

            <article class="card span-3">
                <div class="label">Planner Version Breakdown</div>
                <table>
                    <thead>
                        <tr>
                            <th>Planner</th>
                            <th>Retries</th>
                            <th>Immediate</th>
                            <th>Eventual</th>
                            <th>Top Combo</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderBreakdownRows(audioRetryBreakdowns?.byPlannerVersion ?? [])}
                    </tbody>
                </table>
            </article>

            <article class="card span-3">
                <div class="label">Weakest Audio Role Breakdown</div>
                <table>
                    <thead>
                        <tr>
                            <th>Role</th>
                            <th>Retries</th>
                            <th>Immediate</th>
                            <th>Eventual</th>
                            <th>Top Combo</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderBreakdownRows(audioRetryBreakdowns?.byAudioWeakestRole ?? [])}
                    </tbody>
                </table>
            </article>

            <article class="card span-12">
                <div class="label">Setting Profiles</div>
                <table>
                    <thead>
                        <tr>
                            <th>Form | Workflow | Planner</th>
                            <th>Retries</th>
                            <th>Immediate</th>
                            <th>Eventual</th>
                            <th>Top Combo</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderBreakdownRows(audioRetryBreakdowns?.bySettingProfile ?? [])}
                    </tbody>
                </table>
                <p class="footer-note">directive combo 성공률을 설정 slice별로 비교</p>
            </article>
        </section>
    </div>
</body>
</html>`;
}