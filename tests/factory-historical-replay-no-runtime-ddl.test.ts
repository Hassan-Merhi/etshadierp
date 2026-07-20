import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay schema ownership", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  it("suppresses the preserved legacy startup CREATE TABLE call", () => {
    const wrapper = read("server/routes/factory/raw-stock/rawStockRecalcRoutes.ts");
    expect(wrapper).toContain("guardedRegistrationQuery");
    expect(wrapper).toContain("CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+factory_recalc_undo_log");
    expect(wrapper).toContain("mutablePool.query = originalQuery");
  });

  it("keeps consumed-token and undo schema in registered migration 0007", () => {
    const migration = read("migrations/0007_factory_historical_replay_safety.sql");
    const journal = read("migrations/meta/_journal.json");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS \"factory_replay_consumed_tokens\"");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS \"factory_recalc_undo_log\"");
    expect(journal).toContain("0007_factory_historical_replay_safety");
  });
});
