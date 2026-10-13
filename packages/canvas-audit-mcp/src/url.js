/**
 * URL safety gate.
 *
 * This server hands an LLM-supplied string to a real browser. Without a gate,
 * `file:///…`, `data:…` or `chrome://…` turn an audit tool into a local-file
 * reader whose screenshots leave the machine. Only http(s) is auditable.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export class BlockedUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

/**
 * Validates and normalises a target URL.
 * @param {unknown} input raw url argument
 * @returns {string} normalised absolute http(s) url
 * @throws {BlockedUrlError} when the url is malformed or uses a blocked scheme
 */
export function assertAuditableUrl(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new BlockedUrlError('`url` is required and must be a non-empty string.');
  }

  const raw = input.trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BlockedUrlError(
      `Invalid URL: "${raw}". Pass an absolute URL including the scheme, e.g. https://example.com or http://localhost:3000.`
    );
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new BlockedUrlError(
      `Blocked URL scheme "${parsed.protocol}". canvas-audit-mcp only audits http:// and https:// pages. ` +
        'Local files, data: URIs and browser-internal pages are refused so that the auditor cannot be ' +
        'used to read the host machine. To audit a local page, serve it over http (e.g. npx serve .).'
    );
  }

  return parsed.toString();
}
