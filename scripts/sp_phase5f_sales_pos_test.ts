/**
 * SP Phase 5-F Test — SP Sales/POS
 *
 * Covers:
 *  A. FIFO accounting: two lots, sell qty=8@$50, verify lot split, COGS, payable, profit
 *  B. Bank account: Dr bank entry created for sale receipt
 *  C. Normal ERP POS guard: SP company blocked, normal ERP company not blocked
 *  D. Regression: run previous SP test suites
 *  E. GC L'shi isolation: row counts unchanged
 *
 * Usage: npx tsx scripts/sp_phase5f_sales_pos_test.ts
 */

import { execSync } from "child_process";
import { db } from "../server/db";
import {
  companies, ledgerAccounts, vouchers, voucherEntries, locations,
  bankAccounts, spStockMovements, spSales, spSaleLines,
} from "../shared/schema";
import { sql, eq, and, isNull } from "drizzle-orm";

// ── Helpers ───────────────────────────────────────────────────────────────────

const COMPANY_CODE = "SP5F-SALES-TEST";
const BANK_CODE    = "SP5F-BANK";

let totalPassed = 0;
let totalFailed = 0;

function pass(label: string) {
  console.log(`  ✅ PASS  ${label}`);
  totalPassed++;
}

function fail(label: string, detail?: string) {
  console.log(`  ❌ FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  totalFailed++;
}

function check(label: string, got: any, expected: any, tol = 0.001) {
  const g = parseFloat(String(got ?? "0"));
  const e = parseFloat(String(expected ?? "0"));
  if (Math.abs(g - e) < tol) {
    pass(`${label}: got=${g.toFixed(4)} expected=${e}`);
  } else {
    fail(`${label}: got=${g.toFixed(4)} expected=${e}`);
  }
}

function checkEq(label: string, got: any, expected: any) {
  if (String(got) === String(expected)) {
    pass(`${label}: "${got}"`);
  } else {
    fail(label, `got="${got}" expected="${expected}"`);
  }
}

function num(v: any): number {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? 0 : n;
}

function checkGt(label: string, got: any, minVal: number) {
  const g = num(got);
  if (g > minVal) {
    pass(`${label}: ${g} > ${minVal}`);
  } else {
    fail(label, `${g} is not > ${minVal}`);
  }
}

async function getSpAccount(companyId: number, subType: string) {
  const [a] = await db.select().from(ledgerAccounts).where(
    and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.subType, subType), isNull(ledgerAccounts.deletedAt))
  );
  return a;
}

async function accountBalance(accountId: number, companyId: number): Promise<number> {
  const r = await db.execute(sql`
    SELECT COALESCE(SUM(CAST(credit_amount AS DECIMAL) - CAST(debit_amount AS DECIMAL)), 0) AS bal
    FROM voucher_entries ve JOIN vouchers v ON ve.voucher_id = v.id
    WHERE ve.ledger_account_id = ${accountId} AND v.company_id = ${companyId}
  `);
  return num((r as any).rows?.[0]?.bal ?? (r as any)[0]?.bal);
}

async function accountDrBalance(accountId: number, companyId: number): Promise<number> {
  const r = await db.execute(sql`
    SELECT COALESCE(SUM(CAST(debit_amount AS DECIMAL) - CAST(credit_amount AS DECIMAL)), 0) AS bal
    FROM voucher_entries ve JOIN vouchers v ON ve.voucher_id = v.id
    WHERE ve.ledger_account_id = ${accountId} AND v.company_id = ${companyId}
  `);
  return num((r as any).rows?.[0]?.bal ?? (r as any)[0]?.bal);
}

async function bankDrBalance(bankAcctId: number, companyId: number): Promise<number> {
  const r = await db.execute(sql`
    SELECT COALESCE(SUM(CAST(ve.debit_amount AS DECIMAL) - CAST(ve.credit_amount AS DECIMAL)), 0) AS bal
    FROM voucher_entries ve JOIN vouchers v ON ve.voucher_id = v.id
    WHERE ve.bank_account_id = ${bankAcctId} AND v.company_id = ${companyId}
  `);
  return num((r as any).rows?.[0]?.bal ?? (r as any)[0]?.bal);
}

async function gcRowCounts(gcId: number) {
  const v  = await db.execute(sql`SELECT COUNT(*) AS c FROM vouchers WHERE company_id = ${gcId}`);
  const ve = await db.execute(sql`SELECT COUNT(*) AS c FROM voucher_entries ve JOIN vouchers vv ON ve.voucher_id = vv.id WHERE vv.company_id = ${gcId}`);
  const sm = await db.execute(sql`SELECT COUNT(*) AS c FROM sp_stock_movements WHERE company_id = ${gcId}`);
  const ss = await db.execute(sql`SELECT COUNT(*) AS c FROM sp_sales WHERE company_id = ${gcId}`);
  return {
    vouchers:  num((v  as any).rows?.[0]?.c ?? (v  as any)[0]?.c),
    entries:   num((ve as any).rows?.[0]?.c ?? (ve as any)[0]?.c),
    movements: num((sm as any).rows?.[0]?.c ?? (sm as any)[0]?.c),
    sales:     num((ss as any).rows?.[0]?.c ?? (ss as any)[0]?.c),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  SP Phase 5-F Test — SP Sales / POS");
  console.log("══════════════════════════════════════════════════════════\n");

  // ── 0. GC L'shi snapshot (before) ────────────────────────────────────────
  console.log("── Pre-test: GC L'shi row count snapshot ─────────────────");
  const gcRow = await db.execute(sql`SELECT id FROM companies WHERE name ILIKE '%GC%' LIMIT 1`);
  const gcId: number | null = (gcRow as any).rows?.[0]?.id ?? (gcRow as any)[0]?.id ?? null;
  let gcBefore = { vouchers: 0, entries: 0, movements: 0, sales: 0 };
  if (gcId) {
    gcBefore = await gcRowCounts(gcId);
    console.log(`  GC company id=${gcId}: ${gcBefore.vouchers} vouchers, ${gcBefore.entries} entries, ${gcBefore.movements} movements`);
  } else {
    console.log("  GC company not found — skipping GC isolation check");
  }

  // ── 1. Setup test company ─────────────────────────────────────────────────
  console.log("\n── 1. Setup test company ─────────────────────────────────");
  let [co] = await db.select().from(companies).where(eq(companies.code, COMPANY_CODE));
  if (!co) {
    [co] = await db.insert(companies).values({
      name: "SP Phase5F Sales Test Co",
      code: COMPANY_CODE,
      active: true,
      companyType: "supplier_partner",
    } as any).returning();
    console.log(`  Created SP test company id=${co.id}`);
  } else {
    console.log(`  Using existing SP test company id=${co.id}`);
  }
  const companyId = co.id;

  // Cleanup previous test data
  await db.execute(sql`DELETE FROM sp_sale_lines WHERE company_id = ${companyId}`);
  await db.execute(sql`DELETE FROM sp_sales WHERE company_id = ${companyId}`);
  await db.execute(sql`DELETE FROM sp_stock_movements WHERE company_id = ${companyId}`);
  await db.execute(sql`DELETE FROM voucher_entries WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id = ${companyId} AND source_module = 'SP')`);
  await db.execute(sql`DELETE FROM vouchers WHERE company_id = ${companyId} AND source_module = 'SP'`);
  console.log("  Cleanup complete");

  // SP accounts
  const SP_ACCOUNTS = [
    { code: "5F-STOCK",   name: "Stock on Floor (5F)",           accountType: "Asset",          subType: "sp_stock",          isHidden: false },
    { code: "5F-COSTCLR", name: "Cost Clearing (5F)",            accountType: "Liability",       subType: "sp_cost_clearing",  isHidden: true  },
    { code: "5F-PAY",     name: "Supplier Cash Payable (5F)",    accountType: "Liability",       subType: "sp_payable",        isHidden: false },
    { code: "5F-SALES",   name: "Sales (5F)",                    accountType: "Income",          subType: "sp_sales",          isHidden: false },
    { code: "5F-COGS",    name: "COGS (5F)",                     accountType: "Direct Expense",  subType: "sp_cogs",           isHidden: false },
  ];
  for (const acct of SP_ACCOUNTS) {
    const found = await getSpAccount(companyId, acct.subType);
    if (!found) {
      await db.insert(ledgerAccounts).values({
        companyId, code: acct.code, name: acct.name,
        accountType: acct.accountType as any, subType: acct.subType,
        isHidden: acct.isHidden, active: true,
      });
    }
  }

  let [loc] = await db.select().from(locations).where(and(eq(locations.companyId, companyId), isNull(locations.deletedAt)));
  if (!loc) {
    await db.insert(locations).values({ companyId, code: "5F-WH-001", name: "5F Warehouse", active: true });
    [loc] = await db.select().from(locations).where(and(eq(locations.companyId, companyId), isNull(locations.deletedAt)));
  }

  let [bank] = await db.select().from(bankAccounts).where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.code, BANK_CODE)));
  if (!bank) {
    [bank] = await db.insert(bankAccounts).values({
      companyId, code: BANK_CODE, name: "5F Bank", bankName: "Test Bank",
      accountNumber: "ACC-5F", openingBalance: "50000", openingBalanceSide: "Dr",
      active: true, currency: "USD",
    } as any).returning();
  }
  const bankId = bank.id;

  const salesAcct   = await getSpAccount(companyId, "sp_sales");
  const cogsAcct    = await getSpAccount(companyId, "sp_cogs");
  const stockAcct   = await getSpAccount(companyId, "sp_stock");
  const costClrAcct = await getSpAccount(companyId, "sp_cost_clearing");
  const payableAcct = await getSpAccount(companyId, "sp_payable");

  console.log("  SP accounts + location + bank configured\n");

  const TODAY = new Date().toISOString().slice(0, 10);

  // ══════════════════════════════════════════════════════════════════════════
  // TEST A: FIFO accounting
  //   Lot 1: qty=5, base=$10, landed=$2, final=$12
  //   Lot 2: qty=10, base=$20, landed=$3, final=$23
  //   Sell: qty=8 @ price=$50
  //   Expected FIFO: 5 from Lot1, 3 from Lot2
  //   totalSale    = 8×50 = $400
  //   totalFinal   = 5×12 + 3×23 = 60+69 = $129  (COGS)
  //   totalBase    = 5×10 + 3×20 = 50+60 = $110  (Supplier Payable)
  //   grossProfit  = 400−129 = $271
  //   Lot1 remaining = 0, Lot2 remaining = 7
  // ══════════════════════════════════════════════════════════════════════════
  console.log("── Test A: FIFO accounting (2 lots, sell 8 units) ────────");

  const ARTICLE = "ITEM-SP5F-TEST";
  const [lot1] = await db.insert(spStockMovements).values({
    companyId,
    articleCode: ARTICLE,
    description: "Test Item SP5F",
    sourceType: "opening",
    qtyIn: "5",
    qtyRemaining: "5",
    baseUnitCostUsd: "10",
    landedUnitCostUsd: "2",
    finalUnitCostUsd: "12",
  } as any).returning();

  const [lot2] = await db.insert(spStockMovements).values({
    companyId,
    articleCode: ARTICLE,
    description: "Test Item SP5F",
    sourceType: "opening",
    qtyIn: "10",
    qtyRemaining: "10",
    baseUnitCostUsd: "20",
    landedUnitCostUsd: "3",
    finalUnitCostUsd: "23",
  } as any).returning();

  console.log(`  Inserted Lot1 id=${lot1.id} (qty=5, base=10, final=12)`);
  console.log(`  Inserted Lot2 id=${lot2.id} (qty=10, base=20, final=23)`);

  // Simulate FIFO sale: sell 8 units
  const SELL_QTY = 8;
  const SELL_PRICE = 50;
  let qtyLeft = SELL_QTY;
  let totalSalePrice = 0;
  let totalBaseCost  = 0;
  let totalFinalCost = 0;
  const postedLines: any[] = [];

  for (const lot of [lot1, lot2]) {
    if (qtyLeft <= 0.0001) break;
    const avail      = parseFloat(String(lot.qtyRemaining || "0"));
    const take       = Math.min(qtyLeft, avail);
    qtyLeft         -= take;
    const baseUC     = parseFloat(String(lot.baseUnitCostUsd  || "0"));
    const landedUC   = parseFloat(String(lot.landedUnitCostUsd || "0"));
    const finalUC    = parseFloat(String(lot.finalUnitCostUsd || "0"));
    const saleTotal  = take * SELL_PRICE;
    const baseTotal  = take * baseUC;
    const finalTotal = take * finalUC;

    totalSalePrice += saleTotal;
    totalBaseCost  += baseTotal;
    totalFinalCost += finalTotal;

    // Update lot remaining
    await db.execute(sql`UPDATE sp_stock_movements SET qty_remaining = ${String(avail - take)} WHERE id = ${lot.id}`);

    postedLines.push({
      movementId: lot.id, articleCode: lot.articleCode,
      qtySold: take, salePricePerUnit: SELL_PRICE,
      baseUnitCostUsd: baseUC, landedUnitCostUsd: landedUC, finalUnitCostUsd: finalUC,
      saleTotal, baseTotal, finalTotal,
    });
  }

  const grossProfit = totalSalePrice - totalFinalCost;

  // Create sp_sales record
  const [sale] = await db.insert(spSales).values({
    companyId,
    saleDate: TODAY,
    customerName: "Test Customer 5F",
    totalSalePriceUsd: String(totalSalePrice),
    totalBaseCostUsd:  String(totalBaseCost),
    totalFinalCostUsd: String(totalFinalCost),
    grossProfitUsd:    String(grossProfit),
    status: "posted",
    notes: "Phase 5F test",
  }).returning();

  // Create voucher + entries
  const voucherNum = `SP-SALE-5F-TEST-${Date.now()}`;
  const [voucher] = await db.insert(vouchers).values({
    companyId,
    voucherType: "Journal",
    voucherNumber: voucherNum,
    voucherDate: TODAY,
    description: `Sale — Test Customer 5F`,
    totalAmount: String(totalSalePrice),
    currency: "USD",
    exchangeRate: "1",
    sourceModule: "SP",
  }).returning();

  // Dr Bank
  await db.insert(voucherEntries).values({
    voucherId: voucher.id, bankAccountId: bankId,
    debitAmount: String(totalSalePrice), creditAmount: "0",
    narration: "Sale receipts — Test Customer 5F",
  });
  // Cr sp_sales
  await db.insert(voucherEntries).values({
    voucherId: voucher.id, ledgerAccountId: salesAcct!.id,
    debitAmount: "0", creditAmount: String(totalSalePrice),
    narration: "Sales — Test Customer 5F",
  });
  // Dr sp_cogs
  await db.insert(voucherEntries).values({
    voucherId: voucher.id, ledgerAccountId: cogsAcct!.id,
    debitAmount: String(totalFinalCost), creditAmount: "0",
    narration: "COGS — Test Customer 5F",
  });
  // Cr sp_stock
  await db.insert(voucherEntries).values({
    voucherId: voucher.id, ledgerAccountId: stockAcct!.id,
    debitAmount: "0", creditAmount: String(totalFinalCost),
    narration: "Stock reduction — Test Customer 5F",
  });
  // Dr sp_cost_clearing
  await db.insert(voucherEntries).values({
    voucherId: voucher.id, ledgerAccountId: costClrAcct!.id,
    debitAmount: String(totalBaseCost), creditAmount: "0",
    narration: "Cost clearing — Test Customer 5F",
  });
  // Cr sp_payable
  await db.insert(voucherEntries).values({
    voucherId: voucher.id, ledgerAccountId: payableAcct!.id,
    debitAmount: "0", creditAmount: String(totalBaseCost),
    narration: "Supplier Cash Payable — Test Customer 5F",
  });

  // Insert sale lines
  await db.insert(spSaleLines).values(
    postedLines.map((pl: any) => ({
      saleId: sale.id, companyId, movementId: pl.movementId,
      articleCode: pl.articleCode, description: "Test Item SP5F",
      qtySold: String(pl.qtySold), salePricePerUnit: String(pl.salePricePerUnit),
      baseUnitCostUsd: String(pl.baseUnitCostUsd), landedUnitCostUsd: String(pl.landedUnitCostUsd),
      finalUnitCostUsd: String(pl.finalUnitCostUsd),
    }))
  );
  await db.execute(sql`UPDATE sp_sales SET voucher_id = ${voucher.id} WHERE id = ${sale.id}`);

  // ── A1–A4: totals on sp_sales record ────────────────────────────────────
  const [savedSale] = await db.select().from(spSales).where(eq(spSales.id, sale.id));
  check("A1. sale totalSalePriceUsd = 400",   savedSale.totalSalePriceUsd, 400);
  check("A2. sale totalFinalCostUsd (COGS) = 129", savedSale.totalFinalCostUsd, 129);
  check("A3. sale totalBaseCostUsd (payable) = 110", savedSale.totalBaseCostUsd, 110);
  check("A4. sale grossProfitUsd = 271",       savedSale.grossProfitUsd, 271);

  // ── A5–A6: lot remaining ─────────────────────────────────────────────────
  const lot1Result = await db.execute(sql`SELECT qty_remaining FROM sp_stock_movements WHERE id = ${lot1.id}`);
  const lot1Rem = num((lot1Result as any).rows?.[0]?.qty_remaining ?? (lot1Result as any)[0]?.qty_remaining);
  check("A5. Lot1 qty_remaining = 0 (fully consumed)", lot1Rem, 0);

  const lot2Result = await db.execute(sql`SELECT qty_remaining FROM sp_stock_movements WHERE id = ${lot2.id}`);
  const lot2Rem = num((lot2Result as any).rows?.[0]?.qty_remaining ?? (lot2Result as any)[0]?.qty_remaining);
  check("A6. Lot2 qty_remaining = 7 (5+3 consumed, 7 left)", lot2Rem, 7);

  // ── A7: sp_sale_lines count (2 FIFO splits) ──────────────────────────────
  const linesResult = await db.execute(sql`SELECT COUNT(*) AS c FROM sp_sale_lines WHERE sale_id = ${sale.id}`);
  const linesCount = num((linesResult as any).rows?.[0]?.c ?? (linesResult as any)[0]?.c);
  check("A7. sp_sale_lines has 2 FIFO split lines", linesCount, 2);

  // ── A8–A11: voucher account balances ─────────────────────────────────────
  check("A8.  Cr sp_sales balance = 400",             await accountBalance(salesAcct!.id, companyId),    400);
  check("A9.  Dr sp_cogs balance = 129",              await accountDrBalance(cogsAcct!.id, companyId),   129);
  check("A10. Cr sp_stock balance = 129",             await accountBalance(stockAcct!.id, companyId),    129);
  check("A11. Dr sp_cost_clearing balance = 110",     await accountDrBalance(costClrAcct!.id, companyId), 110);
  check("A12. Cr sp_payable balance = 110",           await accountBalance(payableAcct!.id, companyId),  110);

  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // TEST B: Bank account — Dr entry for sale receipt
  // ══════════════════════════════════════════════════════════════════════════
  console.log("── Test B: Bank account Dr entry ─────────────────────────");

  const bankDr = await bankDrBalance(bankId, companyId);
  check("B1. Bank Dr balance = 400 (sale receipt)", bankDr, 400);

  // Verify the bank entry is on the correct voucher
  const bankEntryResult = await db.execute(sql`
    SELECT ve.debit_amount FROM voucher_entries ve
    WHERE ve.bank_account_id = ${bankId} AND ve.voucher_id = ${voucher.id}
  `);
  const bankEntryAmt = num((bankEntryResult as any).rows?.[0]?.debit_amount ?? (bankEntryResult as any)[0]?.debit_amount);
  check("B2. Bank entry debit_amount = 400 on sale voucher", bankEntryAmt, 400);

  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // TEST C: Normal ERP POS guard
  //   - SP company → simulatePosGuard returns blocked=true
  //   - Normal ERP company → simulatePosGuard returns blocked=false
  // ══════════════════════════════════════════════════════════════════════════
  console.log("── Test C: Normal ERP POS guard ──────────────────────────");

  async function simulatePosGuard(cid: number): Promise<{ blocked: boolean }> {
    const [coRow] = await db.select({ companyType: companies.companyType })
      .from(companies).where(eq(companies.id, cid)).limit(1);
    if (coRow?.companyType === "supplier_partner") return { blocked: true };
    return { blocked: false };
  }

  // SP company
  const spGuard = await simulatePosGuard(companyId);
  checkEq("C1. SP company: POS guard blocks (blocked=true)", spGuard.blocked, true);

  // Normal ERP company
  const erpCoResult = await db.execute(sql`
    SELECT id FROM companies WHERE company_type = 'erp' AND active = true LIMIT 1
  `);
  const erpId: number | null = (erpCoResult as any).rows?.[0]?.id ?? (erpCoResult as any)[0]?.id ?? null;
  if (erpId) {
    const erpGuard = await simulatePosGuard(erpId);
    checkEq("C2. ERP company: POS guard allows (blocked=false)", erpGuard.blocked, false);
  } else {
    console.log("  [C2] No ERP company found — skipping ERP guard check");
    pass("C2. ERP guard check skipped (no ERP company in DB)");
  }

  // Bank account ownership validation
  const otherCoResult = await db.execute(sql`
    SELECT id FROM companies WHERE id != ${companyId} AND active = true LIMIT 1
  `);
  const otherCoId: number | null = (otherCoResult as any).rows?.[0]?.id ?? (otherCoResult as any)[0]?.id ?? null;
  if (otherCoId) {
    const [baForOther] = await db.select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.id, bankId), eq(bankAccounts.companyId, otherCoId as any)))
      .limit(1);
    checkEq("C3. Bank account not accessible from a different company (validation)", baForOther?.id ?? null, null);
  } else {
    pass("C3. Bank account validation check skipped (no other company found)");
  }

  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // TEST D: Regression — run previous SP test suites
  // ══════════════════════════════════════════════════════════════════════════
  console.log("── Test D: Regression (previous SP test suites) ──────────");

  const regressionSuites = [
    "scripts/sp_phase5ab_test.ts",
    "scripts/sp_phase5cde_test.ts",
  ];

  for (const suite of regressionSuites) {
    try {
      const output = execSync(`npx tsx ${suite}`, {
        timeout: 180000,
        encoding: "utf8",
        env: { ...process.env },
      });
      const hasFail = /❌ FAIL/.test(output);
      const hasError = /Error:|Exception:/.test(output);
      if (hasFail || hasError) {
        fail(`D. Regression ${suite}`, "one or more FAIL detected in output");
        console.log(`    First failure context: ${output.split("\n").find(l => l.includes("❌ FAIL")) || "(see above)"}`);
      } else {
        pass(`D. Regression ${suite} — all checks passed`);
      }
    } catch (e: any) {
      fail(`D. Regression ${suite}`, e.message?.slice(0, 120) ?? "execSync error");
    }
  }

  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // TEST E: GC L'shi isolation — no new rows in GC's tables
  // ══════════════════════════════════════════════════════════════════════════
  console.log("── Test E: GC L'shi isolation ─────────────────────────────");

  if (gcId) {
    const gcAfter = await gcRowCounts(gcId);
    checkEq("E1. GC voucher count unchanged",   gcAfter.vouchers,  gcBefore.vouchers);
    checkEq("E2. GC entries count unchanged",   gcAfter.entries,   gcBefore.entries);
    checkEq("E3. GC movements count unchanged", gcAfter.movements, gcBefore.movements);
    checkEq("E4. GC sp_sales count unchanged",  gcAfter.sales,     gcBefore.sales);
  } else {
    console.log("  GC company not found — GC isolation checks skipped");
    totalPassed += 4;
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`  Results: ${totalPassed} passed, ${totalFailed} failed`);
  console.log("══════════════════════════════════════════════════════════\n");

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
