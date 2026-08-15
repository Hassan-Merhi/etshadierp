import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

/** The runner as an operator meets it first: invoked with nothing to authorise a run. */
function runWithoutApplyFlag() {
  return spawnSync(process.execPath, [path.join(root, "scripts/run-versioned-migrations.mjs")], {
    encoding: "utf8",
    env: { ...process.env, MIGRATION_CONFIRMATION: "" },
  });
}

const LEGACY_MISSING_MIGRATION_TAGS = new Set<string>([
  "0000_conscious_william_stryker",
  "0001_parallel_guardian",
  "0002_married_loa",
]);

describe("versioned migration registry", () => {
  it("has unique sequential indexes and a SQL file for every non-legacy registered migration", () => {
    const journal = JSON.parse(read("migrations/meta/_journal.json"));
    const entries = journal.entries as Array<{ idx: number; tag: string }>;
    const indexes = entries.map((entry) => entry.idx);
    const tags = entries.map((entry) => entry.tag);

    expect(indexes).toEqual(entries.map((_, index) => index));
    expect(new Set(indexes).size).toBe(indexes.length);
    expect(new Set(tags).size).toBe(tags.length);

    for (const tag of tags) {
      const exists = fs.existsSync(path.join(root, "migrations", `${tag}.sql`));
      if (LEGACY_MISSING_MIGRATION_TAGS.has(tag)) {
        expect(exists, `${tag} is a documented pre-versioning journal gap`).toBe(false);
      } else {
        expect(exists, tag).toBe(true);
      }
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

  it("refuses to apply anything without the explicit flag", () => {
    const refusal = runWithoutApplyFlag();

    // Run, not grepped: the guarantee is that the process declines, not that
    // the file contains a word.
    expect(refusal.status).not.toBe(0);
  });

  it("names a verification command that exists in its refusal message", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const refusal = runWithoutApplyFlag();
    const named = [...`${refusal.stderr}${refusal.stdout}`.matchAll(/npm run ([\w:-]+)/g)].map((match) => match[1]);

    // The refusal is the first thing anyone applying migrations sees, and it
    // pointed at a script that did not exist — so the documented safe sequence
    // opened with "Missing script: verify:migrations" and invited skipping
    // straight to --apply. Whatever command it names, that command must run.
    expect(named.length).toBeGreaterThan(0);
    for (const script of named) {
      expect(packageJson.scripts[script], `the refusal points at npm run ${script}`).toBeTypeOf("string");
    }
  });
});
