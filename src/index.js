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
          'Audit canvas/WebGL sharpness against Device Pixel Ratio (DPR). Detects blurry rendering (unscaled DPR), oversized buffers (wasting VRAM), aspect ratio distortion, and missing context recovery listeners.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Target URL to inspect (supports localhost and public URLs)' },
            preset: {
              type: 'string',
              enum: ['desktop_1080p', 'macbook_retina', 'desktop_4k', 'mobile_iphone', 'tablet_ipad'],
              description: 'Device preset configuration (default: macbook_retina)',
            },
            customDpr: { type: 'number', description: 'Custom Device Pixel Ratio override (e.g. 1, 1.5, 2, 3)' },
            captureScreenshot: { type: 'boolean', description: 'Whether to capture full resolution screenshot (default: true)' },
            waitForMs: { type: 'number', description: 'Wait time for rendering/animations in milliseconds (default: 2000)' },
          },
          required: ['url'],
        },
      },
      {
        name: 'profile_frametime_sync',
        description:
          'True Sync Profiling: Measures true frame pacing and stutter via continuous frames and synchronous GPU readback checks. Bypasses async command queue illusions and V-Sync phase hopping. Returns Median, P95, P99, Jitter, and frame drop rate.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Target URL to profile' },
            preset: {
              type: 'string',
              enum: ['desktop_1080p', 'macbook_retina', 'desktop_4k', 'mobile_iphone', 'tablet_ipad'],
              description: 'Device preset configuration (default: desktop_1080p)',
            },
            sampleFrames: { type: 'number', description: 'Number of consecutive frames to sample (default: 180)' },
            warmupMs: { type: 'number', description: 'Warmup duration before sampling starts in ms (default: 1500)' },
            cpuThrottleRate: { type: 'number', description: 'CPU slowdown multiplier via Chrome CDP (e.g. 1 = normal, 4 = 4x slowdown)' },
          },
          required: ['url'],
        },
      },
      {
        name: 'inspect_responsive_ergonomics',
        description:
          'Opinionated ergonomics and layout integrity audit: Flags touch targets < 32px (difficult on mobile), horizontal overflow leaks creating rogue scrollbars (scrollWidth > innerWidth), and clipped text blocks.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Target URL to inspect' },
            preset: {
              type: 'string',
              enum: ['desktop_1080p', 'macbook_retina', 'desktop_4k', 'mobile_iphone', 'tablet_ipad'],
              description: 'Device preset configuration (default: mobile_iphone)',
            },
            minTouchSize: { type: 'number', description: 'Minimum interactive touch target size in px (default: 32)' },
            captureScreenshot: { type: 'boolean', description: 'Whether to capture screenshot (default: true)' },
          },
          required: ['url'],
        },
      },
      {
        name: 'test_adaptive_recovery',
        description:
          'Tests WebGL context crash recovery (simulating GPU reset via WEBGL_lose_context) and optional dynamic load downscaling behavior.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Target URL to inspect' },
            preset: {
              type: 'string',
              enum: ['desktop_1080p', 'macbook_retina', 'desktop_4k', 'mobile_iphone', 'tablet_ipad'],
              description: 'Device preset configuration (default: desktop_1080p)',
            },
            testContextLoss: { type: 'boolean', description: 'Simulate GPU context loss and test self-recovery (default: true)' },
            testLoadDegradation: { type: 'boolean', description: 'Test dynamic resolution downscaling under artificial lag (default: false)' },
          },
          required: ['url'],
        },
      },
      {
        name: 'compare_device_matrix',
        description:
          'Executes an aggregated audit across 3 key benchmark tiers (Desktop 1080p 1x, MacBook Retina 2x, iPhone 3x) to identify cross-device rendering discrepancies.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Target URL to inspect' },
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
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
});

// Start standard stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('canvas-audit-mcp server started and listening on stdio.');
