import type { Express } from "express";
import { logger } from "../lib/logger";
import { createHash } from "crypto";
import Decimal from "decimal.js";
import { db, pool } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate } from "./_helpers";
import {
  inventory,
  stockItems,
  stockGroups,
  stockItemCodeAliases,
  stockItemLocationPrices,
  stockTransferVouchers,
  stockTransferItems,
  stockAdjustmentVouchers,
  stockAdjustmentItems,
  containers,
  containerOffloads,
  containerOffloadItems,
  containerSales,
  containerCharges,
  containerTrackingImportRowSchema,
  updateContainerTrackingSchema,
  bankAccounts,
  fixedAssets,
  insertBankAccountSchema,
  insertFixedAssetSchema,
  insertStockGroupSchema,
  insertStockItemSchema,
  insertStockItemCodeAliasSchema,
  insertContainerSchema,
  offloadRequestSchema,
  purchaseOrders,
  poLineItems,
  insertContainerSaleSchema,
  vouchers,
  voucherEntries,
  salesItems,
  suppliers,
  customers,
  locations,
  employees,
  userLocations,
  auditLog,
  interCompanyTransfers,
  insertInterCompanyTransferSchema,
  ledgerAccounts,
  exchangeRates,
  FEATURE_KEYS,
} from "@shared/schema";
import {
  eq,
  and,
  or,
  desc,
  asc,
  lt,
  gt,
  ne,
  inArray,
  sql,
  isNull,
  isNotNull,
  not,
  gte,
  lte,
  like,
  ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory } from "../inventoryHelper";

