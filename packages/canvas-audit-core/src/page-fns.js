/**
 * Functions that execute INSIDE the page.
 *
 * Every function here is serialised by the driver (Playwright, Puppeteer, raw
 * CDP), so each one must be self-contained: no imports, no closures, no shared
 * helpers. They collect raw data only -- all judgement happens in Node, in
 * analysis.js, where it can be unit-tested without a browser.
 */

/** Collects raw canvas geometry and context facts. */
export function collectCanvasData() {
  const state = window.__canvasAudit;
  const dpr = window.devicePixelRatio;
  const canvases = Array.from(document.querySelectorAll('canvas'));

  const results = canvases.map((canvas, index) => {
    const rect = canvas.getBoundingClientRect();
    const clientW = canvas.clientWidth || Math.round(rect.width);
    const clientH = canvas.clientHeight || Math.round(rect.height);

    const recordedType = state ? state.ctxTypes.get(canvas) : undefined;
    const contextType = recordedType || 'none';
    const isWebGL =
      contextType === 'webgl' || contextType === 'webgl2' || contextType === 'experimental-webgl';

    let glInfo = null;
    if (isWebGL) {
      try {
        const gl = canvas.getContext(recordedType);
        if (gl && !gl.isContextLost()) {
          const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
          glInfo = {
            maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
            renderer: debugExt
              ? gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL)
              : gl.getParameter(gl.RENDERER),
            vendor: debugExt ? gl.getParameter(debugExt.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
            drawingBufferWidth: gl.drawingBufferWidth,
            drawingBufferHeight: gl.drawingBufferHeight,
          };
        }
      } catch {
        glInfo = null;
      }
    }

    const registered = (state && state.listeners.get(canvas)) || new Set();

    return {
      index,
      id: canvas.id || `canvas[${index}]`,
      className: canvas.className || '',
      cssWidth: clientW,
      cssHeight: clientH,
      bufferWidth: canvas.width,
      bufferHeight: canvas.height,
      contextType,
      isWebGL,
      glInfo,
      hasContextLostHandler:
        registered.has('webglcontextlost') || typeof canvas.onwebglcontextlost === 'function',
      hasContextRestoredHandler:
        registered.has('webglcontextrestored') || typeof canvas.onwebglcontextrestored === 'function',
    };
  });

  return { instrumented: !!state, dpr, canvasCount: canvases.length, canvases: results };
}

/** Samples frames the PAGE renders, plus a GPU readback stall measurement. */
export async function collectFramePacingData({ sampleFrames, timeoutMs }) {
  const state = window.__canvasAudit;
  if (!state) return { instrumented: false };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Poll with setTimeout, not requestAnimationFrame: polling with rAF would keep
  // the compositor awake and hide a page that has stopped drawing.
  const startIndex = state.appFrames.length;
  const deadline = performance.now() + timeoutMs;
  while (state.appFrames.length - startIndex < sampleFrames && performance.now() < deadline) {
    await sleep(25);
  }
  const collected = state.appFrames.slice(startIndex, startIndex + sampleFrames);

  // Only ever touch contexts the page created itself.
  const canvases = Array.from(document.querySelectorAll('canvas'));
  let gl = null;
  let glRenderer = null;
  for (const canvas of canvases) {
    const type = state.ctxTypes.get(canvas);
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
      const context = canvas.getContext(type);
      if (context && !context.isContextLost()) {
        gl = context;
        const debugExt = context.getExtension('WEBGL_debug_renderer_info');
        glRenderer = debugExt
          ? context.getParameter(debugExt.UNMASKED_RENDERER_WEBGL)
          : context.getParameter(context.RENDERER);
        break;
      }
    }
  }

  let readbackStalls = null;
  if (gl) {
    const pixel = new Uint8Array(4);
    readbackStalls = [];
    for (let i = 0; i < 12; i++) {
      await new Promise((resolve) => state.rawRAF(() => resolve()));
      const started = performance.now();
      try {
        // readPixels forces the driver to drain queued commands, so the stall
        // is a real measure of GPU backlog. The value is used, not discarded.
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      } catch {
        readbackStalls = null;
        break;
      }
      readbackStalls.push(performance.now() - started);
    }
  }

  return {
    instrumented: true,
    hasCanvas: canvases.length > 0,
    isWebGL: !!gl,
    glRenderer,
    rafCallsByPage: state.rafCalls,
    frames: collected.map((f) => ({ ts: f.ts, cpuMs: f.cpuMs })),
    readbackStalls,
  };
}

