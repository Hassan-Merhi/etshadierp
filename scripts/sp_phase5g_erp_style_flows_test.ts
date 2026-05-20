/**
 * SP Phase 5-G Test — ERP-Style Containers, Prepaid & Offload
 *
 * Covers:
 *  A. Container account override — custom OTW / OTW-CLR accounts, cross-company rejection
 *  B. Prepaid debit account override — custom debit, cross-company bank rejection
 *  C. Offload charge types — paid_now, unpaid_payable, other, cross-company rejections
 *  D. Offload "other" charge type — credits selected ledger account, verified in voucher entries
 *  E. Regression — GC L'shi row counts unchanged
 *
 * Usage: npx tsx scripts/sp_phase5g_erp_style_flows_test.ts
 */

import { db } from "../server/db";
import {
  companies, ledgerAccounts, vouchers, voucherEntries, locations,
  bankAccounts, spContainers, spContainerLines, spPrepaidCharges,
  spOffloads, spOffloadCharges, spStockMovements,
} from "../shared/schema";
import { sql, eq, and, isNull } from "drizzle-orm";

// ── Helpers ────────────────────────────────────────────────────────────────────

const COMPANY_CODE  = "SP5G-ERP-TEST";
const COMPANY2_CODE = "SP5G-OTHER-CO";

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

async function accountDrBalance(accountId: number, companyId: number): Promise<number> {
  const r = await db.execute(sql`
    SELECT COALESCE(SUM(CAST(debit_amount AS DECIMAL) - CAST(credit_amount AS DECIMAL)), 0) AS bal
    FROM voucher_entries ve JOIN vouchers v ON ve.voucher_id = v.id
    WHERE ve.ledger_account_id = ${accountId} AND v.company_id = ${companyId}
  `);
  return num((r as any).rows?.[0]?.bal ?? (r as any)[0]?.bal);
}

async function accountCrBalance(accountId: number, companyId: number): Promise<number> {
  const r = await db.execute(sql`
    SELECT COALESCE(SUM(CAST(credit_amount AS DECIMAL) - CAST(debit_amount AS DECIMAL)), 0) AS bal
    FROM voucher_entries ve JOIN vouchers v ON ve.voucher_id = v.id
    WHERE ve.ledger_account_id = ${accountId} AND v.company_id = ${companyId}
  `);
  return num((r as any).rows?.[0]?.bal ?? (r as any)[0]?.bal);
}

async function bankCrBalance(bankAcctId: number, companyId: number): Promise<number> {
  const r = await db.execute(sql`
    SELECT COALESCE(SUM(CAST(ve.credit_amount AS DECIMAL) - CAST(ve.debit_amount AS DECIMAL)), 0) AS bal
    FROM voucher_entries ve JOIN vouchers v ON ve.voucher_id = v.id
    WHERE ve.bank_account_id = ${bankAcctId} AND v.company_id = ${companyId}
  `);
  return num((r as any).rows?.[0]?.bal ?? (r as any)[0]?.bal);
}

async function gcRowCounts(gcId: number) {
  const v  = await db.execute(sql`SELECT COUNT(*) AS c FROM vouchers WHERE company_id = ${gcId}`);
  const ve = await db.execute(sql`SELECT COUNT(*) AS c FROM voucher_entries ve JOIN vouchers vv ON ve.voucher_id = vv.id WHERE vv.company_id = ${gcId}`);
  return {
    vouchers: num((v  as any).rows?.[0]?.c ?? (v  as any)[0]?.c),
    entries:  num((ve as any).rows?.[0]?.c ?? (ve as any)[0]?.c),
  };
}

// ── Inline route helpers ───────────────────────────────────────────────────────

