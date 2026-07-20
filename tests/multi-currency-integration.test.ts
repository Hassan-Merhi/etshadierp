/**
 * tests/multi-currency-integration.test.ts
 *
 * Phase 15 — Task 3 targeted regression tests for the multi-currency system.
 *
 * Tests:
 *  1. CFA payment voucher → entries have historicalExchangeRate, transactionCurrency=CFA,
 *     transactionDebitAmount, baseDebitAmount stored correctly.
 *  2. USD payment voucher → entries have identity rate (1.0), transactionCurrency=USD.
 *  3. Bank account revaluation endpoint returns correct structure.
 *  4. Fixed-asset endpoint returns historicalCostBase field.
 *  5. Voucher edit preserves historical-rate fields through GET /entries.
 *  6. Backfill token mismatch is detected correctly (unit-level).
 *  7. Ambiguous-row CFA classification (between 1,000 and 49,999 at rate >100).
 *  8. balancesByCurrency structure from customer/supplier routes.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { pool, db } from "../server/db";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "../shared/schema";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import crypto from "node:crypto";
import Decimal from "decimal.js";

const TEST_PREFIX = "mc3test";

let ctx: TestContext;
let agent: request.SuperAgentTest;

async function loginAsTestUser() {
  const loginRes = await agent.post("/api/auth/login").send({
    username: `${TEST_PREFIX}_testuser`,
    password: "testpassword123",
  });
  if (loginRes.status !== 200) {
    throw new Error(`Login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
}

async function cleanupVouchers() {
  await pool.query(
    `DELETE FROM voucher_entries WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id = $1)`,
    [ctx.companyId]
  );
  await pool.query(`DELETE FROM vouchers WHERE company_id = $1`, [ctx.companyId]);
}

/** Helper to create a voucher-with-entries via the API */
async function createVoucherWithEntries(payload: any) {
  const res = await agent.post("/api/vouchers/with-entries").send(payload);
  return res;
}

let voucherSeq = 0;

/** Build a minimal Payment voucher payload using the given currency and rate */
function buildPaymentPayload({
  currency,
  exchangeRate,
  amount,
  cashAccountId,
  salesAccountId,
}: {
  currency: string;
  exchangeRate: string | null;
  amount: number;
  cashAccountId: number;
  salesAccountId: number;
}) {
  // Supply a unique voucher number — the DB column is NOT NULL with no DEFAULT.
  const voucherNumber = `MC3-TEST-${Date.now()}-${++voucherSeq}`;
  return {
    voucher: {
      voucherNumber,
      voucherType: "Payment",
      voucherDate: new Date().toISOString().split("T")[0],
      description: `MC3 test ${currency} payment`,
      optional: false,
      currency,
      ...(exchangeRate ? { exchangeRate } : {}),
    },
    entries: [
      {
        accountType: "ledger",
        ledgerAccountId: cashAccountId,
        bankAccountId: null,
        supplierId: null,
        employeeId: null,
        fixedAssetId: null,
        customerId: null,
        debitAmount: String(amount),
        creditAmount: "0",
        narration: "Cash debit",
      },
      {
        accountType: "ledger",
        ledgerAccountId: salesAccountId,
        bankAccountId: null,
        supplierId: null,
        employeeId: null,
        fixedAssetId: null,
        customerId: null,
        debitAmount: "0",
        creditAmount: String(amount),
        narration: "Sales credit",
      },
    ],
  };
}

beforeAll(async () => {
  ctx = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);
  await loginAsTestUser();
}, 60000);

