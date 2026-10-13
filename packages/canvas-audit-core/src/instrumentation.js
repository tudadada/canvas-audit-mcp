/**
 * Page instrumentation.
 *
 * Must stay self-contained: this function is serialised and injected into the
 * page before any of the page's own scripts run. It closes over nothing.
 *
 * Design rule: observe, never substitute. Everything an auditor needs to know
 * about the page is recorded passively here, so no measurement ends up
 * describing the measuring instrument.
 */
export function installInstrumentation() {
  const w = /** @type {any} */ (window);
  if (w.__canvasAudit) return;

  const state = {
    version: 1,
    appFrames: [],
    rafCalls: 0,
    ctxTypes: new WeakMap(),
    listeners: new WeakMap(),
    rawRAF: w.requestAnimationFrame.bind(w),
    rawAddEventListener: EventTarget.prototype.addEventListener,
    maxFrames: 4000,
  };
  w.__canvasAudit = state;

  const originalRAF = state.rawRAF;
  w.requestAnimationFrame = function instrumentedRAF(callback) {
    if (typeof callback !== 'function') return originalRAF(callback);
    state.rafCalls++;
    return originalRAF(function instrumentedFrame(timestamp) {
      const started = performance.now();
      try {
        return callback(timestamp);
      } finally {
        const ended = performance.now();
        state.appFrames.push({ ts: timestamp, cpuMs: ended - started });
        if (state.appFrames.length > state.maxFrames) {
          state.appFrames.splice(0, state.appFrames.length - state.maxFrames);
        }
      }
    });
  };

  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function instrumentedGetContext(type, ...rest) {
    const context = originalGetContext.call(this, type, ...rest);
    if (context && !state.ctxTypes.has(this)) state.ctxTypes.set(this, type);
    return context;
  };

  const originalAddEventListener = HTMLCanvasElement.prototype.addEventListener;
  HTMLCanvasElement.prototype.addEventListener = function instrumentedAEL(type, listener, options) {
    let registered = state.listeners.get(this);
    if (!registered) {
      registered = new Set();
      state.listeners.set(this, registered);
    }
    registered.add(type);
    return originalAddEventListener.call(this, type, listener, options);
  };
}

/** Source text, for drivers that inject scripts as strings rather than functions. */
export const INSTRUMENTATION_SOURCE = `(${installInstrumentation.toString()})();`;
