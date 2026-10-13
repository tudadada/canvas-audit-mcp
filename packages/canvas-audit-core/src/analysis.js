/**
 * All judgement lives here: pure functions over raw page data.
 *
 * Keeping analysis out of the browser means thresholds and verdicts can be
 * unit-tested in milliseconds without launching anything, and the same verdicts
 * are produced whichever driver collected the data.
 */
import { describe, jitter, round } from './stats.js';
import { classifyRenderer } from './gpu.js';

export const THRESHOLDS = {
  /** Below this fraction of the physical pixel grid, a canvas reads as blurry. */
  blurrySharpnessRatio: 0.85,
  /** Above this, the buffer is bigger than it needs to be. */
  oversizedSharpnessRatio: 1.2,
  /** Relative CSS-vs-buffer aspect mismatch that becomes visible stretching. */
  aspectDistortion: 0.05,
  /** Frame spacing above this counts as a dropped frame (below 40 FPS). */
  droppedFrameMs: 25,
  /** Frame spacing above this counts as a visible freeze. */
  severeFreezeMs: 50,
  /** Mean frame-to-frame variation above this reads as unstable pacing. */
  jitterMs: 8,
  /** One 60 Hz frame budget. */
  frameBudgetMs: 16.7,
  /** GPU readback stall above this indicates a command backlog. */
  readbackStallMs: 8,
  /** WCAG 2.2 AA minimum target size. */
  wcag22TargetPx: 24,
  /** Apple HIG / Android Material recommended target size. */
  platformTargetPx: 44,
};

export function analyzeCanvases(raw, { thresholds = THRESHOLDS } = {}) {
  const dpr = raw.dpr;

  const canvases = raw.canvases.map((canvas) => {
    const expectedWidth = Math.round(canvas.cssWidth * dpr);
    const expectedHeight = Math.round(canvas.cssHeight * dpr);
    const widthRatio = expectedWidth > 0 ? canvas.bufferWidth / expectedWidth : 1;
    const heightRatio = expectedHeight > 0 ? canvas.bufferHeight / expectedHeight : 1;
    const sharpnessRatio = Math.min(widthRatio, heightRatio);

    const cssAspect = canvas.cssHeight > 0 ? canvas.cssWidth / canvas.cssHeight : 1;
    const bufferAspect = canvas.bufferHeight > 0 ? canvas.bufferWidth / canvas.bufferHeight : 1;
    const aspectDistortion = Math.abs(cssAspect - bufferAspect) / cssAspect;

    let status = 'OPTIMAL';
    const issues = [];

    if (canvas.contextType === 'none') {
      status = 'NO_CONTEXT';
      issues.push(
        'This canvas has no rendering context yet. It may be created lazily, or transferred to an OffscreenCanvas or worker, in which case its buffer size cannot be judged from the main thread.'
      );
    } else if (sharpnessRatio < thresholds.blurrySharpnessRatio) {
      status = 'BLURRY';
      issues.push(
        `Blurry at DPR ${dpr}: buffer ${canvas.bufferWidth}x${canvas.bufferHeight} is smaller than the physical pixel grid ${expectedWidth}x${expectedHeight}. Set canvas.width = clientWidth * window.devicePixelRatio.`
      );
    } else if (sharpnessRatio > thresholds.oversizedSharpnessRatio) {
      status = 'OVERSIZED';
      issues.push(
        `Oversized buffer ${canvas.bufferWidth}x${canvas.bufferHeight} versus target ${expectedWidth}x${expectedHeight}, wasting VRAM and fillrate.`
      );
    }

    if (aspectDistortion > thresholds.aspectDistortion && canvas.cssWidth > 0 && canvas.cssHeight > 0) {
      issues.push(
        `Aspect distortion ${(aspectDistortion * 100).toFixed(1)}%: CSS box aspect ${cssAspect.toFixed(2)} differs from buffer aspect ${bufferAspect.toFixed(2)}, so the image is stretched.`
      );
    }

    if (canvas.isWebGL && (!canvas.hasContextLostHandler || !canvas.hasContextRestoredHandler)) {
      issues.push(
        'No context-recovery listeners (webglcontextlost / webglcontextrestored). The canvas stays blank after a GPU reset.'
      );
    }

    return {
      ...canvas,
      cssDimensions: { width: canvas.cssWidth, height: canvas.cssHeight },
      bufferDimensions: { width: canvas.bufferWidth, height: canvas.bufferHeight },
      expectedDimensions: { width: expectedWidth, height: expectedHeight },
      sharpnessRatio: round(sharpnessRatio),
      aspectDistortion: round(aspectDistortion, 3),
      selfRecovery: {
        hasContextLostHandler: canvas.hasContextLostHandler,
        hasContextRestoredHandler: canvas.hasContextRestoredHandler,
      },
      status,
      issues,
    };
  });

  return {
    instrumented: raw.instrumented,
    dpr,
    canvasCount: raw.canvasCount,
    canvases,
    blurryCount: canvases.filter((c) => c.status === 'BLURRY').length,
    oversizedCount: canvases.filter((c) => c.status === 'OVERSIZED').length,
    minSharpnessRatio: canvases.length
      ? Math.min(...canvases.filter((c) => c.contextType !== 'none').map((c) => c.sharpnessRatio), Infinity)
      : null,
  };
}

