import { describe, expect, it } from "vitest";

import { auditWriteRouteCoverage } from "../scripts/audit-write-route-coverage.mjs";

describe("authenticated sensitive-write coverage audit", () => {
  it("closes a real pre-sweep guard-only inventory instead of erasing the measurement", () => {
    const beforeSweep = auditWriteRouteCoverage({ includeAuthenticatedSafetySweep: false });
    const afterSweep = auditWriteRouteCoverage();

    expect(beforeSweep.uncoveredSensitive).toHaveLength(0);
    expect(beforeSweep.guardOnlySensitive.length).toBeGreaterThan(0);

    expect(afterSweep.uncoveredSensitive).toHaveLength(0);
    expect(afterSweep.guardOnlySensitive).toHaveLength(0);
    expect(afterSweep.authenticatedSafetyCovered).toHaveLength(beforeSweep.guardOnlySensitive.length);
    expect(afterSweep.summary.authenticatedSafetySweepPresent).toBe(true);
    expect(afterSweep.failures).toEqual([]);
  });
});