/** Collects layout geometry, interactive element sizes and clipped text. */
export function collectErgonomicsData({ minTouchSize }) {
  const layoutWidth = document.documentElement.clientWidth;
  const layoutHeight = document.documentElement.clientHeight;
  const scrollWidth = document.documentElement.scrollWidth;

  const overflowElements = [];
  if (scrollWidth > layoutWidth + 2) {
    for (const element of Array.from(document.querySelectorAll('*'))) {
      const rect = element.getBoundingClientRect();
      if (rect.right > layoutWidth + 2 && rect.width > 0 && rect.height > 0) {
        overflowElements.push({
          tag: element.tagName.toLowerCase(),
          id: element.id || '',
          className: element.className ? String(element.className).substring(0, 50) : '',
          rightOffset: Math.round(rect.right - layoutWidth),
          width: Math.round(rect.width),
        });
        if (overflowElements.length >= 5) break;
      }
    }
  }

  const undersizedTargets = [];
  const interactives = Array.from(
    document.querySelectorAll('button, a, input, select, textarea, [role="button"], [onclick]')
  );
  for (const element of interactives) {
    const rect = element.getBoundingClientRect();
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < layoutHeight &&
      rect.left < layoutWidth;
    if (!visible) continue;

    const style = window.getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;

    const smallest = Math.min(rect.width, rect.height);
    if (rect.width < minTouchSize || rect.height < minTouchSize || smallest < 44) {
      undersizedTargets.push({
        tag: element.tagName.toLowerCase(),
        text: (element.innerText || element.getAttribute('aria-label') || element.value || '')
          .trim()
          .substring(0, 40),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        smallestSidePx: Math.round(smallest),
        id: element.id || '',
        className: element.className ? String(element.className).substring(0, 40) : '',
      });
    }
  }

  const clippedTexts = [];
  for (const element of Array.from(
    document.querySelectorAll('p, h1, h2, h3, h4, span, div.title, div.desc')
  )) {
    if (element.children.length !== 0) continue;
    if ((element.innerText || '').trim().length <= 15) continue;
    const style = window.getComputedStyle(element);
    if (style.overflow !== 'hidden' && style.overflowY !== 'hidden') continue;
    if (element.scrollHeight > element.clientHeight + 4 && element.clientHeight > 0) {
      clippedTexts.push({
        tag: element.tagName.toLowerCase(),
        text: (element.innerText || '').substring(0, 50),
        clippedHeight: element.scrollHeight - element.clientHeight,
      });
      if (clippedTexts.length >= 4) break;
    }
  }

  return {
    layoutWidth,
    layoutHeight,
    windowInnerWidth: window.innerWidth,
    visualViewportWidth: window.visualViewport ? Math.round(window.visualViewport.width) : null,
    scrollWidth,
    overflowElements,
    undersizedTargets,
    clippedTexts,
  };
}

/**
 * Simulates a GPU context loss and observes what the PAGE does about it.
 * Never calls preventDefault() and never restores on the page's behalf, so a
 * pass cannot be manufactured by the auditor.
 */
export async function runContextLossProbe() {
  const state = window.__canvasAudit;
  if (!state) return { supported: false, reason: 'Instrumentation was not installed in this page.' };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const canvases = Array.from(document.querySelectorAll('canvas'));
  if (canvases.length === 0) return { supported: false, reason: 'No canvas elements found on page.' };

  let canvas = null;
  let gl = null;
  for (const candidate of canvases) {
    const type = state.ctxTypes.get(candidate);
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
      const context = candidate.getContext(type);
      if (context) {
        canvas = candidate;
        gl = context;
        break;
      }
    }
  }
  if (!gl) return { supported: false, reason: 'No canvas on this page uses a WebGL context.' };

  const loseExt = gl.getExtension('WEBGL_lose_context');
  if (!loseExt) {
    return { supported: false, reason: 'WEBGL_lose_context is unavailable in this browser build.' };
  }

  // What did the page register, before we touch anything?
  const registered = state.listeners.get(canvas) || new Set();
  const pageHandlers = {
    hasContextLostHandler:
      registered.has('webglcontextlost') || typeof canvas.onwebglcontextlost === 'function',
    hasContextRestoredHandler:
      registered.has('webglcontextrestored') || typeof canvas.onwebglcontextrestored === 'function',
  };

  // Passive observers, registered through the untouched addEventListener and
  // registered last, so defaultPrevented reflects the PAGE's decision.
  const observed = { lostEventFired: false, pagePreventedDefault: false, restoredEventFired: false };
  state.rawAddEventListener.call(canvas, 'webglcontextlost', (event) => {
    observed.lostEventFired = true;
    observed.pagePreventedDefault = event.defaultPrevented;
  });
  state.rawAddEventListener.call(canvas, 'webglcontextrestored', () => {
    observed.restoredEventFired = true;
  });

  loseExt.loseContext();
  await sleep(800);
  const contextLostConfirmed = gl.isContextLost();

  let restoreThrew = null;
  try {
    loseExt.restoreContext();
  } catch (error) {
    restoreThrew = String(error && error.message);
  }
  await sleep(1200);
  const contextRestored = !gl.isContextLost();

  const framesAtRestore = state.appFrames.length;
  await sleep(1000);
  const framesRenderedAfterRestore = state.appFrames.length - framesAtRestore;

  return {
    supported: true,
    pageHandlers,
    contextLostConfirmed,
    lostEventFired: observed.lostEventFired,
    pagePreventedDefault: observed.pagePreventedDefault,
    restoredEventFired: observed.restoredEventFired,
    contextRestored,
    restoreThrew,
    framesRenderedAfterRestore,
    renderingResumed: framesRenderedAfterRestore > 5,
  };
}
