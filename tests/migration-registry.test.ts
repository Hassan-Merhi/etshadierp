import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

const debt = JSON.parse(read("config/migration-registry-debt.json"));
const approvedLegacyTags = new Set<string>(
  debt.legacyMissingRegisteredTags.map((entry: { tag: string }) => entry.tag),
);
const approvedUnregisteredFiles = new Set<string>(
  debt.approvedUnregisteredSqlFiles.map((entry: { file: string }) => entry.file),
);

describe("versioned migration registry", () => {
  it("has unique sequential indexes and only the reviewed legacy file gaps", () => {
    const journal = JSON.parse(read("migrations/meta/_journal.json"));
    const entries = journal.entries as Array<{ idx: number; tag: string }>;
    const indexes = entries.map((entry) => entry.idx);
    const tags = entries.map((entry) => entry.tag);

    expect(indexes).toEqual(entries.map((_, index) => index));
    expect(new Set(indexes).size).toBe(indexes.length);
    expect(new Set(tags).size).toBe(tags.length);

    for (const tag of tags) {
      const exists = fs.existsSync(path.join(root, "migrations", `${tag}.sql`));
      if (approvedLegacyTags.has(tag)) {
        expect(exists, `${tag} is an approved pre-versioning journal gap`).toBe(false);
      } else {
        expect(exists, tag).toBe(true);
      }
    }

    expect([...approvedLegacyTags].sort()).toEqual([
      "0000_conscious_william_stryker",
      "0001_parallel_guardian",
      "0002_married_loa",
    ]);
  });

  it("keeps the exact reviewed standalone SQL set", () => {
    const journal = JSON.parse(read("migrations/meta/_journal.json"));
    const registered = new Set<string>(journal.entries.map((entry: { tag: string }) => entry.tag));
    const actual = fs
      .readdirSync(path.join(root, "migrations"))
      .filter((file) => file.endsWith(".sql") && !registered.has(file.slice(0, -4)))
      .sort();

    expect(actual).toEqual([...approvedUnregisteredFiles].sort());
    expect(actual).toEqual([
      "20260717_factory_recalc_undo_log.sql",
      "20260717_phase3_heavy_read_indexes.sql",
      "20260718_post_offload_charge_edit_undo.sql",
      "20260720_001_financial_close_audit.sql",
      "20260721_001_factory_mix_batch_sources_inventory_supplier.sql",
      "20260721_fix_pos_location_pool_crash.sql",
    ]);
  });

  it("registers the ledger opening-balance currency migration", () => {
    const journal = read("migrations/meta/_journal.json");
    expect(journal).toContain("20260720_003_ledger_account_opening_balance_currency");
  });

  it("keeps the versioned runner opt-in and outside the production start command", () => {
    const runner = read("scripts/run-versioned-migrations.mjs");
    const packageJson = JSON.parse(read("package.json"));

    expect(runner).toContain("MIGRATION_CONFIRMATION");
    expect(runner).toContain("APPLY_VERSIONED_MIGRATIONS");
    expect(runner).toContain("--apply");
    expect(packageJson.scripts.start).not.toContain("run-versioned-migrations");
  });
});
