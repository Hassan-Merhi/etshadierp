import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("versioned migration registry", () => {
  it("has unique sequential indexes and a SQL file for every registered migration", () => {
    const journal = JSON.parse(read("migrations/meta/_journal.json"));
    const entries = journal.entries as Array<{ idx: number; tag: string }>;
    const indexes = entries.map((entry) => entry.idx);
    const tags = entries.map((entry) => entry.tag);

    expect(indexes).toEqual(entries.map((_, index) => index));
    expect(new Set(indexes).size).toBe(indexes.length);
    expect(new Set(tags).size).toBe(tags.length);

    for (const tag of tags) {
      expect(fs.existsSync(path.join(root, "migrations", `${tag}.sql`)), tag).toBe(true);
    }
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
