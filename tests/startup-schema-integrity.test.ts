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
const EXPECTED_STATEMENT_COUNT = 1332;

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
 *
 * Re-pinned again for the canonical stock movement journal
 * (021-canonical-stock-movement-journal.ts): eight appended statements creating
 * the three journal tables and their indexes, taking the count from 1280 to
 * 1288. They are appended last because they reference companies, stock_items
 * and locations, so nothing before them moved.
 *
 * Re-pinned again when the legacy orphan repair stage was added before the
 * foreign-key batch. It archives invalid child rows, preserves nullable
 * references by clearing only the missing parent id, and raises the count
 * from 1285 to 1332.
 *
 * Re-pinned again when three VALIDATE statements were removed from
 * 007-schema-catchup-may-2026.ts, taking the count from 1288 to 1285. They
 * validated factory_raw_stock, factory_fx_allocations and
 * factory_container_commissions *_container_id_fkey while those constraints
 * still pointed at `containers`; part 009 drops each one and recreates it
 * against factory_containers, so the validation compared rows against the wrong
 * parent table and raised foreign_key_violation on every boot of a database
 * holding factory rows. Only those three were deleted and no statement moved.
 */
const EXPECTED_CONTENT_HASH = "eb83cfe04adb580a102cdceae2ff107f1be8f76ac3a6e24d5cf1cf716cb41cba";

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

  it("archives legacy FK orphans before the strict FK batch runs", () => {
    const repairStart = startupMigrations.findIndex((statement) =>
      statement.includes("CREATE TABLE IF NOT EXISTS _orphan_archive_customer_order_bale_removals")
    );
    const foreignKeyStart = startupMigrations.findIndex((statement) =>
      statement.includes("customer_order_bale_removals_order_id_fkey")
    );

    expect(repairStart).toBeGreaterThanOrEqual(0);
    expect(foreignKeyStart).toBeGreaterThan(repairStart);

    for (const table of [
      "customer_order_bale_removals",
      "supplier_container_loaded_items",
      "chat_messages",
      "container_offloads",
      "import_logs",
      "inventory",
      "stock_transfer_items",
    ]) {
      expect(startupMigrations.some((statement) => statement.includes(`_orphan_archive_${table}`))).toBe(true);
    }

    expect(
      startupMigrations.filter((statement) => statement.includes("ON CONFLICT (id) DO NOTHING")).length
    ).toBeGreaterThanOrEqual(7);
  });
});
