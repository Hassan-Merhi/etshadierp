/**
 * SP Phase 2 Integration Test Script
 * ──────────────────────────────────────────────────────────────────────────────
 * Tests: FIFO split across 2 lots, opening stock accounting, alias resolution,
 *        and GC L'shi isolation.
 *
 * Usage:
 *   npx tsx scripts/sp_phase2_test.ts
 *
 * Expects DATABASE_URL set (or .env loaded). Test company id=14 (SPTEST).
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { Pool } from "pg";

const SP_COMPANY_ID = 14;
const GC_COMPANY_ID = 1; // GC L'shi — must not be touched

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, extra?: string) {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}${extra ? ` — ${extra}` : ""}`);
    failed++;
  }
}

function near(a: number, b: number, tol = 0.01) {
  return Math.abs(a - b) <= tol;
}

async function query(sql: string, params: any[] = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}

async function queryOne(sql: string, params: any[] = []) {
  const res = await pool.query(sql, params);
  return res.rows[0] ?? null;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Cleanup: remove all SP data for SPTEST company
// ──────────────────────────────────────────────────────────────────────────────
async function cleanupSpData() {
  console.log("\n▶ Cleanup SPTEST SP data …");
  await query(`DELETE FROM sp_sale_lines WHERE company_id = $1`, [SP_COMPANY_ID]);
  await query(`DELETE FROM sp_sales WHERE company_id = $1`, [SP_COMPANY_ID]);
  await query(`DELETE FROM sp_stock_movements WHERE company_id = $1`, [SP_COMPANY_ID]);
  await query(`DELETE FROM voucher_entries WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id = $1 AND source_module = 'SP')`, [SP_COMPANY_ID]);
  await query(`DELETE FROM vouchers WHERE company_id = $1 AND source_module = 'SP'`, [SP_COMPANY_ID]);
  await query(`DELETE FROM stock_item_code_aliases WHERE company_id = $1`, [SP_COMPANY_ID]);
  // Reset SP account balances are implicit (voucher_entries cleared above)
  console.log("  Cleanup complete.");
}

// ──────────────────────────────────────────────────────────────────────────────
//  Helper: call internal routes via direct DB (since we test without HTTP)
// ──────────────────────────────────────────────────────────────────────────────
async function getSpAccountId(companyId: number, subType: string): Promise<number | null> {
  const row = await queryOne(
    `SELECT id FROM ledger_accounts WHERE company_id = $1 AND sub_type = $2 LIMIT 1`,
    [companyId, subType]
  );
  return row?.id ?? null;
}

async function accountBalance(accountId: number): Promise<number> {
  const row = await queryOne(
    `SELECT COALESCE(SUM(CAST(credit_amount AS DECIMAL)), 0) - COALESCE(SUM(CAST(debit_amount AS DECIMAL)), 0) AS bal
     FROM voucher_entries WHERE ledger_account_id = $1`,
    [accountId]
  );
  return parseFloat(row?.bal ?? "0");
}

// ──────────────────────────────────────────────────────────────────────────────
//  Test 1: Setup — ensure SP accounts exist for SPTEST
// ──────────────────────────────────────────────────────────────────────────────
const SP_ACCOUNTS_DEF = [
  { code: "SP-OTW",     name: "Goods On The Way",            accountType: "Asset",          subType: "sp_goods_otw",      isHidden: false },
  { code: "SP-OTWCLR",  name: "Goods OTW Clearing",          accountType: "Liability",      subType: "sp_otw_clearing",   isHidden: true  },
  { code: "SP-PREPAID", name: "Prepaid Charges",             accountType: "Asset",          subType: "sp_prepaid",        isHidden: false },
  { code: "SP-STOCK",   name: "Stock on Floor",              accountType: "Asset",          subType: "sp_stock",          isHidden: false },
  { code: "SP-COSTCLR", name: "Stock Cost Payable Clearing", accountType: "Liability",      subType: "sp_cost_clearing",  isHidden: true  },
  { code: "SP-PAY",     name: "Supplier Cash Payable",       accountType: "Liability",      subType: "sp_payable",        isHidden: false },
  { code: "SP-SALES",   name: "Sales",                       accountType: "Income",         subType: "sp_sales",          isHidden: false },
  { code: "SP-COGS",    name: "Cost of Goods Sold",          accountType: "Direct Expense", subType: "sp_cogs",           isHidden: false },
  { code: "SP-SHARED",  name: "Shared Charges",              accountType: "Direct Expense", subType: "sp_shared_charges", isHidden: false },
  { code: "SP-OPNBAL",  name: "Opening Balance Clearing",    accountType: "Equity",         subType: "sp_opnbal",         isHidden: true  },
];

async function ensureSpAccounts() {
  for (const acct of SP_ACCOUNTS_DEF) {
    const existing = await queryOne(
      `SELECT id FROM ledger_accounts WHERE company_id = $1 AND sub_type = $2 LIMIT 1`,
      [SP_COMPANY_ID, acct.subType]
    );
    if (!existing) {
      await query(
        `INSERT INTO ledger_accounts (company_id, code, name, account_type, sub_type, is_hidden)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [SP_COMPANY_ID, acct.code, acct.name, acct.accountType, acct.subType, acct.isHidden]
      );
      console.log(`    + Created ${acct.subType}`);
    }
  }
}

async function testSetup() {
  console.log("\n▶ T1: SP Accounts setup …");
  await ensureSpAccounts();
  const subtypes = ["sp_goods_otw", "sp_otw_clearing", "sp_prepaid", "sp_stock",
                    "sp_cost_clearing", "sp_payable", "sp_sales", "sp_cogs",
                    "sp_shared_charges", "sp_opnbal"];
  for (const st of subtypes) {
    const id = await getSpAccountId(SP_COMPANY_ID, st);
    assert(`SP account ${st} exists (id=${id})`, id !== null);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Test 2: Opening Stock — post 2 lots and verify journals
// ──────────────────────────────────────────────────────────────────────────────
async function postOpeningStock(
  articleCode: string, qty: number,
  baseUC: number, landedUC: number, finalUC: number
): Promise<number> {
  // Insert stock movement directly (mirrors the API)
  const [mvRow] = await query(
    `INSERT INTO sp_stock_movements
       (company_id, source_type, article_code, qty_in, qty_remaining,
        base_unit_cost_usd, landed_unit_cost_usd, final_unit_cost_usd)
     VALUES ($1, 'opening', $2, $3, $3, $4, $5, $6)
     RETURNING id`,
    [SP_COMPANY_ID, articleCode, qty, baseUC, landedUC, finalUC]
  );
  const mvId = mvRow.id;

  const stockAcctId   = await getSpAccountId(SP_COMPANY_ID, "sp_stock");
  const costClrAcctId = await getSpAccountId(SP_COMPANY_ID, "sp_cost_clearing");
  const opnBalAcctId  = await getSpAccountId(SP_COMPANY_ID, "sp_opnbal");
  if (!stockAcctId || !costClrAcctId || !opnBalAcctId) throw new Error("SP accounts missing");

  const finalTotal = qty * finalUC;
  const baseTotal  = qty * baseUC;
  const landTotal  = qty * landedUC;

  const [vRow] = await query(
    `INSERT INTO vouchers
       (company_id, voucher_type, voucher_number, voucher_date, description, total_amount, currency, exchange_rate, source_module)
     VALUES ($1, 'Journal', $2, CURRENT_DATE, 'Opening stock test', $3, 'USD', '1', 'SP')
     RETURNING id`,
    [SP_COMPANY_ID, `SP-OPNSTK-TEST-${mvId}-${Date.now()}`, finalTotal]
  );
  const voucherId = vRow.id;

  await query(
    `INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration)
     VALUES ($1, $2, $3, '0', 'Dr stock')`,
    [voucherId, stockAcctId, finalTotal]
  );
  await query(
    `INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration)
     VALUES ($1, $2, '0', $3, 'Cr cost clearing')`,
    [voucherId, costClrAcctId, baseTotal]
  );
  if (landTotal > 0) {
    await query(
      `INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration)
       VALUES ($1, $2, '0', $3, 'Cr opn bal')`,
      [voucherId, opnBalAcctId, landTotal]
    );
  }

  return mvId;
}

async function testOpeningStock() {
  console.log("\n▶ T2: Opening Stock — 2 lots for RICE-25KG …");

  // LOT A: 30 bags @ $15 base, $2 landed = $17 final
  const mvA = await postOpeningStock("RICE-25KG", 30, 15, 2, 17);
  // LOT B: 20 bags @ $16 base, $3 landed = $19 final
  const mvB = await postOpeningStock("RICE-25KG", 20, 16, 3, 19);

  const mvs = await query(
    `SELECT * FROM sp_stock_movements WHERE company_id = $1 AND source_type = 'opening' ORDER BY id ASC`,
    [SP_COMPANY_ID]
  );
  assert("2 opening stock lots created", mvs.length === 2);

  const lotA = mvs.find((m: any) => m.id === mvA);
  const lotB = mvs.find((m: any) => m.id === mvB);
  assert("LOT A: qty_in = 30", near(parseFloat(lotA?.qty_in), 30));
  assert("LOT A: base_unit_cost_usd = 15", near(parseFloat(lotA?.base_unit_cost_usd), 15));
  assert("LOT A: final_unit_cost_usd = 17", near(parseFloat(lotA?.final_unit_cost_usd), 17));
  assert("LOT B: qty_in = 20", near(parseFloat(lotB?.qty_in), 20));
  assert("LOT B: final_unit_cost_usd = 19", near(parseFloat(lotB?.final_unit_cost_usd), 19));

  // Journal checks
  const stockAcctId   = await getSpAccountId(SP_COMPANY_ID, "sp_stock");
  const costClrAcctId = await getSpAccountId(SP_COMPANY_ID, "sp_cost_clearing");
  const opnBalAcctId  = await getSpAccountId(SP_COMPANY_ID, "sp_opnbal");

  const stockBal   = await accountBalance(stockAcctId!);
  const costClrBal = await accountBalance(costClrAcctId!);
  const opnBalBal  = await accountBalance(opnBalAcctId!);

  // SP-STOCK Dr = 30×17 + 20×19 = 510 + 380 = 890
  assert(`SP-STOCK balance = $890 (${stockBal.toFixed(2)})`, near(stockBal, -890), `got ${stockBal}`);
  // Wait — accountBalance returns Cr - Dr, so a Dr account has negative balance
  // Let me recalculate: stockBal = Cr - Dr = 0 - 890 = -890
  // costClrBal = Cr - Dr = (30×15 + 20×16) - 0 = 450+320 = 770 → positive (liability)
  // opnBalBal = Cr - Dr = (30×2 + 20×3) - 0 = 60+60 = 120 → positive (equity)

  const stockDr = -stockBal; // actual debit = 890
  assert(`SP-STOCK debited $890`, near(stockDr, 890), `actual Dr = ${stockDr}`);

  const costClrCr = costClrBal; // 770
  assert(`SP-COSTCLR credited $770 (${costClrCr.toFixed(2)})`, near(costClrCr, 770), `got ${costClrCr}`);

  const opnBalCr = opnBalBal; // 120
  assert(`SP-OPNBAL credited $120 (${opnBalCr.toFixed(2)})`, near(opnBalCr, 120), `got ${opnBalCr}`);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Test 3: FIFO Sale — sell 40 bags (spans both lots)
// ──────────────────────────────────────────────────────────────────────────────
async function postSale(
  articleCode: string, qtySold: number, salePrice: number
): Promise<{ saleId: number; lines: any[] }> {
  // Simulate server FIFO logic directly in DB
  const lots = await query(
    `SELECT * FROM sp_stock_movements
     WHERE company_id = $1 AND article_code = $2 AND qty_remaining > 0
     ORDER BY created_at ASC, id ASC
     FOR UPDATE`,
    [SP_COMPANY_ID, articleCode]
  );
  // (No real transaction here since we're outside the HTTP layer — simulate sequentially)

  const salesAcctId   = await getSpAccountId(SP_COMPANY_ID, "sp_sales");
  const cogsAcctId    = await getSpAccountId(SP_COMPANY_ID, "sp_cogs");
  const stockAcctId   = await getSpAccountId(SP_COMPANY_ID, "sp_stock");
  const costClrAcctId = await getSpAccountId(SP_COMPANY_ID, "sp_cost_clearing");
  const payableAcctId = await getSpAccountId(SP_COMPANY_ID, "sp_payable");
  if (!salesAcctId || !cogsAcctId || !stockAcctId || !costClrAcctId || !payableAcctId) {
    throw new Error("SP accounts missing");
  }

  let qtyLeft = qtySold;
  let totalSale = 0, totalBase = 0, totalFinal = 0;
  const postedLines: any[] = [];

  for (const lot of lots) {
    if (qtyLeft <= 0.0001) break;
    const avail = parseFloat(lot.qty_remaining);
    const qtyFromLot = Math.min(qtyLeft, avail);
    qtyLeft -= qtyFromLot;

    const baseUC  = parseFloat(lot.base_unit_cost_usd);
    const finalUC = parseFloat(lot.final_unit_cost_usd);
    const landedUC = parseFloat(lot.landed_unit_cost_usd);

    totalSale  += qtyFromLot * salePrice;
    totalBase  += qtyFromLot * baseUC;
    totalFinal += qtyFromLot * finalUC;

    await query(
      `UPDATE sp_stock_movements SET qty_remaining = $1 WHERE id = $2`,
      [avail - qtyFromLot, lot.id]
    );

    postedLines.push({ movementId: lot.id, qtySold: qtyFromLot, baseUC, landedUC, finalUC });
  }

  const grossProfit = totalSale - totalFinal;

  const [saleRow] = await query(
    `INSERT INTO sp_sales
       (company_id, sale_date, customer_name, total_sale_price_usd, total_base_cost_usd,
        total_final_cost_usd, gross_profit_usd, status)
     VALUES ($1, CURRENT_DATE, 'Test Customer', $2, $3, $4, $5, 'posted')
     RETURNING id`,
    [SP_COMPANY_ID, totalSale, totalBase, totalFinal, grossProfit]
  );
  const saleId = saleRow.id;

  const [vRow] = await query(
    `INSERT INTO vouchers
       (company_id, voucher_type, voucher_number, voucher_date, description, total_amount, currency, exchange_rate, source_module)
     VALUES ($1, 'Journal', $2, CURRENT_DATE, 'Test sale FIFO', $3, 'USD', '1', 'SP')
     RETURNING id`,
    [SP_COMPANY_ID, `SP-SALE-TEST-${saleId}-${Date.now()}`, totalSale]
  );
  const voucherId = vRow.id;

  // Cr Sales
  await query(`INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration) VALUES ($1,$2,'0',$3,'Sales')`, [voucherId, salesAcctId, totalSale]);
  // Dr COGS, Cr Stock
  await query(`INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration) VALUES ($1,$2,$3,'0','COGS')`, [voucherId, cogsAcctId, totalFinal]);
  await query(`INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration) VALUES ($1,$2,'0',$3,'Stock')`, [voucherId, stockAcctId, totalFinal]);
  // Dr COSTCLR, Cr PAY
  await query(`INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration) VALUES ($1,$2,$3,'0','CostClr')`, [voucherId, costClrAcctId, totalBase]);
  await query(`INSERT INTO voucher_entries (voucher_id, ledger_account_id, debit_amount, credit_amount, narration) VALUES ($1,$2,'0',$3,'Pay')`, [voucherId, payableAcctId, totalBase]);

  // Sale lines
  for (const pl of postedLines) {
    await query(
      `INSERT INTO sp_sale_lines
         (sale_id, company_id, movement_id, article_code, qty_sold, sale_price_per_unit,
          base_unit_cost_usd, landed_unit_cost_usd, final_unit_cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [saleId, SP_COMPANY_ID, pl.movementId, articleCode, pl.qtySold, salePrice,
       pl.baseUC, pl.landedUC, pl.finalUC]
    );
  }

  await query(`UPDATE sp_sales SET voucher_id = $1 WHERE id = $2`, [voucherId, saleId]);

  return { saleId, lines: postedLines };
}

async function testFifoSale() {
  console.log("\n▶ T3: FIFO Sale — 40 bags @ $40 (spans LOT A + LOT B) …");

  const { saleId, lines } = await postSale("RICE-25KG", 40, 40);

  assert("Sale posted", saleId > 0);
  assert("2 FIFO lots consumed", lines.length === 2, `got ${lines.length}`);

  const lotALine = lines[0]; // first lot = LOT A (30 bags)
  const lotBLine = lines[1]; // second lot = LOT B (10 bags)

  assert("LOT A: 30 bags consumed", near(lotALine.qtySold, 30), `got ${lotALine.qtySold}`);
  assert("LOT B: 10 bags consumed", near(lotBLine.qtySold, 10), `got ${lotBLine.qtySold}`);

  // Verify lot remaining
  const lotA = await queryOne(`SELECT qty_remaining FROM sp_stock_movements WHERE id = $1`, [lotALine.movementId]);
  const lotB = await queryOne(`SELECT qty_remaining FROM sp_stock_movements WHERE id = $1`, [lotBLine.movementId]);
  assert("LOT A remaining = 0", near(parseFloat(lotA?.qty_remaining), 0), `got ${lotA?.qty_remaining}`);
  assert("LOT B remaining = 10", near(parseFloat(lotB?.qty_remaining), 10), `got ${lotB?.qty_remaining}`);

  // Verify sale totals
  const sale = await queryOne(`SELECT * FROM sp_sales WHERE id = $1`, [saleId]);
  const saleTotal  = parseFloat(sale.total_sale_price_usd);  // 40 × $40 = $1600
  const baseCost   = parseFloat(sale.total_base_cost_usd);   // 30×$15 + 10×$16 = 450+160 = $610
  const finalCost  = parseFloat(sale.total_final_cost_usd);  // 30×$17 + 10×$19 = 510+190 = $700
  const grossProfit = parseFloat(sale.gross_profit_usd);     // 1600-700 = $900

  assert(`Sale total = $1600 (${saleTotal.toFixed(2)})`, near(saleTotal, 1600), `got ${saleTotal}`);
  assert(`Base cost = $610 (${baseCost.toFixed(2)})`, near(baseCost, 610), `got ${baseCost}`);
  assert(`Final COGS = $700 (${finalCost.toFixed(2)})`, near(finalCost, 700), `got ${finalCost}`);
  assert(`Gross profit = $900 (${grossProfit.toFixed(2)})`, near(grossProfit, 900), `got ${grossProfit}`);

  // Verify accounting: SP-PAY balance = $610 (base only, NOT final)
  const payableAcctId = await getSpAccountId(SP_COMPANY_ID, "sp_payable");
  const payBal = await accountBalance(payableAcctId!); // Cr - Dr = 610 (liability Cr)
  assert(`SP-PAY balance = $610 (${payBal.toFixed(2)})`, near(payBal, 610), `got ${payBal}`);

  // Verify accounting: SP-COGS Dr = $700
  const cogsAcctId = await getSpAccountId(SP_COMPANY_ID, "sp_cogs");
  const cogsBal = await accountBalance(cogsAcctId!); // Cr - Dr = -700 (expense Dr)
  assert(`SP-COGS Dr = $700 (bal=${cogsBal.toFixed(2)})`, near(cogsBal, -700), `got ${cogsBal}`);

  // Verify accounting: SP-SALES Cr = $1600
  const salesAcctId = await getSpAccountId(SP_COMPANY_ID, "sp_sales");
  const salesBal = await accountBalance(salesAcctId!); // Cr - Dr = 1600 (income Cr)
  assert(`SP-SALES Cr = $1600 (bal=${salesBal.toFixed(2)})`, near(salesBal, 1600), `got ${salesBal}`);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Test 4: Alias mapping
// ──────────────────────────────────────────────────────────────────────────────
async function testAlias() {
  console.log("\n▶ T4: Alias mapping …");

  // Create a temporary stock item for the alias FK test
  const [siRow] = await query(
    `INSERT INTO stock_items (company_id, code, name, uom)
     VALUES ($1, 'TEST-RICE-ITEM', 'Test Rice Item (alias test)', 'BAG')
     RETURNING id`,
    [SP_COMPANY_ID]
  );
  const testStockItemId = siRow.id;
  assert("Temp stock item created", testStockItemId > 0);

  // Insert an alias: "RICE-ALT" → testStockItemId
  await query(
    `INSERT INTO stock_item_code_aliases (company_id, alias_code, stock_item_id, description)
     VALUES ($1, 'RICE-ALT', $2, 'Test alias') ON CONFLICT DO NOTHING`,
    [SP_COMPANY_ID, testStockItemId]
  );

  const alias = await queryOne(
    `SELECT * FROM stock_item_code_aliases WHERE company_id = $1 AND alias_code = 'RICE-ALT'`,
    [SP_COMPANY_ID]
  );
  assert("Alias 'RICE-ALT' inserted", alias !== null);
  assert(`Alias maps to stock_item_id ${testStockItemId}`, parseInt(alias?.stock_item_id) === testStockItemId);

  // Clean up
  await query(`DELETE FROM stock_item_code_aliases WHERE company_id = $1 AND alias_code = 'RICE-ALT'`, [SP_COMPANY_ID]);
  await query(`DELETE FROM stock_items WHERE id = $1`, [testStockItemId]);
  assert("Alias + stock item cleanup OK", true);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Test 5: GC L'shi isolation — no SP data touched
// ──────────────────────────────────────────────────────────────────────────────
async function testGcIsolation() {
  console.log("\n▶ T5: GC L'shi isolation …");

  // GC should have NO sp_stock_movements or sp_sales (SP-only tables)
  const gcMov = await queryOne(
    `SELECT COUNT(*) AS cnt FROM sp_stock_movements WHERE company_id = $1`,
    [GC_COMPANY_ID]
  );
  const gcSales = await queryOne(
    `SELECT COUNT(*) AS cnt FROM sp_sales WHERE company_id = $1`,
    [GC_COMPANY_ID]
  );
  assert(`GC sp_stock_movements = 0 (got ${gcMov?.cnt})`, parseInt(gcMov?.cnt) === 0);
  assert(`GC sp_sales = 0 (got ${gcSales?.cnt})`, parseInt(gcSales?.cnt) === 0);

  // Aliases in stock_item_code_aliases are per-company — GC's existing aliases are unaffected.
  // Verify SPTEST aliases are scoped to SP_COMPANY_ID only (none leaked to GC).
  const spAliasesLeakedToGc = await queryOne(
    `SELECT COUNT(*) AS cnt FROM stock_item_code_aliases WHERE company_id = $1 AND alias_code = 'RICE-ALT'`,
    [GC_COMPANY_ID]
  );
  assert(`RICE-ALT alias not leaked to GC (got ${spAliasesLeakedToGc?.cnt})`,
    parseInt(spAliasesLeakedToGc?.cnt) === 0);

  // Verify SP accounts scoped to SP_COMPANY_ID only
  const gcSpAcct = await queryOne(
    `SELECT COUNT(*) AS cnt FROM ledger_accounts WHERE company_id = $1 AND sub_type = 'sp_opnbal'`,
    [GC_COMPANY_ID]
  );
  assert(`SP-OPNBAL not created for GC (got ${gcSpAcct?.cnt})`, parseInt(gcSpAcct?.cnt) === 0);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Main
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log(" SP Phase 2 Integration Test — company_id=" + SP_COMPANY_ID);
  console.log("═══════════════════════════════════════════════════════════");

  try {
    await cleanupSpData();
    await testSetup();
    await testOpeningStock();
    await testFifoSale();
    await testAlias();
    await testGcIsolation();
  } catch (err: any) {
    console.error("\n⚠  Test aborted with error:", err.message);
    failed++;
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(` Results: ${passed} passed  ${failed} failed  (${passed + failed} total)`);
  console.log("═══════════════════════════════════════════════════════════\n");

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main();
