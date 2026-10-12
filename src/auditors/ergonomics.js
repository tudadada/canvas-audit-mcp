import { createAuditorContext, DEVICE_PRESETS } from '../utils/browser.js';

/**
 * Ergonomics and Visual Integrity Auditor:
 * Evaluates touch targets, horizontal overflow leaks, text clipping/wrapping,
 * and layout integrity across viewport sizes.
 */
export async function inspectResponsiveErgonomics({
  url,
  preset = 'mobile_iphone',
  minTouchSize = 32,
  captureScreenshot = true,
}) {
  const config = DEVICE_PRESETS[preset] ? { ...DEVICE_PRESETS[preset] } : { ...DEVICE_PRESETS.mobile_iphone };
  const { browser, context } = await createAuditorContext(config);

  try {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Filter noisy benign font network errors
        if (!text.includes('fonts.gstatic.com') && !text.includes('fonts.googleapis.com')) {
          consoleErrors.push(text);
        }
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    const audit = await page.evaluate(({ minTouchSize, isMobile }) => {
      const issues = [];
      const windowW = window.innerWidth;
      const windowH = window.innerHeight;
      const docScrollW = document.documentElement.scrollWidth;

      // 1. Horizontal Overflow Check
      // 1. Horizontal Overflow Check
      let overflowElements = [];
      if (docScrollW > windowW + 2) {
        issues.push({
          type: 'HORIZONTAL_OVERFLOW',
          severity: 'HIGH',
          message: `Horizontal overflow detected! scrollWidth (${docScrollW}px) exceeds viewport width (${windowW}px), creating rogue horizontal scrollbars.`,
        });

        // Identify offenders
        const allElements = Array.from(document.querySelectorAll('*'));
        for (const el of allElements) {
          const rect = el.getBoundingClientRect();
          if (rect.right > windowW + 2 && rect.width > 0 && rect.height > 0) {
            overflowElements.push({
              tag: el.tagName.toLowerCase(),
              id: el.id || '',
              className: el.className ? String(el.className).substring(0, 50) : '',
              rightOffset: Math.round(rect.right - windowW),
              width: Math.round(rect.width),
            });
            if (overflowElements.length >= 5) break;
          }
        }
      }

      // 2. Touch Target Ergonomics (< minTouchSize px)
      const interactiveSelector = 'button, a, input, select, textarea, [role="button"], [onclick]';
      const interactives = Array.from(document.querySelectorAll(interactiveSelector));
      const undersizedTargets = [];

      for (const el of interactives) {
        const rect = el.getBoundingClientRect();
        // Check only visible elements
        if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < windowH && rect.left < windowW) {
          const style = window.getComputedStyle(el);
          if (style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0') {
            if (rect.width < minTouchSize || rect.height < minTouchSize) {
              const textContent = (el.innerText || el.getAttribute('aria-label') || el.value || '').trim().substring(0, 40);
              undersizedTargets.push({
                tag: el.tagName.toLowerCase(),
                text: textContent || '[no text]',
                dimensions: `${Math.round(rect.width)}x${Math.round(rect.height)}px`,
                id: el.id || '',
                className: el.className ? String(el.className).substring(0, 40) : '',
              });
            }
          }
        }
      }

      if (undersizedTargets.length > 0) {
        issues.push({
          type: 'UNDERSIZED_TOUCH_TARGETS',
          severity: isMobile ? 'HIGH' : 'MEDIUM',
          message: `Detected ${undersizedTargets.length} interactive elements smaller than minimum touch threshold (${minTouchSize}px), hindering mobile ergonomics.`,
          count: undersizedTargets.length,
          samples: undersizedTargets.slice(0, 6),
        });
      }

      // 3. Text Clipping and Unintended Overflow
      const textContainers = Array.from(document.querySelectorAll('p, h1, h2, h3, h4, span, div.title, div.desc'));
      const clippedTexts = [];
      for (const el of textContainers) {
        if (el.children.length === 0 && (el.innerText || '').trim().length > 15) {
          const style = window.getComputedStyle(el);
          if (style.overflow === 'hidden' || style.overflowY === 'hidden') {
            if (el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 0) {
              clippedTexts.push({
                tag: el.tagName.toLowerCase(),
                text: (el.innerText || '').substring(0, 50),
                clippedHeight: el.scrollHeight - el.clientHeight,
              });
              if (clippedTexts.length >= 4) break;
            }
          }
        }
      }

      if (clippedTexts.length > 0) {
        issues.push({
          type: 'TEXT_CLIPPING',
          severity: 'MEDIUM',
          message: `Detected ${clippedTexts.length} clipped text blocks (overflow: hidden with content exceeding bounding height).`,
          samples: clippedTexts,
        });
      }

      return {
        viewportWidth: windowW,
        viewportHeight: windowH,
        scrollWidth: docScrollW,
        overflowElements,
        issues,
      };
    }, { minTouchSize, isMobile: config.isMobile });

    let screenshotBase64 = null;
    if (captureScreenshot) {
      const buffer = await page.screenshot({ fullPage: false, type: 'png' });
      screenshotBase64 = buffer.toString('base64');
    }

    return {
      url,
      preset: config.name,
      viewport: config.viewport,
      isMobile: config.isMobile,
      dpr: config.deviceScaleFactor,
      audit,
      consoleErrors: consoleErrors.slice(0, 5),
      screenshotBase64,
    };
  } finally {
    await browser.close();
  }
}
