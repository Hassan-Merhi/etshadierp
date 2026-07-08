/**
 * tests/supplier-proforma-alias-conflict.test.ts
 *
 * Regression test for the "SAFTEY BOOT" / "SAFETY BOOTS #2" price-swap bug
 * on the container verification screen.
 *
 * Root cause: `buildAliasMap()` resolves each proforma/loaded barcode to a
 * canonical stock-item code via `stock_item_code_aliases`, purely by barcode
 * identity (never by item name similarity). If an alias row's `aliasCode` is
 * accidentally set to the OWN primary `code` of a *different* stock item
 * (a data-entry mistake), two unrelated items get merged under one barcode
 * bucket in the verification comparison, silently swapping their loaded
 * price/qty. This test asserts that such a conflicting alias is detected and
 * excluded from the resolution map, rather than being silently applied.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../server/db";
import { buildAliasMap, resolveBarcode } from "../server/routes/supplierProformaRoutes";
import {
  seedTestData,
  cleanupTestData,
  closeTestServer,
  type TestContext,
} from "./setup";

const TEST_PREFIX = "aliasconflicttest";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
}, 60000);

afterAll(async () => {
  try {
    await pool.query(
      `DELETE FROM stock_item_code_aliases WHERE company_id = $1`,
      [ctx.companyId],
    );
  } catch { /* ignore */ }
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

describe("buildAliasMap — conflict guardrail", () => {
  it("applies a well-formed alias (alias code is not any item's own primary code)", async () => {
    const { companyId, stockItemIds } = ctx;
    const [item1Id] = stockItemIds;

    await pool.query(
      `INSERT INTO stock_item_code_aliases (company_id, stock_item_id, alias_code)
       VALUES ($1, $2, 'SUPPLIER-CODE-XYZ')`,
      [companyId, item1Id],
    );

    const { map, conflicts } = await buildAliasMap(companyId);
    expect(map.get("supplier-code-xyz")).toBeDefined();
    expect(conflicts.find((c) => c.aliasCode === "SUPPLIER-CODE-XYZ")).toBeUndefined();
  });

  it("flags and excludes an alias whose code collides with a DIFFERENT item's own primary code", async () => {
    const { companyId, stockItemIds } = ctx;
    const [item1Id, item2Id] = stockItemIds; // item2's own `code` is `${TEST_PREFIX}-ITEM2`

    const { rows: [item2] } = await pool.query<{ code: string }>(
      `SELECT code FROM stock_items WHERE id = $1`,
      [item2Id],
    );

    // Bad data: item1 is given an alias equal to item2's own primary code —
    // this is exactly the misconfiguration that swapped SAFTEY BOOT / SAFETY
    // BOOTS #2's loaded prices in production.
    await pool.query(
      `INSERT INTO stock_item_code_aliases (company_id, stock_item_id, alias_code)
       VALUES ($1, $2, $3)`,
      [companyId, item1Id, item2.code],
    );

    const { map, conflicts } = await buildAliasMap(companyId);

    // The conflicting alias must NOT be applied — barcode resolution must
    // never merge two distinct items via a name-blind, but data-broken, alias.
    expect(map.get(item2.code.toLowerCase())).toBeUndefined();

    const conflict = conflicts.find((c) => c.aliasCode.toLowerCase() === item2.code.toLowerCase());
    expect(conflict).toBeDefined();
    expect(conflict!.ownerCode).toBe(item2.code);
  });

  it("resolveBarcode falls back to the raw code (self-match) when the alias was excluded as conflicting", async () => {
    const { companyId, stockItemIds } = ctx;
    const [, item2Id] = stockItemIds;
    const { rows: [item2] } = await pool.query<{ code: string }>(
      `SELECT code FROM stock_items WHERE id = $1`,
      [item2Id],
    );

    const { map } = await buildAliasMap(companyId);
    // Because the conflicting alias is excluded, item2's own barcode resolves
    // to itself, not to item1 — the two items stay distinct in the comparison.
    expect(resolveBarcode(item2.code, map)).toBe(item2.code);
  });
});
