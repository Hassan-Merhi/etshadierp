import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("scheduled soft-delete purge safety", () => {
  const maintenance = source("server/services/scheduler/maintenance.ts");

  it("does not treat factory mix batches as a simple bulk-delete target", () => {
    expect(maintenance).toContain("purgeOldFactoryMixBatches");

    const simplePurgeStart = maintenance.indexOf("const simplePurges");
    const simplePurgeEnd = maintenance.indexOf("for (const { table, col } of simplePurges)", simplePurgeStart);
    const simplePurgeBlock = maintenance.slice(simplePurgeStart, simplePurgeEnd);

    expect(simplePurgeBlock).not.toContain('{ table: "factory_mix_batches"');
  });

  it("protects every known mix-batch production/history relationship before permanent deletion", () => {
    expect(maintenance).toContain("factory_mix_batch_sources WHERE mix_batch_id = $1");
    expect(maintenance).toContain("source_batch_id = $1");
    expect(maintenance).toContain("source_type = 'BATCH' AND source_id = $1");
    expect(maintenance).toContain("factory_daily_usages WHERE mix_batch_id = $1");
    expect(maintenance).toContain("factory_mix_batches WHERE carry_forward_from_id = $1");
    expect(maintenance).toContain("factory_pressing_batches WHERE mix_batch_id = $1");
    expect(maintenance).toContain("factory_bales WHERE mix_batch_id = $1");
    expect(maintenance).toContain("factory_waste_entries WHERE mix_batch_id = $1");
    expect(maintenance).toContain("mixBatchReferenceTotal(references) > 0");
  });

  it("isolates a blocked mix batch instead of rolling back unrelated cleanup", () => {
    expect(maintenance).toContain('const MIX_BATCH_PURGE_SAVEPOINT = "soft_delete_purge_mix_batch"');
    expect(maintenance).toContain("ROLLBACK TO SAVEPOINT ${MIX_BATCH_PURGE_SAVEPOINT}");
    expect(maintenance).toContain("retained it and continuing");
  });

  it("isolates other purge tables and surfaces fatal transaction failures to the scheduler", () => {
    expect(maintenance).toContain('const PURGE_SAVEPOINT = "soft_delete_purge_unit"');
    expect(maintenance).toContain("runIsolatedPurgeUnit(client, table");
    expect(maintenance).toContain("Fatal error during soft-delete purge");
    expect(maintenance).toContain("throw err");
  });

  it("logs mix-batch identity and database constraint metadata without deleting history rows", () => {
    expect(maintenance).toContain("mixBatchId: candidate.id");
    expect(maintenance).toContain("companyId: candidate.company_id");
    expect(maintenance).toContain("batchCode: candidate.batch_code");
    expect(maintenance).toContain("dbConstraint: databaseError.constraint");

    const purgeFunctionStart = maintenance.indexOf("async function purgeOldFactoryMixBatches");
    const purgeFunctionEnd = maintenance.indexOf("export async function purgeOldSoftDeletes", purgeFunctionStart);
    const mixBatchPurgeFunction = maintenance.slice(purgeFunctionStart, purgeFunctionEnd);

    expect(mixBatchPurgeFunction).not.toContain("DELETE FROM factory_mix_batch_sources");
    expect(mixBatchPurgeFunction).not.toContain("DELETE FROM factory_daily_usages");
    expect(mixBatchPurgeFunction).not.toContain("UPDATE factory_bales");
  });
});
