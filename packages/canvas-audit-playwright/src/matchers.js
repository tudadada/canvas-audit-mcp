import { expect as baseExpect } from '@playwright/test';
import { THRESHOLDS } from 'canvas-audit-core';
import { assertInstrumented } from './attach.js';
import {
  auditCanvasDpr,
  profileFramePacing,
  inspectErgonomics,
  testContextLossRecovery,
  auditPage,
} from './audit.js';
import { checkBaseline } from './baseline-store.js';

function list(lines) {
  return lines.map((line) => `  - ${line}`).join('\n');
}

export const expect = baseExpect.extend({
  /**
   * Every canvas renders at the display's physical pixel grid.
   */
  async toHaveSharpCanvases(page, { minRatio = THRESHOLDS.blurrySharpnessRatio, allowOversized = true } = {}) {
    const result = await auditCanvasDpr(page);
    const offenders = result.canvases.filter(
      (canvas) =>
        canvas.contextType !== 'none' &&
        (canvas.sharpnessRatio < minRatio || (!allowOversized && canvas.status === 'OVERSIZED'))
    );

    return {
      pass: offenders.length === 0,
      name: 'toHaveSharpCanvases',
      expected: `every canvas at >= ${minRatio} of the physical pixel grid (DPR ${result.dpr})`,
      actual: offenders.length === 0 ? 'all sharp' : `${offenders.length} canvas(es) below the threshold`,
      message: () =>
        offenders.length === 0
          ? `Expected at least one blurry canvas, but all ${result.canvasCount} render at the physical pixel grid.`
          : `Canvas sharpness below ${minRatio} at DPR ${result.dpr}:\n` +
            list(
              offenders.map(
                (canvas) =>
                  `${canvas.id}: buffer ${canvas.bufferDimensions.width}x${canvas.bufferDimensions.height}, ` +
                  `needs ${canvas.expectedDimensions.width}x${canvas.expectedDimensions.height} ` +
                  `(ratio ${canvas.sharpnessRatio}). Set canvas.width = clientWidth * devicePixelRatio.`
              )
            ),
    };
  },

  /**
   * The page survives a GPU context loss: cancels the event, regains its
   * context, and resumes rendering. The matcher never does any of that for it.
   */
  async toSurviveContextLoss(page) {
    await assertInstrumented(page);
    const result = await testContextLossRecovery(page);

    return {
      pass: result.verdict === 'RECOVERY_PASS',
      name: 'toSurviveContextLoss',
      expected: 'RECOVERY_PASS',
      actual: result.verdict,
      message: () =>
        result.verdict === 'RECOVERY_PASS'
          ? 'Expected the page to fail GPU context recovery, but it recovered correctly.'
          : `GPU context recovery: ${result.verdict}\n${list(result.reasons)}`,
    };
  },

  /** No rogue horizontal scrollbar at the current viewport. */
  async toHaveNoHorizontalOverflow(page) {
    const result = await inspectErgonomics(page);
    const overflow = result.issues.find((issue) => issue.type === 'HORIZONTAL_OVERFLOW');

    return {
      pass: !overflow,
      name: 'toHaveNoHorizontalOverflow',
      expected: `content within ${result.viewportWidth}px`,
      actual: `${result.scrollWidth}px`,
      message: () =>
        !overflow
          ? `Expected horizontal overflow, but content fits within ${result.viewportWidth}px.`
          : `Content overflows the viewport by ${overflow.overflowPx}px ` +
            `(${result.scrollWidth}px inside ${result.viewportWidth}px). Widest offenders:\n` +
            list(
              overflow.offenders.map(
                (element) =>
                  `<${element.tag}${element.id ? ` id="${element.id}"` : ''}${
                    element.className ? ` class="${element.className}"` : ''
                  }> extends ${element.rightOffset}px past the edge`
              )
            ),
    };
  },

  /** Touch targets meet a size floor. Defaults to the WCAG 2.2 AA minimum. */
  async toHaveAccessibleTouchTargets(page, { minSize = THRESHOLDS.wcag22TargetPx } = {}) {
    const result = await inspectErgonomics(page, { minTouchSize: minSize });
    const issue = result.issues.find((entry) => entry.type === 'UNDERSIZED_TOUCH_TARGETS');
    const offenders = issue ? issue.samples : [];

    return {
      pass: offenders.length === 0,
      name: 'toHaveAccessibleTouchTargets',
      expected: `every interactive element at least ${minSize}x${minSize}px`,
      actual: offenders.length === 0 ? 'all targets large enough' : `${offenders.length} too small`,
      message: () =>
        offenders.length === 0
          ? `Expected undersized touch targets, but all are at least ${minSize}px.`
          : `Touch targets below ${minSize}px at ${result.viewportWidth}px wide:\n` +
            list(
              offenders.map(
                (target) =>
                  `<${target.tag}${target.id ? ` id="${target.id}"` : ''}> "${target.text || '[no text]'}" ` +
                  `is ${target.width}x${target.height}px`
              )
            ),
    };
  },

  /**
   * The page's own render loop holds a frame rate. A page that does not animate
   * fails loudly rather than silently reporting the display refresh rate.
   */
  async toSustainFrameRate(page, { minFps = 55, sampleFrames = 90, timeoutMs = 15000 } = {}) {
    await assertInstrumented(page);
    const result = await profileFramePacing(page, { sampleFrames, timeoutMs });

    if (result.verdict === 'STATIC_NO_ANIMATION') {
      return {
        pass: false,
        name: 'toSustainFrameRate',
        expected: `>= ${minFps} FPS`,
        actual: 'no animation loop',
        message: () =>
          `The page rendered no frames, so it has no frame rate to sustain.\n${list(result.observations)}`,
      };
    }

    const fps = result.metrics.effectiveFps;
    return {
      pass: fps >= minFps,
      name: 'toSustainFrameRate',
      expected: `>= ${minFps} FPS`,
      actual: `${fps} FPS`,
      message: () =>
        fps >= minFps
          ? `Expected the page to drop below ${minFps} FPS, but it sustained ${fps} FPS.`
          : `The page sustained ${fps} FPS (median frame spacing ${result.metrics.presentIntervalMs.median}ms, ` +
            `main-thread work ${result.metrics.cpuPerFrameMs.p95}ms at P95).\n${list(result.observations)}`,
    };
  },

  /**
   * Display quality has not regressed against the stored baseline.
   * Run once to record it; `CANVAS_AUDIT_UPDATE_BASELINE=1` rewrites it.
   */
  async toMatchCanvasBaseline(page, id, { baselinePath, tolerances, update, gateTimings, audit = {} } = {}) {
    await assertInstrumented(page);
    const report = await auditPage(page, audit);
    const result = checkBaseline(id, report, { baselinePath, tolerances, update, gateTimings });

    // Timing drift is reported but does not fail the run by default; see the
    // reasoning in canvas-audit-core/src/baseline.js.
    if (result.warnings && result.warnings.length > 0) {
      console.warn(
        `canvas-audit: timing drift on "${id}" (not failing the run):\n` +
          list(
            result.warnings.map((w) => `${w.metric}: ${w.previous} -> ${w.current} (${w.direction})`)
          )
      );
    }

    return {
      pass: result.regressions.length === 0,
      name: 'toMatchCanvasBaseline',
      expected: `no regression against baseline "${id}"`,
      actual:
        result.regressions.length === 0
          ? result.isNew
            ? 'baseline recorded'
            : 'no regression'
          : `${result.regressions.length} regression(s)`,
      message: () =>
        result.regressions.length === 0
          ? `Expected "${id}" to regress, but it did not.`
          : `Display quality regressed against baseline "${id}":\n` +
            list(
              result.regressions.map(
                (regression) => `${regression.metric}: ${regression.previous} -> ${regression.current} (${regression.direction})`
              )
            ) +
            `\n\nBaseline: ${result.baselinePath}` +
            '\nIf this change is intended, re-record with CANVAS_AUDIT_UPDATE_BASELINE=1.',
    };
  },
});
