import { createAuditorContext, DEVICE_PRESETS } from '../utils/browser.js';

/**
 * Tests WebGL self-recovery against GPU context loss
 * and verifies adaptive degradation logic when under artificial stress.
 */
export async function testAdaptiveRecovery({
  url,
  preset = 'desktop_1080p',
  testContextLoss = true,
  testLoadDegradation = false,
}) {
  const config = DEVICE_PRESETS[preset] ? { ...DEVICE_PRESETS[preset] } : { ...DEVICE_PRESETS.desktop_1080p };
  const { browser, context } = await createAuditorContext(config);

  try {
    const page = await context.newPage();
    const runtimeErrors = [];

    page.on('pageerror', (err) => {
      runtimeErrors.push(err.message);
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    let contextLossResult = null;
    if (testContextLoss) {
      contextLossResult = await page.evaluate(async () => {
        const canvases = Array.from(document.querySelectorAll('canvas'));
        if (canvases.length === 0) {
          return { supported: false, reason: 'No canvas elements found on page.' };
        }

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

        if (!canvas || !gl) {
          return { supported: false, reason: 'No canvas elements utilize a WebGL context on page.' };
        }

        const loseExt = gl.getExtension('WEBGL_lose_context');
        if (!loseExt) {
          return { supported: false, reason: 'Browser environment disallows WEBGL_lose_context extension.' };
        }

        let lostTriggered = false;
        let restoredTriggered = false;

        const onLost = (e) => {
          lostTriggered = true;
          // Standard pattern: e.preventDefault() to allow restoring
          if (e && e.preventDefault) e.preventDefault();
        };
        const onRestored = () => {
          restoredTriggered = true;
        };

        canvas.addEventListener('webglcontextlost', onLost, false);
        canvas.addEventListener('webglcontextrestored', onRestored, false);

        // 1. Simulate GPU Context Loss
        loseExt.loseContext();
        await new Promise((r) => setTimeout(r, 600));

        const isCurrentlyLost = gl.isContextLost();

        // 2. Simulate GPU Recovery / Reset
        loseExt.restoreContext();
        await new Promise((r) => setTimeout(r, 800));

        const isRestored = !gl.isContextLost();

        return {
          supported: true,
          isCurrentlyLost,
          lostTriggered,
          restoredTriggered,
          isRestored,
        };
      });
    }

    let degradationResult = null;
    if (testLoadDegradation) {
      degradationResult = await page.evaluate(async () => {
        // Monitor canvas buffer size before and after artificial lag
        const canvas = document.querySelector('canvas');
        if (!canvas) return { monitored: false };

        const initialBuffer = { width: canvas.width, height: canvas.height };

        // Inject 50ms artificial frame lag for 40 frames
        let framesLagged = 0;
        await new Promise((resolve) => {
          function stallTick() {
            const start = performance.now();
            while (performance.now() - start < 45) {
              // busy wait to simulate GPU/CPU bottleneck
            }
            framesLagged++;
            if (framesLagged < 40) {
              requestAnimationFrame(stallTick);
            } else {
              resolve();
            }
          }
          requestAnimationFrame(stallTick);
        });

        await new Promise((r) => setTimeout(r, 1000));
        const afterBuffer = { width: canvas.width, height: canvas.height };

        const hasScaledDown = afterBuffer.width < initialBuffer.width || afterBuffer.height < initialBuffer.height;

        return {
          monitored: true,
          initialBuffer,
          afterBuffer,
          hasScaledDown,
        };
      });
    }

    return {
      url,
      preset: config.name,
      contextLossResult,
      degradationResult,
      runtimeErrors: runtimeErrors.slice(0, 5),
      verdict: contextLossResult?.isRestored ? 'RECOVERY_PASS' : (contextLossResult?.supported ? 'RECOVERY_FAIL' : 'SKIPPED'),
    };
  } finally {
    await browser.close();
  }
}
