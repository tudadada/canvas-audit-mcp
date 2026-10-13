import { chromium } from 'playwright';
import { installInstrumentation } from 'canvas-audit-core';

/**
 * Browser lifecycle for the MCP server.
 *
 * This is the only thing the MCP package still owns. Every measurement lives in
 * canvas-audit-core, shared with canvas-audit-playwright -- so a fix to a
 * threshold or a verdict lands in both at once, and the MCP server can never
 * drift from what CI asserts.
 */

export const DEVICE_PRESETS = {
  desktop_1080p: {
    name: 'Desktop Standard (1080p, DPR 1x)',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  macbook_retina: {
    name: 'MacBook Pro Retina (DPR 2x)',
    viewport: { width: 1512, height: 982 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
  },
  desktop_4k: {
    name: 'Desktop 4K Display (DPR 2x)',
    viewport: { width: 3840, height: 2160 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
  },
  mobile_iphone: {
    name: 'Mobile High-DPI (iPhone 15 Pro, DPR 3x)',
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  tablet_ipad: {
    name: 'Tablet (iPad Pro, DPR 2x)',
    viewport: { width: 1024, height: 1366 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
};

export function resolvePreset(preset, fallback = 'desktop_1080p') {
  return DEVICE_PRESETS[preset] ? { ...DEVICE_PRESETS[preset] } : { ...DEVICE_PRESETS[fallback] };
}

const SANDBOX_FAILURE_HINTS = [
  'No usable sandbox',
  'SUID sandbox',
  'Running as root without --no-sandbox',
  'namespace sandbox',
];

/**
 * Opens an instrumented page at `url` and hands it to `work`, then cleans up.
 *
 * Security posture: the Chromium sandbox stays enabled; if it genuinely cannot
 * start we retry once without it, warn on stderr, and report sandbox:false in
 * the result so a weakened posture is visible rather than silent. CSP is never
 * bypassed -- disabling it would change the behaviour being measured.
 */
export async function withAuditPage(url, presetName, fallbackPreset, work, { waitForMs = 0 } = {}) {
  const config = resolvePreset(presetName, fallbackPreset);
  const baseArgs = ['--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist'];

  let browser;
  let sandbox = true;
  try {
    browser = await chromium.launch({ headless: true, args: baseArgs });
  } catch (error) {
    const message = String(error && error.message);
    const sandboxProblem = SANDBOX_FAILURE_HINTS.some((hint) => message.includes(hint));
    if (!sandboxProblem || process.env.CANVAS_AUDIT_ALLOW_NO_SANDBOX === '0') throw error;
    sandbox = false;
    console.error(
      '[canvas-audit-mcp] Chromium sandbox unavailable here; retrying with --no-sandbox. ' +
        'Audited pages run with reduced isolation. Set CANVAS_AUDIT_ALLOW_NO_SANDBOX=0 to forbid this.'
    );
    browser = await chromium.launch({
      headless: true,
      args: [...baseArgs, '--no-sandbox', '--disable-setuid-sandbox'],
    });
  }

  try {
    const context = await browser.newContext({
      viewport: config.viewport,
      deviceScaleFactor: config.deviceScaleFactor,
      isMobile: config.isMobile,
      hasTouch: config.hasTouch,
      bypassCSP: false,
    });
    await context.addInitScript(installInstrumentation);

    const page = await context.newPage();
    const consoleErrors = [];
    const runtimeErrors = [];
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (!text.includes('fonts.gstatic.com') && !text.includes('fonts.googleapis.com')) {
        consoleErrors.push(text);
      }
    });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const load = {
      httpStatus: response ? response.status() : null,
      ok: response ? response.ok() : false,
    };
    if (response && !response.ok()) {
      load.warning = `The page returned HTTP ${load.httpStatus}. Any audit below describes the error page, not your application.`;
    } else if (!response) {
      load.warning = 'No HTTP response was captured for this navigation (cached, redirected or aborted).';
    }

    if (waitForMs > 0) await page.waitForTimeout(waitForMs);

    const evaluate = (pageFunction, arg) => page.evaluate(pageFunction, arg);
    const result = await work({ page, evaluate, config, load, sandbox, consoleErrors, runtimeErrors });

    return {
      url,
      preset: config.name,
      viewport: config.viewport,
      dpr: config.deviceScaleFactor,
      sandbox,
      load,
      ...result,
    };
  } finally {
    await browser.close();
  }
}
