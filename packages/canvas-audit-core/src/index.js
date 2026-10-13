/**
 * canvas-audit-core
 *
 * Driver-agnostic measurement engine. It owns no browser and launches nothing.
 * Give it an `evaluate(pageFunction, arg)` -- Playwright's page.evaluate,
 * Puppeteer's, or your own CDP wrapper -- and it returns analysed results.
 *
 * The point of the split: in CI the browser is already open and the page is
 * already loaded, so the expensive part of an audit (starting Chromium) should
 * cost nothing. The MCP server is simply another caller of this same engine.
 */
import {
  collectCanvasData,
  collectFramePacingData,
  collectErgonomicsData,
  runContextLossProbe,
} from './page-fns.js';
import { analyzeCanvases, analyzeFramePacing, analyzeErgonomics, judgeRecovery, THRESHOLDS } from './analysis.js';

export { installInstrumentation, INSTRUMENTATION_SOURCE } from './instrumentation.js';
export {
  collectCanvasData,
  collectFramePacingData,
  collectErgonomicsData,
  runContextLossProbe,
} from './page-fns.js';
export { analyzeCanvases, analyzeFramePacing, analyzeErgonomics, judgeRecovery, THRESHOLDS } from './analysis.js';
export { classifyRenderer } from './gpu.js';
export {
  summarizeReport,
  compareToBaseline,
  loadBaselineFile,
  saveBaselineFile,
  formatRegressions,
  DEFAULT_TOLERANCES,
} from './baseline.js';
export { describe, jitter, percentile, round } from './stats.js';

/** @typedef {(pageFunction: Function, arg?: any) => Promise<any>} Evaluator */

/**
 * @param {Evaluator} evaluate
 */
export async function auditCanvasDpr(evaluate, { thresholds = THRESHOLDS } = {}) {
  const raw = await evaluate(collectCanvasData);
  return analyzeCanvases(raw, { thresholds });
}

/**
 * @param {Evaluator} evaluate
 */
export async function profileFramePacing(
  evaluate,
  { sampleFrames = 120, timeoutMs = 15000, thresholds = THRESHOLDS } = {}
) {
  const raw = await evaluate(collectFramePacingData, { sampleFrames, timeoutMs });
  return analyzeFramePacing(raw, { thresholds });
}

/**
 * @param {Evaluator} evaluate
 */
export async function inspectErgonomics(
  evaluate,
  { minTouchSize = 32, isMobile = false, thresholds = THRESHOLDS } = {}
) {
  const raw = await evaluate(collectErgonomicsData, { minTouchSize });
  return analyzeErgonomics(raw, { minTouchSize, isMobile, thresholds });
}

/**
 * @param {Evaluator} evaluate
 */
export async function testContextLossRecovery(evaluate) {
  const raw = await evaluate(runContextLossProbe);
  return judgeRecovery(raw);
}

/**
 * Runs the selected audits against one already-loaded page.
 * @param {Evaluator} evaluate
 */
export async function auditPage(
  evaluate,
  {
    canvas = true,
    framePacing = true,
    ergonomics = true,
    recovery = false,
    sampleFrames = 120,
    timeoutMs = 15000,
    minTouchSize = 32,
    isMobile = false,
    thresholds = THRESHOLDS,
  } = {}
) {
  const report = {};
  if (canvas) report.canvas = await auditCanvasDpr(evaluate, { thresholds });
  if (framePacing) report.framePacing = await profileFramePacing(evaluate, { sampleFrames, timeoutMs, thresholds });
  if (ergonomics) report.ergonomics = await inspectErgonomics(evaluate, { minTouchSize, isMobile, thresholds });
  // Recovery is destructive to the page's GPU context, so it runs last and only on request.
  if (recovery) report.recovery = await testContextLossRecovery(evaluate);
  return report;
}
