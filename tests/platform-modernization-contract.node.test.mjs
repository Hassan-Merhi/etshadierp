import assert from "node:assert/strict";
import test from "node:test";

import { auditPlatformModernization } from "../scripts/audit-platform-modernization.mjs";

test("Phase 13 dependency/platform modernization contract", () => {
  const report = auditPlatformModernization();
  assert.deepEqual(report.failures, []);
  assert.equal(report.summary.failing, 0);
  assert.ok(report.summary.checked >= 11);
  assert.ok(report.checks.every((check) => check.ok));
});