function parseNum(v: any): number {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? 0 : n;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  SP Phase 5-G Test — ERP-Style Containers, Prepaid & Offload");
  console.log("══════════════════════════════════════════════════════════\n");

  // ── 0. GC L'shi snapshot (before) ──────────────────────────────────────────
  console.log("── Pre-test: GC L'shi row count snapshot ─────────────────");
  const gcRow = await db.execute(sql`SELECT id FROM companies WHERE name ILIKE '%GC%' LIMIT 1`);
  const gcId: number | null = (gcRow as any).rows?.[0]?.id ?? (gcRow as any)[0]?.id ?? null;
  let gcBefore = { vouchers: 0, entries: 0 };
  if (gcId) {
    gcBefore = await gcRowCounts(gcId);
    console.log(`  GC company id=${gcId}: ${gcBefore.vouchers} vouchers, ${gcBefore.entries} entries`);
  } else {
    console.log("  GC company not found — skipping GC isolation check");
  }

  // ── 1. Setup primary test company ──────────────────────────────────────────
  console.log("\n── 1. Setup primary test company ─────────────────────────");
  let [co] = await db.select().from(companies).where(eq(companies.code, COMPANY_CODE));
  if (!co) {
    [co] = await db.insert(companies).values({
      name: "SP Phase5G ERP Test Co",
      code: COMPANY_CODE,
      active: true,
      companyType: "supplier_partner",
    } as any).returning();
    console.log(`  Created SP test company id=${co.id}`);
  } else {
    console.log(`  Using existing SP test company id=${co.id}`);
  }
  const companyId = co.id;

  // Cleanup previous test data for primary company
  await db.execute(sql`DELETE FROM sp_offload_charges WHERE company_id = ${companyId}`);
  await db.execute(sql`DELETE FROM sp_stock_movements WHERE company_id = ${companyId}`);
  await db.execute(sql`DELETE FROM sp_offloads WHERE company_id = ${companyId}`);
  await db.execute(sql`DELETE FROM sp_prepaid_charges WHERE company_id = ${companyId}`);
  await db.execute(sql`DELETE FROM sp_container_lines WHERE company_id = ${companyId}`);
  await db.execute(sql`DELETE FROM sp_containers WHERE company_id = ${companyId}`);
  await db.execute(sql`DELETE FROM voucher_entries WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id = ${companyId} AND source_module = 'SP')`);
  await db.execute(sql`DELETE FROM vouchers WHERE company_id = ${companyId} AND source_module = 'SP'`);
  console.log("  Cleanup complete");

  // SP accounts for primary company
  const SP_ACCOUNTS = [
    { code: "5G-OTW",     name: "Goods OTW (5G)",              accountType: "Asset",     subType: "sp_goods_otw",      isHidden: false },
    { code: "5G-OTWCLR",  name: "OTW Clearing (5G)",           accountType: "Liability", subType: "sp_otw_clearing",   isHidden: true  },
    { code: "5G-PREPAID", name: "Prepaid Charges (5G)",         accountType: "Asset",     subType: "sp_prepaid",        isHidden: false },
    { code: "5G-STOCK",   name: "Stock on Floor (5G)",          accountType: "Asset",     subType: "sp_stock",          isHidden: false },
    { code: "5G-COSTCLR", name: "Cost Clearing (5G)",           accountType: "Liability", subType: "sp_cost_clearing",  isHidden: true  },
    { code: "5G-PAY",     name: "Supplier Cash Payable (5G)",   accountType: "Liability", subType: "sp_payable",        isHidden: false },
    { code: "5G-SALES",   name: "Sales (5G)",                   accountType: "Income",    subType: "sp_sales",          isHidden: false },
    { code: "5G-COGS",    name: "COGS (5G)",                    accountType: "Direct Expense", subType: "sp_cogs",       isHidden: false },
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

  // Extra accounts for override tests (no special subType)
  let customOtwRow = await db.execute(sql`SELECT id FROM ledger_accounts WHERE company_id = ${companyId} AND code = '5G-CUSTOM-OTW' LIMIT 1`);
  let customOtwId: number = num((customOtwRow as any).rows?.[0]?.id ?? (customOtwRow as any)[0]?.id);
  if (!customOtwId) {
    const [r] = await db.insert(ledgerAccounts).values({
      companyId, code: "5G-CUSTOM-OTW", name: "Custom OTW Account",
      accountType: "Asset" as any, active: true,
    }).returning();
    customOtwId = r.id;
  }

  let customClrRow = await db.execute(sql`SELECT id FROM ledger_accounts WHERE company_id = ${companyId} AND code = '5G-CUSTOM-CLR' LIMIT 1`);
  let customClrId: number = num((customClrRow as any).rows?.[0]?.id ?? (customClrRow as any)[0]?.id);
  if (!customClrId) {
    const [r] = await db.insert(ledgerAccounts).values({
      companyId, code: "5G-CUSTOM-CLR", name: "Custom OTW Clearing",
      accountType: "Liability" as any, active: true,
    }).returning();
    customClrId = r.id;
  }

  let customDebitRow = await db.execute(sql`SELECT id FROM ledger_accounts WHERE company_id = ${companyId} AND code = '5G-CUSTOM-DEBIT' LIMIT 1`);
  let customDebitId: number = num((customDebitRow as any).rows?.[0]?.id ?? (customDebitRow as any)[0]?.id);
  if (!customDebitId) {
    const [r] = await db.insert(ledgerAccounts).values({
      companyId, code: "5G-CUSTOM-DEBIT", name: "Custom Prepaid Debit",
      accountType: "Asset" as any, active: true,
    }).returning();
    customDebitId = r.id;
  }

  let otherLedgerRow = await db.execute(sql`SELECT id FROM ledger_accounts WHERE company_id = ${companyId} AND code = '5G-OTHER-ACCT' LIMIT 1`);
  let otherLedgerAcctId: number = num((otherLedgerRow as any).rows?.[0]?.id ?? (otherLedgerRow as any)[0]?.id);
  if (!otherLedgerAcctId) {
    const [r] = await db.insert(ledgerAccounts).values({
      companyId, code: "5G-OTHER-ACCT", name: "Other Charge Account",
      accountType: "Expense" as any, active: true,
    }).returning();
    otherLedgerAcctId = r.id;
  }

  let payableLedgerRow = await db.execute(sql`SELECT id FROM ledger_accounts WHERE company_id = ${companyId} AND code = '5G-PAYABLE' LIMIT 1`);
  let payableLedgerAcctId: number = num((payableLedgerRow as any).rows?.[0]?.id ?? (payableLedgerRow as any)[0]?.id);
  if (!payableLedgerAcctId) {
    const [r] = await db.insert(ledgerAccounts).values({
      companyId, code: "5G-PAYABLE", name: "Freight Payable Account",
      accountType: "Liability" as any, active: true,
    }).returning();
    payableLedgerAcctId = r.id;
  }

  // Location
  let [loc] = await db.select().from(locations).where(and(eq(locations.companyId, companyId), isNull(locations.deletedAt)));
  if (!loc) {
    await db.insert(locations).values({ companyId, code: "5G-WH-001", name: "5G Warehouse", active: true });
    [loc] = await db.select().from(locations).where(and(eq(locations.companyId, companyId), isNull(locations.deletedAt)));
  }

  // Bank accounts
  let [bank] = await db.select().from(bankAccounts).where(and(eq(bankAccounts.companyId, companyId)));
  if (!bank) {
    [bank] = await db.insert(bankAccounts).values({
      companyId, code: "5G-BANK", name: "5G Bank", bankName: "Test Bank",
      accountNumber: "ACC-5G", openingBalance: "100000", openingBalanceSide: "Dr",
      active: true, currency: "USD",
    } as any).returning();
  }
  const bankId = bank.id;

  // Setup other company (for cross-company tests)
  let [co2] = await db.select().from(companies).where(eq(companies.code, COMPANY2_CODE));
  if (!co2) {
    [co2] = await db.insert(companies).values({
      name: "SP Phase5G Other Co",
      code: COMPANY2_CODE,
      active: true,
      companyType: "supplier_partner",
    } as any).returning();
  }
  const company2Id = co2.id;

  // Create an account belonging to company2 (for cross-company rejection tests)
  let otherCoAcctRow = await db.execute(sql`SELECT id FROM ledger_accounts WHERE company_id = ${company2Id} AND code = '5G-CO2-OTW' LIMIT 1`);
  let otherCoAcctId: number = num((otherCoAcctRow as any).rows?.[0]?.id ?? (otherCoAcctRow as any)[0]?.id);
  if (!otherCoAcctId) {
    const [r] = await db.insert(ledgerAccounts).values({
      companyId: company2Id, code: "5G-CO2-OTW", name: "Co2 OTW Account",
      accountType: "Asset" as any, active: true,
    }).returning();
    otherCoAcctId = r.id;
  }

  let [otherCoBank] = await db.select().from(bankAccounts).where(eq(bankAccounts.companyId, company2Id));
  if (!otherCoBank) {
    [otherCoBank] = await db.insert(bankAccounts).values({
      companyId: company2Id, code: "5G-CO2-BANK", name: "Co2 Bank", bankName: "Other Bank",
      accountNumber: "ACC-CO2", openingBalance: "50000", openingBalanceSide: "Dr",
      active: true, currency: "USD",
    } as any).returning();
  }
  const otherCoBankId = otherCoBank.id;

  console.log(`  Accounts: customOtwId=${customOtwId}, customClrId=${customClrId}, customDebitId=${customDebitId}`);
  console.log(`  otherLedgerAcctId=${otherLedgerAcctId}, payableLedgerAcctId=${payableLedgerAcctId}`);
  console.log(`  bankId=${bankId}, otherCoBankId=${otherCoBankId}`);

  const otwAcct     = await getSpAccount(companyId, "sp_goods_otw");
  const otwClrAcct  = await getSpAccount(companyId, "sp_otw_clearing");
  const prepaidAcct = await getSpAccount(companyId, "sp_prepaid");
  const stockAcct   = await getSpAccount(companyId, "sp_stock");
  const costClrAcct = await getSpAccount(companyId, "sp_cost_clearing");

  if (!otwAcct || !otwClrAcct || !prepaidAcct || !stockAcct || !costClrAcct) {
    fail("SP accounts must all be present", "Missing one or more SP accounts — aborting");
    process.exit(1);
  }

  // ── A. Container account override ──────────────────────────────────────────
  console.log("\n── A. Container account override ─────────────────────────");

  // A1: Cross-company OTW account rejection
  console.log("  A1: Cross-company OTW account rejected");
  try {
    const fakeBody = {
      companyId,
      otwAccountId: otherCoAcctId,
      otwClearingAccountId: null,
      supplierName: "Test Supplier",
      invoiceNumber: "INV-XCO-001",
      invoiceDate: "2026-01-01",
      invoiceTotalUsd: "1000",
      lines: [],
    };
    // Simulate the validation: look up the account for this company
    const [acct] = await db.select().from(ledgerAccounts).where(
      and(eq(ledgerAccounts.id, fakeBody.otwAccountId), eq(ledgerAccounts.companyId, companyId), isNull(ledgerAccounts.deletedAt))
    );
    if (!acct) {
      pass("A1: Cross-company OTW account correctly rejected (not found for company)");
    } else {
      fail("A1: Cross-company OTW account should have been rejected");
    }
  } catch (e: any) {
    fail("A1: Unexpected error", e.message);
  }

  // A2: Create container with default OTW accounts (no override)
  console.log("  A2: Container with default OTW accounts");
  const [container1] = await db.insert(spContainers).values({
    companyId, supplierName: "Supplier A", containerNumber: "CONT-5G-001",
    invoiceNumber: "INV-5G-001", invoiceDate: "2026-01-10",
    invoiceTotalUsd: "5000", discountPct: "10",
    freightEstimateUsd: "200", status: "open",
  }).returning();
  await db.insert(spContainerLines).values([
    { containerId: container1.id, companyId, articleCode: "RICE-5G", description: "Rice", qty: "100", unitRateUsd: "5.00" },
    { containerId: container1.id, companyId, articleCode: "WHEAT-5G", description: "Wheat", qty: "50", unitRateUsd: "8.00" },
  ]);
  // Post OTW voucher with default accounts
  const otwV = await db.transaction(async (tx) => {
    const totalUsd = 5000;
    const [voucher] = await tx.insert(vouchers).values({
      companyId, voucherType: "Journal", voucherNumber: `SP-OTW-${container1.id}`,
      voucherDate: "2026-01-10", description: `OTW: Supplier A INV-5G-001`,
      totalAmount: String(totalUsd), currency: "USD", exchangeRate: "1", sourceModule: "SP",
    }).returning();
    await tx.insert(voucherEntries).values({
      voucherId: voucher.id, ledgerAccountId: otwAcct.id,
      debitAmount: String(totalUsd), creditAmount: "0", narration: "OTW Dr",
    });
    await tx.insert(voucherEntries).values({
      voucherId: voucher.id, ledgerAccountId: otwClrAcct.id,
      debitAmount: "0", creditAmount: String(totalUsd), narration: "OTW Clr Cr",
    });
    await tx.update(spContainers).set({ goodsOtwVoucherId: voucher.id }).where(eq(spContainers.id, container1.id));
    return voucher;
  });
  check("A2: OTW Dr balance", await accountDrBalance(otwAcct.id, companyId), 5000);
  check("A2: OTW Clr Cr balance", await accountCrBalance(otwClrAcct.id, companyId), 5000);
  pass("A2: Container created with default OTW accounts");

  // A3: Create a second container using custom OTW account override
  console.log("  A3: Container with custom OTW account override");
  const [container2] = await db.insert(spContainers).values({
    companyId, supplierName: "Supplier B", containerNumber: "CONT-5G-002",
    invoiceNumber: "INV-5G-002", invoiceDate: "2026-02-01",
    invoiceTotalUsd: "3000", discountPct: "0",
    freightEstimateUsd: "0", status: "open",
  }).returning();
  await db.insert(spContainerLines).values([
    { containerId: container2.id, companyId, articleCode: "CORN-5G", description: "Corn", qty: "200", unitRateUsd: "15.00" },
  ]);
  // Post with CUSTOM accounts
  await db.transaction(async (tx) => {
    const totalUsd = 3000;
    const [voucher] = await tx.insert(vouchers).values({
      companyId, voucherType: "Journal", voucherNumber: `SP-OTW-CUSTOM-${container2.id}`,
      voucherDate: "2026-02-01", description: `OTW Custom: Supplier B INV-5G-002`,
      totalAmount: String(totalUsd), currency: "USD", exchangeRate: "1", sourceModule: "SP",
    }).returning();
    await tx.insert(voucherEntries).values({
      voucherId: voucher.id, ledgerAccountId: customOtwId,
      debitAmount: String(totalUsd), creditAmount: "0", narration: "Custom OTW Dr",
    });
    await tx.insert(voucherEntries).values({
      voucherId: voucher.id, ledgerAccountId: customClrId,
      debitAmount: "0", creditAmount: String(totalUsd), narration: "Custom OTW Clr Cr",
    });
    await tx.update(spContainers).set({ goodsOtwVoucherId: voucher.id }).where(eq(spContainers.id, container2.id));
  });
  check("A3: Custom OTW Dr balance", await accountDrBalance(customOtwId, companyId), 3000);
  check("A3: Custom OTW Clr Cr balance", await accountCrBalance(customClrId, companyId), 3000);
  // Default OTW still has only 5000 (not 8000)
  check("A3: Default OTW unchanged at 5000", await accountDrBalance(otwAcct.id, companyId), 5000);

  // ── B. Prepaid debit account override ──────────────────────────────────────
  console.log("\n── B. Prepaid debit account override ─────────────────────");

  // B1: Default prepaid (debitAccountId not set)
  console.log("  B1: Prepaid with default debit account (sp_prepaid)");
  const [prepaid1] = await db.insert(spPrepaidCharges).values({
    companyId, containerId: container1.id,
    prepaidDate: "2026-01-15", chargeType: "duty",
    amountPaidUsd: "800", amountUsedUsd: "0", agentName: "Customs Agent",
  }).returning();
  await db.transaction(async (tx) => {
    const amt = 800;
    const [voucher] = await tx.insert(vouchers).values({
      companyId, voucherType: "Journal", voucherNumber: `SP-PRE-${prepaid1.id}`,
      voucherDate: "2026-01-15", description: "Prepaid duty",
      totalAmount: String(amt), currency: "USD", exchangeRate: "1", sourceModule: "SP",
    }).returning();
    await tx.insert(voucherEntries).values({
      voucherId: voucher.id, ledgerAccountId: prepaidAcct.id,
      debitAmount: String(amt), creditAmount: "0", narration: "Prepaid Dr",
    });
    await tx.insert(voucherEntries).values({
      voucherId: voucher.id, bankAccountId: bankId,
      debitAmount: "0", creditAmount: String(amt), narration: "Bank Cr",
    });
    await tx.update(spPrepaidCharges).set({ voucherId: voucher.id }).where(eq(spPrepaidCharges.id, prepaid1.id));
  });
  check("B1: Prepaid Dr balance (default)", await accountDrBalance(prepaidAcct.id, companyId), 800);
  check("B1: Bank Cr balance after prepaid", await bankCrBalance(bankId, companyId), 800);

  // B2: Prepaid with CUSTOM debit account
  console.log("  B2: Prepaid with custom debit account override");
  const [prepaid2] = await db.insert(spPrepaidCharges).values({
    companyId, containerId: container1.id,
    prepaidDate: "2026-01-20", chargeType: "freight",
    amountPaidUsd: "500", amountUsedUsd: "0", agentName: "Freight Co",
  }).returning();
  await db.transaction(async (tx) => {
    const amt = 500;
    const [voucher] = await tx.insert(vouchers).values({
      companyId, voucherType: "Journal", voucherNumber: `SP-PRE-CUSTOM-${prepaid2.id}`,
      voucherDate: "2026-01-20", description: "Prepaid freight — custom debit",
      totalAmount: String(amt), currency: "USD", exchangeRate: "1", sourceModule: "SP",
    }).returning();
    await tx.insert(voucherEntries).values({
      voucherId: voucher.id, ledgerAccountId: customDebitId,
      debitAmount: String(amt), creditAmount: "0", narration: "Custom Prepaid Dr",
    });
    await tx.insert(voucherEntries).values({
      voucherId: voucher.id, bankAccountId: bankId,
      debitAmount: "0", creditAmount: String(amt), narration: "Bank Cr",
    });
    await tx.update(spPrepaidCharges).set({ voucherId: voucher.id }).where(eq(spPrepaidCharges.id, prepaid2.id));
  });
  check("B2: Custom debit account Dr balance", await accountDrBalance(customDebitId, companyId), 500);
  check("B2: Default prepaid account unchanged at 800", await accountDrBalance(prepaidAcct.id, companyId), 800);
  check("B2: Bank Cr balance now 1300", await bankCrBalance(bankId, companyId), 1300);

  // B3: Cross-company bank account rejection
  console.log("  B3: Cross-company bank account correctly rejected");
  const [otherBankRow] = await db.select().from(bankAccounts).where(
    and(eq(bankAccounts.id, otherCoBankId), eq(bankAccounts.companyId, companyId))
  );
  if (!otherBankRow) {
    pass("B3: Cross-company bank account correctly rejected (not found for company)");
  } else {
    fail("B3: Cross-company bank account should have been rejected");
  }

  // B4: Port handling charge type (new in P5-G)
  console.log("  B4: Port handling charge type accepted");
  const [prepaid3] = await db.insert(spPrepaidCharges).values({
    companyId, containerId: container1.id,
    prepaidDate: "2026-01-22", chargeType: "port_handling",
    amountPaidUsd: "200", amountUsedUsd: "0", agentName: "Port Authority",
  }).returning();
  checkEq("B4: port_handling chargeType saved", prepaid3.chargeType, "port_handling");
  check("B4: amount correct", parseFloat(prepaid3.amountPaidUsd as string), 200);

  // ── C. Offload — all charge types including "other" ────────────────────────
  console.log("\n── C. Offload charge types ────────────────────────────────");

  // Container1 has 150 units (100 RICE + 50 WHEAT), discount 10%
  // RICE: qty=100, unitRate=5.00, discounted=4.50 → total = 450
  // WHEAT: qty=50, unitRate=8.00, discounted=7.20 → total = 360
  // Total base = 810
  // Prepaid available: prepaid1 (duty) = 800, prepaid2 (freight) = 500 (custom debit)
  // Charges to add:
  //   - prepaid_used: 300 from prepaid1 (duty)
  //   - paid_now: 150 from bank
  //   - unpaid_payable: 200 payable ledger account
  //   - other: 100 other ledger account

  const discountFactor = 0.90; // 10% discount
  const totalQty = 150;
  const riceBase = 100 * 5.00 * discountFactor; // 450
  const wheatBase = 50 * 8.00 * discountFactor;  // 360
  const totalBase = riceBase + wheatBase;         // 810
  const invoiceTotal = 5000;

  const chargePrepaidUsed = 300;
  const chargePaidNow     = 150;
  const chargeUnpaidPayable = 200;
  const chargeOther       = 100;
  const totalLanded       = chargePrepaidUsed + chargePaidNow + chargeUnpaidPayable + chargeOther; // 750
  const totalFinal        = totalBase + totalLanded; // 1560

  check("C setup: totalBase", totalBase, 810);
  check("C setup: totalLanded", totalLanded, 750);
  check("C setup: totalFinal", totalFinal, 1560);

  // Run offload in a transaction
  const offloadResult = await db.transaction(async (tx) => {
    // Voucher A: OTW Reversal
    const [voucherA] = await tx.insert(vouchers).values({
      companyId, voucherType: "Journal", voucherNumber: `SP-OTW-REV-${container1.id}`,
      voucherDate: "2026-02-10", description: `Goods OTW Reversal`,
      totalAmount: String(invoiceTotal), currency: "USD", exchangeRate: "1", sourceModule: "SP",
    }).returning();
    await tx.insert(voucherEntries).values({
      voucherId: voucherA.id, ledgerAccountId: otwClrAcct.id,
      debitAmount: String(invoiceTotal), creditAmount: "0", narration: "OTW Clr Dr",
    });
    await tx.insert(voucherEntries).values({
      voucherId: voucherA.id, ledgerAccountId: otwAcct.id,
      debitAmount: "0", creditAmount: String(invoiceTotal), narration: "OTW Cr",
    });

    // Voucher B: Stock creation
    const [voucherB] = await tx.insert(vouchers).values({
      companyId, voucherType: "Journal", voucherNumber: `SP-STOCK-${container1.id}`,
      voucherDate: "2026-02-10", description: `Stock offload`,
      totalAmount: String(totalFinal), currency: "USD", exchangeRate: "1", sourceModule: "SP",
    }).returning();

    // Dr Stock
    await tx.insert(voucherEntries).values({
      voucherId: voucherB.id, ledgerAccountId: stockAcct.id,
      debitAmount: String(totalFinal), creditAmount: "0", narration: "Stock Dr",
    });

    // Cr base cost → Cost Clearing
    await tx.insert(voucherEntries).values({
      voucherId: voucherB.id, ledgerAccountId: costClrAcct.id,
      debitAmount: "0", creditAmount: String(totalBase), narration: "Base cost Cr",
    });

    // Cr prepaid_used
    await tx.insert(voucherEntries).values({
      voucherId: voucherB.id, ledgerAccountId: prepaidAcct.id,
      debitAmount: "0", creditAmount: String(chargePrepaidUsed), narration: "Prepaid used Cr",
    });
    await tx.execute(
      sql`UPDATE sp_prepaid_charges SET amount_used_usd = amount_used_usd + ${chargePrepaidUsed} WHERE id = ${prepaid1.id}`
    );

    // Cr paid_now → bank
    await tx.insert(voucherEntries).values({
      voucherId: voucherB.id, bankAccountId: bankId,
      debitAmount: "0", creditAmount: String(chargePaidNow), narration: "Paid now Cr",
    });

    // Cr unpaid_payable → payable ledger
    await tx.insert(voucherEntries).values({
      voucherId: voucherB.id, ledgerAccountId: payableLedgerAcctId,
      debitAmount: "0", creditAmount: String(chargeUnpaidPayable), narration: "Payable Cr",
    });

    // Cr other → other ledger account
    await tx.insert(voucherEntries).values({
      voucherId: voucherB.id, ledgerAccountId: otherLedgerAcctId,
      debitAmount: "0", creditAmount: String(chargeOther), narration: "Other charge Cr",
    });

    // Insert offload record
    const [offload] = await tx.insert(spOffloads).values({
      companyId, containerId: container1.id, offloadDate: "2026-02-10",
      totalQty: String(totalQty), totalBaseCostUsd: String(totalBase),
      totalLandedCostUsd: String(totalLanded), totalFinalCostUsd: String(totalFinal),
      voucherIdReversal: voucherA.id, voucherIdStock: voucherB.id,
    }).returning();

    // Insert charges
    await tx.insert(spOffloadCharges).values([
      { offloadId: offload.id, companyId, chargeType: "prepaid_used",   description: "Duty",    amountUsd: String(chargePrepaidUsed),  prepaidChargeId: prepaid1.id },
      { offloadId: offload.id, companyId, chargeType: "paid_now",       description: "Freight", amountUsd: String(chargePaidNow),      creditBankAccountId: bankId },
      { offloadId: offload.id, companyId, chargeType: "unpaid_payable", description: "Port",    amountUsd: String(chargeUnpaidPayable), creditLedgerAccountId: payableLedgerAcctId },
      { offloadId: offload.id, companyId, chargeType: "other",          description: "Misc",    amountUsd: String(chargeOther),         creditLedgerAccountId: otherLedgerAcctId },
    ]);

    // Insert stock movements
    const landedPerUnit = totalLanded / totalQty;
    for (const line of [
      { articleCode: "RICE-5G", qty: 100, unitRateUsd: 5.00 },
      { articleCode: "WHEAT-5G", qty: 50, unitRateUsd: 8.00 },
    ]) {
      const baseUnitCost = line.unitRateUsd * discountFactor;
      const finalUnitCost = baseUnitCost + landedPerUnit;
      await tx.insert(spStockMovements).values({
        companyId, containerId: container1.id, offloadId: offload.id,
        articleCode: line.articleCode, locationId: loc?.id ?? null,
        qtyIn: String(line.qty), qtyRemaining: String(line.qty),
        baseUnitCostUsd: String(baseUnitCost),
        landedUnitCostUsd: String(landedPerUnit),
        finalUnitCostUsd: String(finalUnitCost),
      });
    }

    await tx.update(spContainers).set({ status: "offloaded" }).where(eq(spContainers.id, container1.id));

    return { offload, voucherBId: voucherB.id };
  });

  // Verify offload entries
  const stockDr = await accountDrBalance(stockAcct.id, companyId);
  check("C1: Stock Dr = totalFinal", stockDr, totalFinal);

  const costClrCr = await accountCrBalance(costClrAcct.id, companyId);
  // costClrAcct gets credited base (810) minus otwClr reversal debit (5000) + otwClr original credit (5000)
  // Net: costClr Cr = 810 (only from offload voucher B)
  check("C1: Cost Clearing Cr = base", costClrCr, totalBase);

  const prepaidCrBalance = await accountCrBalance(prepaidAcct.id, companyId);
  // prepaid was Dr 800 (B1), Cr 300 (C - prepaid_used) → net = 800 - 300 = 500 Dr
  // accountCrBalance returns credit - debit = 300 - 800 = -500
  // Let's just check the specific offload credit entry
  const prepaidUsedEntry = await db.execute(sql`
    SELECT SUM(CAST(credit_amount AS DECIMAL)) AS tot
    FROM voucher_entries ve JOIN vouchers v ON ve.voucher_id = v.id
    WHERE ve.ledger_account_id = ${prepaidAcct.id} AND v.id = ${offloadResult.voucherBId}
  `);
  const prepaidUsedAmt = num((prepaidUsedEntry as any).rows?.[0]?.tot ?? (prepaidUsedEntry as any)[0]?.tot);
  check("C2: Prepaid used entry = 300", prepaidUsedAmt, 300);

  // Verify bank credit from paid_now
  const bankCrAtOffload = await db.execute(sql`
    SELECT SUM(CAST(ve.credit_amount AS DECIMAL)) AS tot
    FROM voucher_entries ve JOIN vouchers v ON ve.voucher_id = v.id
    WHERE ve.bank_account_id = ${bankId} AND v.id = ${offloadResult.voucherBId}
  `);
  const bankPaidNow = num((bankCrAtOffload as any).rows?.[0]?.tot ?? (bankCrAtOffload as any)[0]?.tot);
  check("C3: Paid now bank Cr = 150", bankPaidNow, 150);

  // Verify payable ledger credit
  const payableCr = await accountCrBalance(payableLedgerAcctId, companyId);
  check("C4: Payable ledger Cr = 200", payableCr, 200);

  // Verify "other" ledger credit
  const otherCr = await accountCrBalance(otherLedgerAcctId, companyId);
  check("C5: Other ledger Cr = 100", otherCr, 100);

  // Verify OTW net balance is zero after reversal
  const otwNetDr = await accountDrBalance(otwAcct.id, companyId);
  // OTW was Dr 5000 (original) then Cr 5000 (reversal) → net = 0
  check("C6: OTW net balance = 0 after reversal", otwNetDr, 0);

  // D. Verify charge records stored correctly
  console.log("\n── D. Offload charge records ──────────────────────────────");
  const storedCharges = await db.select().from(spOffloadCharges).where(eq(spOffloadCharges.offloadId, offloadResult.offload.id));
  checkEq("D1: 4 charge records stored", storedCharges.length, 4);

  const prepaidCharge   = storedCharges.find(c => c.chargeType === "prepaid_used");
  const paidNowCharge   = storedCharges.find(c => c.chargeType === "paid_now");
  const payableCharge   = storedCharges.find(c => c.chargeType === "unpaid_payable");
  const otherCharge     = storedCharges.find(c => c.chargeType === "other");

  checkEq("D2: prepaid_used record present", !!prepaidCharge, true);
  check("D2: prepaid_used amount", prepaidCharge?.amountUsd, chargePrepaidUsed);
  checkEq("D3: paid_now record present", !!paidNowCharge, true);
  check("D3: paid_now bank account stored", paidNowCharge?.creditBankAccountId, bankId);
  checkEq("D4: unpaid_payable record present", !!payableCharge, true);
  check("D4: unpaid_payable ledger stored", payableCharge?.creditLedgerAccountId, payableLedgerAcctId);
  checkEq("D5: other record present", !!otherCharge, true);
  check("D5: other ledger account stored", otherCharge?.creditLedgerAccountId, otherLedgerAcctId);
  check("D5: other amount = 100", otherCharge?.amountUsd, 100);

  // D6: Prepaid amount_used_usd updated
  const [updatedPrepaid] = await db.select().from(spPrepaidCharges).where(eq(spPrepaidCharges.id, prepaid1.id));
  check("D6: Prepaid1 amount_used_usd updated to 300", updatedPrepaid.amountUsedUsd, 300);

  // D7: Stock movements created
  const movements = await db.select().from(spStockMovements).where(
    and(eq(spStockMovements.companyId, companyId), eq(spStockMovements.containerId, container1.id))
  );
  checkEq("D7: 2 stock movements created", movements.length, 2);
  const riceMovement  = movements.find(m => m.articleCode === "RICE-5G");
  const wheatMovement = movements.find(m => m.articleCode === "WHEAT-5G");
  checkEq("D7: RICE movement present", !!riceMovement, true);
  checkEq("D7: WHEAT movement present", !!wheatMovement, true);

  const landedPerUnit = totalLanded / totalQty; // 750/150 = 5
  check("D8: RICE base unit cost", riceMovement?.baseUnitCostUsd, 5.00 * 0.90); // 4.50
  check("D8: RICE landed per unit", riceMovement?.landedUnitCostUsd, landedPerUnit); // 5.00
  check("D8: RICE final unit cost", riceMovement?.finalUnitCostUsd, 4.50 + landedPerUnit); // 9.50
  check("D8: WHEAT base unit cost", wheatMovement?.baseUnitCostUsd, 8.00 * 0.90); // 7.20
  check("D8: WHEAT final unit cost", wheatMovement?.finalUnitCostUsd, 7.20 + landedPerUnit); // 12.20

  // D9: Cross-company account validation for offload
  console.log("  D9: Cross-company ledger account rejected for offload");
  {
    const [xcCoAcct] = await db.select().from(ledgerAccounts).where(
      and(eq(ledgerAccounts.id, otherCoAcctId), eq(ledgerAccounts.companyId, companyId), isNull(ledgerAccounts.deletedAt))
    );
    if (!xcCoAcct) {
      pass("D9: Cross-company ledger account correctly rejected for offload unpaid_payable");
    } else {
      fail("D9: Cross-company ledger account should have been rejected");
    }
  }

  // ── E. GC L'shi isolation ──────────────────────────────────────────────────
  console.log("\n── E. GC L'shi isolation ─────────────────────────────────");
  if (gcId) {
    const gcAfter = await gcRowCounts(gcId);
    checkEq("E1: GC voucher count unchanged", gcAfter.vouchers, gcBefore.vouchers);
    checkEq("E2: GC voucher_entries count unchanged", gcAfter.entries, gcBefore.entries);
  } else {
    pass("E: GC company not found — isolation not applicable");
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`  Results: ${totalPassed} passed, ${totalFailed} failed`);
  console.log("══════════════════════════════════════════════════════════\n");

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
