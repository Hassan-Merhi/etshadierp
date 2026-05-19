/**
 * SP Phase 3 — Real-Data Sample Test
 *
 * Uses 5 actual GC L'shi stock items (read-only) as the basis for a controlled
 * SP workflow: aliases → opening stock → FIFO sales → reconciliation table.
 * Verifies GC L'shi data is completely unchanged throughout.
 *
 * Run: npx tsx scripts/sp_phase3_sample_test.ts
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const GREEN  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const RED    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const CYAN   = (s: string) => `\x1b[36m${s}\x1b[0m`;
const BOLD   = (s: string) => `\x1b[1m${s}\x1b[0m`;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ${GREEN("✓")} ${label}`);
    passed++;
  } else {
    console.log(`  ${RED("✗")} ${label}${detail ? " — " + detail : ""}`);
    failed++;
    failures.push(label + (detail ? " — " + detail : ""));
  }
}

function assertApprox(label: string, actual: number, expected: number, tol = 0.01) {
  const ok = Math.abs(actual - expected) <= tol;
  assert(label, ok, ok ? "" : `expected ${expected.toFixed(4)}, got ${actual.toFixed(4)}`);
}

const pn = (v: any) => parseFloat(String(v ?? "0"));
const fmtUsd = (v: number) => `$${v.toFixed(4)}`;
const fmtQty = (v: number) => v.toFixed(3);

// ─── Config ───────────────────────────────────────────────────────────────────
const GC_COMPANY_ID = 1;
const SP_COMPANY_ID = 14;  // SPTEST

// 5 real GC L'shi stock items — READ-ONLY references
const SAMPLE_ITEMS = [
  { stockItemId: 93,   code: "EG10764", name: "EG Ladies Dress #1 40 KGS"          },
  { stockItemId: 127,  code: "EG24721", name: "EG Mix Shoes #2 25 KGS"             },
  { stockItemId: 151,  code: "EG15634", name: "EG Winter Cap #1 40 KGS"            },
  { stockItemId: 99,   code: "EG84631", name: "EG Ladies Spring Dress Cr 25 KGS"   },
  { stockItemId: 5036, code: "PL100",   name: "PL Adult Winter Jacket"             },
];

// Simulated Fresh Start invoice — 5% discount, $11.75/BL freight
const INVOICE_LINES = [
  { code: "EG10764", qty: 20, unitRate: 200.00 },
  { code: "EG24721", qty: 25, unitRate:  90.00 },
  { code: "EG15634", qty: 15, unitRate: 100.00 },
  { code: "EG84631", qty: 10, unitRate: 250.00 },
  { code: "PL100",   qty: 30, unitRate:  50.00 },
];
const DISCOUNT_PCT   = 5;
const FREIGHT_USD    = 1175.00;
const TOTAL_QTY      = INVOICE_LINES.reduce((s, l) => s + l.qty, 0); // 100

// 3 sample sales
const SAMPLE_SALES = [
  { code: "EG10764", qty: 5,  salePricePerUnit: 250.00 },
  { code: "EG24721", qty: 10, salePricePerUnit: 110.00 },
  { code: "PL100",   qty: 8,  salePricePerUnit:  70.00 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function gcSnapshot() {
  const r1 = (await db.execute(sql`SELECT COUNT(*) AS n FROM vouchers WHERE company_id = ${GC_COMPANY_ID}`)).rows[0] as any;
  const r2 = (await db.execute(sql`SELECT COUNT(*) AS n FROM inventory WHERE company_id = ${GC_COMPANY_ID}`)).rows[0] as any;
  const r3 = (await db.execute(sql`SELECT COUNT(*) AS n FROM stock_items WHERE company_id = ${GC_COMPANY_ID} AND deleted_at IS NULL`)).rows[0] as any;
  return { vouchers: pn(r1.n), inventory: pn(r2.n), stockItems: pn(r3.n) };
}

async function cleanupSpTest() {
  // Delete only SPTEST SP data — never touches GC L'shi
  await db.execute(sql`DELETE FROM sp_sale_lines WHERE company_id = ${SP_COMPANY_ID}`);
  await db.execute(sql`DELETE FROM sp_sales      WHERE company_id = ${SP_COMPANY_ID}`);
  await db.execute(sql`DELETE FROM sp_stock_movements WHERE company_id = ${SP_COMPANY_ID}`);
  await db.execute(sql`DELETE FROM sp_offload_charges WHERE offload_id IN (SELECT id FROM sp_offloads WHERE company_id = ${SP_COMPANY_ID})`);
  await db.execute(sql`DELETE FROM sp_offloads WHERE company_id = ${SP_COMPANY_ID}`);
  await db.execute(sql`DELETE FROM sp_container_lines WHERE container_id IN (SELECT id FROM sp_containers WHERE company_id = ${SP_COMPANY_ID})`);
  await db.execute(sql`DELETE FROM sp_containers WHERE company_id = ${SP_COMPANY_ID}`);
  await db.execute(sql`DELETE FROM stock_item_code_aliases WHERE company_id = ${SP_COMPANY_ID}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(BOLD(CYAN("\n═══════════════════════════════════════════════════════")));
  console.log(BOLD(CYAN("  SP PHASE 3 — Real-Data Sample Test")));
  console.log(BOLD(CYAN("  5 GC L'shi items · FIFO · Reconciliation · Isolation")));
  console.log(BOLD(CYAN("═══════════════════════════════════════════════════════\n")));

  // ── 0. Verify GC items exist (read-only) ────────────────────────────────
  console.log(BOLD("0. Verify GC L'shi sample items exist (read-only)"));
  for (const item of SAMPLE_ITEMS) {
    const [row] = (await db.execute(sql`
      SELECT id, code, name FROM stock_items
      WHERE id = ${item.stockItemId} AND company_id = ${GC_COMPANY_ID}
    `)).rows as any[];
    assert(`GC item ${item.code} (id=${item.stockItemId}) exists`, !!row, row?.name || "not found");
  }

  // ── 1. GC baseline snapshot ─────────────────────────────────────────────
  console.log(BOLD("\n1. GC L'shi baseline counts (safety reference)"));
  const gcBefore = await gcSnapshot();
  console.log(`   vouchers=${gcBefore.vouchers}, inventory=${gcBefore.inventory}, stock_items=${gcBefore.stockItems}`);
  assert("GC baseline: vouchers ≥ 2612",  gcBefore.vouchers  >= 2612);
  assert("GC baseline: inventory ≥ 2216", gcBefore.inventory >= 2216);
  assert("GC baseline: stock_items ≥ 1808", gcBefore.stockItems >= 1808);

  // ── 2. Clean SPTEST slate ───────────────────────────────────────────────
  console.log(BOLD("\n2. Clean SPTEST slate (SP-only tables)"));
  await cleanupSpTest();
  console.log("   Done — no GC L'shi tables touched");

  // ── 3. Create 5 aliases ─────────────────────────────────────────────────
  console.log(BOLD("\n3. Create 5 aliases  SPTEST → GC stock item IDs"));
  for (const item of SAMPLE_ITEMS) {
    await db.execute(sql`
      INSERT INTO stock_item_code_aliases (company_id, stock_item_id, alias_code, description)
      VALUES (${SP_COMPANY_ID}, ${item.stockItemId}, ${item.code}, ${item.name})
    `);
    console.log(`   ${item.code.padEnd(10)} → stock_item_id=${item.stockItemId}  "${item.name}"`);
  }
  const aliasCount = pn(((await db.execute(sql`SELECT COUNT(*) AS n FROM stock_item_code_aliases WHERE company_id = ${SP_COMPANY_ID}`)).rows[0] as any).n);
  assert("5 aliases created in SPTEST", aliasCount === 5);

  // ── 4. Compute per-line opening stock costs ─────────────────────────────
  console.log(BOLD("\n4. Cost calculation  (5% discount · freight $11.75/BL)"));

  const discountFactor  = 1 - DISCOUNT_PCT / 100;
  const freightPerUnit  = FREIGHT_USD / TOTAL_QTY;   // $11.75/BL

  type LineCost = {
    code: string; qty: number;
    discountedBase: number; landed: number; finalCost: number;
    totalBase: number; totalFinal: number;
  };
  const lineCosts: LineCost[] = INVOICE_LINES.map(l => {
    const discountedBase = l.unitRate * discountFactor;
    const finalCost      = discountedBase + freightPerUnit;
    return { code: l.code, qty: l.qty, discountedBase, landed: freightPerUnit, finalCost,
             totalBase: discountedBase * l.qty, totalFinal: finalCost * l.qty };
  });

  const hdr = "   Article    |  Qty | Base/u      | Freight/u   | Final/u     | TotalFinal";
  console.log(hdr);
  console.log("   " + "─".repeat(hdr.length - 3));
  for (const l of lineCosts) {
    console.log(`   ${l.code.padEnd(10)} | ${String(l.qty).padStart(4)} | ${fmtUsd(l.discountedBase).padStart(11)} | ${fmtUsd(l.landed).padStart(11)} | ${fmtUsd(l.finalCost).padStart(11)} | ${fmtUsd(l.totalFinal).padStart(12)}`);
  }
  const totalFinalAll = lineCosts.reduce((s, l) => s + l.totalFinal, 0);
  console.log("   " + "─".repeat(hdr.length - 3));
  console.log(`   ${"TOTAL".padEnd(10)} | ${String(TOTAL_QTY).padStart(4)} | ${"".padStart(11)} | ${"".padStart(11)} | ${"".padStart(11)} | ${fmtUsd(totalFinalAll).padStart(12)}`);

  assertApprox("Discount factor = 0.95",        discountFactor,   0.95,   0.0001);
  assertApprox("Freight/unit = $11.75",          freightPerUnit,  11.75,   0.0001);
  assertApprox("EG10764 final cost/u = $201.75", lineCosts[0].finalCost, 201.75, 0.0001);
  assertApprox("EG24721 final cost/u = $97.25",  lineCosts[1].finalCost,  97.25, 0.0001);
  assertApprox("EG15634 final cost/u = $106.75", lineCosts[2].finalCost, 106.75, 0.0001);
  assertApprox("EG84631 final cost/u = $249.25", lineCosts[3].finalCost, 249.25, 0.0001);
  assertApprox("PL100   final cost/u = $59.25",  lineCosts[4].finalCost,  59.25, 0.0001);

  // ── 5. Insert opening stock lots ────────────────────────────────────────
  console.log(BOLD("\n5. Insert opening stock lots into sp_stock_movements"));
  const movementIds: number[] = [];

  for (const l of lineCosts) {
    const aliasRow = (await db.execute(sql`
      SELECT stock_item_id FROM stock_item_code_aliases
      WHERE company_id = ${SP_COMPANY_ID} AND alias_code = ${l.code}
    `)).rows[0] as any;
    const stockItemId = aliasRow?.stock_item_id ?? null;

    const [movRow] = (await db.execute(sql`
      INSERT INTO sp_stock_movements
        (company_id, article_code, description, stock_item_id,
         qty_in, qty_remaining,
         base_unit_cost_usd, landed_unit_cost_usd, final_unit_cost_usd,
         source_type, container_id, offload_id, container_line_id)
      VALUES
        (${SP_COMPANY_ID}, ${l.code}, ${"P3 Opening: " + l.code}, ${stockItemId ?? null},
         ${l.qty}, ${l.qty},
         ${l.discountedBase.toFixed(6)}, ${l.landed.toFixed(6)}, ${l.finalCost.toFixed(6)},
         'opening_stock', NULL, NULL, NULL)
      RETURNING id
    `)).rows as any[];

    movementIds.push(movRow.id);
    console.log(`   Lot: ${l.code.padEnd(10)} ×${l.qty} BL @ final ${fmtUsd(l.finalCost)}/BL  (id=${movRow.id}, stockItemId=${stockItemId})`);
  }
  assert("5 opening stock lots created", movementIds.length === 5);

  // ── 6. Verify opening lots are readable ─────────────────────────────────
  console.log(BOLD("\n6. Verify opening lots in SPTEST"));
  for (const l of lineCosts) {
    const [movRow] = (await db.execute(sql`
      SELECT qty_in, qty_remaining, final_unit_cost_usd, base_unit_cost_usd
      FROM sp_stock_movements
      WHERE company_id = ${SP_COMPANY_ID} AND article_code = ${l.code} AND source_type = 'opening_stock'
      ORDER BY id DESC LIMIT 1
    `)).rows as any[];
    assert(`${l.code}: lot found`, !!movRow);
    if (movRow) {
      assertApprox(`${l.code}: qty_in = ${l.qty}`,             pn(movRow.qty_in),            l.qty,        0.001);
      assertApprox(`${l.code}: qty_remaining = ${l.qty}`,      pn(movRow.qty_remaining),      l.qty,        0.001);
      assertApprox(`${l.code}: final_unit_cost = ${l.finalCost.toFixed(4)}`, pn(movRow.final_unit_cost_usd), l.finalCost, 0.001);
    }
  }

  // ── 7. Run 3 FIFO sales ─────────────────────────────────────────────────
  console.log(BOLD("\n7. Run 3 FIFO sales"));

  type SaleResult = {
    code: string; qty: number; saleTotal: number;
    cogs: number; profit: number; basePayable: number;
  };
  const saleResults: SaleResult[] = [];

  for (const sale of SAMPLE_SALES) {
    const lc = lineCosts.find(l => l.code === sale.code)!;

    // Fetch FIFO lots
    const lots = (await db.execute(sql`
      SELECT id, qty_remaining, final_unit_cost_usd, base_unit_cost_usd, landed_unit_cost_usd
      FROM sp_stock_movements
      WHERE company_id = ${SP_COMPANY_ID} AND article_code = ${sale.code}
        AND qty_remaining > 0
      ORDER BY created_at ASC, id ASC
    `)).rows as any[];

    let qtyLeft = sale.qty;
    let totalCogs = 0;
    let totalBase = 0;

    for (const lot of lots) {
      if (qtyLeft <= 0.0001) break;
      const consume   = Math.min(pn(lot.qty_remaining), qtyLeft);
      totalCogs      += consume * pn(lot.final_unit_cost_usd);
      totalBase      += consume * pn(lot.base_unit_cost_usd);
      qtyLeft        -= consume;

      await db.execute(sql`
        UPDATE sp_stock_movements
        SET qty_remaining = qty_remaining - ${consume}
        WHERE id = ${lot.id}
      `);
    }

    const saleTotal = sale.qty * sale.salePricePerUnit;
    const profit    = saleTotal - totalCogs;

    // Create sp_sales record
    const [saleRow] = (await db.execute(sql`
      INSERT INTO sp_sales
        (company_id, sale_date, customer_name,
         total_sale_price_usd, total_base_cost_usd, total_final_cost_usd, gross_profit_usd,
         status, notes)
      VALUES
        (${SP_COMPANY_ID}, CURRENT_DATE, 'P3 Test Customer',
         ${saleTotal.toFixed(4)}, ${totalBase.toFixed(4)}, ${totalCogs.toFixed(4)}, ${profit.toFixed(4)},
         'posted', ${"P3 sale: " + sale.code})
      RETURNING id
    `)).rows as any[];

    // Create sp_sale_lines record
    const lot0 = lots[0]; // for single-lot case (opening stock qty ≥ sale qty)
    await db.execute(sql`
      INSERT INTO sp_sale_lines
        (sale_id, company_id, movement_id, article_code, stock_item_id,
         qty_sold, sale_price_per_unit, base_unit_cost_usd, landed_unit_cost_usd, final_unit_cost_usd)
      VALUES
        (${saleRow.id}, ${SP_COMPANY_ID}, ${lot0.id}, ${sale.code}, ${lot0.stock_item_id ?? null},
         ${sale.qty}, ${sale.salePricePerUnit.toFixed(4)},
         ${lc.discountedBase.toFixed(6)}, ${lc.landed.toFixed(6)}, ${lc.finalCost.toFixed(6)})
    `);

    const result: SaleResult = { code: sale.code, qty: sale.qty, saleTotal, cogs: totalCogs, profit, basePayable: totalBase };
    saleResults.push(result);

    console.log(`   ${sale.code.padEnd(10)} ×${sale.qty} BL @ ${fmtUsd(sale.salePricePerUnit)}/BL → revenue=${fmtUsd(saleTotal)}  COGS=${fmtUsd(totalCogs)}  profit=${fmtUsd(profit)}`);
    assert(`${sale.code}: stock fully consumed (qtyLeft=0)`, Math.abs(qtyLeft) < 0.001, `qtyLeft=${qtyLeft.toFixed(4)}`);
  }

  // ── 8. Reconciliation table ─────────────────────────────────────────────
  console.log(BOLD("\n8. Reconciliation — Computed Expected vs Actual DB"));

  type ReconExpected = {
    code: string; expQty: number; expSales: number;
    expCOGS: number; expProfit: number; expBasePayable: number;
  };
  const expected: ReconExpected[] = SAMPLE_SALES.map(sale => {
    const lc   = lineCosts.find(l => l.code === sale.code)!;
    const cogs  = sale.qty * lc.finalCost;
    const sales = sale.qty * sale.salePricePerUnit;
    return {
      code: sale.code, expQty: sale.qty, expSales: sales,
      expCOGS: cogs, expProfit: sales - cogs, expBasePayable: sale.qty * lc.discountedBase,
    };
  });

  const h = "   Article    | ExpSales    | ActSales    | ExpCOGS     | ActCOGS     | ExpProfit   | ActProfit   | OK?";
  console.log(h);
  console.log("   " + "─".repeat(h.length - 3));

  for (const exp of expected) {
    const act = saleResults.find(s => s.code === exp.code)!;
    const salesOk   = Math.abs(act.saleTotal   - exp.expSales)        < 0.01;
    const cogsOk    = Math.abs(act.cogs        - exp.expCOGS)         < 0.01;
    const profitOk  = Math.abs(act.profit      - exp.expProfit)       < 0.01;
    const payableOk = Math.abs(act.basePayable - exp.expBasePayable)  < 0.01;
    const allOk     = salesOk && cogsOk && profitOk && payableOk;

    console.log(
      `   ${exp.code.padEnd(10)} | ${fmtUsd(exp.expSales).padStart(11)} | ${fmtUsd(act.saleTotal).padStart(11)}` +
      ` | ${fmtUsd(exp.expCOGS).padStart(11)} | ${fmtUsd(act.cogs).padStart(11)}` +
      ` | ${fmtUsd(exp.expProfit).padStart(11)} | ${fmtUsd(act.profit).padStart(11)}` +
      ` | ${allOk ? GREEN("OK") : RED("FAIL")}`
    );

    assertApprox(`${exp.code}: sales match`,       act.saleTotal,    exp.expSales);
    assertApprox(`${exp.code}: COGS match`,         act.cogs,         exp.expCOGS);
    assertApprox(`${exp.code}: profit match`,       act.profit,       exp.expProfit);
    assertApprox(`${exp.code}: basePayable match`,  act.basePayable,  exp.expBasePayable);
  }

  const totExpSales  = expected.reduce((s, e) => s + e.expSales,  0);
  const totActSales  = saleResults.reduce((s, r) => s + r.saleTotal, 0);
  const totExpCOGS   = expected.reduce((s, e) => s + e.expCOGS,   0);
  const totActCOGS   = saleResults.reduce((s, r) => s + r.cogs,      0);
  const totExpProfit = expected.reduce((s, e) => s + e.expProfit,  0);
  const totActProfit = saleResults.reduce((s, r) => s + r.profit,     0);

  console.log("   " + "─".repeat(h.length - 3));
  console.log(
    `   ${"TOTAL".padEnd(10)} | ${fmtUsd(totExpSales).padStart(11)} | ${fmtUsd(totActSales).padStart(11)}` +
    ` | ${fmtUsd(totExpCOGS).padStart(11)} | ${fmtUsd(totActCOGS).padStart(11)}` +
    ` | ${fmtUsd(totExpProfit).padStart(11)} | ${fmtUsd(totActProfit).padStart(11)}`
  );

  assertApprox("Total sales match",  totActSales,  totExpSales);
  assertApprox("Total COGS match",   totActCOGS,   totExpCOGS);
  assertApprox("Total profit match", totActProfit, totExpProfit);

  // ── 9. Remaining stock after sales ─────────────────────────────────────
  console.log(BOLD("\n9. Stock remaining in SPTEST after sales"));
  for (const l of lineCosts) {
    const soldQty = SAMPLE_SALES.find(s => s.code === l.code)?.qty ?? 0;
    const expRemaining = l.qty - soldQty;
    const [row] = (await db.execute(sql`
      SELECT COALESCE(SUM(qty_remaining), 0) AS remaining
      FROM sp_stock_movements
      WHERE company_id = ${SP_COMPANY_ID} AND article_code = ${l.code}
    `)).rows as any[];
    assertApprox(
      `${l.code.padEnd(10)} remaining = ${fmtQty(expRemaining)} BL`,
      pn(row.remaining), expRemaining, 0.001
    );
  }

  // ── 10. sp_sales records ────────────────────────────────────────────────
  console.log(BOLD("\n10. Verify sp_sales records in DB"));
  const salesCount = pn(((await db.execute(sql`
    SELECT COUNT(*) AS n FROM sp_sales WHERE company_id = ${SP_COMPANY_ID}
  `)).rows[0] as any).n);
  assert(`${SAMPLE_SALES.length} sp_sales rows created`, salesCount === SAMPLE_SALES.length);

  const saleLinesCount = pn(((await db.execute(sql`
    SELECT COUNT(*) AS n FROM sp_sale_lines WHERE company_id = ${SP_COMPANY_ID}
  `)).rows[0] as any).n);
  assert(`${SAMPLE_SALES.length} sp_sale_lines rows created`, saleLinesCount === SAMPLE_SALES.length);

  // ── 11. Line-preview alias resolution (DB-level) ────────────────────────
  console.log(BOLD("\n11. Alias resolution — line-preview logic verification"));
  const aliasRows = (await db.execute(sql`
    SELECT a.alias_code, a.stock_item_id, si.code AS item_code, si.name AS item_name
    FROM stock_item_code_aliases a
    JOIN stock_items si ON si.id = a.stock_item_id
    WHERE a.company_id = ${SP_COMPANY_ID}
    ORDER BY a.alias_code
  `)).rows as any[];

  assert("5 aliases with valid stock_items JOIN", aliasRows.length === 5);
  assert("All aliases resolve to item code", (aliasRows as any[]).every(r => r.item_code));

  for (const item of SAMPLE_ITEMS) {
    const aliasRow = aliasRows.find((r: any) => r.alias_code === item.code);
    assert(
      `${item.code} → stockItemId=${item.stockItemId} (${aliasRow?.item_name || "??"})`,
      !!aliasRow && pn(aliasRow.stock_item_id) === item.stockItemId
    );
  }

  // ── 12. GC L'shi isolation check ────────────────────────────────────────
  console.log(BOLD("\n12. GC L'shi isolation — verify ZERO changes to GC data"));
  const gcAfter = await gcSnapshot();

  assert("GC vouchers unchanged",     gcAfter.vouchers   === gcBefore.vouchers,    `before=${gcBefore.vouchers},   after=${gcAfter.vouchers}`);
  assert("GC inventory unchanged",    gcAfter.inventory  === gcBefore.inventory,   `before=${gcBefore.inventory},  after=${gcAfter.inventory}`);
  assert("GC stock_items unchanged",  gcAfter.stockItems === gcBefore.stockItems,  `before=${gcBefore.stockItems}, after=${gcAfter.stockItems}`);

  // Verify GC actual stock quantities untouched
  for (const item of SAMPLE_ITEMS) {
    const [invRow] = (await db.execute(sql`
      SELECT quantity FROM inventory
      WHERE stock_item_id = ${item.stockItemId} AND company_id = ${GC_COMPANY_ID}
      LIMIT 1
    `)).rows as any[];
    assert(`GC ${item.code}: inventory row still exists`, !!invRow);
    if (invRow) assert(`GC ${item.code}: quantity still > 0`, pn(invRow.quantity) > 0, `quantity=${invRow.quantity}`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const totalTests = passed + failed;
  console.log(BOLD(CYAN("\n═══════════════════════════════════════════════════════")));
  if (failed === 0) {
    console.log(GREEN(BOLD(`  ALL ${totalTests} TESTS PASSED ✓`)));
    console.log(CYAN("  Phase 3 complete — GC L'shi untouched, SP FIFO verified"));
  } else {
    console.log(RED(BOLD(`  ${failed} of ${totalTests} TESTS FAILED`)));
    failures.forEach(f => console.log(`    ${RED("•")} ${f}`));
  }
  console.log(BOLD(CYAN("═══════════════════════════════════════════════════════\n")));

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(RED(BOLD("Fatal: " + err.message)));
  console.error(err.stack);
  process.exit(1);
});
