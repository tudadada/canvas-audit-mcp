#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  auditCanvasDpr,
  profileFramePacing,
  inspectErgonomics,
  testContextLossRecovery,
} from 'canvas-audit-core';

import { withAuditPage, DEVICE_PRESETS } from './session.js';
import { assertAuditableUrl, BlockedUrlError } from './url.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const PRESETS = Object.keys(DEVICE_PRESETS);
const presetEnum = z.enum(PRESETS);
const urlSchema = z.string().min(1, 'url is required');

const SCHEMAS = {
  audit_canvas_dpr: z.object({
    url: urlSchema,
    preset: presetEnum.optional(),
    captureScreenshot: z.boolean().optional(),
    waitForMs: z.number().int().min(0).max(60000).optional(),
  }),
  profile_frametime_sync: z.object({
    url: urlSchema,
    preset: presetEnum.optional(),
    sampleFrames: z.number().int().min(10).max(2000).optional(),
    warmupMs: z.number().int().min(0).max(60000).optional(),
    cpuThrottleRate: z.number().min(1).max(20).optional(),
    collectTimeoutMs: z.number().int().min(1000).max(120000).optional(),
  }),
  inspect_responsive_ergonomics: z.object({
    url: urlSchema,
    preset: presetEnum.optional(),
    minTouchSize: z.number().min(1).max(200).optional(),
    captureScreenshot: z.boolean().optional(),
  }),
  test_adaptive_recovery: z.object({ url: urlSchema, preset: presetEnum.optional() }),
  compare_device_matrix: z.object({ url: urlSchema }),
};

const presetProperty = { type: 'string', enum: PRESETS, description: 'Device preset configuration' };
const urlProperty = { type: 'string', description: 'Target http(s) URL. Local files and data: URIs are refused.' };

