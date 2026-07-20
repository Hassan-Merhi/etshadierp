import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay atomic audit", () => {
  it("persists undo and audit from the apply transaction callback", () => {
    const route = readFileSync(
      resolve(process.cwd(), "server/routes/factory/raw-stock/historicalReplayRoutesV4.ts"),
      "utf8"
    );
    expect(route).toContain("onCommit: async (client, applyResult, snapshots)");
    expect(route).toContain("INSERT INTO factory_recalc_undo_log");
    expect(route).toContain("INSERT INTO audit_log");
    expect(route).toContain("before: snapshots.before");
    expect(route).toContain("after: snapshots.after");
  });
});
