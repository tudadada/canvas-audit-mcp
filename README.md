# canvas-audit-mcp

> **Opinionated Canvas, WebGL & Display Quality Auditor for the Model Context Protocol (MCP)**

[![npm version](https://img.shields.io/npm/v/canvas-audit-mcp.svg)](https://www.npmjs.com/package/canvas-audit-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Unlike general browser automation tools that merely provide mechanical "hands" (click, type, navigate), **`canvas-audit-mcp`** serves as an **"opinionated eye"** engineered specifically for web graphics, display fidelity, and real-world rendering audits:

- **No Hardware Illusions:** We don't pretend to emulate physical GPUs purely in software. Instead, we accurately audit high-DPI scaling (Device Pixel Ratio), verify layout & touch ergonomics, and validate WebGL resilience against GPU context crashes.
- **Defeating the 3 Measurement Traps:**
  1. *Async Queue Deception:* Standard JS loop benchmarks look fast on slow GPUs because draw commands are merely placed in an asynchronous pipeline.
  2. *Chrome's `gl.finish()` deception:* In Chrome, `gl.finish()` does not synchronously block execution as classical OpenGL textbooks suggest.
  3. *V-Sync Hopping:* Single-frame sampling causes 25x errors due to 16.6ms vs. 450ms V-Sync phase shifts. We profile frame distributions (Median, P95, and Jitter) over continuous multi-frame streams with synchronous GPU readback verification.
- **Canvas & WebGL Sharpness Diagnosis:** Automatically detects unscaled canvas buffers where developers forgot `canvas.width = clientWidth * window.devicePixelRatio`, exposing blurry rendering on Retina, 4K, and modern mobile displays.

---

## 🛠 MCP Tools

### 1. `audit_canvas_dpr`
Audits all `<canvas>` elements across targeted device presets or custom DPRs:
- **Blurriness Detection (Under-sampled):** Warns if `canvas.width < clientWidth * DPR` and computes the exact sharpness ratio.
- **Wasteful Oversampling:** Warns if render targets are oversized, wasting precious GPU fillrate and VRAM.
- **Aspect Ratio Distortion:** Detects non-uniform stretching between CSS dimensions and internal drawing buffer aspect ratio.
- **Context Resilience:** Checks whether canvas instances have registered `webglcontextlost` and `webglcontextrestored` event handlers.

### 2. `profile_frametime_sync`
Measures true rendering performance using **True Sync Profiling**:
- **Median Frametime (ms)** & **Effective FPS**: Unbiased operational speed.
- **P95 / P99 Frametime (ms)**: Quantifies the worst stutter frames.
- **Jitter (ms)**: Measures frame-to-frame pacing variation to detect V-Sync phase hopping.
- **CPU Throttling**: Supports Chrome DevTools Protocol CPU throttling (1x to 6x) to inspect CPU-side marshalling bottlenecks.

### 3. `inspect_responsive_ergonomics`
Audits touch targets and layout integrity across viewport sizes:
- **Touch Target Threshold:** Flags buttons, links, and interactives smaller than **32px × 32px** (or configurable threshold).
- **Horizontal Overflow Leaks:** Pinpoints the exact element causing `scrollWidth > innerWidth` (rogue horizontal scrollbars).
- **Text Clipping:** Identifies text containers with `overflow: hidden` where copy is silently truncated.

### 4. `test_adaptive_recovery`
- Simulates sudden GPU crashes using the `WEBGL_lose_context` extension.
- Verifies that the application catches `webglcontextlost` and successfully recovers rendering via `webglcontextrestored` rather than freezing permanently.
- Optionally monitors adaptive degradation behavior under artificial load.

### 5. `compare_device_matrix`
- Runs a consolidated audit across **3 benchmark device tiers**:
  - `desktop_1080p` (Standard Display, DPR 1x)
  - `macbook_retina` (High-DPI Retina, DPR 2x)
  - `mobile_iphone` (High-Density Mobile, DPR 3x)
- Returns an aggregated comparison matrix for side-by-side analysis.

---

## 🚀 Quick Start & Integration

### Run via `npx` (No Installation Required)

Add directly to your MCP client configuration:

#### Google Antigravity (`~/.gemini/config/mcp_config.json`)
```json
{
  "mcpServers": {
    "canvas-audit": {
      "command": "npx",
      "args": ["-y", "canvas-audit-mcp"]
    }
  }
}
```

#### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "canvas-audit": {
      "command": "npx",
      "args": ["-y", "canvas-audit-mcp"]
    }
  }
}
```

#### Cursor (`.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "canvas-audit": {
      "command": "npx",
      "args": ["-y", "canvas-audit-mcp"]
    }
  }
}
```

---

## 💻 Local Development & Testing

```bash
git clone https://github.com/tudadada/canvas-audit-mcp.git
cd canvas-audit-mcp
npm install
npx playwright install chromium

# Run internal integration tests against sample page
npm test
```

---

## 📄 License

MIT © [tudadada](https://github.com/tudadada)
