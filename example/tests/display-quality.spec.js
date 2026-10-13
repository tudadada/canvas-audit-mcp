/**
 * What a real consumer of canvas-audit-playwright writes.
 *
 * Note what is NOT here: no browser launch, no Chromium download, no second
 * tool. These assertions run against the page the test already opened.
 */
import { test, expect, auditPage } from 'canvas-audit-playwright';

test.describe('display quality', () => {
  test('catches a canvas that ignores devicePixelRatio', async ({ page }, testInfo) => {
    await page.goto('/blurry-animated.html');

    // On the 2x project this canvas is half the resolution it should be.
    if (testInfo.project.name === 'desktop-retina') {
      await expect(page).not.toHaveSharpCanvases();
    }

    const report = await auditPage(page, { framePacing: false, ergonomics: false });
    expect(report.canvas.canvases[0].contextType).toBe('2d');
  });

  test('passes a canvas that scales its buffer by DPR', async ({ page }) => {
    await page.goto('/sharp-animated.html');
    await expect(page).toHaveSharpCanvases();
  });

  test('a static page has no frame rate to report', async ({ page }) => {
    await page.goto('/static-no-animation.html');
    // The display still refreshes at 60Hz; the page renders nothing. The
    // matcher must fail rather than inherit the display's heartbeat.
    await expect(page).not.toSustainFrameRate({ sampleFrames: 30, timeoutMs: 2500 });
  });

  test('an animating page sustains its frame rate', async ({ page }) => {
    await page.goto('/sharp-animated.html');
    await expect(page).toSustainFrameRate({ minFps: 50, sampleFrames: 45 });
  });

  test('a WebGL app without recovery handling fails context loss', async ({ page }) => {
    await page.goto('/webgl-no-recovery.html');
    await expect(page).not.toSurviveContextLoss();
  });

  test('a WebGL app with correct recovery handling survives context loss', async ({ page }) => {
    await page.goto('/webgl-with-recovery.html');
    await expect(page).toSurviveContextLoss();
  });

  test('catches horizontal overflow and small touch targets', async ({ page }, testInfo) => {
    await page.goto('/mobile-overflow.html');

    // A 500px block only overflows a phone viewport, which is the point: the
    // same page is fine on a desktop and broken on a phone.
    if (testInfo.project.name === 'mobile') {
      await expect(page).not.toHaveNoHorizontalOverflow();
    } else {
      await expect(page).toHaveNoHorizontalOverflow();
    }

    await expect(page).not.toHaveAccessibleTouchTargets();
  });

  test('a clean page passes every layout assertion', async ({ page }) => {
    await page.goto('/clean.html');
    await expect(page).toHaveNoHorizontalOverflow();
    await expect(page).toHaveAccessibleTouchTargets();
  });
});

test.describe('baseline regression tracking', () => {
  test('records then compares a baseline', async ({ page }, testInfo) => {
    const baselinePath = testInfo.outputPath('canvas-audit.baseline.json');
    const id = `sharp-${testInfo.project.name}`;
    const options = { baselinePath, audit: { recovery: false, sampleFrames: 30, timeoutMs: 5000 } };

    await page.goto('/sharp-animated.html');
    // First run records the baseline, so it passes.
    await expect(page).toMatchCanvasBaseline(id, options);
    // Same page, unchanged: still no regression.
    await expect(page).toMatchCanvasBaseline(id, options);

    // Now the same id meets a page that is measurably worse. This must fail.
    await page.goto('/blurry-animated.html');
    await expect(page).not.toMatchCanvasBaseline(id, options);
  });
});
