import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay authoritative input locks", () => {
  const locks = readFileSync(
    resolve(process.cwd(), "server/services/factory/historical-replay/authoritativeLocks.ts"),
    "utf8"
  );
  const scope = readFileSync(
    resolve(process.cwd(), "server/services/factory/historical-replay/exactScopeFinal.ts"),
    "utf8"
  );

  it("locks supplier before container and landed-cost inputs", () => {
    const supplier = locks.indexOf("FROM factory_suppliers");
    const container = locks.indexOf("FROM factory_containers");
    const receipts = locks.indexOf('"factory_container_receipts"');
    expect(supplier).toBeGreaterThan(-1);
    expect(supplier).toBeLessThan(container);
    expect(container).toBeLessThan(receipts);
    expect(locks).toContain('"factory_offload_additional_charges"');
    expect(locks).toContain('"factory_container_commissions"');
    expect(locks).toContain('"factory_container_other_charges"');
    expect(locks).toContain("factory_raw_material_adjustments");
    expect(locks).toContain("factory_daybook_entries");
  });

  it("takes authoritative locks before rebuilding the apply scope", () => {
    const lockCall = scope.indexOf("lockSelectedReplayAuthoritativeInputs");
    const buildCall = scope.indexOf("buildExactHistoricalReplayScopeInternalV6(params)");
    expect(lockCall).toBeGreaterThan(-1);
    expect(lockCall).toBeLessThan(buildCall);
  });
});