export function analyzeFramePacing(raw, { thresholds = THRESHOLDS } = {}) {
  if (!raw.instrumented) {
    return {
      verdict: 'NOT_INSTRUMENTED',
      metrics: null,
      observations: [
        'Frame pacing needs the instrumentation installed before the page loads. Use the canvas-audit test fixture, or call attachCanvasAudit(context) before navigating.',
      ],
    };
  }

  const renderer = classifyRenderer(raw.glRenderer);

  const base = {
    hasCanvas: raw.hasCanvas,
    isWebGL: raw.isWebGL,
    renderer,
    pageRequestedFrames: raw.rafCallsByPage,
    framesCaptured: raw.frames.length,
  };

  if (raw.frames.length === 0) {
    return {
      ...base,
      verdict: 'STATIC_NO_ANIMATION',
      metrics: null,
      observations: [
        raw.rafCallsByPage === 0
          ? 'The page never called requestAnimationFrame during the sampling window. There is no animation loop to profile, so frame-pacing numbers would be meaningless here.'
          : `The page called requestAnimationFrame ${raw.rafCallsByPage} time(s) but rendered no frames during the sampling window. The loop may have stopped, been throttled, or be waiting on an event.`,
      ],
    };
  }

  const presentIntervals = [];
  for (let i = 1; i < raw.frames.length; i++) {
    presentIntervals.push(raw.frames[i].ts - raw.frames[i - 1].ts);
  }
  const cpuTimes = raw.frames.map((f) => f.cpuMs);

  const present = describe(presentIntervals);
  const cpu = describe(cpuTimes);
  const readback = raw.readbackStalls ? describe(raw.readbackStalls) : null;
  const presentJitter = jitter(presentIntervals);

  const dropped = presentIntervals.filter((d) => d > thresholds.droppedFrameMs).length;
  const severe = presentIntervals.filter((d) => d > thresholds.severeFreezeMs).length;
  const dropRatePercent = presentIntervals.length ? round((dropped / presentIntervals.length) * 100, 1) : null;

  const observations = [];
  let verdict = 'STABLE_60FPS';

  if (present.p95 > thresholds.severeFreezeMs) {
    verdict = 'SEVERE_STUTTER';
    observations.push(`Severe stutter: P95 frame spacing ${present.p95}ms against a 16.7ms target.`);
  } else if (present.p95 > thresholds.droppedFrameMs) {
    verdict = 'DROPPING_FRAMES';
    observations.push(
      `Frame drops: P95 spacing ${present.p95}ms, ${dropRatePercent}% of frames over ${thresholds.droppedFrameMs}ms.`
    );
  }

  if (presentJitter !== null && presentJitter > thresholds.jitterMs) {
    observations.push(
      `Unstable pacing (jitter ${presentJitter}ms): consecutive frames vary widely, the signature of V-Sync phase hopping.`
    );
  }

  if (cpu.p95 > thresholds.frameBudgetMs) {
    if (verdict === 'STABLE_60FPS') verdict = 'CPU_BOUND';
    observations.push(
      `Main thread is the bottleneck: the page's own frame callback took ${cpu.p95}ms at P95, over the whole ${thresholds.frameBudgetMs}ms budget. V-Sync hides this in frame-interval numbers alone.`
    );
  }

  if (readback && readback.median > thresholds.readbackStallMs) {
    observations.push(
      `GPU command backlog: a 1x1 readback stalled ${readback.median}ms (median), so queued work was still draining.`
    );
  }

  if (renderer.note) observations.push(renderer.note);

  if (observations.length === 0) {
    observations.push(
      `Sustained ${round(1000 / present.mean, 1)} FPS with ${cpu.median}ms of main-thread work per frame.`
    );
  }

  return {
    ...base,
    verdict,
    metrics: {
      presentIntervalMs: present,
      // Effective FPS comes from the MEAN interval, not the median.
      // Real stuttering animation is bimodal: frames alternate between 16.7ms
      // and 33.3ms as the renderer misses every other V-Sync. The median then
      // lands on 16.7ms and reports "59 FPS" for a page that is visibly running
      // at half rate with 45% of its frames dropped. The mean counts the misses.
      effectiveFps: round(1000 / present.mean, 1),
      bestCaseFps: round(1000 / present.median, 1),
      jitterMs: presentJitter,
      droppedFramesPercent: dropRatePercent,
      severeFreezesCount: severe,
      cpuPerFrameMs: cpu,
      gpuReadbackStallMs: readback,
    },
    observations,
  };
}

