/**
 * Renderer classification.
 *
 * Headless Chromium draws with SwiftShader, a CPU rasteriser. Any GPU timing
 * collected there describes a software renderer, not the user's graphics card.
 * Reporting that honestly is the difference between a measurement and a number.
 */

const SOFTWARE_RENDERER_HINTS = [
  'swiftshader',
  'llvmpipe',
  'softpipe',
  'microsoft basic render',
  'software rasterizer',
  'mesa offscreen',
];

export function classifyRenderer(rendererString) {
  if (!rendererString) {
    return { backend: 'unknown', renderer: null, gpuMetricsTrustworthy: false, note: null };
  }

  const lowered = String(rendererString).toLowerCase();
  const isSoftware = SOFTWARE_RENDERER_HINTS.some((hint) => lowered.includes(hint));

  return {
    backend: isSoftware ? 'software' : 'hardware',
    renderer: rendererString,
    gpuMetricsTrustworthy: !isSoftware,
    note: isSoftware
      ? 'This page rendered through a software rasteriser (no real GPU). Frame-pacing and readback numbers below describe CPU-side emulation, not graphics hardware. Run in headed mode, or headless with a real GPU, for figures that represent what a user would see.'
      : null,
  };
}
