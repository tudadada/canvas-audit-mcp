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
  console.log('=== BẮT ĐẦU KIỂM THỬ NỘI BỘ CANVAS-AUDIT-MCP ===\n');
  console.log(`URL thử nghiệm: ${testUrl}\n`);

  // 1. Test Canvas DPR Audit
  console.log('--- 1. Kiểm thử Canvas DPR Audit (Preset: macbook_retina, DPR=2) ---');
  const dprRes = await auditCanvasDpr({
    url: testUrl,
    preset: 'macbook_retina',
    captureScreenshot: false,
    waitForMs: 1000,
  });
  console.log(`Số lượng canvas: ${dprRes.canvasCount}`);
  for (const c of dprRes.canvases) {
    console.log(`\nCanvas [${c.id}]:`);
    console.log(`  - Kích thước CSS: ${c.cssDimensions.width}x${c.cssDimensions.height}px`);
    console.log(`  - Kích thước Buffer: ${c.bufferDimensions.width}x${c.bufferDimensions.height}px`);
    console.log(`  - Chuẩn khuyến nghị (DPR=${dprRes.dpr}): ${c.expectedDimensions.width}x${c.expectedDimensions.height}px`);
    console.log(`  - Tỷ lệ độ nét (Sharpness): ${(c.sharpnessRatio * 100).toFixed(0)}% -> Trạng thái: ${c.status}`);
    if (c.issues.length > 0) {
      console.log(`  - Vấn đề phát hiện:`);
      c.issues.forEach((iss) => console.log(`     * ${iss}`));
    }
  }

  // 2. Test Ergonomics Audit
  console.log('\n--- 2. Kiểm thử Công thái học (Ergonomics, Ngưỡng 32px) ---');
  const ergoRes = await inspectResponsiveErgonomics({
    url: testUrl,
    preset: 'mobile_iphone',
    minTouchSize: 32,
    captureScreenshot: false,
  });
  console.log(`Vấn đề phát hiện: ${ergoRes.audit.issues.length}`);
  for (const iss of ergoRes.audit.issues) {
    console.log(`  - [${iss.severity}] ${iss.message}`);
    if (iss.samples) {
      iss.samples.forEach((s) => console.log(`     * Tag: ${s.tag}, Kích thước: ${s.dimensions}, Nội dung: "${s.text}"`));
    }
  }

  // 3. Test Adaptive Recovery
  console.log('\n--- 3. Kiểm thử Tự hồi phục WebGL khi GPU Context Loss ---');
  const recRes = await testAdaptiveRecovery({
    url: testUrl,
    preset: 'desktop_1080p',
    testContextLoss: true,
  });
  console.log(`Kết quả: ${recRes.verdict}`);
  console.log(`  - Hỗ trợ mô phỏng mất context: ${recRes.contextLossResult?.supported}`);
  console.log(`  - Bắt được sự kiện mất context (lost): ${recRes.contextLossResult?.lostTriggered}`);
  console.log(`  - Phục hồi thành công (restored): ${recRes.contextLossResult?.isRestored}`);

  // 4. Test True Sync Frametime
  console.log('\n--- 4. Kiểm thử Đo đạc Frametime True Sync (60 frames) ---');
  const frameRes = await profileFrametimeSync({
    url: testUrl,
    sampleFrames: 60,
    warmupMs: 500,
  });
  console.log(`Đánh giá: ${frameRes.verdict}`);
  console.log(`  - Median Frametime: ${frameRes.metrics?.medianFrametimeMs} ms`);
  console.log(`  - P95 Frametime: ${frameRes.metrics?.p95FrametimeMs} ms`);
  console.log(`  - Effective FPS: ${frameRes.metrics?.effectiveFps} FPS`);
  console.log(`  - Jitter: ${frameRes.metrics?.jitterMs} ms`);

  console.log('\n=== TẤT CẢ KIỂM THỬ ĐÃ HOÀN TẤT THÀNH CÔNG! ===');
}

runTests().catch((err) => {
  console.error('Lỗi kiểm thử:', err);
  process.exit(1);
});
