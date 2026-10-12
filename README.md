# canvas-audit-mcp

> **Opinionated Canvas, WebGL & Display Quality Auditor for Model Context Protocol (MCP)**

Khác với các công cụ browser automation thông thường (chỉ cung cấp "cánh tay" để click/mở trang), **`canvas-audit-mcp`** là một **"con mắt có quan điểm khắt khe"** (Opinionated Eye) được đóng gói từ những kinh nghiệm xương máu khi kiểm thử đồ họa web thực tế:
- **Không ảo tưởng phần cứng:** Không cố "giả lập GPU vật lý bằng phần mềm". Thay vào đó, tập trung vào việc mô phỏng chính xác mật độ điểm ảnh (DPR), kiểm tra tính toàn vẹn bố cục (Layout/Ergonomics) và kiểm tra khả năng tự hồi phục khi card đồ họa reset.
- **Loại bỏ 3 bẫy đo lừa dối:** Đánh bại hiện tượng GPU xếp hàng bất đồng bộ, bỏ qua hàm `gl.finish()` giả mạo của Chrome, và đo phân phối khung hình (Median, P95, VSync Jitter) trên 180 frames để không bị nhịp quét màn hình đánh lừa.
- **Chẩn đoán mờ nét Canvas/WebGL:** Tự động phát hiện lỗi quên nhân `devicePixelRatio` khiến canvas bị mờ vỡ nét trên màn hình Retina (MacBook, 4K, iPhone).

---

## 🛠 Danh sách công cụ (MCP Tools)

### 1. `audit_canvas_dpr`
Quét toàn bộ thẻ `<canvas>` trong trang web:
- **Phát hiện mờ nét (Blurry):** Cảnh báo nếu `canvas.width < clientWidth * DPR` kèm tỷ lệ mờ.
- **Phát hiện lãng phí (Oversized):** Cảnh báo nếu render dư thừa điểm ảnh gây tốn VRAM.
- **Lỗi méo hình (Aspect Distortion):** So sánh tỷ lệ khung hình CSS với tỷ lệ điểm ảnh buffer.
- **Tự hồi phục (Resilience):** Kiểm tra xem canvas có lắng nghe sự kiện `webglcontextlost` hay không.

### 2. `profile_frametime_sync`
Đo hiệu năng và độ mượt bằng kỹ thuật **True Sync Profiling**:
- Trả về **Median Frametime** (ms) và **Effective FPS**.
- **P95 Frametime** (ms): Bắt các khung hình bị giật cục nặng nhất.
- **Jitter** (ms): Đo độ lệch nhịp giữa các frame liên tiếp (bắt hiện tượng V-Sync xen kẽ 17ms - 450ms).
- Hỗ trợ bóp chậm CPU (`cpuThrottleRate`: 1x - 6x) qua Chrome DevTools Protocol.

### 3. `inspect_responsive_ergonomics`
Bộ kiểm tra công thái học và giao diện:
- **Ngưỡng chạm ngón tay:** Bắt tất cả các nút hoặc link nhỏ hơn **32px × 32px** (hoặc tùy chỉnh).
- **Tràn viền ngang:** Tìm chính xác phần tử làm `scrollWidth > innerWidth` sinh thanh cuộn rác.
- **Chữ bị cắt cụt (Text Clipping):** Tìm các khối text bị `overflow: hidden` làm mất chữ.

### 4. `test_adaptive_recovery`
- Mô phỏng sập card đồ họa thông qua extension `WEBGL_lose_context`.
- Kiểm tra xem trang web có tự động bắt sự kiện và phục hồi (`webglcontextrestored`) để tiếp tục vẽ hay bị chết đứng.

### 5. `compare_device_matrix`
- Tự động chạy quét trang web trên **3 phân khúc chuẩn**:
  - `desktop_1080p` (Màn hình thường, DPR 1x)
  - `macbook_retina` (Màn hình sắc nét, DPR 2x)
  - `mobile_iphone` (Màn hình điện thoại cao cấp, DPR 3x)
- Xuất bảng so sánh tổng hợp trực quan.

---

## 🚀 Hướng dẫn Cài đặt & Cấu hình

### 1. Cài đặt môi trường
Dự án yêu cầu **Node.js >= 18**:
```bash
cd "canvas-audit-mcp"
npm install
npx playwright install chromium
```

### 2. Tích hợp vào Google Antigravity
Thêm vào file cấu hình `~/.gemini/config/mcp_config.json`:
```json
{
  "mcpServers": {
    "canvas-audit": {
      "command": "node",
      "args": ["E:/Project A/Today - Tram trung chuyen/canvas-audit-mcp/src/index.js"]
    }
  }
}
```

### 3. Tích hợp vào Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "canvas-audit": {
      "command": "node",
      "args": ["E:/Project A/Today - Tram trung chuyen/canvas-audit-mcp/src/index.js"]
    }
  }
}
```

### 4. Tích hợp vào Cursor (`.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "canvas-audit": {
      "command": "node",
      "args": ["E:/Project A/Today - Tram trung chuyen/canvas-audit-mcp/src/index.js"]
    }
  }
}
```

---

## 🧪 Chạy thử nghiệm nội bộ
Để kiểm tra mọi tính năng chạy chuẩn xác với trang mẫu tích hợp sẵn:
```bash
npm test
```
