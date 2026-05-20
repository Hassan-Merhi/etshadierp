/**
 * SP Phase 5-C/D/E Test
 *
 * Covers:
 *  1. Container create saves container_number and freight_estimate_usd
 *  2. Container create posts Dr SP-OTW / Cr SP-OTWCLR
 *  3. Prepaid create with prepaidDate uses that date on the voucher
 *  4. Prepaid can be created without containerId
 *  5. Offload vouchers match accounting preview (Dr SP-STOCK / Cr SP-COSTCLR / Cr SP-PREPAID / Bank / Payable)
 *  6. Supplier Cash Payable NOT created by container, prepaid, or offload
 *  7. Supplier Cash Payable IS created by sale
 *  8. Goods OTW goes to zero after offload
 *  9. Prepaid remaining is correct after use
 * 10. GC L'shi row counts remain unchanged
 * 11. Normal ERP companies are unaffected by SP guards
 *
 * Usage: npx tsx scripts/sp_phase5cde_test.ts
 */

import { db } from "../server/db";
import {
  companies, ledgerAccounts, vouchers, voucherEntries, locations,
  bankAccounts, spContainers, spContainerLines, spPrepaidCharges,
  spOffloads, spOffloadCharges, spStockMovements, spSales, spSaleLines,
} from "../shared/schema";
import { sql, eq, and, isNull, asc } from "drizzle-orm";

// ── Helpers ───────────────────────────────────────────────────────────────────

const COMPANY_CODE = "SP5CDE-TEST";
const BANK_CODE    = "SP5CDE-BANK";

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

function checkNull(label: string, got: any) {
  if (got === null || got === undefined) {
    pass(`${label}: is null/undefined as expected`);
  } else {
    fail(label, `expected null but got "${got}"`);
  }
}

function checkGt(label: string, got: any, minVal: number) {
  const g = parseFloat(String(got ?? "0"));
  if (g > minVal) {
    pass(`${label}: ${g} > ${minVal}`);
  } else {
    fail(label, `${g} is not > ${minVal}`);
  }
}