export function analyzeErgonomics(raw, { minTouchSize = 32, isMobile = false, thresholds = THRESHOLDS } = {}) {
  const issues = [];

  if (raw.scrollWidth > raw.layoutWidth + 2) {
    issues.push({
      type: 'HORIZONTAL_OVERFLOW',
      severity: 'HIGH',
      message: `Horizontal overflow: content is ${raw.scrollWidth}px wide inside a ${raw.layoutWidth}px viewport, producing a rogue horizontal scrollbar.`,
      overflowPx: raw.scrollWidth - raw.layoutWidth,
      offenders: raw.overflowElements,
    });
  }

  const belowConfigured = raw.undersizedTargets.filter(
    (t) => t.width < minTouchSize || t.height < minTouchSize
  );
  const belowWcag = raw.undersizedTargets.filter((t) => t.smallestSidePx < thresholds.wcag22TargetPx);
  const belowPlatform = raw.undersizedTargets.filter((t) => t.smallestSidePx < thresholds.platformTargetPx);

  if (belowConfigured.length > 0) {
    issues.push({
      type: 'UNDERSIZED_TOUCH_TARGETS',
      severity: belowWcag.length > 0 || isMobile ? 'HIGH' : 'MEDIUM',
      message:
        `${belowConfigured.length} interactive element(s) are smaller than the configured ${minTouchSize}px threshold. ` +
        `${belowWcag.length} fall below the WCAG 2.2 AA minimum of ${thresholds.wcag22TargetPx}px` +
        `${belowWcag.length > 0 ? ' (an accessibility conformance failure)' : ''}, and ${belowPlatform.length} ` +
        `fall below the ${thresholds.platformTargetPx}px size Apple and Android recommend.`,
      count: belowConfigured.length,
      belowWcag22Count: belowWcag.length,
      belowPlatformRecommendedCount: belowPlatform.length,
      samples: belowConfigured.slice(0, 6),
    });
  }

  if (raw.clippedTexts.length > 0) {
    issues.push({
      type: 'TEXT_CLIPPING',
      severity: 'MEDIUM',
      message: `${raw.clippedTexts.length} text block(s) are silently truncated by overflow:hidden.`,
      samples: raw.clippedTexts,
    });
  }

  return {
    viewportWidth: raw.layoutWidth,
    viewportHeight: raw.layoutHeight,
    windowInnerWidth: raw.windowInnerWidth,
    visualViewportWidth: raw.visualViewportWidth,
    scrollWidth: raw.scrollWidth,
    overflowElements: raw.overflowElements,
    counts: {
      belowConfiguredThreshold: belowConfigured.length,
      belowWcag22: belowWcag.length,
      belowPlatformRecommended: belowPlatform.length,
      clippedTextBlocks: raw.clippedTexts.length,
    },
    issues,
  };
}

export function judgeRecovery(raw) {
  if (!raw) return { verdict: 'SKIPPED', reasons: ['Context-loss testing was not run.'], detail: null };
  if (!raw.supported) return { verdict: 'SKIPPED', reasons: [raw.reason], detail: raw };

  const reasons = [];

  if (!raw.pageHandlers.hasContextLostHandler) {
    reasons.push(
      'The page registers no webglcontextlost handler. When the GPU resets (driver update, sleep/wake, backgrounded tab, memory pressure) the canvas goes blank permanently.'
    );
  }
  if (!raw.pageHandlers.hasContextRestoredHandler) {
    reasons.push(
      'The page registers no webglcontextrestored handler, so even a restored context will not trigger a rebuild of its GPU resources.'
    );
  }
  if (raw.lostEventFired && !raw.pagePreventedDefault) {
    reasons.push(
      'The page did not call preventDefault() on the webglcontextlost event. Without it the browser never restores the context, by specification.'
    );
  }
  if (raw.restoreThrew) reasons.push(`restoreContext() threw: ${raw.restoreThrew}`);

  if (!raw.contextRestored) {
    reasons.push('The context remained lost after a simulated driver recovery.');
    return { verdict: 'RECOVERY_FAIL', reasons, detail: raw };
  }

  if (!raw.renderingResumed) {
    reasons.push(
      `The context was restored but the page rendered only ${raw.framesRenderedAfterRestore} frame(s) afterwards. The canvas is alive while the render loop stays dead, which still looks frozen to a user.`
    );
    return { verdict: 'RECOVERY_PARTIAL', reasons, detail: raw };
  }

  if (reasons.length === 0) {
    reasons.push(
      `The page cancelled the loss event, regained its context, and rendered ${raw.framesRenderedAfterRestore} frames afterwards.`
    );
  }
  return { verdict: 'RECOVERY_PASS', reasons, detail: raw };
}