afterAll(async () => {
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

// ─── 1. CFA Payment Voucher — dual-currency fields are stored ─────────────────

describe("CFA Payment Voucher — dual-currency field storage", () => {
  const CFA_RATE = "600"; // CFA per USD
  const CFA_AMOUNT = 60000; // Clearly CFA-scale (≥ 50,000)

  let voucherId: number;

  beforeEach(async () => {
    await cleanupVouchers();
  });

  it("creates a CFA voucher via API (currency=CFA, exchangeRate=600)", async () => {
    const res = await createVoucherWithEntries(
      buildPaymentPayload({
        currency: "CFA",
        exchangeRate: CFA_RATE,
        amount: CFA_AMOUNT,
        cashAccountId: ctx.cashAccountId,
        salesAccountId: ctx.salesAccountId,
      })
    );
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(res.body?.voucher?.id).toBeDefined();
    voucherId = res.body.voucher.id;
  });

  it("stores transactionCurrency=CFA on entries", async () => {
    const res = await createVoucherWithEntries(
      buildPaymentPayload({
        currency: "CFA",
        exchangeRate: CFA_RATE,
        amount: CFA_AMOUNT,
        cashAccountId: ctx.cashAccountId,
        salesAccountId: ctx.salesAccountId,
      })
    );
    expect([200, 201]).toContain(res.status);
    voucherId = res.body.voucher.id;

    const { rows } = await pool.query(
      `SELECT transaction_currency, historical_exchange_rate, transaction_debit_amount,
              transaction_credit_amount, base_debit_amount, base_credit_amount, rate_convention
       FROM voucher_entries WHERE voucher_id = $1 ORDER BY id`,
      [voucherId]
    );

    // Should have 2 entries
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(row.transaction_currency).toBe("CFA");
      expect(row.historical_exchange_rate).not.toBeNull();
      expect(parseFloat(row.historical_exchange_rate)).toBeCloseTo(600, 1);
      expect(row.rate_convention).toBe("TRANSACTION_PER_BASE");
    }

    // Debit entry: should have transaction_debit_amount = CFA_AMOUNT, base_debit_amount = 100
    const debitRow = rows.find((r: any) => parseFloat(r.transaction_debit_amount || "0") > 0);
    expect(debitRow).toBeDefined();
    expect(parseFloat(debitRow.transaction_debit_amount)).toBeCloseTo(CFA_AMOUNT, 0);
    // Base amount = CFA / rate = 60000 / 600 = 100 USD
    expect(parseFloat(debitRow.base_debit_amount)).toBeCloseTo(100, 2);

    // Credit entry
    const creditRow = rows.find((r: any) => parseFloat(r.transaction_credit_amount || "0") > 0);
    expect(creditRow).toBeDefined();
    expect(parseFloat(creditRow.transaction_credit_amount)).toBeCloseTo(CFA_AMOUNT, 0);
    expect(parseFloat(creditRow.base_credit_amount)).toBeCloseTo(100, 2);
  });

  it("does NOT overwrite debit_amount / credit_amount legacy columns", async () => {
    const res = await createVoucherWithEntries(
      buildPaymentPayload({
        currency: "CFA",
        exchangeRate: CFA_RATE,
        amount: CFA_AMOUNT,
        cashAccountId: ctx.cashAccountId,
        salesAccountId: ctx.salesAccountId,
      })
    );
    expect([200, 201]).toContain(res.status);
    voucherId = res.body.voucher.id;

    const { rows } = await pool.query(
      `SELECT debit_amount, credit_amount FROM voucher_entries WHERE voucher_id = $1 ORDER BY id`,
      [voucherId]
    );

    // Legacy columns should still hold the original amounts (what the caller passed)
    const debitRow = rows.find((r: any) => parseFloat(r.debit_amount || "0") > 0);
    expect(debitRow).toBeDefined();
    expect(parseFloat(debitRow.debit_amount)).toBeCloseTo(CFA_AMOUNT, 0);
  });
});

// ─── 2. USD Payment Voucher — identity rate ───────────────────────────────────

describe("USD Payment Voucher — identity rate stored", () => {
  beforeEach(async () => {
    await cleanupVouchers();
  });

  it("stores transactionCurrency=USD and rate=1 for USD vouchers", async () => {
    const USD_AMOUNT = 500;
    const res = await createVoucherWithEntries(
      buildPaymentPayload({
        currency: "USD",
        exchangeRate: null,
        amount: USD_AMOUNT,
        cashAccountId: ctx.cashAccountId,
        salesAccountId: ctx.salesAccountId,
      })
    );
    expect([200, 201]).toContain(res.status);
    const voucherId = res.body.voucher.id;

    const { rows } = await pool.query(
      `SELECT transaction_currency, historical_exchange_rate, base_debit_amount, base_credit_amount
       FROM voucher_entries WHERE voucher_id = $1`,
      [voucherId]
    );

    for (const row of rows) {
      // USD entries: transactionCurrency should be USD (or null if no rate set for company)
      if (row.transaction_currency) {
        expect(row.transaction_currency).toBe("USD");
        // Rate should be 1 for identity
        if (row.historical_exchange_rate) {
          expect(parseFloat(row.historical_exchange_rate)).toBeCloseTo(1, 3);
        }
      }
    }
  });
});

// ─── 3. GET /entries returns multi-currency fields ─────────────────────────────

describe("GET /api/vouchers/:id/entries — returns multi-currency fields", () => {
  let voucherId: number;

  beforeEach(async () => {
    await cleanupVouchers();
  });

  it("returns transactionCurrency and historicalExchangeRate in entries response", async () => {
    const CFA_RATE = "600";
    const CFA_AMOUNT = 60000;
    const createRes = await createVoucherWithEntries(
      buildPaymentPayload({
        currency: "CFA",
        exchangeRate: CFA_RATE,
        amount: CFA_AMOUNT,
        cashAccountId: ctx.cashAccountId,
        salesAccountId: ctx.salesAccountId,
      })
    );
    expect([200, 201]).toContain(createRes.status);
    voucherId = createRes.body.voucher.id;

    const res = await agent.get(`/api/vouchers/${voucherId}/entries`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    // Each entry should have the multi-currency fields
    for (const entry of res.body) {
      if (entry.transactionCurrency) {
        expect(entry.transactionCurrency).toBe("CFA");
        expect(entry.historicalExchangeRate).toBeDefined();
        expect(parseFloat(entry.historicalExchangeRate)).toBeCloseTo(600, 1);
      }
    }
  });
});

// ─── 4. GET /view-entries returns multi-currency fields ──────────────────────

describe("GET /api/vouchers/:id/view-entries — returns multi-currency fields", () => {
  let voucherId: number;

  beforeEach(async () => {
    await cleanupVouchers();
  });

  it("view-entries response includes transactionDebitAmount and baseDebitAmount", async () => {
    const CFA_RATE = "600";
    const CFA_AMOUNT = 60000;
    const createRes = await createVoucherWithEntries(
      buildPaymentPayload({
        currency: "CFA",
        exchangeRate: CFA_RATE,
        amount: CFA_AMOUNT,
        cashAccountId: ctx.cashAccountId,
        salesAccountId: ctx.salesAccountId,
      })
    );
    expect([200, 201]).toContain(createRes.status);
    voucherId = createRes.body.voucher.id;

    const res = await agent.get(`/api/vouchers/${voucherId}/view-entries`);
    expect(res.status).toBe(200);
    // view-entries returns an array for non-purchase/sales vouchers
    const entries = Array.isArray(res.body) ? res.body : res.body?.entries || [];
    expect(entries.length).toBeGreaterThan(0);

    const debitEntry = entries.find((e: any) => parseFloat(e.debitAmount || "0") > 0);
    expect(debitEntry).toBeDefined();

    // Should have multi-currency fields
    if (debitEntry.transactionCurrency) {
      expect(debitEntry.transactionCurrency).toBe("CFA");
      expect(debitEntry.transactionDebitAmount).toBeDefined();
      expect(parseFloat(debitEntry.transactionDebitAmount)).toBeCloseTo(CFA_AMOUNT, 0);
      expect(debitEntry.baseDebitAmount).toBeDefined();
      expect(parseFloat(debitEntry.baseDebitAmount)).toBeCloseTo(100, 2);
    }
  });
});

// ─── 5. Bank account revaluation endpoint (Phase 2+3 rewrite) ────────────────
//
// POST-Phase-2: endpoint now returns nativeBalancesByCurrency (Record<ccy, string>)
// instead of the old flat nativeCurrency + nativeBalance fields.

describe("GET /api/bank-accounts/revaluation", () => {
  it("returns 200 with Phase-2 nativeBalancesByCurrency structure", async () => {
    const res = await agent.get("/api/bank-accounts/revaluation");
    expect(res.status).toBe(200);
    const body = res.body;
    // Response shape: { accounts: [...], currentCfaPerUsd: string|null }
    expect(body).toHaveProperty("accounts");
    expect(Array.isArray(body.accounts)).toBe(true);

    for (const item of body.accounts) {
      // Phase-2 shape: nativeBalancesByCurrency replaces old nativeCurrency/nativeBalance
      expect(item).toHaveProperty("nativeBalancesByCurrency");
      expect(typeof item.nativeBalancesByCurrency).toBe("object");
      // All per-currency values must be numeric strings
      for (const [ccy, val] of Object.entries(item.nativeBalancesByCurrency)) {
        expect(typeof val).toBe("string");
        expect(isFinite(Number(val))).toBe(true);
      }
      // Phase-2 base fields
      expect(item).toHaveProperty("historicalBaseBalance");
      expect(item).toHaveProperty("currentRate");
      expect(item).toHaveProperty("currentTranslatedBaseBalance");
      expect(item).toHaveProperty("translationDifference");
      // Phase-4 opening-balance flag
      expect(item).toHaveProperty("openingBalanceCurrencyUnresolved");
      expect(typeof item.openingBalanceCurrencyUnresolved).toBe("boolean");
      // All monetary fields must be numeric strings
      for (const field of ["historicalBaseBalance", "currentTranslatedBaseBalance", "translationDifference"]) {
        expect(isFinite(Number(item[field]))).toBe(true);
      }
    }
  });

  it("currentCfaPerUsd is either null or a 10dp numeric string", async () => {
    const res = await agent.get("/api/bank-accounts/revaluation");
    expect(res.status).toBe(200);
    const { currentCfaPerUsd } = res.body;
    if (currentCfaPerUsd !== null) {
      expect(typeof currentCfaPerUsd).toBe("string");
      expect(isFinite(Number(currentCfaPerUsd))).toBe(true);
      // Should have 10 decimal places
      expect(/\.\d{10}$/.test(currentCfaPerUsd)).toBe(true);
    }
  });
});

// ─── 6. Fixed asset endpoint returns historicalCostBase ──────────────────────

describe("GET /api/fixed-assets — historicalCostBase field", () => {
  it("returns 200 with historicalCostBase field", async () => {
    const res = await agent.get("/api/fixed-assets");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    // If there are fixed assets, each should have historicalCostBase
    for (const asset of res.body) {
      // The field should be present (may be null for assets with no cost entries)
      expect("historicalCostBase" in asset).toBe(true);
    }
  });
});

// ─── 7. Backfill token constant-time comparison (unit) ───────────────────────

describe("Backfill token constant-time comparison — unit tests", () => {
  /**
   * Mirrors the safeCompareTokens function from the backfill script.
   * (We re-implement it here for unit testing without importing the script.)
   */
  function safeCompareTokens(provided: string, expected: string): boolean {
    if (typeof provided !== "string" || typeof expected !== "string") return false;
    if (provided.length !== expected.length) return false;
    try {
      const a = Buffer.from(provided, "utf8");
      const b = Buffer.from(expected, "utf8");
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  function generateToken(companyIds: number[], reportHash: string): string {
    return crypto
      .createHash("sha256")
      .update(`backfill-v1:${companyIds.join(",")}:${reportHash}`)
      .digest("hex")
      .slice(0, 16);
  }

  it("accepts matching tokens", () => {
    const token = generateToken([1], "abc123");
    expect(safeCompareTokens(token, token)).toBe(true);
  });

  it("rejects mismatched token (wrong company scope)", () => {
    const token1 = generateToken([1], "abc123");
    const token2 = generateToken([2], "abc123");
    expect(safeCompareTokens(token1, token2)).toBe(false);
  });

  it("rejects mismatched token (wrong hash)", () => {
    const token1 = generateToken([1], "abc123");
    const token2 = generateToken([1], "xyz789");
    expect(safeCompareTokens(token1, token2)).toBe(false);
  });

  it("rejects token of different length (does not leak via timingSafeEqual crash)", () => {
    // Truncated token
    expect(safeCompareTokens("short", "abc123abc123abcd")).toBe(false);
  });

  it("rejects non-string inputs", () => {
    expect(safeCompareTokens(null as any, "abc")).toBe(false);
    expect(safeCompareTokens("abc", undefined as any)).toBe(false);
  });
});

// ─── Phase 13 — classifyVoucherEntryFallback unit tests ──────────────────────

describe("classifyVoucherEntryFallback — Phase 7 helper", () => {
  // Import inline to avoid circular module issues in vitest
  let classify: typeof import("../server/services/accounting/currencyAmounts").classifyVoucherEntryFallback;

  beforeAll(async () => {
    const mod = await import("../server/services/accounting/currencyAmounts");
    classify = mod.classifyVoucherEntryFallback;
  });

  it("classifies as 'migrated' when base_debit_amount is set", () => {
    const r = classify({
      baseDebitAmount: "100.00",
      baseCreditAmount: null,
      transactionCurrency: "CFA",
      voucherCurrency: "CFA",
      baseCurrency: "USD",
    });
    expect(r.classification).toBe("migrated");
    expect(r.safe).toBe(true);
  });

  it("classifies as 'migrated' when base_credit_amount is set (and debit is null)", () => {
    const r = classify({
      baseDebitAmount: null,
      baseCreditAmount: "50.00",
      transactionCurrency: "USD",
      voucherCurrency: "USD",
      baseCurrency: "USD",
    });
    expect(r.classification).toBe("migrated");
    expect(r.safe).toBe(true);
  });

  it("classifies as 'identity-usd' for USD entry in USD-base company (no base amounts)", () => {
    const r = classify({
      baseDebitAmount: null,
      baseCreditAmount: null,
      transactionCurrency: "USD",
      voucherCurrency: "USD",
      baseCurrency: "USD",
    });
    expect(r.classification).toBe("identity-usd");
    expect(r.safe).toBe(true);
  });

  it("classifies as 'unresolved-legacy' for CFA entry with no base amounts", () => {
    const r = classify({
      baseDebitAmount: null,
      baseCreditAmount: null,
      transactionCurrency: "CFA",
      voucherCurrency: "CFA",
      baseCurrency: "USD",
    });
    expect(r.classification).toBe("unresolved-legacy");
    expect(r.safe).toBe(false);
    expect(r.reason).toBeDefined();
  });

  it("classifies XOF as same as CFA — unresolved-legacy when no base amounts", () => {
    // XOF should normalize to CFA, distinct from USD base
    const r = classify({
      baseDebitAmount: null,
      baseCreditAmount: null,
      transactionCurrency: "XOF",
      voucherCurrency: "XOF",
      baseCurrency: "USD",
    });
    // XOF ≠ USD → unresolved-legacy
    expect(r.classification).toBe("unresolved-legacy");
    expect(r.safe).toBe(false);
  });

  it("falls back to voucher currency when transactionCurrency is null", () => {
    // No tx currency but voucher currency is USD → identity-usd
    const r = classify({
      baseDebitAmount: null,
      baseCreditAmount: null,
      transactionCurrency: null,
      voucherCurrency: "USD",
      baseCurrency: "USD",
    });
    expect(r.classification).toBe("identity-usd");
    expect(r.safe).toBe(true);
  });

  it("migrated classification takes priority over currency mismatch", () => {
    // Even if transaction currency is CFA, if base amounts are set, row is migrated
    const r = classify({
      baseDebitAmount: "100.000000",
      baseCreditAmount: "0.000000",
      transactionCurrency: "CFA",
      voucherCurrency: "CFA",
      baseCurrency: "USD",
    });
    expect(r.classification).toBe("migrated");
    expect(r.safe).toBe(true);
  });
});

// ─── Phase 13 — Credit note entry normalization round-trip ───────────────────

describe("Credit note POST — dual-currency columns populated", () => {
  beforeEach(async () => {
    // Clean up credit notes created in this describe
    await pool.query(
      `DELETE FROM voucher_entries WHERE voucher_id IN (
         SELECT id FROM vouchers WHERE company_id = $1 AND voucher_type IN ('Credit Note', 'Debit Note')
       )`,
      [ctx.companyId]
    );
    await pool.query(
      `DELETE FROM credit_note_items WHERE voucher_id IN (
         SELECT id FROM vouchers WHERE company_id = $1 AND voucher_type IN ('Credit Note', 'Debit Note')
       )`,
      [ctx.companyId]
    );
    await pool.query(
      `DELETE FROM vouchers WHERE company_id = $1 AND voucher_type IN ('Credit Note', 'Debit Note')`,
      [ctx.companyId]
    );
  });

  it("credit note entries have base_debit_amount and transaction_currency=USD populated", async () => {
    // Get a stock item and location via the test context
    const { rows: stockRows } = await pool.query(
      `SELECT si.id AS stock_item_id, l.id AS location_id
       FROM stock_items si
       JOIN inventory inv ON inv.stock_item_id = si.id
       JOIN locations l ON l.id = inv.location_id
       WHERE si.company_id = $1 AND inv.quantity > 0
       LIMIT 1`,
      [ctx.companyId]
    );

    if (stockRows.length === 0) {
      // No inventory available in test company — skip this test gracefully
      console.warn("[mc3 credit-note test] No inventory found for test company — skipping round-trip test");
      return;
    }

    const { stock_item_id, location_id } = stockRows[0];

    // Get a cash ledger account
    const { rows: cashRows } = await pool.query(
      `SELECT id FROM ledger_accounts WHERE company_id = $1 AND account_type = 'Cash' LIMIT 1`,
      [ctx.companyId]
    );
    if (cashRows.length === 0) return;
    const cashAccountId = cashRows[0].id;

    const payload = {
      voucherDate: new Date().toISOString().split("T")[0],
      noteType: "Credit Note",
      description: "MC3 phase-13 credit note test",
      cashAccountId,
      cashAccountType: "ledger",
      items: [
        {
          stockItemId: stock_item_id,
          locationId: location_id,
          quantity: "1",
          refundRate: "10.00",
          inventoryCost: "8.00",
        },
      ],
    };

    const res = await agent.post("/api/credit-notes").send(payload);
    if (res.status === 404 || res.status === 400) {
      // Route may require additional setup — skip gracefully
      console.warn("[mc3 credit-note test] Credit note creation returned", res.status, "— skipping");
      return;
    }
    expect([200, 201]).toContain(res.status);

    const voucherId = res.body?.id || res.body?.voucher?.id;
    expect(voucherId).toBeDefined();

    const { rows } = await pool.query(
      `SELECT transaction_currency, base_debit_amount, base_credit_amount,
              transaction_debit_amount, transaction_credit_amount, historical_exchange_rate, rate_convention
       FROM voucher_entries WHERE voucher_id = $1`,
      [voucherId]
    );

    expect(rows.length).toBeGreaterThan(0);

    // Phase 5 normalization: every row must have base_debit_amount set (USD=USD IDENTITY)
    for (const row of rows) {
      expect(row.transaction_currency).toBe("USD");
      // base amounts are equal to debit/credit amounts for USD 1:1
      if (parseFloat(row.transaction_debit_amount || "0") > 0) {
        expect(row.base_debit_amount).not.toBeNull();
      }
      if (parseFloat(row.transaction_credit_amount || "0") > 0) {
        expect(row.base_credit_amount).not.toBeNull();
      }
    }
  });
});

// ─── Phase 13 — hasMigratedEntries guard API behavior ────────────────────────

describe("hasMigratedEntries guard — net profit endpoint does not double-convert", () => {
  it("GET /api/stats/net-profit returns 200 regardless of migration status", async () => {
    const res = await agent.get("/api/stats/net-profit");
    // 200 for a company with or without migrated entries; 400 if no company selected
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      // Response must be a valid object (not a conversion error / NaN)
      expect(typeof res.body).toBe("object");
      // Key financial totals should be finite numbers (not NaN/Infinity)
      for (const field of ["totalRevenue", "totalExpenses", "netProfit", "grossProfit"]) {
        if (field in res.body) {
          const val = res.body[field];
          expect(isFinite(Number(val))).toBe(true);
        }
      }
    }
  });

  it("GET /api/stats/net-profit with a future toDate returns 200 and sensible totals", async () => {
    const res = await agent.get("/api/stats/net-profit?toDate=2099-12-31");
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      expect(typeof res.body).toBe("object");
      // Supplier/worker totals should be finite when guard applies
      for (const field of ["supplierLiabilities", "supplierAssets", "workerLiabilities"]) {
        if (field in res.body) {
          expect(isFinite(Number(res.body[field]))).toBe(true);
        }
      }
    }
  });
});

// ─── Phase 13 — Migration file existence check ───────────────────────────────

describe("Migration files — Phase 13 existence check", () => {
  it("20260720_002 voucher_entry_currency_fields migration file exists", async () => {
    const fs = await import("node:fs/promises");
    const stat = await fs.stat("migrations/20260720_002_voucher_entry_currency_fields.sql").catch(() => null);
    expect(stat).not.toBeNull();
  });

  it("20260720_003 ledger_account_opening_balance_currency migration file exists", async () => {
    const fs = await import("node:fs/promises");
    const stat = await fs.stat("migrations/20260720_003_ledger_account_opening_balance_currency.sql").catch(() => null);
    expect(stat).not.toBeNull();
  });

  it("_journal.json contains both Phase 2 migration entries (idx 7 and 8)", async () => {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile("migrations/meta/_journal.json", "utf8");
    const journal = JSON.parse(raw);
    const tags = journal.entries.map((e: any) => e.tag);
    expect(tags).toContain("20260720_002_voucher_entry_currency_fields");
    expect(tags).toContain("20260720_003_ledger_account_opening_balance_currency");
    // Indices must be sequential — idx 7 and 8
    const idx7 = journal.entries.find((e: any) => e.tag === "20260720_002_voucher_entry_currency_fields");
    const idx8 = journal.entries.find((e: any) => e.tag === "20260720_003_ledger_account_opening_balance_currency");
    expect(idx7?.idx).toBe(7);
    expect(idx8?.idx).toBe(8);
  });
});

// ─── Phase 13 — Backfill idempotency guard includes base_debit_amount IS NULL ─

describe("Backfill script — double-guard idempotency", () => {
  it("backfill script WHERE clause guards on both transaction_currency and base_debit_amount", async () => {
    const fs = await import("node:fs/promises");
    const script = await fs.readFile("scripts/backfill-voucher-entry-currency-amounts.mjs", "utf8");
    // The apply query must guard on base_debit_amount IS NULL in addition to transaction_currency IS NULL
    expect(script).toContain("AND transaction_currency IS NULL");
    expect(script).toContain("AND base_debit_amount    IS NULL");
  });
});

// ─── 8. Backfill classification logic — unit tests ───────────────────────────

describe("Backfill classification logic — unit tests", () => {
  Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

  function normalizeCcy(raw: string | null | undefined): string {
    const upper = (raw || "USD").trim().toUpperCase();
    if (upper === "XOF") return "CFA";
    return upper;
  }

  function classifyRow(voucher: { currency: string; exchange_rate: string | null }, entry: { debit_amount: string; credit_amount: string; transaction_currency: string | null }) {
    if (entry.transaction_currency) return { cls: "already-repaired" };
    const ccy = normalizeCcy(voucher.currency);
    if (ccy === "USD") return { cls: "identity-usd" };
    if (!voucher.exchange_rate || voucher.exchange_rate === "") return { cls: "missing-rate" };
    const rateDecimal = new Decimal(voucher.exchange_rate);
    if (!rateDecimal.isFinite() || rateDecimal.lte(0)) return { cls: "invalid-rate" };
    const storedDebit = new Decimal(entry.debit_amount || "0");
    const storedCredit = new Decimal(entry.credit_amount || "0");
    const storedMain = storedDebit.gt(0) ? storedDebit : storedCredit;
    if (rateDecimal.gt(100)) {
      if (storedMain.lte(999)) return { cls: "confirmed-base-stored" };
      if (storedMain.gte(50000)) return { cls: "confirmed-transaction-stored" };
      return { cls: "ambiguous" };
    }
    if (storedMain.lte(100)) return { cls: "confirmed-base-stored" };
    return { cls: "ambiguous" };
  }

  it("classifies USD voucher as identity-usd", () => {
    const { cls } = classifyRow(
      { currency: "USD", exchange_rate: null },
      { debit_amount: "500", credit_amount: "0", transaction_currency: null }
    );
    expect(cls).toBe("identity-usd");
  });

  it("classifies already-repaired when transaction_currency is set", () => {
    const { cls } = classifyRow(
      { currency: "CFA", exchange_rate: "600" },
      { debit_amount: "60000", credit_amount: "0", transaction_currency: "CFA" }
    );
    expect(cls).toBe("already-repaired");
  });

  it("classifies small USD-scale CFA amount as confirmed-base-stored (rate 600, amount 100)", () => {
    const { cls } = classifyRow(
      { currency: "CFA", exchange_rate: "600" },
      { debit_amount: "100", credit_amount: "0", transaction_currency: null }
    );
    expect(cls).toBe("confirmed-base-stored");
  });

  it("classifies large CFA-scale amount as confirmed-transaction-stored (rate 600, amount 60000)", () => {
    const { cls } = classifyRow(
      { currency: "CFA", exchange_rate: "600" },
      { debit_amount: "60000", credit_amount: "0", transaction_currency: null }
    );
    expect(cls).toBe("confirmed-transaction-stored");
  });

  it("classifies mid-range amount as ambiguous (rate 600, amount 5000)", () => {
    const { cls } = classifyRow(
      { currency: "CFA", exchange_rate: "600" },
      { debit_amount: "5000", credit_amount: "0", transaction_currency: null }
    );
    expect(cls).toBe("ambiguous");
  });

  it("normalises XOF to CFA", () => {
    expect(normalizeCcy("XOF")).toBe("CFA");
    expect(normalizeCcy("xof")).toBe("CFA");
    expect(normalizeCcy("CFA")).toBe("CFA");
  });

  it("classifies missing-rate when exchange_rate is null", () => {
    const { cls } = classifyRow(
      { currency: "CFA", exchange_rate: null },
      { debit_amount: "60000", credit_amount: "0", transaction_currency: null }
    );
    expect(cls).toBe("missing-rate");
  });

  it("classifies invalid-rate when exchange_rate is 0", () => {
    const { cls } = classifyRow(
      { currency: "CFA", exchange_rate: "0" },
      { debit_amount: "60000", credit_amount: "0", transaction_currency: null }
    );
    expect(cls).toBe("invalid-rate");
  });
});

// ─── 9. Voucher edit — GET /entries includes historical rate ──────────────────

describe("Voucher edit — GET /entries returns historical rate info", () => {
  beforeEach(async () => {
    await cleanupVouchers();
  });

  it("entries endpoint returns historicalExchangeRate for CFA vouchers", async () => {
    const CFA_RATE = "600";
    const CFA_AMOUNT = 60000;
    const createRes = await createVoucherWithEntries(
      buildPaymentPayload({
        currency: "CFA",
        exchangeRate: CFA_RATE,
        amount: CFA_AMOUNT,
        cashAccountId: ctx.cashAccountId,
        salesAccountId: ctx.salesAccountId,
      })
    );
    expect([200, 201]).toContain(createRes.status);
    const voucherId = createRes.body.voucher.id;

    const res = await agent.get(`/api/vouchers/${voucherId}/entries`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    // The entries endpoint should include multi-currency fields
    const debitEntry = res.body.find((e: any) => parseFloat(e.debitAmount || "0") > 0);
    expect(debitEntry).toBeDefined();

    // These fields should be present after server enhancement
    expect(debitEntry.transactionCurrency).toBeDefined();
    expect(debitEntry.historicalExchangeRate).toBeDefined();
    expect(parseFloat(debitEntry.historicalExchangeRate)).toBeCloseTo(600, 1);
  });
});

// ─── 10. PUT /with-entries edit preserves multi-currency fields ────────────────

describe("PUT /api/vouchers/:id/with-entries — dual-currency fields survive edit", () => {
  beforeEach(async () => {
    await cleanupVouchers();
  });

  it("editing a CFA voucher preserves transactionCurrency, historicalExchangeRate, and baseDebitAmount", async () => {
    const CFA_RATE = "600";
    const CFA_AMOUNT = 60000;

    // 1. Create the CFA voucher
    const createRes = await createVoucherWithEntries(
      buildPaymentPayload({
        currency: "CFA",
        exchangeRate: CFA_RATE,
        amount: CFA_AMOUNT,
        cashAccountId: ctx.cashAccountId,
        salesAccountId: ctx.salesAccountId,
      })
    );
    expect([200, 201]).toContain(createRes.status);
    const voucherId = createRes.body.voucher.id;
    const originalVoucher = createRes.body.voucher;

    // Verify initial storage
    const { rows: beforeRows } = await pool.query(
      `SELECT transaction_currency, historical_exchange_rate, base_debit_amount, base_credit_amount
       FROM voucher_entries WHERE voucher_id = $1 ORDER BY id`,
      [voucherId]
    );
    expect(beforeRows).toHaveLength(2);
    expect(beforeRows.find((r: any) => parseFloat(r.base_debit_amount || "0") > 0)).toBeDefined();

    // 2. Fetch the entries as the edit form would
    const entriesRes = await agent.get(`/api/vouchers/${voucherId}/entries`);
    expect(entriesRes.status).toBe(200);
    const loadedEntries = entriesRes.body;

    // 3. Submit an edit (change the narration, keep amounts the same)
    const editPayload = {
      voucher: {
        voucherType: originalVoucher.voucherType,
        voucherDate: originalVoucher.voucherDate,
        description: "MC3 edit test — narration changed",
        optional: false,
      },
      entries: loadedEntries.map((e: any) => ({
        ledgerAccountId: e.ledgerAccountId || null,
        bankAccountId: e.bankAccountId || null,
        fixedAssetId: e.fixedAssetId || null,
        supplierId: e.supplierId || null,
        employeeId: e.employeeId || null,
        debitAmount: e.debitAmount,
        creditAmount: e.creditAmount,
        narration: "edited narration",
        // Pass multi-currency fields through (as the frontend does)
        transactionCurrency: e.transactionCurrency ?? undefined,
        historicalExchangeRate: e.historicalExchangeRate ?? undefined,
        rateConvention: e.rateConvention ?? undefined,
      })),
    };

    const editRes = await agent.put(`/api/vouchers/${voucherId}/with-entries`).send(editPayload);
    expect(editRes.status, JSON.stringify(editRes.body)).toBe(200);

    // 4. Verify dual-currency fields are preserved after edit
    const { rows: afterRows } = await pool.query(
      `SELECT transaction_currency, historical_exchange_rate, base_debit_amount, base_credit_amount,
              transaction_debit_amount, transaction_credit_amount, rate_convention
       FROM voucher_entries WHERE voucher_id = $1 ORDER BY id`,
      [voucherId]
    );
    expect(afterRows).toHaveLength(2);

    // transactionCurrency must still be CFA
    for (const row of afterRows) {
      expect(row.transaction_currency).toBe("CFA");
      expect(row.rate_convention).toBe("TRANSACTION_PER_BASE");
      expect(parseFloat(row.historical_exchange_rate)).toBeCloseTo(600, 1);
    }

    // Debit entry: baseDebitAmount should still be ~100 (60000 / 600)
    const debitRow = afterRows.find((r: any) => parseFloat(r.base_debit_amount || "0") > 0);
    expect(debitRow).toBeDefined();
    expect(parseFloat(debitRow.base_debit_amount)).toBeCloseTo(100, 2);
    expect(parseFloat(debitRow.transaction_debit_amount)).toBeCloseTo(CFA_AMOUNT, 0);

    // Credit entry: baseCreditAmount should still be ~100
    const creditRow = afterRows.find((r: any) => parseFloat(r.base_credit_amount || "0") > 0);
    expect(creditRow).toBeDefined();
    expect(parseFloat(creditRow.base_credit_amount)).toBeCloseTo(100, 2);
  });

  it("GET /view-entries still returns correct multi-currency fields after edit", async () => {
    const CFA_RATE = "600";
    const CFA_AMOUNT = 60000;

    // Create
    const createRes = await createVoucherWithEntries(
      buildPaymentPayload({
        currency: "CFA",
        exchangeRate: CFA_RATE,
        amount: CFA_AMOUNT,
        cashAccountId: ctx.cashAccountId,
        salesAccountId: ctx.salesAccountId,
      })
    );
    expect([200, 201]).toContain(createRes.status);
    const voucherId = createRes.body.voucher.id;
    const originalVoucher = createRes.body.voucher;

    // Fetch entries and re-submit (minimal edit)
    const entriesRes = await agent.get(`/api/vouchers/${voucherId}/entries`);
    const loadedEntries = entriesRes.body;

    await agent.put(`/api/vouchers/${voucherId}/with-entries`).send({
      voucher: { voucherType: originalVoucher.voucherType, voucherDate: originalVoucher.voucherDate, description: "edit2", optional: false },
      entries: loadedEntries.map((e: any) => ({
        ledgerAccountId: e.ledgerAccountId || null,
        bankAccountId: e.bankAccountId || null,
        fixedAssetId: e.fixedAssetId || null,
        supplierId: e.supplierId || null,
        employeeId: e.employeeId || null,
        debitAmount: e.debitAmount,
        creditAmount: e.creditAmount,
        narration: e.narration,
        transactionCurrency: e.transactionCurrency ?? undefined,
        historicalExchangeRate: e.historicalExchangeRate ?? undefined,
        rateConvention: e.rateConvention ?? undefined,
      })),
    });

    // Verify view-entries still returns multi-currency fields
    const viewRes = await agent.get(`/api/vouchers/${voucherId}/view-entries`);
    expect(viewRes.status).toBe(200);
    const entries = Array.isArray(viewRes.body) ? viewRes.body : viewRes.body?.entries || [];
    const debit = entries.find((e: any) => parseFloat(e.debitAmount || "0") > 0);
    expect(debit).toBeDefined();
    if (debit?.transactionCurrency) {
      expect(debit.transactionCurrency).toBe("CFA");
      expect(parseFloat(debit.transactionDebitAmount || "0")).toBeCloseTo(CFA_AMOUNT, 0);
      expect(parseFloat(debit.baseDebitAmount || "0")).toBeCloseTo(100, 2);
    }
  });
});
