import {
  auditPage as coreAuditPage,
  auditCanvasDpr as coreAuditCanvasDpr,
  profileFramePacing as coreProfileFramePacing,
  inspectErgonomics as coreInspectErgonomics,
  testContextLossRecovery as coreTestContextLossRecovery,
} from 'canvas-audit-core';
import { evaluatorFor } from './attach.js';

/**
 * Audits the page that is already open in this test. No browser is launched,
 * no navigation happens: the cost of an audit here is a few page.evaluate calls.
 */
export function auditPage(page, options) {
  return coreAuditPage(evaluatorFor(page), options);
}

export function auditCanvasDpr(page, options) {
  return coreAuditCanvasDpr(evaluatorFor(page), options);
}

export function profileFramePacing(page, options) {
  return coreProfileFramePacing(evaluatorFor(page), options);
}

export function inspectErgonomics(page, options) {
  return coreInspectErgonomics(evaluatorFor(page), options);
}

export function testContextLossRecovery(page) {
  return coreTestContextLossRecovery(evaluatorFor(page));
}
