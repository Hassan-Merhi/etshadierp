/**
 * Startup schema integrity.
 * ------------------------
 * `startupMigrations` is assembled from ten modules under
 * `server/startup-schema/`. The statements run sequentially against a live
 * database at boot, so order is behaviour: moving a statement between parts, or
 * reordering two within a part, can change the resulting schema or fail outright
 * against production data.
 *
 * This test pins the assembled array so any such change is deliberate. When a
 * migration is genuinely added, update EXPECTED_STATEMENT_COUNT and
 * EXPECTED_CONTENT_HASH in the same commit - the diff then shows reviewers that
 * the array changed on purpose rather than as a side effect of editing a file.
 *
 * The recorded hash is the reviewed value of the composed startup migration
 * array on the current main baseline.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { startupMigrations } from "../server/startup-schema";

/** Statement count of the reviewed composed array. */
const EXPECTED_STATEMENT_COUNT = 1280;

/**
 * sha256 of JSON.stringify(startupMigrations) for the reviewed composed array.
 *
 * Re-pinned when the three factory_container_receipts constraints in
 * 010-security-notifications-and-precision.ts gained the DO/duplicate_object
 * guard the rest of that file uses. Unguarded they raised "constraint already
 * exists" on every startup after the first, which the startup-migration ratchet
 * added in the same change would have reported as three failures on every
 * re-run. The statement COUNT is unchanged at 1280 and no statement moved: the
 * three were wrapped in place, so only their text differs.
 *
 * Re-pinned again when the eleven baselined startup-migration failures were
 * fixed: nine seed INSERTs became guarded SELECTs that check their company and
 * ledger account exist, and two foreign keys targeting schema that no longer
 * exists (supplier_containers, bales.erp_location_id) were guarded on the object
 * being present. The count is still 1280 and nothing moved — every statement was
 * guarded in place — and the migration ceiling fell from 11 to 0.
 */
const EXPECTED_CONTENT_HASH = "412c33005449a49ae8da9a90880abad22127c84037e48b1e5b7846166567b42c";

function contentHash(statements: string[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(statements)).digest("hex");
}

describe("startup schema integrity", () => {
  it("assembles the expected number of statements", () => {
    expect(startupMigrations).toHaveLength(EXPECTED_STATEMENT_COUNT);
  });

  it("preserves statement content and order exactly", () => {
    expect(
      contentHash(startupMigrations),
      "The assembled startup migration array changed. If a migration was added or " +
        "edited on purpose, update EXPECTED_STATEMENT_COUNT and EXPECTED_CONTENT_HASH " +
        "in this file within the same commit. If not, a statement has been reordered " +
        "or moved between parts - order is executed order, so restore it."
    ).toBe(EXPECTED_CONTENT_HASH);
  });

  it("contains only non-empty SQL strings", () => {
    const bad = startupMigrations
      .map((statement, index) => ({ statement, index }))
      .filter(({ statement }) => typeof statement !== "string" || statement.trim() === "");

    expect(bad, `Empty or non-string entries at: ${bad.map((b) => b.index).join(", ")}`).toEqual([]);
  });

  it("keeps the retired single-file module deleted", () => {
    // The split is only a real split if the monolith is gone. A re-appearing
    // startupSchema.ts would mean two sources of truth for boot-time DDL.
    expect(fs.existsSync(path.join(process.cwd(), "server/startupSchema.ts"))).toBe(false);
  });

  it("registers every part module in the composed array", () => {
    // Guards the failure mode where a part is added to the directory but never
    // imported by index.ts, so its statements silently never run.
    const partsDirectory = path.join(process.cwd(), "server/startup-schema");
    const parts = fs
      .readdirSync(partsDirectory)
      .filter((file) => file.endsWith(".ts") && file !== "index.ts")
      .sort();

    const index = fs.readFileSync(path.join(partsDirectory, "index.ts"), "utf8");
    const unregistered = parts.filter((file) => !index.includes(`./${file.replace(/\.ts$/, "")}`));

    expect(
      unregistered,
      `These parts exist but are not imported by server/startup-schema/index.ts:\n${unregistered.join("\n")}`
    ).toEqual([]);
  });
});
