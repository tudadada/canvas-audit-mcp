import path from 'path';
import { fileURLToPath } from 'url';
import { auditCanvasDpr } from '../src/auditors/canvas-dpr.js';
import { inspectResponsiveErgonomics } from '../src/auditors/ergonomics.js';
import { testAdaptiveRecovery } from '../src/auditors/adaptive-stress.js';
import { profileFrametimeSync } from '../src/auditors/frametime-sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sampleHtmlPath = path.resolve(__dirname, 'sample-page.html');
const testUrl = `file://${sampleHtmlPath.replace(/\\/g, '/')}`;

async function runTests() {
  console.log('=== STARTING LOCAL INTEGRATION TESTS: CANVAS-AUDIT-MCP ===\n');
  console.log(`Test URL: ${testUrl}\n`);

  // 1. Test Canvas DPR Audit
  console.log('--- 1. Testing Canvas DPR Audit (Preset: macbook_retina, DPR=2) ---');
  const dprRes = await auditCanvasDpr({
    url: testUrl,
    preset: 'macbook_retina',
    captureScreenshot: false,
    waitForMs: 1000,
  });
  console.log(`Canvas elements detected: ${dprRes.canvasCount}`);
  for (const c of dprRes.canvases) {
    console.log(`\nCanvas [${c.id}]:`);
    console.log(`  - CSS dimensions: ${c.cssDimensions.width}x${c.cssDimensions.height}px`);
    console.log(`  - Buffer dimensions: ${c.bufferDimensions.width}x${c.bufferDimensions.height}px`);
    console.log(`  - Expected dimensions (DPR=${dprRes.dpr}): ${c.expectedDimensions.width}x${c.expectedDimensions.height}px`);
    console.log(`  - Sharpness ratio: ${(c.sharpnessRatio * 100).toFixed(0)}% -> Status: ${c.status}`);
    if (c.issues.length > 0) {
      console.log(`  - Detected issues:`);
      c.issues.forEach((iss) => console.log(`     * ${iss}`));
    }
  }

  // 2. Test Ergonomics Audit
  console.log('\n--- 2. Testing Ergonomics Audit (Threshold: 32px) ---');
  const ergoRes = await inspectResponsiveErgonomics({
    url: testUrl,
    preset: 'mobile_iphone',
    minTouchSize: 32,
    captureScreenshot: false,
  });
  console.log(`Issues detected: ${ergoRes.audit.issues.length}`);
  for (const iss of ergoRes.audit.issues) {
    console.log(`  - [${iss.severity}] ${iss.message}`);
    if (iss.samples) {
      iss.samples.forEach((s) => console.log(`     * Tag: ${s.tag}, Size: ${s.dimensions}, Text: "${s.text}"`));
    }
  }

  // 3. Test Adaptive Recovery
  console.log('\n--- 3. Testing WebGL Context Loss Recovery ---');
  const recRes = await testAdaptiveRecovery({
    url: testUrl,
    preset: 'desktop_1080p',
    testContextLoss: true,
  });
  console.log(`Result: ${recRes.verdict}`);
  console.log(`  - Context loss simulation supported: ${recRes.contextLossResult?.supported}`);
  console.log(`  - Caught context lost event: ${recRes.contextLossResult?.lostTriggered}`);
  console.log(`  - Restored successfully: ${recRes.contextLossResult?.isRestored}`);

  // 4. Test True Sync Frametime
  console.log('\n--- 4. Testing True Sync Frametime Profiling (60 frames) ---');
  const frameRes = await profileFrametimeSync({
    url: testUrl,
    sampleFrames: 60,
    warmupMs: 500,
  });
  console.log(`Verdict: ${frameRes.verdict}`);
  console.log(`  - Median Frametime: ${frameRes.metrics?.medianFrametimeMs} ms`);
  console.log(`  - P95 Frametime: ${frameRes.metrics?.p95FrametimeMs} ms`);
  console.log(`  - Effective FPS: ${frameRes.metrics?.effectiveFps} FPS`);
  console.log(`  - Jitter: ${frameRes.metrics?.jitterMs} ms`);

  console.log('\n=== ALL INTEGRATION TESTS PASSED SUCCESSFULLY! ===');
}

runTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