export function registerBankAssetRoutes(app: Express) {
  app.get("/api/bank-accounts", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const accounts = await storage.getAllBankAccounts(req.session.currentCompanyId);
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/bank-accounts", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const parsed = insertBankAccountSchema.parse(req.body);

      // Check for duplicate code
      const existing = await storage.getBankAccountByCode(parsed.code);
      if (existing) {
        return res.status(400).json({ message: "Bank account code already exists" });
      }

      // Validate opening balance amount and side must both be present or both absent
      const hasBalance = parsed.openingBalance && parseFloat(parsed.openingBalance) !== 0;
      const hasSide = !!parsed.openingBalanceSide;

      if (hasBalance && !hasSide) {
        return res.status(400).json({ message: "Opening balance requires Dr/Cr side" });
      }

      if (!hasBalance && hasSide) {
        return res.status(400).json({ message: "Dr/Cr side requires opening balance amount" });
      }

      // Validate linked ledger is Bank or Cash type
      if (parsed.linkedLedgerId) {
        const allLedgers = await storage.getAllLedgerAccounts(req.session.currentCompanyId!);
        const linkedLedger = allLedgers.find((l) => l.id === parsed.linkedLedgerId);

        if (!linkedLedger) {
          return res.status(400).json({ message: "Linked ledger account not found" });
        }

        if (linkedLedger.accountType !== "Bank" && linkedLedger.accountType !== "Cash") {
          return res.status(400).json({
            message: `Linked ledger must be Bank or Cash type. Found: ${linkedLedger.accountType}`,
          });
        }
      }

      const account = await storage.createBankAccount(parsed);
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "create",
          tableName: "bank_accounts",
          recordId: account.id,
          recordIdentifier: account.name,
          changes: {
            name: { old: undefined, new: account.name },
            code: { old: undefined, new: account.code },
            bankName: { old: undefined, new: (account as any).bankName || null },
            accountNumber: { old: undefined, new: (account as any).accountNumber || null },
            openingBalance: { old: undefined, new: account.openingBalance || "0" },
            openingBalanceSide: { old: undefined, new: account.openingBalanceSide || null },
          },
        });
      } catch {
        /* non-fatal */
      }
      res.status(201).json(account);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/bank-accounts/:id", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const id = parseInt(req.params.id);
      const existingBankAcc = await storage.getBankAccountById(id, req.session.currentCompanyId);
      const parsed = insertBankAccountSchema.partial().parse(req.body);

      // Validate opening balance amount and side must both be present or both absent
      const hasBalance = parsed.openingBalance && parseFloat(parsed.openingBalance) !== 0;
      const hasSide = !!parsed.openingBalanceSide;

      if (hasBalance && !hasSide) {
        return res.status(400).json({ message: "Opening balance requires Dr/Cr side" });
      }

      if (!hasBalance && hasSide) {
        return res.status(400).json({ message: "Dr/Cr side requires opening balance amount" });
      }

      const account = await storage.updateBankAccount(id, parsed, req.session.currentCompanyId);
      try {
        if (existingBankAcc) {
          const _bankChanges: Record<string, { old?: any; new?: any }> = {};
          for (const _f of ["name", "code", "openingBalance", "openingBalanceSide"] as const) {
            if (String((existingBankAcc as any)[_f] ?? "") !== String((account as any)[_f] ?? "")) {
              _bankChanges[_f] = { old: (existingBankAcc as any)[_f], new: (account as any)[_f] };
            }
          }
          await logAudit({
            userId: req.session.userId!,
            username: (req.session as any).username || "unknown",
            companyId: req.session.currentCompanyId!,
            action: "update",
            tableName: "bank_accounts",
            recordId: account.id,
            recordIdentifier: account.name,
            changes: _bankChanges,
          });
        }
      } catch {
        /* non-fatal */
      }
      res.json(account);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/bank-accounts/:id", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const id = parseInt(req.params.id);
      const existingBankAccDel = await storage.getBankAccountById(id, req.session.currentCompanyId);
      await storage.deleteBankAccount(id, req.session.currentCompanyId);
      try {
        if (existingBankAccDel) {
          await logAudit({
            userId: req.session.userId!,
            username: (req.session as any).username || "unknown",
            companyId: req.session.currentCompanyId!,
            action: "delete",
            tableName: "bank_accounts",
            recordId: existingBankAccDel.id,
            recordIdentifier: existingBankAccDel.name,
            changes: {
              name: { old: existingBankAccDel.name, new: null },
              code: { old: existingBankAccDel.code, new: null },
              openingBalance: { old: existingBankAccDel.openingBalance || "0", new: null },
            },
          });
        }
      } catch {
        /* non-fatal */
      }
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Cash/bank account revaluation — live translation at current rate vs. historical base.
  //
  // For each Bank/Cash ledger account the response includes:
  //   nativeBalancesByCurrency: Record<currency, string> — net native balance per currency
  //   historicalBaseBalance:    sum of historical USD base amounts + opening balance
  //   currentRate:              CFA per USD (or "1.0000000000" for USD-only accounts)
  //   currentTranslatedBaseBalance: native balances translated at current rate
  //   translationDifference:    currentTranslated - historical (unrealised FX gain/loss)
  //   openingBalanceCurrencyUnresolved: true when opening-balance currency metadata is absent
  //
  // Phases 2+3: groups SQL by (ledger_account_id, currency) instead of MAX(currency),
  // and uses Decimal.js throughout — no parseFloat/native-JS arithmetic.
  app.get("/api/bank-accounts/revaluation", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Fetch all Bank/Cash ledger accounts, including Phase-4 opening-balance metadata.
      const cashBankAccts = await db
        .select({
          id: ledgerAccounts.id,
          name: ledgerAccounts.name,
          code: ledgerAccounts.code,
          accountType: ledgerAccounts.accountType,
          openingBalance: ledgerAccounts.openingBalance,
          openingBalanceSide: ledgerAccounts.openingBalanceSide,
          openingBalanceCurrency: ledgerAccounts.openingBalanceCurrency,
          openingBalanceHistoricalRate: ledgerAccounts.openingBalanceHistoricalRate,
          openingBalanceBaseAmount: ledgerAccounts.openingBalanceBaseAmount,
        })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.companyId, companyId),
            isNull(ledgerAccounts.deletedAt),
            or(eq(ledgerAccounts.accountType, "Bank"), eq(ledgerAccounts.accountType, "Cash")),
          ),
        )
        .execute();

      if (cashBankAccts.length === 0) {
        return res.json({ accounts: [], currentCfaPerUsd: null });
      }

      const accountIds = cashBankAccts.map((a) => a.id);

      // Get the latest CFA/USD exchange rate (CFA per 1 USD).
      const rateRows = await db
        .select({ rate: exchangeRates.rate })
        .from(exchangeRates)
        .where(
          and(
            eq(exchangeRates.companyId, companyId),
            or(
              and(eq(exchangeRates.fromCurrency, "USD"), eq(exchangeRates.toCurrency, "CFA")),
              and(eq(exchangeRates.fromCurrency, "USD"), eq(exchangeRates.toCurrency, "XOF")),
            ),
          ),
        )
        .orderBy(desc(exchangeRates.effectiveDate))
        .limit(1)
        .execute();
      const currentCfaPerUsd =
        rateRows.length > 0 && rateRows[0].rate ? new Decimal(rateRows[0].rate) : null;

      // Phase 2: aggregate per (ledger_account_id, currency) so that mixed-currency accounts
      // (e.g. an account with both USD and CFA deposits) are handled correctly.
      // Legacy rows with NULL transaction_currency are treated as 'USD'.
      const aggRaw = await pool.query<{
        ledger_account_id: string;
        entry_currency: string;
        native_debit: string;
        native_credit: string;
        hist_base_debit: string;
        hist_base_credit: string;
      }>(
        `SELECT ve.ledger_account_id,
                COALESCE(ve.transaction_currency, 'USD') AS entry_currency,
                COALESCE(SUM(ve.transaction_debit_amount::numeric),  0) AS native_debit,
                COALESCE(SUM(ve.transaction_credit_amount::numeric), 0) AS native_credit,
                COALESCE(SUM(COALESCE(ve.base_debit_amount,  ve.debit_amount)::numeric),  0) AS hist_base_debit,
                COALESCE(SUM(COALESCE(ve.base_credit_amount, ve.credit_amount)::numeric), 0) AS hist_base_credit
         FROM voucher_entries ve
         JOIN vouchers v ON ve.voucher_id = v.id
         WHERE v.company_id = $1
           AND v.optional   = false
           AND v.deleted_at IS NULL
           AND ve.ledger_account_id = ANY($2::int[])
         GROUP BY ve.ledger_account_id, COALESCE(ve.transaction_currency, 'USD')`,
        [companyId, accountIds],
      );

      // Build per-account currency buckets.
      type CurrencyBucket = {
        nativeDebit: Decimal;
        nativeCredit: Decimal;
        histBaseDebit: Decimal;
        histBaseCredit: Decimal;
      };
      const bucketMap = new Map<number, Map<string, CurrencyBucket>>();
      for (const row of aggRaw.rows) {
        const accId = parseInt(row.ledger_account_id);
        const ccy = row.entry_currency;
        if (!bucketMap.has(accId)) bucketMap.set(accId, new Map());
        bucketMap.get(accId)!.set(ccy, {
          nativeDebit: new Decimal(row.native_debit),
          nativeCredit: new Decimal(row.native_credit),
          histBaseDebit: new Decimal(row.hist_base_debit),
          histBaseCredit: new Decimal(row.hist_base_credit),
        });
      }

      const accounts = cashBankAccts.map((acc) => {
        const buckets = bucketMap.get(acc.id) || new Map<string, CurrencyBucket>();

        // ── Opening balance ─────────────────────────────────────────────────────
        // Phase 4: when openingBalanceCurrency + openingBalanceBaseAmount are set,
        // use them for accurate historical-base contribution and native bucketing.
        // Legacy rows (both NULL) fall back to treating the opening balance as USD
        // and flag openingBalanceCurrencyUnresolved so the UI can warn the operator.
        const openingRaw = new Decimal(acc.openingBalance || "0");
        const openingSide = acc.openingBalanceSide === "Cr" ? -1 : 1;
        const openingSignedRaw = openingRaw.times(openingSide);

        let openingBaseContrib: Decimal;
        let openingNativeCurrency: string;
        let openingNativeAmount: Decimal;
        let openingBalanceCurrencyUnresolved = false;

        if (acc.openingBalanceCurrency && acc.openingBalanceBaseAmount != null) {
          // Phase 4 path: explicit currency + base amount recorded.
          const obBase = new Decimal(acc.openingBalanceBaseAmount);
          openingBaseContrib = acc.openingBalanceSide === "Cr" ? obBase.neg() : obBase;
          openingNativeCurrency = acc.openingBalanceCurrency;
          openingNativeAmount = openingSignedRaw;
        } else if (openingRaw.isZero()) {
          openingBaseContrib = new Decimal(0);
          openingNativeCurrency = "USD";
          openingNativeAmount = new Decimal(0);
        } else {
          // Legacy: currency unknown → treat as USD, flag as unresolved.
          openingBalanceCurrencyUnresolved = true;
          openingBaseContrib = openingSignedRaw;
          openingNativeCurrency = "USD";
          openingNativeAmount = openingSignedRaw;
        }

        // ── Native balances per currency ────────────────────────────────────────
        // Merge opening-balance native amount + transaction-entry native amounts.
        const nativeBalancesByCurrency: Record<string, string> = {};

        if (!openingNativeAmount.isZero()) {
          nativeBalancesByCurrency[openingNativeCurrency] = openingNativeAmount
            .toDecimalPlaces(6)
            .toFixed(6);
        }
        for (const [ccy, bucket] of buckets) {
          const nativeNet = bucket.nativeDebit.minus(bucket.nativeCredit);
          const prev = nativeBalancesByCurrency[ccy]
            ? new Decimal(nativeBalancesByCurrency[ccy])
            : new Decimal(0);
          const total = prev.plus(nativeNet);
          if (!total.isZero()) {
            nativeBalancesByCurrency[ccy] = total.toDecimalPlaces(6).toFixed(6);
          }
        }
        // Remove zero-balance entries.
        for (const k of Object.keys(nativeBalancesByCurrency)) {
          if (new Decimal(nativeBalancesByCurrency[k]).isZero()) {
            delete nativeBalancesByCurrency[k];
          }
        }

        // ── Historical base balance (USD) ───────────────────────────────────────
        let historicalBaseBalance = openingBaseContrib;
        for (const [, bucket] of buckets) {
          historicalBaseBalance = historicalBaseBalance
            .plus(bucket.histBaseDebit)
            .minus(bucket.histBaseCredit);
        }

        // ── Current translated base balance ─────────────────────────────────────
        // Translate each native-currency bucket at the current rate:
        //   USD / other base-currency  → 1:1
        //   CFA                        → native / currentCfaPerUsd
        // This is the mark-to-market value — for display only, never for historical accounting.
        let currentTranslatedBaseBalance: Decimal;
        let translationDifference: Decimal;
        let currentRate: Decimal;

        if (currentCfaPerUsd && currentCfaPerUsd.gt(0)) {
          let translatedSum = new Decimal(0);
          for (const [ccy, nativeStr] of Object.entries(nativeBalancesByCurrency)) {
            const native = new Decimal(nativeStr);
            if (ccy === "CFA" || ccy === "XOF") {
              translatedSum = translatedSum.plus(native.div(currentCfaPerUsd));
            } else {
              translatedSum = translatedSum.plus(native);
            }
          }
          currentTranslatedBaseBalance = translatedSum;
          currentRate = currentCfaPerUsd;
          translationDifference = currentTranslatedBaseBalance.minus(historicalBaseBalance);
        } else {
          // No CFA rate — everything is USD-equivalent, no translation effect.
          currentRate = new Decimal(1);
          currentTranslatedBaseBalance = historicalBaseBalance;
          translationDifference = new Decimal(0);
        }

        return {
          id: acc.id,
          name: acc.name,
          code: acc.code,
          accountType: acc.accountType,
          nativeBalancesByCurrency,
          historicalBaseBalance: historicalBaseBalance.toDecimalPlaces(6).toFixed(6),
          currentRate: currentRate.toDecimalPlaces(10).toFixed(10),
          currentTranslatedBaseBalance: currentTranslatedBaseBalance
            .toDecimalPlaces(6)
            .toFixed(6),
          translationDifference: translationDifference.toDecimalPlaces(6).toFixed(6),
          openingBalanceCurrencyUnresolved,
        };
      });

      res.json({
        accounts,
        currentCfaPerUsd: currentCfaPerUsd
          ? currentCfaPerUsd.toDecimalPlaces(10).toFixed(10)
          : null,
      });
    } catch (error: any) {
      logger.error("Bank revaluation error:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  // Fixed Assets
  app.get("/api/fixed-assets", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const assets = await storage.getAllFixedAssets(companyId);

      // Compute historical cost/depreciation from voucher entries using base currency amounts.
      // COALESCE(base_debit_amount, debit_amount): historical USD cost (post-backfill); falls
      // back to debit_amount for legacy rows.
      const assetIds = assets.map((a) => a.id);
      const assetHistMap = new Map<number, { historicalCostBase: number; historicalDepreciationBase: number }>();
      if (assetIds.length > 0) {
        const histRows = await pool.query<{
          fixed_asset_id: string;
          hist_debit: string;
          hist_credit: string;
        }>(
          `SELECT ve.fixed_asset_id,
                  COALESCE(SUM(COALESCE(ve.base_debit_amount,  ve.debit_amount)::numeric),  0) AS hist_debit,
                  COALESCE(SUM(COALESCE(ve.base_credit_amount, ve.credit_amount)::numeric), 0) AS hist_credit
           FROM voucher_entries ve
           JOIN vouchers v ON ve.voucher_id = v.id
           WHERE ve.fixed_asset_id = ANY($1::int[])
             AND v.deleted_at IS NULL
             AND v.optional = false
           GROUP BY ve.fixed_asset_id`,
          [assetIds],
        );
        for (const row of histRows.rows) {
          assetHistMap.set(parseInt(row.fixed_asset_id), {
            historicalCostBase: parseFloat(row.hist_debit),
            historicalDepreciationBase: parseFloat(row.hist_credit),
          });
        }
      }

      // Transform to match frontend expectations (assetCode, assetName) and add historical fields
      const transformedAssets = assets.map((asset) => {
        const hist = assetHistMap.get(asset.id) || { historicalCostBase: 0, historicalDepreciationBase: 0 };
        return {
          ...asset,
          assetCode: asset.code,
          assetName: asset.name,
          historicalCostBase: hist.historicalCostBase,
          historicalDepreciationBase: hist.historicalDepreciationBase,
        };
      });
      res.json(transformedAssets);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/fixed-assets", requireAuth, async (req, res) => {
    try {
      const parsed = insertFixedAssetSchema.parse(req.body);

      // Check for duplicate code
      const existing = await storage.getFixedAssetByCode(parsed.code);
      if (existing) {
        return res.status(400).json({ message: "Fixed asset code already exists" });
      }

      // Validate useful life is required when depreciation method is not "None"
      if (parsed.depreciationMethod !== "None" && (!parsed.usefulLife || parsed.usefulLife <= 0)) {
        return res.status(400).json({
          message: "Useful life (years) is required and must be greater than 0 when depreciation method is not 'None'",
        });
      }

      const asset = await storage.createFixedAsset(parsed);
      res.status(201).json(asset);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/fixed-assets/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid asset ID" });

      // Check for linked voucher entries
      const entryCheck = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM voucher_entries WHERE fixed_asset_id = ${id}`
      );
      const entryCount = parseInt((entryCheck.rows[0] as any)?.cnt || "0");
      if (entryCount > 0) {
        return res.status(400).json({
          message: `Cannot delete: this asset has ${entryCount} voucher entry/entries. Remove related transactions first.`,
        });
      }

      const [deleted] = await db
        .delete(fixedAssets)
        .where(and(eq(fixedAssets.id, id), eq(fixedAssets.companyId, companyId)))
        .returning({ id: fixedAssets.id });

      if (!deleted) return res.status(404).json({ message: "Fixed asset not found" });
      res.json({ message: "Fixed asset deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // PO Import - Parse and Preview Excel
  app.post("/api/po-import/parse", requireAuth, upload.single("file"), async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const workbook = await readExcel(req.file.buffer);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rawData = sheetToJson(worksheet);

      if (rawData.length === 0) {
        return res.status(400).json({ message: "Excel file is empty" });
      }

      // Calculate file hash for idempotency
      const fileHash = createHash("md5").update(req.file.buffer).digest("hex");

      // Check if file already imported
      const existingImport = await storage.getImportLogByHash(fileHash);
      if (existingImport) {
        return res.status(400).json({
          message: "This file has already been imported",
          importedAt: existingImport.createdAt,
          containerId: existingImport.containerId,
        });
      }

      // Parse and structure the data
      const rows = rawData as any[];
      const errors: string[] = [];
      const itemRows: any[] = [];
      const chargeRows: any[] = [];

      // Get all stock items for barcode/name lookup
      const allStockItems = await storage.getAllStockItems(req.session.currentCompanyId!);

      // Helper function to find column value with flexible naming
      const getColumnValue = (row: any, ...possibleNames: string[]): string | undefined => {
        for (const name of possibleNames) {
          if (row[name] !== undefined && row[name] !== null && row[name] !== "") {
            return row[name];
          }
        }
        return undefined;
      };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;

        // Check if it's a charge row or item row
        const chargeType = getColumnValue(row, "Charge_Type", "Charge Type");
        const chargeAmount = getColumnValue(row, "Charge_Amount", "Charge Amount");
        if (chargeType && chargeAmount) {
          chargeRows.push({
            rowNum,
            chargeType,
            amount: parseFloat(chargeAmount),
            containerNumber: getColumnValue(row, "Container_Number", "Container Number") || "",
          });
        } else if (
          getColumnValue(row, "Item_Barcode", "Item Barcode") ||
          getColumnValue(row, "Item_Name", "Item Name")
        ) {
          let stockItem = null;
          const itemBarcode = getColumnValue(row, "Item_Barcode", "Item Barcode");
          const itemNameValue = getColumnValue(row, "Item_Name", "Item Name");
          let itemName = itemNameValue || "";

          // Try to find stock item by code/alias or name (for preview purposes only - validation happens in validate step)
          if (itemBarcode) {
            stockItem = await storage.getStockItemByCodeOrAlias(itemBarcode, req.session.currentCompanyId!);
            if (stockItem) {
              itemName = stockItem.name;
            }
          } else if (itemNameValue) {
            stockItem = allStockItems.find((item) => item.name === itemNameValue);
          }

          const quantity = parseFloat(getColumnValue(row, "Quantity") || "0");
          const rate = parseFloat(getColumnValue(row, "Rate") || "0");

          if (quantity === 0 || isNaN(quantity)) {
            errors.push(`Row ${rowNum}: Quantity must be a non-zero number (negative quantities are allowed)`);
            continue;
          }

          if (rate === undefined || rate < 0) {
            errors.push(`Row ${rowNum}: Rate must be non-negative`);
            continue;
          }

          itemRows.push({
            rowNum,
            poNumber: getColumnValue(row, "PO_Number", "PO Number") || "",
            containerNumber: getColumnValue(row, "Container_Number", "Container Number") || "",
            supplierCode: getColumnValue(row, "Supplier_Code", "Supplier Code") || "",
            barcode: itemBarcode || null,
            stockItemId: stockItem?.id || null,
            itemName: itemName,
            quantity: quantity,
            rate: rate,
            lineTotal: quantity * rate,
            currency: getColumnValue(row, "Currency") || "USD",
            freight: parseFloat(getColumnValue(row, "Freight") || "0"),
            surcharge: parseFloat(getColumnValue(row, "Surcharge") || "0"),
            fumigation: parseFloat(getColumnValue(row, "Fumigation") || "0"),
            discount: parseFloat(getColumnValue(row, "Discount") || "0"),
            documentCharges: parseFloat(getColumnValue(row, "Document_Charges", "Document Charges") || "0"),
          });
        }
      }

      // Basic structural errors only (validation of item existence happens in validate step)
      if (errors.length > 0) {
        return res.status(400).json({ message: "Validation errors", errors });
      }

      if (itemRows.length === 0) {
        return res.status(400).json({ message: "No valid item rows found" });
      }

      // Group by container
      const containerGroups = itemRows.reduce(
        (acc, row) => {
          if (!acc[row.containerNumber]) {
            acc[row.containerNumber] = {
              containerNumber: row.containerNumber,
              supplierCode: row.supplierCode,
              items: [],
              pos: new Map(),
            };
          }

          const container = acc[row.containerNumber];
          container.items.push(row);

          if (!container.pos.has(row.poNumber)) {
            container.pos.set(row.poNumber, []);
          }
          container.pos.get(row.poNumber)!.push(row);

          return acc;
        },
        {} as Record<string, any>
      );

      // Calculate container totals
      const preview = Object.values(containerGroups).map((container: any) => {
        const itemsTotal = container.items.reduce((sum: number, item: any) => sum + item.lineTotal, 0);

        // Get charges from rows or aggregate from columns
        const charges = {
          freight: 0,
          surcharge: 0,
          fumigation: 0,
          discount: 0,
          documentCharges: 0,
        };

        // Check if charges are in separate rows
        const containerCharges = chargeRows.filter((c) => c.containerNumber === container.containerNumber);
        if (containerCharges.length > 0) {
          containerCharges.forEach((charge) => {
            const chargeType = (charge.chargeType || "").toLowerCase().replace(/[_\s]/g, "");
            if (chargeType === "freight") charges.freight = charge.amount;
            else if (chargeType === "surcharge") charges.surcharge = charge.amount;
            else if (chargeType === "fumigation") charges.fumigation = charge.amount;
            else if (chargeType === "discount") charges.discount = charge.amount;
            else if (chargeType.includes("document")) charges.documentCharges = charge.amount;
          });
        } else {
          // Aggregate from item row columns
          container.items.forEach((item: any) => {
            charges.freight += item.freight;
            charges.surcharge += item.surcharge;
            charges.fumigation += item.fumigation;
            charges.discount += item.discount;
            charges.documentCharges += item.documentCharges;
          });
        }

        const chargesTotal =
          charges.freight + charges.surcharge + charges.fumigation + charges.documentCharges - charges.discount;
        const grandTotal = itemsTotal + chargesTotal;

        return {
          containerNumber: container.containerNumber,
          supplierCode: container.supplierCode,
          itemsCount: container.items.length,
          posCount: container.pos.size,
          itemsTotal,
          charges,
          chargesTotal,
          grandTotal,
          items: container.items,
          pos: Array.from(container.pos.keys()),
        };
      });

      res.json({
        fileHash,
        fileName: req.file.originalname,
        rowCount: rows.length,
        preview,
      });
    } catch (error: any) {
      logger.error("PO Import parse error:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  // PO Import - Validate data before import
}
