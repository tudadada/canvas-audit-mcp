/**
 * canvas-audit-playwright
 *
 * Canvas, WebGL and display-quality assertions for Playwright tests.
 *
 *   import { test, expect } from 'canvas-audit-playwright';
 *
 *   test('home page renders sharply', async ({ page }) => {
 *     await page.goto('/');
 *     await expect(page).toHaveSharpCanvases();
 *     await expect(page).toHaveNoHorizontalOverflow();
 *     await expect(page).toMatchCanvasBaseline('home-desktop');
 *   });
 *
 * The browser is the one your test already opened, so an audit costs a few
 * page.evaluate calls rather than a browser launch.
 */
import { test as base } from '@playwright/test';
import { attachCanvasAudit } from './attach.js';

/**
 * Drop-in replacement for @playwright/test's `test`, with the audit
 * instrumentation installed on the context before any navigation.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await attachCanvasAudit(context);
    await use(context);
  },
});

export { expect } from './matchers.js';
export { attachCanvasAudit, evaluatorFor, assertInstrumented } from './attach.js';
export {
  auditPage,
  auditCanvasDpr,
  profileFramePacing,
  inspectErgonomics,
  testContextLossRecovery,
} from './audit.js';
export { checkBaseline, isUpdateMode, DEFAULT_BASELINE_PATH } from './baseline-store.js';
export { THRESHOLDS, summarizeReport, classifyRenderer } from 'canvas-audit-core';
