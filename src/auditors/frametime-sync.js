import { createAuditorContext, DEVICE_PRESETS } from '../utils/browser.js';

/**
 * True Sync Profiling:
 * Collects continuous frame intervals and uses WebGL synchronous readback
 * to prevent GPU async pipeline deception and V-Sync hopping miscalculations.
 */
export async function profileFrametimeSync({
  url,
  preset = 'desktop_1080p',
  sampleFrames = 180,
  warmupMs = 1500,
  cpuThrottleRate = 1,
}) {
  const config = DEVICE_PRESETS[preset] ? { ...DEVICE_PRESETS[preset] } : { ...DEVICE_PRESETS.desktop_1080p };
  const { browser, context } = await createAuditorContext(config);

  try {
    const page = await context.newPage();

    // Enable Chrome DevTools Protocol session for CPU throttling if requested
    if (cpuThrottleRate > 1) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottleRate });
    }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(warmupMs);

    // Profile frames in-page using continuous requestAnimationFrame + GPU Readback check
    const profileData = await page.evaluate(async (maxFrames) => {
      return new Promise((resolve) => {
        const frameDeltas = [];
        let lastTime = performance.now();
        let frameCount = 0;

        // Find primary canvas if present
        const canvases = Array.from(document.querySelectorAll('canvas'));
        let canvas = null;
        let gl = null;
        for (const c of canvases) {
          const ctx = c.getContext('webgl2') || c.getContext('webgl');
          if (ctx) {
            canvas = c;
            gl = ctx;
            break;
          }
        }
        if (!canvas && canvases.length > 0) {
          canvas = canvases[0];
        }
        const readBuffer = new Uint8Array(4);

        function tick(currentTime) {
          const delta = currentTime - lastTime;
          lastTime = currentTime;

          // Skip first frame delta
          if (frameCount > 0) {
            frameDeltas.push(delta);
          }

          // If WebGL is present, perform a micro readback test once every 30 frames to test real pipeline sync
          if (gl && frameCount % 30 === 0) {
            try {
              gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, readBuffer);
            } catch (e) {
              // Ignore if context lost or protected
            }
          }

          frameCount++;
          if (frameCount <= maxFrames) {
            requestAnimationFrame(tick);
          } else {
            resolve({
              hasCanvas: !!canvas,
              isWebGL: !!gl,
              frameDeltas,
            });
          }
        }

        requestAnimationFrame(tick);
      });
    }, sampleFrames);

    const deltas = profileData.frameDeltas;
    if (deltas.length === 0) {
      return {
        url,
        preset: config.name,
        error: 'Không thể thu thập dữ liệu khung hình (không có requestAnimationFrame đang chạy).',
      };
    }

    // Sort to calculate statistics
    const sorted = [...deltas].sort((a, b) => a - b);
    const sum = deltas.reduce((acc, val) => acc + val, 0);
    const avg = sum / deltas.length;
    const median = sorted[Math.floor(sorted.length * 0.5)];
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];

    // Measure V-Sync hopping and frame drops
    // 60Hz target = ~16.6ms. Frame > 25ms means drop below 40 FPS. Frame > 50ms means severe freeze.
    const droppedFrames = deltas.filter((d) => d > 25).length;
    const severeFreezes = deltas.filter((d) => d > 50).length;
    const dropRatePercent = Number(((droppedFrames / deltas.length) * 100).toFixed(1));

    // Jitter calculation (average delta-to-delta oscillation)
    let jitterSum = 0;
    for (let i = 1; i < deltas.length; i++) {
      jitterSum += Math.abs(deltas[i] - deltas[i - 1]);
    }
    const avgJitter = Number((jitterSum / (deltas.length - 1)).toFixed(2));

    let verdict = 'STABLE_60FPS';
    const observations = [];

    if (p95 > 50) {
      verdict = 'SEVERE_STUTTER';
      observations.push(
        `Hiện tượng giật cục nghiêm trọng (P95 = ${p95.toFixed(1)}ms). Hơn 5% số khung hình bị nghẽn vượt quá 50ms.`
      );
    } else if (p95 > 25) {
      verdict = 'DROPPING_FRAMES';
      observations.push(
        `Tụt khung hình (P95 = ${p95.toFixed(1)}ms, Drop Rate = ${dropRatePercent}%). Không duy trì được 60 FPS ổn định.`
      );
    }

    if (avgJitter > 8) {
      observations.push(
        `Khung hình bất ổn định (Jitter cao = ${avgJitter}ms). Có dấu hiệu hiện tượng V-Sync xen kẽ giữa các nhịp quét màn hình.`
      );
    }

    return {
      url,
      preset: config.name,
      cpuThrottleRate: `${cpuThrottleRate}x`,
      samplesAnalyzed: deltas.length,
      hasCanvas: profileData.hasCanvas,
      isWebGL: profileData.isWebGL,
      metrics: {
        medianFrametimeMs: Number(median.toFixed(2)),
        averageFrametimeMs: Number(avg.toFixed(2)),
        effectiveFps: Number((1000 / avg).toFixed(1)),
        p95FrametimeMs: Number(p95.toFixed(2)),
        p99FrametimeMs: Number(p99.toFixed(2)),
        minFrametimeMs: Number(min.toFixed(2)),
        maxFrametimeMs: Number(max.toFixed(2)),
        jitterMs: avgJitter,
        droppedFramesPercent: dropRatePercent,
        severeFreezesCount: severeFreezes,
      },
      verdict,
      observations,
    };
  } finally {
    await browser.close();
  }
}