const TOOLS = [
  {
    name: 'audit_canvas_dpr',
    description:
      'Audit canvas/WebGL sharpness against Device Pixel Ratio. Detects blurry rendering, oversized buffers, aspect-ratio distortion and missing context-recovery listeners.',
    annotations: { title: 'Audit canvas DPR sharpness', readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        url: urlProperty,
        preset: { ...presetProperty, description: 'Device preset (default: macbook_retina)' },
        captureScreenshot: { type: 'boolean', description: 'Return a screenshot (default: true)' },
        waitForMs: { type: 'number', description: 'Wait for rendering before auditing, ms (default: 2000)' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'profile_frametime_sync',
    description:
      "Profile the page's real frame pacing by wrapping its own requestAnimationFrame. A page that never animates reports STATIC_NO_ANIMATION rather than 60 FPS. Returns present intervals, main-thread cost per frame, and GPU readback stall.",
    annotations: { title: 'Profile frame pacing', readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        url: urlProperty,
        preset: { ...presetProperty, description: 'Device preset (default: desktop_1080p)' },
        sampleFrames: { type: 'number', description: 'Frames rendered by the page to sample (default: 180)' },
        warmupMs: { type: 'number', description: 'Warmup before sampling, ms (default: 1500)' },
        cpuThrottleRate: { type: 'number', description: 'CPU slowdown via CDP (1 = normal, 4 = 4x)' },
        collectTimeoutMs: { type: 'number', description: 'Give up waiting for frames after this long (default: 15000)' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'inspect_responsive_ergonomics',
    description:
      'Layout and ergonomics audit: horizontal overflow measured against the CSS viewport, touch targets scored against the configured threshold plus WCAG 2.2 AA (24px) and the 44px platform recommendation, and silently clipped text.',
    annotations: { title: 'Inspect responsive ergonomics', readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        url: urlProperty,
        preset: { ...presetProperty, description: 'Device preset (default: mobile_iphone)' },
        minTouchSize: { type: 'number', description: 'Minimum touch target size in px (default: 32)' },
        captureScreenshot: { type: 'boolean', description: 'Return a screenshot (default: true)' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'test_adaptive_recovery',
    description:
      "Test whether the PAGE survives a GPU context loss. The auditor only observes: it never calls preventDefault() and never restores the context on the page's behalf, so a pass requires the page to cancel the event, regain its context and resume rendering.",
    annotations: {
      title: 'Test WebGL context-loss recovery',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: { url: urlProperty, preset: { ...presetProperty, description: 'Device preset (default: desktop_1080p)' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'compare_device_matrix',
    description:
      'Run the DPR and ergonomics audits across three benchmark tiers (Desktop 1080p 1x, MacBook Retina 2x, iPhone 3x) in parallel and return a side-by-side matrix.',
    annotations: { title: 'Compare across device tiers', readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: { url: urlProperty },
      required: ['url'],
      additionalProperties: false,
    },
  },
];

const server = new Server({ name: 'canvas-audit-mcp', version: pkg.version }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

const HANDLERS = {
  async audit_canvas_dpr({ url, preset, captureScreenshot = true, waitForMs = 2000 }) {
    return withAuditPage(
      url,
      preset,
      'macbook_retina',
      async ({ evaluate, page }) => ({
        canvas: await auditCanvasDpr(evaluate),
        screenshotBase64: captureScreenshot ? (await page.screenshot({ type: 'png' })).toString('base64') : null,
      }),
      { waitForMs }
    );
  },

  async profile_frametime_sync({ url, preset, sampleFrames = 180, warmupMs = 1500, cpuThrottleRate = 1, collectTimeoutMs = 15000 }) {
    return withAuditPage(
      url,
      preset,
      'desktop_1080p',
      async ({ evaluate, page }) => {
        if (cpuThrottleRate > 1) {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottleRate });
        }
        return {
          cpuThrottleRate: `${cpuThrottleRate}x`,
          framePacing: await profileFramePacing(evaluate, { sampleFrames, timeoutMs: collectTimeoutMs }),
        };
      },
      { waitForMs: warmupMs }
    );
  },

  async inspect_responsive_ergonomics({ url, preset, minTouchSize = 32, captureScreenshot = true }) {
    return withAuditPage(
      url,
      preset,
      'mobile_iphone',
      async ({ evaluate, page, config, consoleErrors }) => ({
        ergonomics: await inspectErgonomics(evaluate, { minTouchSize, isMobile: config.isMobile }),
        consoleErrors: consoleErrors.slice(0, 5),
        screenshotBase64: captureScreenshot ? (await page.screenshot({ type: 'png' })).toString('base64') : null,
      }),
      { waitForMs: 1500 }
    );
  },

  async test_adaptive_recovery({ url, preset }) {
    return withAuditPage(
      url,
      preset,
      'desktop_1080p',
      async ({ evaluate, runtimeErrors }) => ({
        recovery: await testContextLossRecovery(evaluate),
        runtimeErrors: runtimeErrors.slice(0, 5),
        methodology:
          "The auditor never calls preventDefault() on the context-loss event and never restores on the page's behalf.",
      }),
      { waitForMs: 2000 }
    );
  },

  async compare_device_matrix({ url }) {
    const presets = ['desktop_1080p', 'macbook_retina', 'mobile_iphone'];
    const matrix = await Promise.all(
      presets.map((preset) =>
        withAuditPage(
          url,
          preset,
          preset,
          async ({ evaluate, config }) => ({
            canvas: await auditCanvasDpr(evaluate),
            ergonomics: await inspectErgonomics(evaluate, { isMobile: config.isMobile }),
          }),
          { waitForMs: 1500 }
        )
      )
    );
    return { url, matrix };
  },
};

function textResult(payload) {
  const content = [
    {
      type: 'text',
      text: JSON.stringify(payload, (key, value) => (key === 'screenshotBase64' ? undefined : value), 2),
    },
  ];
  if (payload.screenshotBase64) {
    content.push({ type: 'image', data: payload.screenshotBase64, mimeType: 'image/png' });
  }
  return { content };
}

function errorResult(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;

  const schema = SCHEMAS[name];
  if (!schema) return errorResult(`Unknown tool: ${name}`);

  const parsed = schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return errorResult(`Invalid arguments for ${name} -- ${details}`);
  }

  try {
    const args = { ...parsed.data, url: assertAuditableUrl(parsed.data.url) };
    return textResult(await HANDLERS[name](args));
  } catch (error) {
    if (error instanceof BlockedUrlError) return errorResult(error.message);
    return errorResult(`Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`canvas-audit-mcp ${pkg.version} listening on stdio.`);
