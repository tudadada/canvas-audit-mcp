/**
 * Baseline and regression comparison.
 *
 * A one-shot audit answers "does this page have problems?". A baseline answers
 * "did the commit I just made make it worse?" -- which is the question that
 * keeps a tool in a pipeline instead of being run once and forgotten.
 *
 * Counts are compared exactly: one more blurry canvas is a regression, full
 * stop. Timings are compared with tolerance, because frame timings are noisy on
 * shared CI machines and a tool that cries wolf gets switched off.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_TOLERANCES = {
  /** Relative slack on timing metrics (0.2 = 20% slower before it counts). */
  timingRatio: 0.2,
  /** Absolute slack on timing metrics, in ms, to absorb CI noise. */
  timingAbsoluteMs: 2,
  /** How far the sharpness ratio may fall before it counts. */
  sharpnessDrop: 0.01,
};

const RECOVERY_RANK = { RECOVERY_PASS: 3, RECOVERY_PARTIAL: 2, RECOVERY_FAIL: 1, SKIPPED: 0 };

/** Reduces a full report to the small set of numbers worth tracking over time. */
export function summarizeReport(report) {
  const summary = {};

  if (report.canvas) {
    summary.blurryCanvases = report.canvas.blurryCount;
    summary.oversizedCanvases = report.canvas.oversizedCount;
    if (Number.isFinite(report.canvas.minSharpnessRatio)) {
      summary.minSharpnessRatio = report.canvas.minSharpnessRatio;
    }
  }

  if (report.framePacing && report.framePacing.metrics) {
    summary.presentP95Ms = report.framePacing.metrics.presentIntervalMs.p95;
    summary.cpuPerFrameP95Ms = report.framePacing.metrics.cpuPerFrameMs.p95;
    summary.effectiveFps = report.framePacing.metrics.effectiveFps;
    summary.droppedFramesPercent = report.framePacing.metrics.droppedFramesPercent;
  }
  if (report.framePacing) summary.framePacingVerdict = report.framePacing.verdict;

  if (report.ergonomics) {
    summary.belowWcag22Targets = report.ergonomics.counts.belowWcag22;
    summary.belowConfiguredTargets = report.ergonomics.counts.belowConfiguredThreshold;
    summary.clippedTextBlocks = report.ergonomics.counts.clippedTextBlocks;
    summary.horizontalOverflowPx = Math.max(0, report.ergonomics.scrollWidth - report.ergonomics.viewportWidth);
  }

  if (report.recovery) summary.recoveryVerdict = report.recovery.verdict;

  return summary;
}

/** Metrics where a bigger number is worse, and whether tolerance applies. */
const HIGHER_IS_WORSE = {
  blurryCanvases: { timing: false },
  oversizedCanvases: { timing: false },
  belowWcag22Targets: { timing: false },
  belowConfiguredTargets: { timing: false },
  clippedTextBlocks: { timing: false },
  horizontalOverflowPx: { timing: false },
  presentP95Ms: { timing: true },
  cpuPerFrameP95Ms: { timing: true },
  droppedFramesPercent: { timing: true },
};

const LOWER_IS_WORSE = {
  effectiveFps: { timing: true },
  minSharpnessRatio: { timing: false, slack: 'sharpnessDrop' },
};

/**
 * @param summary          metrics from this run
 * @param baselineEntry    metrics recorded previously
 * @param tolerances       slack applied to timing metrics
 * @param gateTimings      whether a timing change should FAIL the check.
 *
 * Off by default, and this default was earned rather than assumed: running the
 * suite twice against the same unchanged page produced P95 frame spacing of
 * 16.7ms and then 33.3ms, because the compositor fell to the next V-Sync
 * multiple. That is a real property of frame timing on a shared machine, not a
 * bug to tune away, and a check that fails on it would be switched off within a
 * week -- taking the trustworthy checks down with it. So timing changes are
 * reported as `warnings` and tracked over time, while only deterministic
 * signals (canvas counts, sharpness, target sizes, overflow, recovery verdict)
 * can fail a build. Turn this on for a dedicated performance job with a quiet
 * machine and a generous tolerance.
 */
export function compareToBaseline(summary, baselineEntry, tolerances = DEFAULT_TOLERANCES, { gateTimings = false } = {}) {
  if (!baselineEntry) {
    return { isNew: true, regressions: [], improvements: [], warnings: [], summary };
  }

  const regressions = [];
  const improvements = [];
  const warnings = [];

  const allowance = (previous, config) => {
    if (config.slack) return tolerances[config.slack];
    if (!config.timing) return 0;
    return Math.max(tolerances.timingAbsoluteMs, Math.abs(previous) * tolerances.timingRatio);
  };

  const record = (entry, config) => {
    const bucket = config.timing && !gateTimings ? warnings : regressions;
    bucket.push(entry);
  };

  for (const [metric, config] of Object.entries(HIGHER_IS_WORSE)) {
    const previous = baselineEntry[metric];
    const current = summary[metric];
    if (typeof previous !== 'number' || typeof current !== 'number') continue;
    const slack = allowance(previous, config);
    if (current > previous + slack) {
      record({ metric, previous, current, delta: round(current - previous), direction: 'increased' }, config);
    } else if (current < previous - slack) {
      improvements.push({ metric, previous, current, delta: round(current - previous), direction: 'decreased' });
    }
  }

  for (const [metric, config] of Object.entries(LOWER_IS_WORSE)) {
    const previous = baselineEntry[metric];
    const current = summary[metric];
    if (typeof previous !== 'number' || typeof current !== 'number') continue;
    const slack = allowance(previous, config);
    if (current < previous - slack) {
      record({ metric, previous, current, delta: round(current - previous), direction: 'decreased' }, config);
    } else if (current > previous + slack) {
      improvements.push({ metric, previous, current, delta: round(current - previous), direction: 'increased' });
    }
  }

  // Recovery is a ranked verdict, not a number: losing a grade is a regression.
  if (baselineEntry.recoveryVerdict && summary.recoveryVerdict) {
    const before = RECOVERY_RANK[baselineEntry.recoveryVerdict] ?? 0;
    const after = RECOVERY_RANK[summary.recoveryVerdict] ?? 0;
    if (after < before) {
      regressions.push({
        metric: 'recoveryVerdict',
        previous: baselineEntry.recoveryVerdict,
        current: summary.recoveryVerdict,
        direction: 'downgraded',
      });
    } else if (after > before) {
      improvements.push({
        metric: 'recoveryVerdict',
        previous: baselineEntry.recoveryVerdict,
        current: summary.recoveryVerdict,
        direction: 'upgraded',
      });
    }
  }

  return { isNew: false, regressions, improvements, warnings, summary };
}

function round(value) {
  return Number(Number(value).toFixed(2));
}

export function loadBaselineFile(path) {
  if (!existsSync(path)) return { version: 1, entries: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && parsed.entries ? parsed : { version: 1, entries: {} };
  } catch {
    return { version: 1, entries: {} };
  }
}

export function saveBaselineFile(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function formatRegressions(id, result) {
  if (result.isNew) return `canvas-audit: "${id}" has no baseline entry yet; nothing to compare against.`;
  if (result.regressions.length === 0) return `canvas-audit: "${id}" has not regressed.`;

  const lines = result.regressions.map(
    (r) => `  - ${r.metric}: ${r.previous} -> ${r.current} (${r.direction})`
  );
  return `canvas-audit: "${id}" regressed against the baseline:\n${lines.join('\n')}`;
}
