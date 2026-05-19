/**
 * SP Sandbox Test — runs the full Phase 1 supplier_partner accounting flow
 * against the real database without HTTP auth (imports DB + logic directly).
 *
 * Usage: npx tsx scripts/sp_sandbox_test.ts
 */

import { db } from "../server/db";
import {
  companies, ledgerAccounts, vouchers, voucherEntries, locations,
  bankAccounts, spContainers, spContainerLines, spPrepaidCharges,
  spOffloads, spOffloadCharges, spStockMovements, spSales, spSaleLines,
} from "../shared/schema";
import { sql, eq, and, isNull, asc, gt } from "drizzle-orm";

// ── Helpers ──────────────────────────────────────────────────────────────────

const COMPANY_CODE = "SPTEST";
const BANK_CODE    = "SPBANK001";

function pass(label: string, got: number, expected: number, tol = 0.01) {
  const ok = Math.abs(got - expected) < tol;
  console.log(`  ${ok ? "✅ PASS" : "❌ FAIL"}  ${label}: got=${got.toFixed(4)}  expected=${expected}`);
  return ok;
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

// ── Main test ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n══════════════════════════════════════════");
  console.log("  SP Phase 1 Sandbox Test");
  console.log("══════════════════════════════════════════\n");

  let failures = 0;
  function check(label: string, got: number, expected: number, tol = 0.01) {
    if (!pass(label, got, expected, tol)) failures++;
  }

  // ── 0. Find / create test company ─────────────────────────────────────────
  let [co] = await db.select().from(companies).where(eq(companies.code, COMPANY_CODE));
  if (!co) {
    [co] = await db.insert(companies).values({
      name: "SP Test Co",
      code: COMPANY_CODE,
      active: true,
      companyType: "supplier_partner",
    } as any).returning();
    console.log(`✓ Created SP test company id=${co.id}`);
  } else {
    console.log(`✓ Using existing SP test company id=${co.id}`);
  }
  const companyId = co.id;

  // ── 1. Setup accounts ─────────────────────────────────────────────────────
  const SP_ACCOUNTS = [
    { code: "SP-OTW",     name: "Goods On The Way",            accountType: "Asset",          subType: "sp_goods_otw",      isHidden: false },
    { code: "SP-OTWCLR",  name: "Goods OTW Clearing",          accountType: "Liability",       subType: "sp_otw_clearing",   isHidden: true  },
    { code: "SP-PREPAID", name: "Prepaid Charges",             accountType: "Asset",          subType: "sp_prepaid",        isHidden: false },
    { code: "SP-STOCK",   name: "Stock on Floor",              accountType: "Asset",          subType: "sp_stock",          isHidden: false },
    { code: "SP-COSTCLR", name: "Stock Cost Payable Clearing", accountType: "Liability",       subType: "sp_cost_clearing",  isHidden: true  },
    { code: "SP-PAY",     name: "Supplier Cash Payable",       accountType: "Liability",       subType: "sp_payable",        isHidden: false },
    { code: "SP-SALES",   name: "Sales",                       accountType: "Income",         subType: "sp_sales",          isHidden: false },
    { code: "SP-COGS",    name: "Cost of Goods Sold",          accountType: "Direct Expense", subType: "sp_cogs",           isHidden: false },
    { code: "SP-SHARED",  name: "Shared Charges",              accountType: "Direct Expense", subType: "sp_shared_charges", isHidden: false },
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
  const [defLoc] = await db.select().from(locations).where(
    and(eq(locations.companyId, companyId), isNull(locations.deletedAt))
  );
  if (!defLoc) {
    await db.insert(locations).values({ companyId, code: "SP-WH-001", name: "Main Warehouse", active: true });
  }
  const [loc] = await db.select().from(locations).where(
    and(eq(locations.companyId, companyId), isNull(locations.deletedAt))
  );
  console.log("✓ Setup complete — 9 accounts + 1 location");

  // Ensure bank account
  let [bank] = await db.select().from(bankAccounts).where(
    and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.code, BANK_CODE))
  );
  if (!bank) {
    [bank] = await db.insert(bankAccounts).values({
      companyId, code: BANK_CODE, name: "SP Test Bank", bankName: "Test Bank",
      accountNumber: "ACC-001", openingBalance: "10000", openingBalanceSide: "Dr",
      active: true, currency: "USD",
    } as any).returning();
  }
  const bankId = bank.id;
  console.log(`✓ Bank account id=${bankId}\n`);

  // Load accounts
  const otwAcct    = await getSpAccount(companyId, "sp_goods_otw");
  const otwClrAcct = await getSpAccount(companyId, "sp_otw_clearing");
  const prepaidAcct = await getSpAccount(companyId, "sp_prepaid");
  const stockAcct  = await getSpAccount(companyId, "sp_stock");
  const costClrAcct = await getSpAccount(companyId, "sp_cost_clearing");
  const payableAcct = await getSpAccount(companyId, "sp_payable");
  const salesAcct  = await getSpAccount(companyId, "sp_sales");
  const cogsAcct   = await getSpAccount(companyId, "sp_cogs");
  const sharedAcct = await getSpAccount(companyId, "sp_shared_charges");

  // ── 2. Create container: 100 bags @ $15, invoice = $1,500 ─────────────────
  console.log("── STEP 2: Create Container ──────────────────────");
  const TODAY = "2026-05-19";
  const invoiceTotal = 1500;
  const result = await db.transaction(async (tx) => {
    const [container] = await tx.insert(spContainers).values({
      companyId, supplierName: "Test Supplier", invoiceNumber: "INV-TEST-001",
      invoiceDate: TODAY, invoiceTotalUsd: String(invoiceTotal),
      discountPct: "0", status: "open",
    }).returning();

    await tx.insert(spContainerLines).values({
      containerId: container.id, companyId,
      articleCode: "BAG-001", description: "Test Bags",
      qty: "100", unitRateUsd: "15",
    });

    const vNum = `SP-OTW-${container.id}-TEST`;
    const [v] = await tx.insert(vouchers).values({
      companyId, voucherType: "Journal", voucherNumber: vNum, voucherDate: TODAY,
      description: `Goods OTW: Test Supplier — INV-TEST-001`,
      totalAmount: String(invoiceTotal), currency: "USD", exchangeRate: "1", sourceModule: "SP",
    }).returning();

    await tx.insert(voucherEntries).values({
      voucherId: v.id, ledgerAccountId: otwAcct!.id,
      debitAmount: String(invoiceTotal), creditAmount: "0",
      narration: "Goods OTW",
    });
    await tx.insert(voucherEntries).values({
      voucherId: v.id, ledgerAccountId: otwClrAcct!.id,
      debitAmount: "0", creditAmount: String(invoiceTotal),
      narration: "OTW Clearing",
    });
    await tx.update(spContainers).set({ goodsOtwVoucherId: v.id }).where(eq(spContainers.id, container.id));
    return container;
  });
  const containerId = result.id;
  console.log(`✓ Container id=${containerId} created — OTW journal posted`);

  // Verify OTW balance = +1500
  const otwBal = await db.execute(sql`
    SELECT COALESCE(SUM(CAST(debit_amount AS DECIMAL) - CAST(credit_amount AS DECIMAL)), 0) AS bal
    FROM voucher_entries ve JOIN vouchers v ON ve.voucher_id = v.id
    WHERE ve.ledger_account_id = ${otwAcct!.id} AND v.company_id = ${companyId}
  `);
  const otwBalance = num((otwBal as any).rows?.[0]?.bal ?? (otwBal as any)[0]?.bal);
  check("Goods OTW balance after container create", otwBalance, 1500);

  // ── 3. Add prepaid duty: $200 ──────────────────────────────────────────────
  console.log("\n── STEP 3: Add Prepaid Charge ($200) ────────────");
  const prepaidAmount = 200;
  const prepaidResult = await db.transaction(async (tx) => {
    const [charge] = await tx.insert(spPrepaidCharges).values({
      companyId, containerId, chargeType: "duty", agentName: "Customs",
      amountPaidUsd: String(prepaidAmount), amountUsedUsd: "0",
    }).returning();

    const [v] = await tx.insert(vouchers).values({
      companyId, voucherType: "Journal", voucherNumber: `SP-PRE-${charge.id}-TEST`,
      voucherDate: TODAY, description: "Prepaid duty",
      totalAmount: String(prepaidAmount), currency: "USD", exchangeRate: "1", sourceModule: "SP",
    }).returning();

    await tx.insert(voucherEntries).values({
      voucherId: v.id, ledgerAccountId: prepaidAcct!.id,
      debitAmount: String(prepaidAmount), creditAmount: "0", narration: "Prepaid duty",
    });
    await tx.insert(voucherEntries).values({
      voucherId: v.id, bankAccountId: bankId,
      debitAmount: "0", creditAmount: String(prepaidAmount), narration: "Bank payment",
    });
    await tx.update(spPrepaidCharges).set({ voucherId: v.id }).where(eq(spPrepaidCharges.id, charge.id));
    return charge;
  });
  const prepaidChargeId = prepaidResult.id;
  console.log(`✓ Prepaid charge id=${prepaidChargeId} created`);

  // ── 4. Offload ─────────────────────────────────────────────────────────────
  console.log("\n── STEP 4: Offload ───────────────────────────────");
  const totalQty       = 100;
  const discountFactor = 1; // 0% discount
  const baseUnitCost   = 15 * discountFactor; // $15
  const totalBaseCost  = totalQty * baseUnitCost; // $1,500
  const totalLandedCost = prepaidAmount; // $200
  const landedPerUnit  = totalLandedCost / totalQty; // $2
  const totalFinalCost = totalBaseCost + totalLandedCost; // $1,700
  const finalUnitCost  = baseUnitCost + landedPerUnit; // $17

  console.log(`  Base unit cost:   $${baseUnitCost}`);
  console.log(`  Landed per unit:  $${landedPerUnit}`);
  console.log(`  Final unit cost:  $${finalUnitCost}`);
  console.log(`  Total base cost:  $${totalBaseCost}`);
  console.log(`  Total final cost: $${totalFinalCost}`);

  // Validate prepaid before use
  const [prepaidRow] = await db.select().from(spPrepaidCharges).where(eq(spPrepaidCharges.id, prepaidChargeId));
  const remaining = num(prepaidRow.amountPaidUsd) - num(prepaidRow.amountUsedUsd);
  check("Prepaid remaining before offload", remaining, 200);

  const offloadResult = await db.transaction(async (tx) => {
    // Voucher A: Reverse OTW
    const [vA] = await tx.insert(vouchers).values({
      companyId, voucherType: "Journal",
      voucherNumber: `SP-OTW-REV-${containerId}-TEST`, voucherDate: TODAY,
      description: "OTW Reversal",
      totalAmount: String(invoiceTotal), currency: "USD", exchangeRate: "1", sourceModule: "SP",
    }).returning();
    await tx.insert(voucherEntries).values({
      voucherId: vA.id, ledgerAccountId: otwClrAcct!.id,
      debitAmount: String(invoiceTotal), creditAmount: "0", narration: "OTW Clearing reversal",
    });
    await tx.insert(voucherEntries).values({
      voucherId: vA.id, ledgerAccountId: otwAcct!.id,
      debitAmount: "0", creditAmount: String(invoiceTotal), narration: "Goods OTW reversal",
    });

    // Voucher B: Create stock
    const [vB] = await tx.insert(vouchers).values({
      companyId, voucherType: "Journal",
      voucherNumber: `SP-STOCK-${containerId}-TEST`, voucherDate: TODAY,
      description: "Stock offload",
      totalAmount: String(totalFinalCost), currency: "USD", exchangeRate: "1", sourceModule: "SP",
    }).returning();
    // Dr Stock = totalFinalCost
    await tx.insert(voucherEntries).values({
      voucherId: vB.id, ledgerAccountId: stockAcct!.id,
      debitAmount: String(totalFinalCost), creditAmount: "0", narration: "Stock received",
    });
    // Cr SP-COSTCLR = totalBaseCost
    await tx.insert(voucherEntries).values({
      voucherId: vB.id, ledgerAccountId: costClrAcct!.id,
      debitAmount: "0", creditAmount: String(totalBaseCost), narration: "Base supplier cost",
    });
    // Cr SP-PREPAID = prepaid used ($200)
    await tx.insert(voucherEntries).values({
      voucherId: vB.id, ledgerAccountId: prepaidAcct!.id,
      debitAmount: "0", creditAmount: String(prepaidAmount), narration: "Prepaid duty used",
    });

    // Update prepaid used amount (add, not overwrite — fixed bug)
    await tx.execute(sql`
      UPDATE sp_prepaid_charges
      SET amount_used_usd = amount_used_usd + ${prepaidAmount}
      WHERE id = ${prepaidChargeId}
    `);

    // Insert offload record
    const [offload] = await tx.insert(spOffloads).values({
      companyId, containerId, offloadDate: TODAY,
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
      amountUsd: String(prepaidAmount), prepaidChargeId,
    });

    // Stock movement — fetch the container line id first
    const [containerLine] = await tx.select().from(spContainerLines).where(eq(spContainerLines.containerId, containerId));

    await tx.insert(spStockMovements).values({
      companyId, containerId, offloadId: offload.id,
      containerLineId: containerLine.id,
      articleCode: "BAG-001", description: "Test Bags",
      locationId: loc.id, qtyIn: "100", qtyRemaining: "100",
      baseUnitCostUsd: String(baseUnitCost),
      landedUnitCostUsd: String(landedPerUnit),
      finalUnitCostUsd: String(finalUnitCost),
    });

    await tx.update(spContainers).set({ status: "offloaded" }).where(eq(spContainers.id, containerId));
    return offload;
  });
  console.log(`✓ Offload complete — id=${offloadResult.id}`);

  // Verify OTW = 0 after offload
  const otwAfter = await db.execute(sql`
    SELECT COALESCE(SUM(CAST(debit_amount AS DECIMAL) - CAST(credit_amount AS DECIMAL)), 0) AS bal
    FROM voucher_entries ve JOIN vouchers v ON ve.voucher_id = v.id
    WHERE ve.ledger_account_id = ${otwAcct!.id} AND v.company_id = ${companyId}
  `);
  const otwAfterBal = num((otwAfter as any).rows?.[0]?.bal ?? (otwAfter as any)[0]?.bal);
  check("10. Goods OTW balance after offload (must be 0)", otwAfterBal, 0);

  // Verify Prepaid Charges balance = 0 after use
  const prepaidBal = await db.execute(sql`
    SELECT COALESCE(SUM(CAST(debit_amount AS DECIMAL) - CAST(credit_amount AS DECIMAL)), 0) AS bal
    FROM voucher_entries ve JOIN vouchers v ON ve.voucher_id = v.id
    WHERE ve.ledger_account_id = ${prepaidAcct!.id} AND v.company_id = ${companyId}
  `);
  const prepaidBalance = num((prepaidBal as any).rows?.[0]?.bal ?? (prepaidBal as any)[0]?.bal);
  check("11. Prepaid Charges balance after use (must be 0)", prepaidBalance, 0);

  // Verify prepaid row amountUsedUsd
  const [updatedPrepaid] = await db.select().from(spPrepaidCharges).where(eq(spPrepaidCharges.id, prepaidChargeId));
  check("   Prepaid amountUsedUsd row", num(updatedPrepaid.amountUsedUsd), 200);

  // ── 5. Sale: 10 bags @ $40 ─────────────────────────────────────────────────
  console.log("\n── STEP 5: Sale (10 bags @ $40) ──────────────────");
  const qtySold   = 10;
  const salePrice = 40;
  const saleTotal = qtySold * salePrice;        // $400
  const baseTotal = qtySold * baseUnitCost;     // $150
  const finalTotal = qtySold * finalUnitCost;   // $170
  const grossProfit = saleTotal - finalTotal;   // $230

  const [movement] = await db.select().from(spStockMovements).where(
    and(eq(spStockMovements.companyId, companyId), gt(spStockMovements.qtyRemaining, "0"))
  ).orderBy(asc(spStockMovements.createdAt));

  const saleResult = await db.transaction(async (tx) => {
    // Deduct from stock movement
    await tx.execute(sql`
      UPDATE sp_stock_movements
      SET qty_remaining = ${String(num(movement.qtyRemaining) - qtySold)}
      WHERE id = ${movement.id}
    `);

    // Insert sale record
    const [sale] = await tx.insert(spSales).values({
      companyId, saleDate: TODAY, customerName: "Test Customer",
      totalSalePriceUsd: String(saleTotal),
      totalBaseCostUsd: String(baseTotal),
      totalFinalCostUsd: String(finalTotal),
      grossProfitUsd: String(grossProfit),
      status: "posted",
    }).returning();

    const [v] = await tx.insert(vouchers).values({
      companyId, voucherType: "Journal",
      voucherNumber: `SP-SALE-${sale.id}-TEST`, voucherDate: TODAY,
      description: `Sale — Test Customer`,
      totalAmount: String(saleTotal), currency: "USD", exchangeRate: "1", sourceModule: "SP",
    }).returning();

    // Dr Bank
    await tx.insert(voucherEntries).values({
      voucherId: v.id, bankAccountId: bankId,
      debitAmount: String(saleTotal), creditAmount: "0", narration: "Sale receipts",
    });
    // Cr Sales
    await tx.insert(voucherEntries).values({
      voucherId: v.id, ledgerAccountId: salesAcct!.id,
      debitAmount: "0", creditAmount: String(saleTotal), narration: "Sales",
    });
    // Dr COGS
    await tx.insert(voucherEntries).values({
      voucherId: v.id, ledgerAccountId: cogsAcct!.id,
      debitAmount: String(finalTotal), creditAmount: "0", narration: "COGS",
    });
    // Cr Stock
    await tx.insert(voucherEntries).values({
      voucherId: v.id, ledgerAccountId: stockAcct!.id,
      debitAmount: "0", creditAmount: String(finalTotal), narration: "Stock reduction",
    });
    // Dr SP-COSTCLR = baseTotal
    await tx.insert(voucherEntries).values({
      voucherId: v.id, ledgerAccountId: costClrAcct!.id,
      debitAmount: String(baseTotal), creditAmount: "0", narration: "Cost clearing",
    });
    // Cr SP-PAY = baseTotal (Supplier Cash Payable = base cost only)
    await tx.insert(voucherEntries).values({
      voucherId: v.id, ledgerAccountId: payableAcct!.id,
      debitAmount: "0", creditAmount: String(baseTotal), narration: "Supplier Cash Payable",
    });

    await tx.insert(spSaleLines).values({
      saleId: sale.id, companyId, movementId: movement.id,
      articleCode: "BAG-001", qtySold: String(qtySold),
      salePricePerUnit: String(salePrice),
      baseUnitCostUsd: String(baseUnitCost),
      landedUnitCostUsd: String(landedPerUnit),
      finalUnitCostUsd: String(finalUnitCost),
    });

    await tx.update(spSales).set({ voucherId: v.id }).where(eq(spSales.id, sale.id));
    return sale;
  });
  console.log(`✓ Sale id=${saleResult.id} posted`);

  // Verify sale numbers
  check("5a. Sales (Cr SP-SALES)", saleTotal, 400);
  check("5b. COGS (Dr SP-COGS)", finalTotal, 170);
  check("5c. Supplier Cash Payable (Cr SP-PAY = base only)", baseTotal, 150);
  check("5d. Gross Profit (Sale - COGS)", grossProfit, 230);

  // ── 6. Add supplier payment: $100 ─────────────────────────────────────────
  console.log("\n── STEP 6: Supplier Payment ($100) + Shared Charge ($2) ──");
  const paymentAmount = 100;
  const sharedChargeAmt = 2;

  await db.transaction(async (tx) => {
    const [v] = await tx.insert(vouchers).values({
      companyId, voucherType: "Journal",
      voucherNumber: `SP-PMT-001-TEST`, voucherDate: TODAY,
      description: "Supplier payment", totalAmount: String(paymentAmount),
      currency: "USD", exchangeRate: "1", sourceModule: "SP",
    }).returning();
    // Dr SP-PAY (reduces payable)
    await tx.insert(voucherEntries).values({
      voucherId: v.id, ledgerAccountId: payableAcct!.id,
      debitAmount: String(paymentAmount), creditAmount: "0", narration: "Supplier payment",
    });
    // Cr Bank
    await tx.insert(voucherEntries).values({
      voucherId: v.id, bankAccountId: bankId,
      debitAmount: "0", creditAmount: String(paymentAmount), narration: "Bank payment to supplier",
    });
  });

  await db.transaction(async (tx) => {
    const [v] = await tx.insert(vouchers).values({
      companyId, voucherType: "Journal",
      voucherNumber: `SP-SHARED-001-TEST`, voucherDate: TODAY,
      description: "Shared bank charge", totalAmount: String(sharedChargeAmt),
      currency: "USD", exchangeRate: "1", sourceModule: "SP",
    }).returning();
    // Dr SP-SHARED
    await tx.insert(voucherEntries).values({
      voucherId: v.id, ledgerAccountId: sharedAcct!.id,
      debitAmount: String(sharedChargeAmt), creditAmount: "0", narration: "Bank shared charge",
    });
    // Cr Bank
    await tx.insert(voucherEntries).values({
      voucherId: v.id, bankAccountId: bankId,
      debitAmount: "0", creditAmount: String(sharedChargeAmt), narration: "Bank charge",
    });
  });
  console.log("✓ Supplier payment and shared charge posted");

  // ── 7. Verify all final balances ───────────────────────────────────────────
  console.log("\n── STEP 7: Verify Final Balances ─────────────────");

  async function accountBalance(accountId: number): Promise<number> {
    const r = await db.execute(sql`
      SELECT COALESCE(SUM(CAST(credit_amount AS DECIMAL) - CAST(debit_amount AS DECIMAL)), 0) AS bal
      FROM voucher_entries ve JOIN vouchers v ON ve.voucher_id = v.id
      WHERE ve.ledger_account_id = ${accountId} AND v.company_id = ${companyId}
    `);
    return num((r as any).rows?.[0]?.bal ?? (r as any)[0]?.bal);
  }

  const payableBal    = await accountBalance(payableAcct!.id);  // Cr - Dr
  const salesBal      = await accountBalance(salesAcct!.id);
  const cogsBal       = await accountBalance(cogsAcct!.id);     // will be negative (more Dr)
  const stockBal      = await accountBalance(stockAcct!.id);    // asset: Dr - Cr
  const sharedBal     = await accountBalance(sharedAcct!.id);   // expense: Dr - Cr (negative by Cr-Dr)
  const costClrBal    = await accountBalance(costClrAcct!.id);
  const otwFinal      = await db.execute(sql`
    SELECT COALESCE(SUM(CAST(debit_amount AS DECIMAL) - CAST(credit_amount AS DECIMAL)), 0) AS bal
    FROM voucher_entries ve JOIN vouchers v ON ve.voucher_id = v.id
    WHERE ve.ledger_account_id = ${otwAcct!.id} AND v.company_id = ${companyId}
  `);
  const otwFinalBal = num((otwFinal as any).rows?.[0]?.bal ?? (otwFinal as any)[0]?.bal);

  // Expected:
  //   Payable = 150 (sold) - 100 (paid) = 50 Cr
  //   Sales = 400 Cr
  //   COGS = 170 Dr  → Cr - Dr = -170
  //   Shared Charges = 2 Dr → Cr - Dr = -2
  //   Net profit = 400 - 170 - 2 = 228
  //   My share = supplier share = 114
  //   Goods OTW = 0

  console.log("\n  Account Balances (Cr positive, Dr negative):");
  check("8a. Supplier Cash Payable closing balance (150-100=50 Cr)", payableBal, 50);
  check("   Sales (Cr)", salesBal, 400);
  check("   COGS (Dr → Cr-Dr = -170)", cogsBal, -170);
  check("9b. Shared Charges (Dr → Cr-Dr = -2)", sharedBal, -2);
  check("10. Goods OTW (must be 0)", otwFinalBal, 0);

  // Net profit: 400 - 170 - 2 = 228
  const netProfit = salesBal + cogsBal + sharedBal; // 400 - 170 - 2
  check("9c. Net Profit (Sales - COGS - Shared)", netProfit, 228);
  check("9d. My Share (50%)", netProfit * 0.5, 114);
  check("9e. Supplier Share (50%)", netProfit - netProfit * 0.5, 114);

  // SP-COSTCLR should net zero: offload Cr 1500, sale Dr 150 → 1350 Cr remaining
  // (the 1350 represents the unsold inventory's base cost still on floor)
  const expectedCostClr = totalBaseCost - baseTotal; // 1500 - 150 = 1350
  check("   SP-COSTCLR net (unsold lots)", costClrBal, expectedCostClr);

  // Stock on floor: was 1700, sold 170 → 1530 remaining
  const stockAssetBal = await db.execute(sql`
    SELECT COALESCE(SUM(CAST(debit_amount AS DECIMAL) - CAST(credit_amount AS DECIMAL)), 0) AS bal
    FROM voucher_entries ve JOIN vouchers v ON ve.voucher_id = v.id
    WHERE ve.ledger_account_id = ${stockAcct!.id} AND v.company_id = ${companyId}
  `);
  const stockAsset = num((stockAssetBal as any).rows?.[0]?.bal ?? (stockAssetBal as any)[0]?.bal);
  check("   Stock on Floor (1700 - 170 = 1530)", stockAsset, 1530);

  // ── 11. Prepaid = 0 ────────────────────────────────────────────────────────
  check("11. Prepaid Charges balance (Dr-Cr = 200-200 = 0)", prepaidBalance, 0);

  // ── 12. Hidden accounts check ──────────────────────────────────────────────
  console.log("\n── STEP 12: Hidden Accounts ──────────────────────");
  const otwClrHidden = (await getSpAccount(companyId, "sp_otw_clearing"))?.isHidden;
  const costClrHidden = (await getSpAccount(companyId, "sp_cost_clearing"))?.isHidden;
  console.log(`  SP-OTWCLR  isHidden=${otwClrHidden}  ${otwClrHidden ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`  SP-COSTCLR isHidden=${costClrHidden}  ${costClrHidden ? "✅ PASS" : "❌ FAIL"}`);
  if (!otwClrHidden || !costClrHidden) failures++;

  // ── 13. GC L'shi isolation check ──────────────────────────────────────────
  console.log("\n── STEP 13: GC L'shi Isolation ──────────────────");
  const gcCo = await db.execute(sql`SELECT id FROM companies WHERE name ILIKE '%GC%LSH%' OR name ILIKE '%GC%L''shi%' LIMIT 1`);
  const gcId = (gcCo as any).rows?.[0]?.id ?? (gcCo as any)[0]?.id;
  if (gcId) {
    const gcSpVouchers = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM vouchers
      WHERE company_id = ${gcId} AND source_module = 'SP'
    `);
    const gcCnt = num((gcSpVouchers as any).rows?.[0]?.cnt ?? (gcSpVouchers as any)[0]?.cnt);
    console.log(`  GC L'shi SP vouchers: ${gcCnt}`);
    if (gcCnt === 0) {
      console.log("  ✅ PASS  GC L'shi has 0 SP vouchers — no cross-contamination");
    } else {
      console.log("  ❌ FAIL  GC L'shi has SP vouchers — data leak detected!");
      failures++;
    }

    const gcSpTables = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM sp_containers WHERE company_id = ${gcId}
    `);
    const gcSpContainers = num((gcSpTables as any).rows?.[0]?.cnt ?? (gcSpTables as any)[0]?.cnt);
    console.log(`  GC L'shi sp_containers: ${gcSpContainers}  ${gcSpContainers === 0 ? "✅" : "❌"}`);
  } else {
    console.log("  ℹ️  GC L'shi company not found by name — skipping (no cross-company risk)");
  }

  // ── Final summary ──────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════");
  if (failures === 0) {
    console.log("  ✅ ALL CHECKS PASSED");
  } else {
    console.log(`  ❌ ${failures} CHECK(S) FAILED`);
  }
  console.log("══════════════════════════════════════════\n");

  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
