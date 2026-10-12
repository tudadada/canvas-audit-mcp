#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { auditCanvasDpr } from './auditors/canvas-dpr.js';
import { profileFrametimeSync } from './auditors/frametime-sync.js';
import { inspectResponsiveErgonomics } from './auditors/ergonomics.js';
import { testAdaptiveRecovery } from './auditors/adaptive-stress.js';
import { DEVICE_PRESETS } from './utils/browser.js';

const server = new Server(
  {
    name: 'canvas-audit-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register list of tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'audit_canvas_dpr',
        description:
          'Kiểm tra độ sắc nét của Canvas/WebGL theo mật độ điểm ảnh (DPR). Phát hiện canvas bị mờ (do chưa nhân DPR), render quá cỡ (lãng phí VRAM), méo tỷ lệ (aspect distortion) và thiếu listener tự hồi phục.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Địa chỉ URL cần kiểm tra (hỗ trợ cả localhost và public URL)' },
            preset: {
              type: 'string',
              enum: ['desktop_1080p', 'macbook_retina', 'desktop_4k', 'mobile_iphone', 'tablet_ipad'],
              description: 'Cấu hình thiết bị mẫu (mặc định: macbook_retina)',
            },
            customDpr: { type: 'number', description: 'Tùy chỉnh DPR cụ thể (ví dụ: 1, 1.5, 2, 3)' },
            captureScreenshot: { type: 'boolean', description: 'Chụp ảnh màn hình (mặc định: true)' },
            waitForMs: { type: 'number', description: 'Thời gian chờ trang tải và vẽ (mili-giây, mặc định: 2000)' },
          },
          required: ['url'],
        },
      },
      {
        name: 'profile_frametime_sync',
        description:
          'Đo hiệu năng và độ mượt thực tế bằng phép đo đồng bộ GPU (True Sync Profiling). Đánh bại bẫy GPU xếp hàng bất đồng bộ và nhịp V-Sync xen kẽ. Trả về Median, P95, P99, Jitter và tỷ lệ tụt khung hình.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Địa chỉ URL cần đo đạc' },
            preset: {
              type: 'string',
              enum: ['desktop_1080p', 'macbook_retina', 'desktop_4k', 'mobile_iphone', 'tablet_ipad'],
              description: 'Cấu hình thiết bị mẫu (mặc định: desktop_1080p)',
            },
            sampleFrames: { type: 'number', description: 'Số lượng khung hình liên tiếp để lấy mẫu (mặc định: 180)' },
            warmupMs: { type: 'number', description: 'Thời gian chờ ổn định trước khi đo (mặc định: 1500)' },
            cpuThrottleRate: { type: 'number', description: 'Hệ số bóp chậm CPU qua Chrome CDP (ví dụ: 1 = bình thường, 4 = chậm 4 lần)' },
          },
          required: ['url'],
        },
      },
      {
        name: 'inspect_responsive_ergonomics',
        description:
          'Bộ kiểm tra công thái học và tính toàn vẹn giao diện có quan điểm: Bắt các nút bấm < 32px (khó bấm trên mobile), tràn viền ngang tạo thanh cuộn rác (scrollWidth > innerWidth), và khối chữ bị cắt cụt.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Địa chỉ URL cần kiểm tra' },
            preset: {
              type: 'string',
              enum: ['desktop_1080p', 'macbook_retina', 'desktop_4k', 'mobile_iphone', 'tablet_ipad'],
              description: 'Cấu hình thiết bị mẫu (mặc định: mobile_iphone)',
            },
            minTouchSize: { type: 'number', description: 'Kích thước nút bấm tối thiểu cho phép (px, mặc định: 32)' },
            captureScreenshot: { type: 'boolean', description: 'Chụp ảnh màn hình (mặc định: true)' },
          },
          required: ['url'],
        },
      },
      {
        name: 'test_adaptive_recovery',
        description:
          'Kiểm tra khả năng tự hồi phục khi card đồ họa bị crash/reset (mô phỏng WebGL Context Lost và Restored qua WEBGL_lose_context) và kiểm tra logic tự giảm tải chất lượng.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Địa chỉ URL cần kiểm tra' },
            preset: {
              type: 'string',
              enum: ['desktop_1080p', 'macbook_retina', 'desktop_4k', 'mobile_iphone', 'tablet_ipad'],
              description: 'Cấu hình thiết bị mẫu (mặc định: desktop_1080p)',
            },
            testContextLoss: { type: 'boolean', description: 'Mô phỏng sập GPU context và kiểm tra tự hồi phục (mặc định: true)' },
            testLoadDegradation: { type: 'boolean', description: 'Kiểm tra logic tự hạ độ phân giải khi lag (mặc định: false)' },
          },
          required: ['url'],
        },
      },
      {
        name: 'compare_device_matrix',
        description:
          'Chạy kiểm tra tổng hợp trên 3 phân khúc thiết bị chủ chốt (Desktop 1080p 1x, MacBook Retina 2x, iPhone Mobile 3x) để phát hiện sự khác biệt về hiển thị và lỗi layout.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Địa chỉ URL cần kiểm tra' },
          },
          required: ['url'],
        },
      },
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'audit_canvas_dpr': {
        const result = await auditCanvasDpr(args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, (key, value) => (key === 'screenshotBase64' ? undefined : value), 2),
            },
            ...(result.screenshotBase64
              ? [
                  {
                    type: 'image',
                    data: result.screenshotBase64,
                    mimeType: 'image/png',
                  },
                ]
              : []),
          ],
        };
      }

      case 'profile_frametime_sync': {
        const result = await profileFrametimeSync(args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'inspect_responsive_ergonomics': {
        const result = await inspectResponsiveErgonomics(args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, (key, value) => (key === 'screenshotBase64' ? undefined : value), 2),
            },
            ...(result.screenshotBase64
              ? [
                  {
                    type: 'image',
                    data: result.screenshotBase64,
                    mimeType: 'image/png',
                  },
                ]
              : []),
          ],
        };
      }

      case 'test_adaptive_recovery': {
        const result = await testAdaptiveRecovery(args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'compare_device_matrix': {
        const targets = ['desktop_1080p', 'macbook_retina', 'mobile_iphone'];
        const matrixResults = [];

        for (const preset of targets) {
          const dprAudit = await auditCanvasDpr({ url: args.url, preset, captureScreenshot: false });
          const ergoAudit = await inspectResponsiveErgonomics({ url: args.url, preset, captureScreenshot: false });
          matrixResults.push({
            preset,
            presetName: DEVICE_PRESETS[preset]?.name,
            dpr: DEVICE_PRESETS[preset]?.deviceScaleFactor,
            viewport: DEVICE_PRESETS[preset]?.viewport,
            canvasStatus: dprAudit.canvases.map((c) => ({
              id: c.id,
              status: c.status,
              sharpnessRatio: c.sharpnessRatio,
              issues: c.issues,
            })),
            ergonomicsIssues: ergoAudit.audit.issues,
          });
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ url: args.url, matrix: matrixResults }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Công cụ không xác định: ${name}`);
    }
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Lỗi khi thực thi ${name}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
});

// Start standard stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('canvas-audit-mcp server started and listening on stdio.');
