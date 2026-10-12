import { chromium } from 'playwright';

/**
 * Creates and configures a browser instance and context with specific display and GPU flags.
 */
export async function createAuditorContext(options = {}) {
  const {
    viewport = { width: 1440, height: 900 },
    deviceScaleFactor = 1,
    isMobile = false,
    hasTouch = false,
    userAgent = undefined,
    disableFonts = false,
  } = options;

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
  ];

  if (disableFonts) {
    launchArgs.push('--disable-remote-fonts');
  }

  const browser = await chromium.launch({
    headless: true,
    args: launchArgs,
  });

  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    userAgent,
    bypassCSP: true,
  });

  return { browser, context };
}

/**
 * Common device presets for auditing
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