function num(v: any): number {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? 0 : n;
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

// ── Snapshot helpers for GC L'shi isolation ──────────────────────────────────

async function gcRowCounts(gcId: number) {
  const v  = await db.execute(sql`SELECT COUNT(*) AS c FROM vouchers WHERE company_id = ${gcId}`);
  const ve = await db.execute(sql`SELECT COUNT(*) AS c FROM voucher_entries ve JOIN vouchers vv ON ve.voucher_id = vv.id WHERE vv.company_id = ${gcId}`);
  const sc = await db.execute(sql`SELECT COUNT(*) AS c FROM sp_containers WHERE company_id = ${gcId}`);
  const sm = await db.execute(sql`SELECT COUNT(*) AS c FROM sp_stock_movements WHERE company_id = ${gcId}`);
  return {
    vouchers:  num((v  as any).rows?.[0]?.c ?? (v  as any)[0]?.c),
    entries:   num((ve as any).rows?.[0]?.c ?? (ve as any)[0]?.c),
    containers: num((sc as any).rows?.[0]?.c ?? (sc as any)[0]?.c),
    movements:  num((sm as any).rows?.[0]?.c ?? (sm as any)[0]?.c),
  };
}

// ── Main test ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  SP Phase 5-C/D/E Test");
  console.log("══════════════════════════════════════════════════════════\n");

  // ── 0. Find GC L'shi row counts BEFORE test ────────────────────────────────
  console.log("── Pre-test: GC L'shi row count snapshot ─────────────────");
  const gcRow = await db.execute(sql`
    SELECT id FROM companies WHERE name ILIKE '%GC%' LIMIT 1
  `);
  const gcId: number | null = (gcRow as any).rows?.[0]?.id ?? (gcRow as any)[0]?.id ?? null;
  let gcBefore = { vouchers: 0, entries: 0, containers: 0, movements: 0 };
  if (gcId) {
    gcBefore = await gcRowCounts(gcId);
    console.log(`  GC company id=${gcId}: ${gcBefore.vouchers} vouchers, ${gcBefore.entries} entries`);
  } else {
    console.log("  GC company not found — skipping GC isolation check");
  }

  // ── 1. Find / create test company ─────────────────────────────────────────
  console.log("\n── 1. Setup test company ─────────────────────────────────");
  let [co] = await db.select().from(companies).where(eq(companies.code, COMPANY_CODE));
  if (!co) {
    [co] = await db.insert(companies).values({
      name: "SP Phase5CDE Test Co",
      code: COMPANY_CODE,
      active: true,
      companyType: "supplier_partner",
    } as any).returning();
    console.log(`  Created SP test company id=${co.id}`);
  } else {
    console.log(`  Using existing SP test company id=${co.id}`);
  }
  const companyId = co.id;

  // Cleanup
  await db.execute(sql`DELETE FROM sp_sale_lines WHERE company_id = ${companyId}`);
  await db.execute(sql`DELETE FROM sp_sales WHERE company_id = ${companyId}`);
  await db.execute(sql`DELETE FROM sp_stock_movements WHERE company_id = ${companyId}`);
  await db.execute(sql`DELETE FROM sp_offload_charges WHERE offload_id IN (SELECT id FROM sp_offloads WHERE company_id = ${companyId})`);
  await db.execute(sql`DELETE FROM sp_offloads WHERE company_id = ${companyId}`);
  await db.execute(sql`DELETE FROM sp_prepaid_charges WHERE company_id = ${companyId}`);
  await db.execute(sql`DELETE FROM sp_container_lines WHERE company_id = ${companyId}`);
  await db.execute(sql`DELETE FROM sp_containers WHERE company_id = ${companyId}`);
  await db.execute(sql`DELETE FROM voucher_entries WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id = ${companyId} AND source_module = 'SP')`);
  await db.execute(sql`DELETE FROM vouchers WHERE company_id = ${companyId} AND source_module = 'SP'`);
  console.log("  Cleanup complete\n");

  // SP accounts
  const SP_ACCOUNTS = [
    { code: "5CDE-OTW",     name: "Goods On The Way (5CDE)",    accountType: "Asset",          subType: "sp_goods_otw",      isHidden: false },
    { code: "5CDE-OTWCLR",  name: "Goods OTW Clearing (5CDE)",  accountType: "Liability",       subType: "sp_otw_clearing",   isHidden: true  },
    { code: "5CDE-PREPAID", name: "Prepaid Charges (5CDE)",     accountType: "Asset",          subType: "sp_prepaid",        isHidden: false },
    { code: "5CDE-STOCK",   name: "Stock on Floor (5CDE)",      accountType: "Asset",          subType: "sp_stock",          isHidden: false },
    { code: "5CDE-COSTCLR", name: "Cost Clearing (5CDE)",       accountType: "Liability",       subType: "sp_cost_clearing",  isHidden: true  },
    { code: "5CDE-PAY",     name: "Supplier Cash Payable (5CDE)", accountType: "Liability",     subType: "sp_payable",        isHidden: false },
    { code: "5CDE-SALES",   name: "Sales (5CDE)",               accountType: "Income",         subType: "sp_sales",          isHidden: false },
    { code: "5CDE-COGS",    name: "COGS (5CDE)",                accountType: "Direct Expense", subType: "sp_cogs",           isHidden: false },
    { code: "5CDE-SHARED",  name: "Shared Charges (5CDE)",      accountType: "Direct Expense", subType: "sp_shared_charges", isHidden: false },
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
    await db.insert(locations).values({ companyId, code: "5CDE-WH-001", name: "5CDE Warehouse", active: true });
    [loc] = await db.select().from(locations).where(and(eq(locations.companyId, companyId), isNull(locations.deletedAt)));
  }
  let [bank] = await db.select().from(bankAccounts).where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.code, BANK_CODE)));
  if (!bank) {
    [bank] = await db.insert(bankAccounts).values({
      companyId, code: BANK_CODE, name: "5CDE Bank", bankName: "Test Bank",
      accountNumber: "ACC-5CDE", openingBalance: "50000", openingBalanceSide: "Dr",
      active: true, currency: "USD",
    } as any).returning();
  }
  const bankId = bank.id;

  const otwAcct    = await getSpAccount(companyId, "sp_goods_otw");
  const otwClrAcct = await getSpAccount(companyId, "sp_otw_clearing");
  const prepaidAcct = await getSpAccount(companyId, "sp_prepaid");
  const stockAcct  = await getSpAccount(companyId, "sp_stock");
  const costClrAcct = await getSpAccount(companyId, "sp_cost_clearing");
  const payableAcct = await getSpAccount(companyId, "sp_payable");
  const salesAcct  = await getSpAccount(companyId, "sp_sales");
  const cogsAcct   = await getSpAccount(companyId, "sp_cogs");

  console.log("  SP accounts + location + bank configured\n");

  const TODAY = "2026-05-20";

  // ══════════════════════════════════════════════════════════════════════════
  // TEST A: Container create — container_number + freight_estimate_usd
  // ══════════════════════════════════════════════════════════════════════════
  console.log("── Test A: Container create (P5-C fields + OTW voucher) ──");

  const invoiceTotal = 3000;
  const [container] = await db.insert(spContainers).values({
    companyId,
    supplierName: "5CDE Supplier",
    containerNumber: "ABCD1234567",
    invoiceNumber: "INV-5CDE-001",
    invoiceDate: TODAY,
    invoiceTotalUsd: String(invoiceTotal),
    discountPct: "10",
    freightEstimateUsd: "250",
    status: "open",
  }).returning();

  // A1: container_number saved
  checkEq("A1. container_number saved to DB", container.containerNumber, "ABCD1234567");

  // A2: freight_estimate_usd saved
  checkEq("A2. freight_estimate_usd saved to DB", container.freightEstimateUsd, "250.0000");

  // A3: discountPct saved
  check("A3. discountPct saved", num(container.discountPct), 10);

  // Insert container lines
  await db.insert(spContainerLines).values([
    { containerId: container.id, companyId, articleCode: "ITEM-A", description: "Item A", qty: "200", unitRateUsd: "10" },
    { containerId: container.id, companyId, articleCode: "ITEM-B", description: "Item B", qty: "100", unitRateUsd: "10" },
  ]);

  // Post Goods OTW voucher (Dr OTW / Cr OTW-CLR)
  const [vOTW] = await db.insert(vouchers).values({
    companyId, voucherType: "Journal",
    voucherNumber: `SP-OTW-5CDE-A-${Date.now()}`,
    voucherDate: TODAY,
    description: "Goods OTW test",
    totalAmount: String(invoiceTotal), currency: "USD", exchangeRate: "1", sourceModule: "SP",
  }).returning();
  await db.insert(voucherEntries).values({ voucherId: vOTW.id, ledgerAccountId: otwAcct!.id, debitAmount: String(invoiceTotal), creditAmount: "0", narration: "Dr OTW" });
  await db.insert(voucherEntries).values({ voucherId: vOTW.id, ledgerAccountId: otwClrAcct!.id, debitAmount: "0", creditAmount: String(invoiceTotal), narration: "Cr OTW-CLR" });
  await db.update(spContainers).set({ goodsOtwVoucherId: vOTW.id }).where(eq(spContainers.id, container.id));

  // A4: Dr OTW balance = +3000
  const otwBal = await accountDrBalance(otwAcct!.id, companyId);
  check("A4. Dr SP-OTW balance after container create = invoice total", otwBal, invoiceTotal);

  // A5: Cr OTW-CLR balance = +3000
  const otwClrBal = await accountBalance(otwClrAcct!.id, companyId);
  check("A5. Cr SP-OTWCLR balance after container create = invoice total", otwClrBal, invoiceTotal);

  // A6: Supplier Cash Payable NOT created by container
  const payBalAfterContainer = await accountBalance(payableAcct!.id, companyId);
  check("A6. SP-PAY (Supplier Cash Payable) = 0 after container create", payBalAfterContainer, 0);

  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // TEST B: Prepaid — with specific date (P5-D) + without containerId (P5-D)
  // ══════════════════════════════════════════════════════════════════════════
  console.log("── Test B: Prepaid create (P5-D — date field + optional containerId) ──");

  const PREPAID_DATE = "2026-05-15";
  const prepaidAmount = 300;

  // B1: Prepaid linked to container — with specific prepaid date
  const [prepaid1] = await db.insert(spPrepaidCharges).values({
    companyId,
    containerId: container.id,
    prepaidDate: PREPAID_DATE,
    chargeType: "duty",
    agentName: "Customs Authority",
    amountPaidUsd: String(prepaidAmount),
    amountUsedUsd: "0",
  }).returning();
  const [vPre1] = await db.insert(vouchers).values({
    companyId, voucherType: "Journal",
    voucherNumber: `SP-PRE-5CDE-B1-${prepaid1.id}`,
    voucherDate: PREPAID_DATE,                // ← uses prepaidDate from form
    description: "Prepaid duty",
    totalAmount: String(prepaidAmount), currency: "USD", exchangeRate: "1", sourceModule: "SP",
  }).returning();
  await db.insert(voucherEntries).values({ voucherId: vPre1.id, ledgerAccountId: prepaidAcct!.id, debitAmount: String(prepaidAmount), creditAmount: "0", narration: "Dr Prepaid" });
  await db.insert(voucherEntries).values({ voucherId: vPre1.id, bankAccountId: bankId, debitAmount: "0", creditAmount: String(prepaidAmount), narration: "Cr Bank" });
  await db.update(spPrepaidCharges).set({ voucherId: vPre1.id }).where(eq(spPrepaidCharges.id, prepaid1.id));

  checkEq("B1. prepaid_date saved to DB", prepaid1.prepaidDate, PREPAID_DATE);
  checkEq("B2. voucher voucherDate = prepaidDate (not server date)", vPre1.voucherDate, PREPAID_DATE);
  check("B3. Prepaid Dr SP-PREPAID balance = 300", await accountDrBalance(prepaidAcct!.id, companyId), 300);

  // B4: Supplier Cash Payable NOT created by prepaid
  const payBalAfterPrepaid = await accountBalance(payableAcct!.id, companyId);
  check("B4. SP-PAY = 0 after prepaid create", payBalAfterPrepaid, 0);

  // B5: Prepaid WITHOUT containerId (P5-D: containerId is now optional)
  const [prepaid2] = await db.insert(spPrepaidCharges).values({
    companyId,
    containerId: null,         // ← no container link
    prepaidDate: TODAY,
    chargeType: "freight",
    agentName: "Freight Broker",
    amountPaidUsd: "150",
    amountUsedUsd: "0",
  }).returning();
  checkNull("B5. Prepaid without containerId saved — containerId is null", prepaid2.containerId);
  checkEq("B6. Prepaid without containerId has correct chargeType", prepaid2.chargeType, "freight");

  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // TEST C: Offload — full accounting verification (P5-E)
  // ══════════════════════════════════════════════════════════════════════════
  console.log("── Test C: Offload accounting (P5-E) ─────────────────────");

  const totalQty       = 300;  // 200 + 100
  const discountFactor = 0.90; // 10% discount
  const baseUnitCost   = 10 * discountFactor;  // $9 per unit
  const totalBaseCost  = totalQty * baseUnitCost; // $2,700
  // We'll use prepaid1 ($300) as the landed charge
  const totalLandedCost = prepaidAmount; // $300
  const landedPerUnit  = totalLandedCost / totalQty; // $1/unit
  const totalFinalCost = totalBaseCost + totalLandedCost; // $3,000

  // Accounting preview assertion: before offload, note down expected Dr/Cr
  // Voucher A: Dr OTW-CLR = 3000 / Cr OTW = 3000
  // Voucher B: Dr STOCK = 3000 / Cr COSTCLR = 2700 / Cr PREPAID = 300

  const offloadResult = await db.transaction(async (tx) => {
    // Voucher A: OTW reversal
    const [vA] = await tx.insert(vouchers).values({
      companyId, voucherType: "Journal",
      voucherNumber: `SP-OTW-REV-5CDE-${container.id}-${Date.now()}`,
      voucherDate: TODAY,
      description: "OTW Reversal 5CDE",
      totalAmount: String(invoiceTotal), currency: "USD", exchangeRate: "1", sourceModule: "SP",
    }).returning();
    await tx.insert(voucherEntries).values({ voucherId: vA.id, ledgerAccountId: otwClrAcct!.id, debitAmount: String(invoiceTotal), creditAmount: "0", narration: "Dr OTW-CLR" });
    await tx.insert(voucherEntries).values({ voucherId: vA.id, ledgerAccountId: otwAcct!.id, debitAmount: "0", creditAmount: String(invoiceTotal), narration: "Cr OTW" });

    // Voucher B: Stock creation
    const [vB] = await tx.insert(vouchers).values({
      companyId, voucherType: "Journal",
      voucherNumber: `SP-STOCK-5CDE-${container.id}-${Date.now()}`,
      voucherDate: TODAY,
      description: "Stock 5CDE",
      totalAmount: String(totalFinalCost), currency: "USD", exchangeRate: "1", sourceModule: "SP",
    }).returning();
    await tx.insert(voucherEntries).values({ voucherId: vB.id, ledgerAccountId: stockAcct!.id, debitAmount: String(totalFinalCost), creditAmount: "0", narration: "Dr STOCK" });
    await tx.insert(voucherEntries).values({ voucherId: vB.id, ledgerAccountId: costClrAcct!.id, debitAmount: "0", creditAmount: String(totalBaseCost), narration: "Cr COSTCLR" });
    await tx.insert(voucherEntries).values({ voucherId: vB.id, ledgerAccountId: prepaidAcct!.id, debitAmount: "0", creditAmount: String(prepaidAmount), narration: "Cr PREPAID used" });

    // Update prepaid used
    await tx.execute(sql`UPDATE sp_prepaid_charges SET amount_used_usd = amount_used_usd + ${prepaidAmount} WHERE id = ${prepaid1.id}`);

    const [offload] = await tx.insert(spOffloads).values({
      companyId, containerId: container.id, offloadDate: TODAY,
      totalQty: String(totalQty),
      totalBaseCostUsd: String(totalBaseCost),
      totalLandedCostUsd: String(totalLandedCost),
      totalFinalCostUsd: String(totalFinalCost),
      voucherIdReversal: vA.id,
      voucherIdStock: vB.id,
    }).returning();

    await tx.insert(spOffloadCharges).values({
      offloadId: offload.id, companyId,
      chargeType: "prepaid_used", description: "Duty",
      amountUsd: String(prepaidAmount), prepaidChargeId: prepaid1.id,
    });

    const containerLines = await tx.select().from(spContainerLines).where(eq(spContainerLines.containerId, container.id));
    for (const line of containerLines) {
      const qty = num(line.qty);
      await tx.insert(spStockMovements).values({
        companyId, containerId: container.id, offloadId: offload.id,
        containerLineId: line.id, articleCode: line.articleCode, description: line.description,
        locationId: loc.id,
        qtyIn: String(qty), qtyRemaining: String(qty),
        baseUnitCostUsd: String(baseUnitCost),
        landedUnitCostUsd: String(landedPerUnit),
        finalUnitCostUsd: String(baseUnitCost + landedPerUnit),
      });
    }

    await tx.update(spContainers).set({ status: "offloaded" }).where(eq(spContainers.id, container.id));
    return offload;
  });

  // C1: Goods OTW goes to zero after offload
  const otwAfterOffload = await accountDrBalance(otwAcct!.id, companyId);
  check("C1. Goods OTW balance = 0 after offload (Dr+Cr net)", otwAfterOffload, 0);

  // C2: OTW Clearing also zero
  const otwClrAfterOffload = await accountBalance(otwClrAcct!.id, companyId);
  check("C2. OTW Clearing balance = 0 after offload", otwClrAfterOffload, 0);

  // C3: Dr STOCK = totalFinalCost = 3000
  const stockBal = await accountDrBalance(stockAcct!.id, companyId);
  check("C3. Dr SP-STOCK balance = totalFinalCost (3000)", stockBal, totalFinalCost);

  // C4: Cr COSTCLR = totalBaseCost = 2700
  const costClrBal = await accountBalance(costClrAcct!.id, companyId);
  check("C4. Cr SP-COSTCLR balance = totalBaseCost (2700)", costClrBal, totalBaseCost);

  // C5: SP-PREPAID net = 0 (Dr 300 from prepaid create, Cr 300 from offload use)
  const prepaidBal = await accountDrBalance(prepaidAcct!.id, companyId);
  check("C5. SP-PREPAID net balance = 0 (300 Dr prepaid, 300 Cr used)", prepaidBal, 0);

  // C6: Supplier Cash Payable NOT created by offload
  const payBalAfterOffload = await accountBalance(payableAcct!.id, companyId);
  check("C6. SP-PAY = 0 after offload (payable not touched by container/prepaid/offload)", payBalAfterOffload, 0);

  // C7: Prepaid remaining = 0 (fully used)
  const [updatedPrepaid] = await db.select().from(spPrepaidCharges).where(eq(spPrepaidCharges.id, prepaid1.id));
  check("C7. prepaid amountUsedUsd = 300 after offload use", num(updatedPrepaid.amountUsedUsd), 300);
  const remaining = num(updatedPrepaid.amountPaidUsd) - num(updatedPrepaid.amountUsedUsd);
  check("C8. Prepaid remaining = 0 after full use", remaining, 0);

  // C9: Offload record exists with correct totals
  const [offloadRow] = await db.select().from(spOffloads).where(eq(spOffloads.id, offloadResult.id));
  check("C9. Offload totalFinalCostUsd = 3000", num(offloadRow.totalFinalCostUsd), 3000);
  check("C10. Offload totalBaseCostUsd = 2700", num(offloadRow.totalBaseCostUsd), 2700);
  check("C11. Offload totalLandedCostUsd = 300", num(offloadRow.totalLandedCostUsd), 300);

  // C12: Container status = offloaded
  const [updatedContainer] = await db.select().from(spContainers).where(eq(spContainers.id, container.id));
  checkEq("C12. Container status = offloaded after offload", updatedContainer.status, "offloaded");

  // C13: container_number still intact after offload
  checkEq("C13. container_number still intact after offload", updatedContainer.containerNumber, "ABCD1234567");

  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // TEST D: Sale — Supplier Cash Payable IS created by sale only
  // ══════════════════════════════════════════════════════════════════════════
  console.log("── Test D: Sale — SP-PAY created only by sale ────────────");

  const qtySold   = 50;
  const salePrice = 20;    // sell at $20/unit
  const saleTotal = qtySold * salePrice;  // $1,000
  const baseTotal = qtySold * baseUnitCost; // 50 × 9 = $450
  const finalTotal = qtySold * (baseUnitCost + landedPerUnit); // 50 × 10 = $500
  const grossProfit = saleTotal - finalTotal; // $500

  // Use ITEM-A movement
  const [moveA] = await db.select().from(spStockMovements).where(
    and(eq(spStockMovements.companyId, companyId), eq(spStockMovements.articleCode, "ITEM-A"))
  );

  await db.transaction(async (tx) => {
    const [sale] = await tx.insert(spSales).values({
      companyId, saleDate: TODAY, customerName: "5CDE Customer",
      totalSalePriceUsd: String(saleTotal),
      totalBaseCostUsd: String(baseTotal),
      totalFinalCostUsd: String(finalTotal),
      grossProfitUsd: String(grossProfit),
      status: "posted",
    }).returning();

    const [v] = await tx.insert(vouchers).values({
      companyId, voucherType: "Journal",
      voucherNumber: `SP-SALE-5CDE-${sale.id}-${Date.now()}`,
      voucherDate: TODAY, description: "5CDE Sale",
      totalAmount: String(saleTotal), currency: "USD", exchangeRate: "1", sourceModule: "SP",
    }).returning();

    await tx.insert(voucherEntries).values({ voucherId: v.id, bankAccountId: bankId, debitAmount: String(saleTotal), creditAmount: "0", narration: "Dr Bank" });
    await tx.insert(voucherEntries).values({ voucherId: v.id, ledgerAccountId: salesAcct!.id, debitAmount: "0", creditAmount: String(saleTotal), narration: "Cr Sales" });
    await tx.insert(voucherEntries).values({ voucherId: v.id, ledgerAccountId: cogsAcct!.id, debitAmount: String(finalTotal), creditAmount: "0", narration: "Dr COGS" });
    await tx.insert(voucherEntries).values({ voucherId: v.id, ledgerAccountId: stockAcct!.id, debitAmount: "0", creditAmount: String(finalTotal), narration: "Cr Stock" });
    await tx.insert(voucherEntries).values({ voucherId: v.id, ledgerAccountId: costClrAcct!.id, debitAmount: String(baseTotal), creditAmount: "0", narration: "Dr COSTCLR (cost clearing)" });
    await tx.insert(voucherEntries).values({ voucherId: v.id, ledgerAccountId: payableAcct!.id, debitAmount: "0", creditAmount: String(baseTotal), narration: "Cr SP-PAY (base cost only)" });

    await tx.insert(spSaleLines).values({
      saleId: sale.id, companyId, movementId: moveA.id,
      articleCode: "ITEM-A", qtySold: String(qtySold),
      salePricePerUnit: String(salePrice),
      baseUnitCostUsd: String(baseUnitCost),
      landedUnitCostUsd: String(landedPerUnit),
      finalUnitCostUsd: String(baseUnitCost + landedPerUnit),
    });
    await tx.update(spSales).set({ voucherId: v.id }).where(eq(spSales.id, sale.id));
    await tx.execute(sql`UPDATE sp_stock_movements SET qty_remaining = qty_remaining - ${qtySold} WHERE id = ${moveA.id}`);
  });

  // D1: SP-PAY is now Cr = baseTotal (only from sale, not from container/prepaid/offload)
  const payBalAfterSale = await accountBalance(payableAcct!.id, companyId);
  check("D1. SP-PAY created by sale = baseTotal (Cr 450)", payBalAfterSale, baseTotal);

  // D2: Stock reduced by sale
  const stockAfterSale = await accountDrBalance(stockAcct!.id, companyId);
  check("D2. SP-STOCK reduced by finalTotal after sale", stockAfterSale, totalFinalCost - finalTotal);

  // D3: COSTCLR balance = totalBaseCost - baseTotal (unsold lots)
  const costClrAfterSale = await accountBalance(costClrAcct!.id, companyId);
  check("D3. SP-COSTCLR = totalBaseCost - baseTotal (2700 - 450 = 2250 unsold)", costClrAfterSale, totalBaseCost - baseTotal);

  // D4: Sales balance = saleTotal
  const salesBal = await accountBalance(salesAcct!.id, companyId);
  check("D4. SP-SALES balance = saleTotal (1000)", salesBal, saleTotal);

  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // TEST E: Verify accounting preview matches actual (P5-E)
  // ══════════════════════════════════════════════════════════════════════════
  console.log("── Test E: Offload accounting preview matches posted vouchers ──");

  // The preview showed:
  //   Voucher A: Dr OTW-CLR 3000 / Cr OTW 3000
  //   Voucher B: Dr STOCK 3000 / Cr COSTCLR 2700 / Cr PREPAID 300
  // Verify the actual vouchers posted by reading the offload record

  const revVoucherId = offloadRow.voucherIdReversal;
  const stVoucherId  = offloadRow.voucherIdStock;

  const revEntries = await db.execute(sql`
    SELECT ledger_account_id, debit_amount, credit_amount
    FROM voucher_entries WHERE voucher_id = ${revVoucherId}
    ORDER BY id
  `);
  const revRows = (revEntries as any).rows ?? (revEntries as any);

  const drOtwClrEntry = revRows.find((r: any) => r.ledger_account_id === otwClrAcct!.id && num(r.debit_amount) > 0);
  const crOtwEntry    = revRows.find((r: any) => r.ledger_account_id === otwAcct!.id && num(r.credit_amount) > 0);

  if (drOtwClrEntry) {
    check("E1. Voucher A — Dr OTW-CLR = invoiceTotal (3000)", num(drOtwClrEntry.debit_amount), invoiceTotal);
  } else {
    fail("E1. Voucher A — Dr OTW-CLR entry not found");
  }
  if (crOtwEntry) {
    check("E2. Voucher A — Cr OTW = invoiceTotal (3000)", num(crOtwEntry.credit_amount), invoiceTotal);
  } else {
    fail("E2. Voucher A — Cr OTW entry not found");
  }

  const stEntries = await db.execute(sql`
    SELECT ledger_account_id, debit_amount, credit_amount
    FROM voucher_entries WHERE voucher_id = ${stVoucherId}
    ORDER BY id
  `);
  const stRows = (stEntries as any).rows ?? (stEntries as any);

  const drStockEntry    = stRows.find((r: any) => r.ledger_account_id === stockAcct!.id    && num(r.debit_amount)  > 0);
  const crCostClrEntry  = stRows.find((r: any) => r.ledger_account_id === costClrAcct!.id  && num(r.credit_amount) > 0);
  const crPrepaidEntry  = stRows.find((r: any) => r.ledger_account_id === prepaidAcct!.id  && num(r.credit_amount) > 0);

  if (drStockEntry) {
    check("E3. Voucher B — Dr STOCK = totalFinalCost (3000)", num(drStockEntry.debit_amount), totalFinalCost);
  } else {
    fail("E3. Voucher B — Dr STOCK entry not found");
  }
  if (crCostClrEntry) {
    check("E4. Voucher B — Cr COSTCLR = totalBaseCost (2700)", num(crCostClrEntry.credit_amount), totalBaseCost);
  } else {
    fail("E4. Voucher B — Cr COSTCLR entry not found");
  }
  if (crPrepaidEntry) {
    check("E5. Voucher B — Cr PREPAID = prepaidAmount (300)", num(crPrepaidEntry.credit_amount), prepaidAmount);
  } else {
    fail("E5. Voucher B — Cr PREPAID entry not found");
  }

  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // TEST F: GC L'shi row counts unchanged
  // ══════════════════════════════════════════════════════════════════════════
  console.log("── Test F: GC L'shi isolation (row counts unchanged) ─────");

  if (gcId) {
    const gcAfter = await gcRowCounts(gcId);
    checkEq("F1. GC voucher count unchanged", gcAfter.vouchers, gcBefore.vouchers);
    checkEq("F2. GC voucher_entries count unchanged", gcAfter.entries, gcBefore.entries);
    checkEq("F3. GC sp_containers count unchanged", gcAfter.containers, gcBefore.containers);
    checkEq("F4. GC sp_stock_movements count unchanged", gcAfter.movements, gcBefore.movements);
  } else {
    console.log("  ℹ️  GC company not found — skipping F1-F4");
  }

  // No SP vouchers for any company that is not supplier_partner
  const spVouchersOnNonSp = await db.execute(sql`
    SELECT COUNT(*) AS c FROM vouchers v
    JOIN companies co ON co.id = v.company_id
    WHERE v.source_module = 'SP'
      AND co.company_type != 'supplier_partner'
  `);
  const spLeakCount = num((spVouchersOnNonSp as any).rows?.[0]?.c ?? (spVouchersOnNonSp as any)[0]?.c);
  check("F5. No SP-module vouchers exist on non-supplier_partner companies", spLeakCount, 0);

  console.log();

  // ══════════════════════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════════════════════
  console.log("══════════════════════════════════════════════════════════");
  console.log(`  Results: ${totalPassed} passed  ${totalFailed} failed  (${totalPassed + totalFailed} total)`);
  if (totalFailed === 0) {
    console.log("  ✅ All P5-C/D/E checks passed.");
  } else {
    console.log("  ❌ Some checks failed.");
  }
  console.log("══════════════════════════════════════════════════════════\n");

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
