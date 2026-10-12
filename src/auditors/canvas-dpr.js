import { createAuditorContext, DEVICE_PRESETS } from '../utils/browser.js';

/**
 * Audits all canvas elements on a page across given presets or DPR settings.
 */
export async function auditCanvasDpr({
  url,
  preset = 'macbook_retina',
  customDpr = null,
  customViewport = null,
  captureScreenshot = true,
  waitForMs = 2000,
}) {
  const config = DEVICE_PRESETS[preset] ? { ...DEVICE_PRESETS[preset] } : { ...DEVICE_PRESETS.desktop_1080p };
  if (customDpr) config.deviceScaleFactor = customDpr;
  if (customViewport) config.viewport = customViewport;

  const { browser, context } = await createAuditorContext(config);
  try {
    const page = await context.newPage();
    
    // Inject listener trackers before page scripts run
    await page.addInitScript(() => {
      window.__canvas_audit_event_map = new WeakMap();
      const origAddEventListener = HTMLCanvasElement.prototype.addEventListener;
      HTMLCanvasElement.prototype.addEventListener = function (type, listener, options) {
        if (!window.__canvas_audit_event_map.has(this)) {
          window.__canvas_audit_event_map.set(this, new Set());
        }
        window.__canvas_audit_event_map.get(this).add(type);
        return origAddEventListener.call(this, type, listener, options);
      };
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (waitForMs > 0) {
      await page.waitForTimeout(waitForMs);
    }

    const evaluation = await page.evaluate(() => {
      const dpr = window.devicePixelRatio;
      const canvases = Array.from(document.querySelectorAll('canvas'));

      const results = canvases.map((canvas, index) => {
        const rect = canvas.getBoundingClientRect();
        const clientW = Math.round(rect.width);
        const clientH = Math.round(rect.height);
        const bufferW = canvas.width;
        const bufferH = canvas.height;

        const expectedBufferW = Math.round(clientW * dpr);
        const expectedBufferH = Math.round(clientH * dpr);

        const widthRatio = expectedBufferW > 0 ? bufferW / expectedBufferW : 1;
        const heightRatio = expectedBufferH > 0 ? bufferH / expectedBufferH : 1;
        const sharpnessIndex = Math.min(widthRatio, heightRatio);

        // Aspect ratio distortion check
        const cssAspect = clientH > 0 ? clientW / clientH : 1;
        const bufferAspect = bufferH > 0 ? bufferW / bufferH : 1;
        const aspectDistortion = Math.abs(cssAspect - bufferAspect) / cssAspect;

        // Context detection
        let contextType = 'unknown';
        let glInfo = null;
        try {
          const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
          if (gl) {
            contextType = canvas.getContext('webgl2') ? 'webgl2' : 'webgl';
            const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
            glInfo = {
              maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
              renderer: debugExt ? gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
              vendor: debugExt ? gl.getParameter(debugExt.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
              drawingBufferWidth: gl.drawingBufferWidth,
              drawingBufferHeight: gl.drawingBufferHeight,
            };
          } else if (canvas.getContext('2d')) {
            contextType = '2d';
          } else if (canvas.getContext('bitmaprenderer')) {
            contextType = 'bitmaprenderer';
          }
        } catch (e) {
          contextType = 'error_probing';
        }

        // Listener check
        const registeredEvents = window.__canvas_audit_event_map?.get(canvas) || new Set();
        const hasContextLostHandler = registeredEvents.has('webglcontextlost');
        const hasContextRestoredHandler = registeredEvents.has('webglcontextrestored');

        // Verdict analysis
        let status = 'OPTIMAL';
        const issues = [];

        if (sharpnessIndex < 0.85) {
          status = 'BLURRY';
          issues.push(
            `Canvas bị mờ trên màn hình DPR=${dpr}. Buffer hiện tại (${bufferW}x${bufferH}) nhỏ hơn chuẩn khuyến nghị (${expectedBufferW}x${expectedBufferH}). Cần gán canvas.width = clientWidth * window.devicePixelRatio.`
          );
        } else if (sharpnessIndex > 1.2) {
          status = 'OVERSIZED';
          issues.push(
            `Canvas render lãng phí tài nguyên. Buffer (${bufferW}x${bufferH}) lớn hơn cần thiết (${expectedBufferW}x${expectedBufferH}), gây tốn VRAM và nghẽn GPU.`
          );
        }

        if (aspectDistortion > 0.05 && clientW > 0 && clientH > 0) {
          issues.push(
            `Lỗi méo hình (Aspect Distortion ${(aspectDistortion * 100).toFixed(1)}%): Tỷ lệ khung CSS (${cssAspect.toFixed(2)}) khác tỷ lệ buffer (${bufferAspect.toFixed(2)}).`
          );
        }

        if ((contextType === 'webgl' || contextType === 'webgl2') && (!hasContextLostHandler || !hasContextRestoredHandler)) {
          issues.push(
            'Thiếu bộ lắng nghe tự hồi phục (webglcontextlost / webglcontextrestored). Trang web sẽ bị chết đứng vĩnh viễn nếu GPU bị crash hoặc reload.'
          );
        }

        return {
          index,
          id: canvas.id || `canvas[${index}]`,
          className: canvas.className || '',
          cssDimensions: { width: clientW, height: clientH },
          bufferDimensions: { width: bufferW, height: bufferH },
          expectedDimensions: { width: expectedBufferW, height: expectedBufferH },
          sharpnessRatio: Number(sharpnessIndex.toFixed(2)),
          aspectDistortion: Number(aspectDistortion.toFixed(3)),
          contextType,
          glInfo,
          selfRecovery: {
            hasContextLostHandler,
            hasContextRestoredHandler,
          },
          status,
          issues,
        };
      });

      return {
        dpr,
        canvasCount: canvases.length,
        results,
      };
    });

    let screenshotBase64 = null;
    if (captureScreenshot) {
      const buffer = await page.screenshot({ fullPage: false, type: 'png' });
      screenshotBase64 = buffer.toString('base64');
    }

    return {
      url,
      testedPreset: config.name,
      dpr: evaluation.dpr,
      viewport: config.viewport,
      canvasCount: evaluation.canvasCount,
      canvases: evaluation.results,
      screenshotBase64,
    };
  } finally {
    await browser.close();
  }
}
