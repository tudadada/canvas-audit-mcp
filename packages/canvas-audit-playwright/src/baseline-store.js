import { resolve } from 'node:path';
import {
  summarizeReport,
  compareToBaseline,
  loadBaselineFile,
  saveBaselineFile,
  DEFAULT_TOLERANCES,
} from 'canvas-audit-core';

export const DEFAULT_BASELINE_PATH = 'canvas-audit.baseline.json';

/** `CANVAS_AUDIT_UPDATE_BASELINE=1 npx playwright test` rewrites the baseline. */
export function isUpdateMode() {
  const flag = process.env.CANVAS_AUDIT_UPDATE_BASELINE;
  return flag === '1' || flag === 'true';
}

/**
 * Compares a report against the stored baseline for `id`, and writes the entry
 * when running in update mode (or when the entry does not exist yet).
 */
export function checkBaseline(
  id,
  report,
  {
    baselinePath = DEFAULT_BASELINE_PATH,
    tolerances = DEFAULT_TOLERANCES,
    update = isUpdateMode(),
    gateTimings = false,
  } = {}
) {
  const path = resolve(process.cwd(), baselinePath);
  const file = loadBaselineFile(path);
  const previous = file.entries[id];

  const summary = summarizeReport(report);
  const result = compareToBaseline(summary, previous, tolerances, { gateTimings });

  const shouldWrite = update || result.isNew;
  if (shouldWrite) {
    file.entries[id] = { ...summary, updatedAt: new Date().toISOString() };
    saveBaselineFile(path, file);
  }

  return { ...result, baselinePath: path, written: shouldWrite, previous: previous || null };
}
