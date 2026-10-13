import { installInstrumentation } from 'canvas-audit-core';

/**
 * Installs the audit instrumentation on a Playwright browser context (or page).
 *
 * Must run BEFORE the page navigates: the instrumentation wraps
 * requestAnimationFrame, getContext and addEventListener ahead of the page's own
 * scripts so it can record what the page does rather than substitute for it.
 *
 * The `test` export of this package does this for you.
 */
export async function attachCanvasAudit(contextOrPage) {
  await contextOrPage.addInitScript(installInstrumentation);
  return contextOrPage;
}

/** Wraps a Playwright page as the evaluator canvas-audit-core expects. */
export function evaluatorFor(page) {
  return (pageFunction, arg) => page.evaluate(pageFunction, arg);
}

/** Throws a useful message instead of a confusing null if the fixture is missing. */
export async function assertInstrumented(page) {
  const present = await page.evaluate(() => !!window.__canvasAudit);
  if (!present) {
    throw new Error(
      'canvas-audit instrumentation is not present on this page.\n' +
        "Import { test } from 'canvas-audit-playwright' instead of '@playwright/test',\n" +
        'or call attachCanvasAudit(context) before page.goto().'
    );
  }
}
