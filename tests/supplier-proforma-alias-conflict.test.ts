/**
 * Regression test for the "SAFTEY BOOT" / "SAFETY BOOTS #2" price-swap bug
 * on the container verification screen.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../server/db";
import { buildAliasMap, resolveBarcode } from "../server/routes/helpers/proformaBarcodeHelpers";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";

const TEST_PREFIX = "aliasconflicttest";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
}, 60000);

afterAll(async () => {
  try {
    await pool.query("DELETE FROM stock_item_code_aliases WHERE company_id = $1", [ctx.companyId]);
  } catch {
    // A failed fixture may not have created the optional alias table yet.
  }
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
    expect(conflicts.find((conflict) => conflict.aliasCode === "SUPPLIER-CODE-XYZ")).toBeUndefined();
  });

  it("flags and excludes an alias whose code collides with a DIFFERENT item's own primary code", async () => {
    const { companyId, stockItemIds } = ctx;
    const [item1Id, item2Id] = stockItemIds;

    const {
      rows: [item2],
    } = await pool.query<{ code: string }>("SELECT code FROM stock_items WHERE id = $1", [item2Id]);

    await pool.query(
      `INSERT INTO stock_item_code_aliases (company_id, stock_item_id, alias_code)
       VALUES ($1, $2, $3)`,
      [companyId, item1Id, item2.code],
    );

    const { map, conflicts } = await buildAliasMap(companyId);
    expect(map.get(item2.code.toLowerCase())).toBeUndefined();

    const conflict = conflicts.find(
      (entry) => entry.aliasCode.toLowerCase() === item2.code.toLowerCase(),
    );
    expect(conflict).toBeDefined();
    expect(conflict!.ownerCode).toBe(item2.code);
  });

  it("resolveBarcode falls back to the raw code (self-match) when the alias was excluded as conflicting", async () => {
    const { companyId, stockItemIds } = ctx;
    const [, item2Id] = stockItemIds;
    const {
      rows: [item2],
    } = await pool.query<{ code: string }>("SELECT code FROM stock_items WHERE id = $1", [item2Id]);

    const { map } = await buildAliasMap(companyId);
    expect(resolveBarcode(item2.code, map)).toBe(item2.code);
  });
});
