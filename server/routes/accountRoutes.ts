import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import {
  resolveParentCompanyId,
  getSupplierBalanceForContext,
} from "./helpers/supplierBalanceHelpers";
import {
  bankAccounts,
  vouchers,
  voucherEntries,
  customers,
  customerBalances,
  customerOrders,
  factorySuppliers,
  factoryContainers,
  factorySupplierPayments,
} from "@shared/schema";
import { eq, and, or, desc, inArray, sql, isNull, isNotNull, ilike } from "drizzle-orm";
import { getClientDate } from "../lib/dateUtils";
import { registerAccountTransactionRoutes } from "./accountTransactionRoutes";
import { registerAccountStatementRoutes } from "./accountStatementRoutes";

export function registerAccountRoutes(app: Express) {
  app.get("/api/accounts/all", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const companyId = req.session.currentCompanyId;

      // Fire all independent lookups in parallel instead of serially.
      // getAllSuppliers is always fetched; for factory companies the result is
      // discarded — the wasted query is small compared to the serial latency saved.
      const [currentCompany, ledgers, banks, assets, employees, allSuppliers, companyCustomers] = await Promise.all([
        storage.getCompanyById(companyId),
        storage.getAllLedgerAccounts(companyId),
        storage.getAllBankAccounts(companyId),
        storage.getAllFixedAssets(companyId),
        storage.getAllEmployees(companyId),
        storage.getAllSuppliers(),
        storage.getAllCustomers(companyId),
      ]);
      const isFactoryCompany = currentCompany?.companyType === "factory";
      const isPropertiesCompany = currentCompany?.companyType === "properties";
      const suppliers = isFactoryCompany || isPropertiesCompany ? [] : allSuppliers;

      // Build a map of ledgerAccountId → customer opening balance.
      // For customer-linked ledger accounts, the customer record is the
      // authoritative source of opening balance — the ledger account's own
      // openingBalance may have drifted (e.g. edited directly in Accounts page).
      const customerObMap = new Map<number, { openingBalance: string; openingBalanceSide: string | null }>();
      for (const cust of companyCustomers) {
        if (cust.ledgerAccountId) {
          customerObMap.set(cust.ledgerAccountId, {
            openingBalance: cust.openingBalance ?? "0",
            openingBalanceSide: cust.openingBalanceSide ?? "Dr",
          });
        }
      }

      // For factory companies, compute a combined balance for customer-linked ledger accounts
      // using the same multi-source formula as /api/factory/customers so both pages agree.
      // Formula: OB + finalized order totals + customerBalances non-INVOICE + voucherNet (excl CHARGE-*)
      const customerLedgerOverrides = new Map<number, { balance: string; balanceSide: string }>();
      if (isFactoryCompany) {
        const linkedCustomers = companyCustomers.filter((c) => c.ledgerAccountId);
        if (linkedCustomers.length > 0) {
          const linkedCustIds = linkedCustomers.map((c) => c.id);
          const linkedLedgerIds = linkedCustomers.map((c) => c.ledgerAccountId!);

          const [salesRows, cbRows, lVoucherRows, cVoucherRows] = await Promise.all([
            db
              .select({
                customerId: customerOrders.customerId,
                total: sql<string>`COALESCE(SUM(CAST(${customerOrders.grandTotal} AS numeric)), 0)`,
              })
              .from(customerOrders)
              .where(
                and(
                  inArray(customerOrders.customerId, linkedCustIds),
                  eq(customerOrders.companyId, companyId),
                  eq(customerOrders.status, "FINALIZED")
                )
              )
              .groupBy(customerOrders.customerId),

            db
              .select({
                customerId: customerBalances.customerId,
                net: sql<string>`COALESCE(SUM(CAST(${customerBalances.debitAmount} AS numeric) - CAST(${customerBalances.creditAmount} AS numeric)), 0)`,
              })
              .from(customerBalances)
              .where(
                and(
                  inArray(customerBalances.customerId, linkedCustIds),
                  eq(customerBalances.companyId, companyId),
                  sql`${customerBalances.referenceType} IS DISTINCT FROM 'INVOICE'`
                )
              )
              .groupBy(customerBalances.customerId),

            db
              .select({
                ledgerAccountId: voucherEntries.ledgerAccountId,
                net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
              })
              .from(voucherEntries)
              .innerJoin(
                vouchers,
                and(
                  eq(voucherEntries.voucherId, vouchers.id),
                  eq(vouchers.companyId, companyId),
                  eq(vouchers.optional, false),
                  isNull(vouchers.deletedAt),
                  sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`
                )
              )
              .where(inArray(voucherEntries.ledgerAccountId as any, linkedLedgerIds))
              .groupBy(voucherEntries.ledgerAccountId),

            db
              .select({
                customerId: voucherEntries.customerId,
                net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
              })
              .from(voucherEntries)
              .innerJoin(
                vouchers,
                and(
                  eq(voucherEntries.voucherId, vouchers.id),
                  eq(vouchers.companyId, companyId),
                  eq(vouchers.optional, false),
                  isNull(vouchers.deletedAt),
                  sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`
                )
              )
              .where(
                and(inArray(voucherEntries.customerId as any, linkedCustIds), isNull(voucherEntries.ledgerAccountId))
              )
              .groupBy(voucherEntries.customerId),
          ]);

          const salesMap = new Map(salesRows.map((r) => [r.customerId!, parseFloat(r.total || "0")]));
          const nonInvMap = new Map(cbRows.map((r) => [r.customerId!, parseFloat(r.net || "0")]));
          const vNetByLedger = new Map(
            lVoucherRows.filter((r) => r.ledgerAccountId).map((r) => [r.ledgerAccountId!, parseFloat(r.net || "0")])
          );
          const vNetByCustomer = new Map(
            cVoucherRows.filter((r) => r.customerId).map((r) => [r.customerId!, parseFloat(r.net || "0")])
          );

          for (const cust of linkedCustomers) {
            const salesTotal = salesMap.get(cust.id) ?? 0;
            const nonInvNet = nonInvMap.get(cust.id) ?? 0;
            const voucherNet = (vNetByLedger.get(cust.ledgerAccountId!) ?? 0) + (vNetByCustomer.get(cust.id) ?? 0);
            const ob = parseFloat(cust.openingBalance || "0");
            const obSide = cust.openingBalanceSide || "Dr";
            const total = (obSide === "Dr" ? ob : -ob) + salesTotal + nonInvNet + voucherNet;
            customerLedgerOverrides.set(cust.ledgerAccountId!, {
              balance: Math.abs(total).toFixed(2),
              balanceSide: total >= 0 ? "Dr" : "Cr",
            });
          }
        }
      }

      // The "Factory Worker Advances" ledger account's own debit/credit balance drifts
      // from reality because advance repayments/deductions aren't always posted back to
      // it (see the same guard in the Factory Net Position route). factory_worker_advances
      // .remaining_balance is the authoritative source (also used by the Payroll & Benefits
      // "Advances" KPI and Net Position), so override this account's displayed balance here
      // too — otherwise the Accounts page shows a stale figure that doesn't match those pages.
      if (isFactoryCompany) {
        const workerAdvLedger = ledgers.find(
          (a) => (a.name || "").toLowerCase().replace(/\s+/g, " ").trim() === "factory worker advances"
        );
        if (workerAdvLedger) {
          const workerAdvRes = await db.execute(sql`
            SELECT COALESCE(SUM(remaining_balance::numeric), 0) AS total
            FROM   factory_worker_advances
            WHERE  company_id = ${companyId}
              AND  remaining_balance > 0
          `);
          const workerAdvRow = ((workerAdvRes as any).rows ?? (workerAdvRes as any))[0] ?? {};
          const workerAdvancesValue = parseFloat(String(workerAdvRow.total ?? "0")) || 0;
          customerLedgerOverrides.set(workerAdvLedger.id, {
            balance: workerAdvancesValue.toFixed(2),
            balanceSide: "Dr",
          });
        }
      }

      // Optional date range filter for account balances.
      // effectiveEndDate defaults to today so future-dated vouchers are excluded.
      const asOfDate = getClientDate(req);
      const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
      const balStartDate =
        typeof req.query.startDate === "string" && ISO_DATE.test(req.query.startDate)
          ? req.query.startDate
          : undefined;
      const rawEndDate =
        typeof req.query.endDate === "string" && ISO_DATE.test(req.query.endDate)
          ? req.query.endDate
          : undefined;
      const effectiveEndDate = rawEndDate && rawEndDate < asOfDate ? rawEndDate : asOfDate;

      // Get all voucher entries for this company's vouchers (excluding optional and deleted)
      // Use COALESCE(effectiveDate, voucherDate) so period filtering respects effective date
      const voucherDateConditions = [
        eq(vouchers.companyId, companyId),
        eq(vouchers.optional, false),
        isNull(vouchers.deletedAt),
        ...(balStartDate ? [sql`COALESCE(${vouchers.effectiveDate}, ${vouchers.voucherDate}) >= ${balStartDate}`] : []),
        sql`COALESCE(${vouchers.effectiveDate}, ${vouchers.voucherDate}) <= ${effectiveEndDate}`,
      ];

      // Ledger account IDs that belong to this company (already fetched above)
      const ledgerIds = ledgers.map((a) => a.id);

      // For ledger accounts: query entries scoped strictly to THIS company's vouchers.
      // Cross-company aggregation causes the account-list balance to differ from the
      // opened statement and Factory Net Position (both company-scoped).
      const companyLedgerConditions: any[] = [
        eq(vouchers.companyId, companyId),
        eq(vouchers.optional, false),
        isNull(vouchers.deletedAt),
        isNotNull(voucherEntries.ledgerAccountId),
        ...(balStartDate ? [sql`COALESCE(${vouchers.effectiveDate}, ${vouchers.voucherDate}) >= ${balStartDate}`] : []),
        sql`COALESCE(${vouchers.effectiveDate}, ${vouchers.voucherDate}) <= ${effectiveEndDate}`,
        ...(ledgerIds.length > 0 ? [inArray(voucherEntries.ledgerAccountId as any, ledgerIds)] : [sql`1=0`]),
      ];

      // Run both fetches in parallel
      const [companyVouchers, companyLedgerEntries] = await Promise.all([
        db
          .select({ id: vouchers.id })
          .from(vouchers)
          .where(and(...voucherDateConditions)),
        ledgerIds.length > 0
          ? db
              .select({
                ledgerAccountId: voucherEntries.ledgerAccountId,
                debitAmount: voucherEntries.debitAmount,
                creditAmount: voucherEntries.creditAmount,
              })
              .from(voucherEntries)
              .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
              .where(and(...companyLedgerConditions))
          : Promise.resolve([]),
      ]);

      const companyVoucherIds = companyVouchers.map((v) => v.id);

      // Get all voucher entries for this company (needed for bank / asset / employee / supplier balances)
      const allEntries =
        companyVoucherIds.length > 0
          ? await db.select().from(voucherEntries).where(inArray(voucherEntries.voucherId, companyVoucherIds)).execute()
          : [];

      // Group entries by account type and calculate balances
      // Ledger balances use the company-scoped query above.
      const ledgerBalances = new Map<number, { debits: number; credits: number }>();
      for (const entry of companyLedgerEntries) {
        if (!entry.ledgerAccountId) continue;
        const debit = parseFloat((entry as any).debitAmount || "0");
        const credit = parseFloat((entry as any).creditAmount || "0");
        const existing = ledgerBalances.get(entry.ledgerAccountId) || { debits: 0, credits: 0 };
        ledgerBalances.set(entry.ledgerAccountId, {
          debits: existing.debits + debit,
          credits: existing.credits + credit,
        });
      }

      const bankBalances = new Map<number, { debits: number; credits: number }>();
      const assetBalances = new Map<number, { debits: number; credits: number }>();
      const employeeBalances = new Map<number, { debits: number; credits: number }>();
      // Note: Supplier balances are calculated separately below using getSupplierBalanceForContext,
      // which correctly scopes entries to the selected company and applies opening-balance rules
      // (opening balance only applies in the parent company's context — zero for all others).

      for (const entry of allEntries) {
        const debit = parseFloat(entry.debitAmount || "0");
        const credit = parseFloat(entry.creditAmount || "0");

        // Ledger balances are already handled by the cross-company query above

        if (entry.bankAccountId) {
          const existing = bankBalances.get(entry.bankAccountId) || {
            debits: 0,
            credits: 0,
          };
          bankBalances.set(entry.bankAccountId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

        if (entry.fixedAssetId) {
          const existing = assetBalances.get(entry.fixedAssetId) || {
            debits: 0,
            credits: 0,
          };
          assetBalances.set(entry.fixedAssetId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

        if (entry.employeeId) {
          const existing = employeeBalances.get(entry.employeeId) || {
            debits: 0,
            credits: 0,
          };
          employeeBalances.set(entry.employeeId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }
        // Note: Supplier balances are calculated separately below using global entries
        // (not company-filtered) to match the supplier stats endpoint
      }

      // Helper function to calculate actual balance
      const calculateBalance = (
        openingBalance: string,
        openingBalanceSide: string | null,
        debits: number,
        credits: number
      ) => {
        let balance = parseFloat(openingBalance || "0");

        // If opening balance has a side, convert to signed number
        if (openingBalanceSide === "Cr") {
          balance = -balance;
        }

        // Add net change (debits increase, credits decrease)
        balance += debits - credits;

        // Determine side based on final balance
        const balanceSide = balance >= 0 ? "Dr" : "Cr";
        const absoluteBalance = Math.abs(balance);

        return { balance: absoluteBalance, balanceSide };
      };

      const accounts = [
        ...ledgers.map((account) => {
          const movements = ledgerBalances.get(account.id) || {
            debits: 0,
            credits: 0,
          };
          // If this ledger account is linked to a customer, use the customer's
          // opening balance as the authoritative source (may differ from the
          // ledger account's own openingBalance if edited directly).
          const custOb = customerObMap.get(account.id);
          const effectiveOB = custOb?.openingBalance ?? account.openingBalance ?? "0";
          const effectiveOBSide = custOb?.openingBalanceSide ?? account.openingBalanceSide;

          // For factory companies, use the pre-computed combined balance override
          // (sales + customerBalances + voucherEntries via both ledgerId and customerId)
          const override = customerLedgerOverrides.get(account.id);
          if (override) {
            return {
              id: `ledger-${account.id}`,
              accountId: account.id,
              type: "ledger",
              code: account.code,
              name: account.name,
              accountType: account.accountType,
              subType: account.subType,
              balance: override.balance,
              balanceSide: override.balanceSide,
              openingBalance: parseFloat(effectiveOB),
              openingBalanceSide: effectiveOBSide || "Dr",
              active: account.active,
              parentId: account.parentId,
            };
          }

          const { balance, balanceSide } = calculateBalance(
            effectiveOB,
            effectiveOBSide,
            movements.debits,
            movements.credits
          );

          return {
            id: `ledger-${account.id}`,
            accountId: account.id,
            type: "ledger",
            code: account.code,
            name: account.name,
            accountType: account.accountType,
            subType: account.subType,
            balance: balance.toFixed(2),
            balanceSide,
            openingBalance: parseFloat(effectiveOB),
            openingBalanceSide: effectiveOBSide || "Dr",
            active: account.active,
            parentId: account.parentId,
          };
        }),
        ...banks.map((account) => {
          const movements = bankBalances.get(account.id) || {
            debits: 0,
            credits: 0,
          };
          const { balance, balanceSide } = calculateBalance(
            account.openingBalance || "0",
            account.openingBalanceSide,
            movements.debits,
            movements.credits
          );

          return {
            id: `bank-${account.id}`,
            accountId: account.id,
            type: "bank",
            code: account.code,
            name: `${account.name} (${account.bankName})`,
            balance: balance.toFixed(2),
            balanceSide,
            openingBalance: parseFloat(account.openingBalance || "0"),
            openingBalanceSide: account.openingBalanceSide || "Dr",
            active: account.active,
            parentId: null,
          };
        }),
        ...assets.map((asset) => {
          const movements = assetBalances.get(asset.id) || {
            debits: 0,
            credits: 0,
          };
          const { balance, balanceSide } = calculateBalance(
            asset.openingBalance || "0",
            "Dr", // Fixed assets are always debit balance
            movements.debits,
            movements.credits
          );

          return {
            id: `asset-${asset.id}`,
            accountId: asset.id,
            type: "fixedAsset",
            code: asset.code,
            name: asset.name,
            balance: balance.toFixed(2),
            balanceSide,
            openingBalance: parseFloat(asset.openingBalance || "0"),
            openingBalanceSide: "Dr", // Fixed assets are always debit balance
            active: asset.active,
            parentId: null,
          };
        }),
        ...employees.map((employee) => {
          const movements = employeeBalances.get(employee.id) || {
            debits: 0,
            credits: 0,
          };
          const openingBalance = parseFloat(employee.openingBalance || "0");
          // Employee accounts are liability (Cr-normal): credits increase balance, debits decrease it.
          // Positive netBalance = Cr (we owe them, the normal state).
          // This matches the payroll page's currentBalance convention.
          const netBalance = openingBalance + movements.credits - movements.debits;
          const balanceSide = netBalance >= 0 ? "Cr" : "Dr";

          return {
            id: `employee-${employee.id}`,
            accountId: employee.id,
            type: "employee",
            code: employee.code,
            name: `${employee.firstName} ${employee.lastName}`,
            balance: Math.abs(netBalance).toFixed(2),
            balanceSide,
            openingBalance: openingBalance,
            openingBalanceSide: "Cr",
            active: employee.active,
            parentId: null,
          };
        }),
      ];

      // Determine whether the current company is the parent company. The opening
      // balance is a one-time historical entry that only belongs to the parent
      // company's books — child/sub companies start from zero and only accrue a
      // balance from their OWN vouchers. The parent is NEVER inferred from
      // "lowest company ID" — only the explicit parentCompanyId setting decides.
      const parentCompanyId = await resolveParentCompanyId();
      const isChildCompany = companyId !== parentCompanyId;

      // Calculate each supplier's balance scoped to THIS company only (opening
      // balance applies solely in the parent company's context). Child companies
      // additionally omit suppliers with no activity in that company at all.
      const supplierAccountsList = (
        await Promise.all(
          suppliers.map(async (supplier) => {
            const {
              balance: calculatedBalance,
              openingBalance,
              hasActivity,
            } = await getSupplierBalanceForContext(supplier, companyId);

            if (isChildCompany && !hasActivity) return null;

            // For suppliers, return the signed balance (same format as /api/suppliers/stats)
            // Positive = we owe them (Cr), Negative = they owe us/prepaid (Dr)
            const balanceSide = calculatedBalance >= 0 ? "Cr" : "Dr";

            return {
              id: `supplier-${supplier.id}`,
              accountId: supplier.id,
              type: "supplier",
              code: supplier.code,
              name: supplier.legalName,
              balance: calculatedBalance.toFixed(2), // Signed value, not absolute
              balanceSide,
              openingBalance: openingBalance,
              openingBalanceSide: "Cr", // Suppliers are always credit balance (payable)
              active: supplier.active,
              parentId: null,
            };
          })
        )
      ).filter((s): s is NonNullable<typeof s> => s !== null);

      // Combine all accounts — customers are excluded from the voucher account selector
      const allAccounts = [...accounts, ...supplierAccountsList];

      res.json({ accounts: allAccounts, asOfDate: effectiveEndDate });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get payable accounts (creditors - suppliers with positive balance)
  app.get("/api/accounts/payables", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const suppliers = await storage.getAllSuppliers();
      const parentCompanyId = await resolveParentCompanyId();
      const isChildCompany = companyId !== parentCompanyId;

      const payableAccounts = (
        await Promise.all(
          suppliers.map(async (supplier) => {
            const { balance, hasActivity } = await getSupplierBalanceForContext(supplier, companyId);
            if (isChildCompany && !hasActivity) return null;
            return {
              id: supplier.id,
              accountId: supplier.id,
              code: supplier.code,
              name: supplier.legalName,
              balance,
            };
          })
        )
      )
        .filter((account): account is NonNullable<typeof account> => account !== null && account.balance > 0)
        .sort((a, b) => b.balance - a.balance);

      res.json(payableAccounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get all accounts for voucher sidebar (optimized format with balances)
  app.get("/api/vouchers/search", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const q = ((req.query.q as string) || "").trim();
      if (!q) return res.json([]);

      // Split into individual keywords so "avance transport" matches both words anywhere
      const keywords = q.split(/\s+/).filter(Boolean);

      // Strip currency symbols / commas so "$3,967" → "3967" for amount matching
      const amountQ = q.replace(/[$,\s]/g, "");
      const isNumericSearch = keywords.length === 1 && /^\d+(\.\d+)?$/.test(amountQ);

      // Each keyword must appear in description OR voucherNumber (AND across keywords)
      const keywordConditions = keywords.map((kw) =>
        or(
          ilike(vouchers.voucherNumber, `%${kw}%`),
          ilike(vouchers.description, `%${kw}%`),
          isNumericSearch ? sql`CAST(${vouchers.totalAmount} AS TEXT) LIKE ${"%" + amountQ + "%"}` : sql`false`
        )
      );

      const results = await db
        .select({
          id: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          effectiveDate: vouchers.effectiveDate,
          description: vouchers.description,
          totalAmount: vouchers.totalAmount,
          currency: vouchers.currency,
          locationName: vouchers.locationName,
        })
        .from(vouchers)
        .where(
          and(eq(vouchers.companyId, req.session.currentCompanyId), isNull(vouchers.deletedAt), ...keywordConditions)
        )
        .orderBy(desc(sql`COALESCE(${vouchers.effectiveDate}, ${vouchers.voucherDate})`))
        .limit(100);

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Lightweight ledger-accounts list (id, code, name) — used by dashboard payable-account selector.
  app.get("/api/accounts/all-ledger", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const accounts = await storage.getAllLedgerAccounts(companyId);
      res.json(
        accounts.map((acc) => ({
          id: acc.id,
          accountId: acc.id,
          code: acc.code || "",
          name: acc.name,
          balance: 0,
        }))
      );
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // 30-second TTL cache for voucher-sidebar results (keyed by companyId).
  // The sidebar shows aggregate balances; stale data for 30 s is acceptable because
  // TanStack Query on the client invalidates this query after every voucher mutation.
  const _vsBCache = new Map<number, { data: any; expiresAt: number }>();

  app.get("/api/accounts/voucher-sidebar", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const companyId = req.session.currentCompanyId;

      // Check TTL cache
      const _vsCached = _vsBCache.get(companyId);
      if (_vsCached && Date.now() < _vsCached.expiresAt) {
        return res.json(_vsCached.data);
      }

      // Parent is never inferred by "lowest company ID" — only the explicit
      // parentCompanyId setting decides whether this company's suppliers carry
      // their historical opening balance.
      const parentCompanyId = await resolveParentCompanyId();
      const isChildCompany = companyId !== parentCompanyId;

      // Phase 1: determine company type (other fetches are conditional on this)
      const currentCompany = await storage.getCompanyById(companyId);
      const isFactoryCompany = currentCompany?.companyType === "factory";
      const isPropertiesCompany = currentCompany?.companyType === "properties";

      // Phase 2: all independent fetches in parallel (allEntries runs concurrently with others)
      const [
        ledgers,
        banks,
        assets,
        employees,
        suppliers,
        fSuppliers,
        fContainers,
        fPayments,
        companyVouchers,
        allEntries,
      ] = await Promise.all([
        storage.getAllLedgerAccounts(companyId),
        storage.getAllBankAccounts(companyId),
        storage.getAllFixedAssets(companyId),
        storage.getAllEmployees(companyId),
        isFactoryCompany || isPropertiesCompany ? Promise.resolve([] as any[]) : storage.getAllSuppliers(),
        isFactoryCompany
          ? db
              .select()
              .from(factorySuppliers)
              .where(eq(factorySuppliers.companyId, companyId))
              .orderBy(factorySuppliers.name)
          : Promise.resolve([] as any[]),
        isFactoryCompany
          ? db.select().from(factoryContainers).where(eq(factoryContainers.companyId, companyId))
          : Promise.resolve([] as any[]),
        isFactoryCompany
          ? db.select().from(factorySupplierPayments).where(eq(factorySupplierPayments.companyId, companyId))
          : Promise.resolve([] as any[]),
        db
          .select({
            id: vouchers.id,
            voucherNumber: vouchers.voucherNumber,
            currency: vouchers.currency,
            exchangeRate: vouchers.exchangeRate,
          })
          .from(vouchers)
          .where(and(eq(vouchers.companyId, companyId), eq(vouchers.optional, false), isNull(vouchers.deletedAt)))
          .execute(),
        // Fetch all entries using a SQL subquery instead of first fetching IDs then inArray
        db
          .select()
          .from(voucherEntries)
          .where(
            sql`${voucherEntries.voucherId} IN (SELECT id FROM vouchers WHERE company_id = ${companyId} AND optional = false AND deleted_at IS NULL)`
          )
          .execute(),
      ]);

      const companyVoucherIds = companyVouchers.map((v) => v.id);
      // FACTORY-PAY-* voucher IDs — excluded when computing factory supplier voucher-paid amounts
      // to prevent double-counting with fPayments (factorySupplierPayments).
      const factoryPayVoucherIds = new Set(
        (companyVouchers as any[]).filter((v) => (v.voucherNumber || "").startsWith("FACTORY-PAY-")).map((v) => v.id)
      );
      // Map from voucherId -> {currency, exchangeRate} for USD conversion of factory supplier entries
      const voucherCurrencyMap = new Map<number, { currency: string; exchangeRate: string }>(
        (companyVouchers as any[]).map((v) => [
          v.id,
          { currency: v.currency || "USD", exchangeRate: v.exchangeRate || "1" },
        ])
      );

      // allEntries already fetched in parallel above (see Promise.all)

      // Group entries by account type and calculate balances
      const ledgerBalances = new Map<number, { debits: number; credits: number }>();
      const bankBalances = new Map<number, { debits: number; credits: number }>();
      const assetBalances = new Map<number, { debits: number; credits: number }>();
      const supplierBalances = new Map<number, number>();
      const employeeBalances = new Map<number, { debits: number; credits: number }>();
      const factorySupplierBalances = new Map<number, number>();
      const customerBalances = new Map<number, { debits: number; credits: number }>();

      for (const entry of allEntries) {
        const debit = parseFloat(entry.debitAmount || "0");
        const credit = parseFloat(entry.creditAmount || "0");

        if (entry.ledgerAccountId) {
          const existing = ledgerBalances.get(entry.ledgerAccountId) || { debits: 0, credits: 0 };
          ledgerBalances.set(entry.ledgerAccountId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

        if (entry.bankAccountId) {
          const existing = bankBalances.get(entry.bankAccountId) || { debits: 0, credits: 0 };
          bankBalances.set(entry.bankAccountId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

        if (entry.fixedAssetId) {
          const existing = assetBalances.get(entry.fixedAssetId) || { debits: 0, credits: 0 };
          assetBalances.set(entry.fixedAssetId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

        if (entry.supplierId) {
          const existing = supplierBalances.get(entry.supplierId) || 0;
          // Only count pure credit or pure debit entries to prevent double-counting
          if (credit > 0 && debit === 0) {
            supplierBalances.set(entry.supplierId, existing + credit); // Increase payable
          } else if (debit > 0 && credit === 0) {
            supplierBalances.set(entry.supplierId, existing - debit); // Decrease payable
          }
        }

        if ((entry as any).factorySupplierId) {
          const fsId = (entry as any).factorySupplierId as number;
          // Only track non-FACTORY-PAY-* debits as ERP voucher payments.
          // FACTORY-PAY-* vouchers are already counted via fPayments.
          if (!factoryPayVoucherIds.has(entry.voucherId) && debit > 0 && credit === 0) {
            // Convert to USD using the voucher's exchange rate
            const vInfo = voucherCurrencyMap.get(entry.voucherId) || { currency: "USD", exchangeRate: "1" };
            const fx = parseFloat(vInfo.exchangeRate) || 1;
            const debitUsd = vInfo.currency === "USD" ? debit : debit / fx;
            const existing = factorySupplierBalances.get(fsId) || 0;
            factorySupplierBalances.set(fsId, existing + debitUsd);
          }
        }

        if (entry.employeeId) {
          const existing = employeeBalances.get(entry.employeeId) || { debits: 0, credits: 0 };
          employeeBalances.set(entry.employeeId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

        if ((entry as any).customerId) {
          const cId = (entry as any).customerId as number;
          const existing = customerBalances.get(cId) || { debits: 0, credits: 0 };
          customerBalances.set(cId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }
      }

      // Opening balance only applies in the parent company's context (see
      // isChildCompany above) — child companies start every supplier at $0 and
      // only reflect movements from this company's own vouchers.

      // Helper function to calculate signed balance (positive = Dr, negative = Cr)
      const calculateSignedBalance = (
        openingBalance: string,
        openingBalanceSide: string | null,
        debits: number,
        credits: number
      ) => {
        let balance = parseFloat(openingBalance || "0");

        // If opening balance has a side, convert to signed number
        if (openingBalanceSide === "Cr") {
          balance = -balance;
        }

        // Add net change (debits increase, credits decrease)
        return balance + debits - credits;
      };

      // Build simplified account array for sidebar
      const accounts = [
        // Bank accounts
        ...banks.map((account) => {
          const movements = bankBalances.get(account.id) || { debits: 0, credits: 0 };
          const balance = calculateSignedBalance(
            account.openingBalance || "0",
            account.openingBalanceSide,
            movements.debits,
            movements.credits
          );

          return {
            id: account.id,
            type: "bank",
            name: account.name,
            code: account.code,
            balance,
          };
        }),
        ...employees.map((employee) => {
          const movements = employeeBalances.get(employee.id) || {
            debits: 0,
            credits: 0,
          };
          const openingBalance = parseFloat(employee.openingBalance || "0");
          // Employee accounts are liability (Cr-normal): credits increase balance, debits decrease it.
          // Positive netBalance = Cr (we owe them, the normal state).
          // This matches the payroll page's currentBalance convention.
          const netBalance = openingBalance + movements.credits - movements.debits;
          const balanceSide = netBalance >= 0 ? "Cr" : "Dr";

          return {
            id: `employee-${employee.id}`,
            accountId: employee.id,
            type: "employee",
            code: employee.code,
            name: `${employee.firstName} ${employee.lastName}`,
            balance: Math.abs(netBalance).toFixed(2),
            balanceSide,
            openingBalance: openingBalance,
            openingBalanceSide: "Cr",
            active: employee.active,
            parentId: null,
          };
        }),
        // Ledger accounts — all included (customer mirror ledgers appear alongside the customer entry)
        ...ledgers.map((account) => {
          const movements = ledgerBalances.get(account.id) || { debits: 0, credits: 0 };
          const balance = calculateSignedBalance(
            account.openingBalance || "0",
            account.openingBalanceSide,
            movements.debits,
            movements.credits
          );

          return {
            id: account.id,
            type: "ledger",
            name: account.name,
            code: account.code,
            balance,
          };
        }),
        // ERP Suppliers — only included for ERP companies (factory and properties use different account structures).
        // Child companies additionally omit suppliers with no activity in this company.
        ...suppliers
          .filter((supplier) => !isChildCompany || supplierBalances.has(supplier.id))
          .map((supplier) => {
            const transactionBalance = supplierBalances.get(supplier.id) || 0;
            const openingBalance = isChildCompany ? 0 : parseFloat(supplier.openingBalance || "0");
            // Suppliers are always Cr (we owe them). Negate so credit balance is negative in the signed system.
            const balance = -(openingBalance + transactionBalance);

            return {
              id: supplier.id,
              type: "supplier",
              name: supplier.legalName,
              code: supplier.code,
              balance,
            };
          }),
        // Factory Suppliers — only included for factory companies
        // Balance computed from factory tables (containers + payments) for accuracy,
        // matching the computeStats formula: includes freight, voucher payments, broker aggregation.
        ...fSuppliers.map((supplier) => {
          const openingBalance = parseFloat(supplier.openingBalance || "0");

          // Collect all supplier IDs to aggregate (the supplier itself + any children brokered through it)
          const linkedChildIds = (fSuppliers as any[])
            .filter((s: any) => s.parentId === supplier.id)
            .map((s: any) => s.id);
          const aggregateIds = [supplier.id, ...linkedChildIds];

          // Container value: sum((actualReceivedKg || totalKg) * ratePerKg + freight) * fxRateToUsd
          const supplierContainers = fContainers.filter((c: any) => aggregateIds.includes(c.supplierId));
          const containerValueUsd = supplierContainers.reduce((sum: number, c: any) => {
            const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
            const rate = parseFloat(c.ratePerKg || "0");
            const freight = parseFloat(c.freight || "0");
            const fx = parseFloat(c.fxRateToUsd || "1");
            return sum + (kg * rate + freight) * fx;
          }, 0);

          // Commission owed to this supplier as broker (exclude containers where they're also the main supplier)
          const brokerContainers = fContainers.filter(
            (c: any) =>
              c.commissionSupplierId === supplier.id &&
              !aggregateIds.includes(c.supplierId) &&
              parseFloat(c.commissionAmount || "0") > 0
          );
          const commissionValueUsd = brokerContainers.reduce((sum: number, c: any) => {
            const commAmt = parseFloat(c.commissionAmount || "0");
            const fx = parseFloat(c.fxRateToUsd || "1");
            const commCurr = c.commissionCurrencyCode || c.currencyCode || "USD";
            return sum + (commCurr === "USD" ? commAmt : commAmt * fx);
          }, 0);

          // Total paid via factorySupplierPayments (in USD) — aggregated across all linked IDs
          const supplierPayments = fPayments.filter((p: any) => aggregateIds.includes(p.supplierId));
          const totalPaidUsd = supplierPayments.reduce(
            (sum: number, p: any) => sum + parseFloat(p.amountUsd || "0"),
            0
          );

          // Total paid via non-FACTORY-PAY-* ERP voucher entries (aggregated across linked IDs)
          const voucherPaidUsd = aggregateIds.reduce((sum, sid) => sum + (factorySupplierBalances.get(sid) || 0), 0);

          // Outstanding balance (positive = we owe them). Negate for sidebar convention (negative = payable/red)
          const outstandingUsd =
            openingBalance + containerValueUsd + commissionValueUsd - totalPaidUsd - voucherPaidUsd;
          const balance = -outstandingUsd;

          return {
            id: supplier.id,
            type: "factorySupplier",
            name: supplier.name,
            code: String(supplier.id),
            balance,
          };
        }),
        // Customers appended below after async balance computation
        // Fixed Assets
        ...assets.map((asset) => {
          const movements = assetBalances.get(asset.id) || { debits: 0, credits: 0 };
          const balance = calculateSignedBalance(
            asset.openingBalance || "0",
            "Dr", // Fixed assets are always debit balance
            movements.debits,
            movements.credits
          );

          return {
            id: asset.id,
            type: "fixedAsset",
            name: asset.name,
            code: asset.code,
            balance,
          };
        }),
      ];

      // Customers are excluded from the voucher account selector — only ledger/bank/supplier accounts appear
      _vsBCache.set(companyId, { data: accounts, expiresAt: Date.now() + 30_000 });
      if (_vsBCache.size > 100) {
        const now = Date.now();
        for (const [k, v] of _vsBCache) {
          if (now >= v.expiresAt) _vsBCache.delete(k);
        }
      }
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get balance for a specific ledger account
  app.get("/api/accounts/ledger/:id/balance", requireAuth, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const ledgerAccountId = parseInt(req.params.id);

      if (isNaN(ledgerAccountId)) {
        return res.status(400).json({ message: "Invalid ledger account ID" });
      }

      const account = await storage.getLedgerAccountById(ledgerAccountId);

      // If not found as a ledger account, it may be a bank account ID (entries stored
      // in voucherEntries.bankAccountId, not ledgerAccountId). Compute balance from
      // the bankAccounts table + getVoucherEntriesByBankAccount so the Daybook entry
      // balance display shows the correct value instead of $0.
      if (!account) {
        const [bankAcct] = await db
          .select({ openingBalance: bankAccounts.openingBalance, openingBalanceSide: bankAccounts.openingBalanceSide })
          .from(bankAccounts)
          .where(eq(bankAccounts.id, ledgerAccountId))
          .limit(1);

        if (!bankAcct) {
          return res.status(404).json({ message: "Account not found" });
        }

        const bankTxs = await storage.getVoucherEntriesByBankAccount(ledgerAccountId);
        let bDebits = 0;
        let bCredits = 0;
        for (const tx of bankTxs) {
          bDebits += parseFloat(tx.debitAmount || "0");
          bCredits += parseFloat(tx.creditAmount || "0");
        }
        const bOB = parseFloat(bankAcct.openingBalance || "0");
        const bSide = bankAcct.openingBalanceSide || "Dr";
        const bankBalance = bOB * (bSide === "Cr" ? -1 : 1) + bDebits - bCredits;
        return res.json({ balance: bankBalance });
      }

      // Check if this ledger account is linked to a customer
      const [linkedCustomer] = await db
        .select({ id: customers.id, ob: customers.openingBalance, side: customers.openingBalanceSide })
        .from(customers)
        .where(eq(customers.ledgerAccountId, ledgerAccountId))
        .limit(1);

      // For factory customer-linked ledger accounts, use the same combined formula
      // as /api/factory/customers so the Accounts page balance matches the Customers page.
      if (linkedCustomer) {
        const currentCompany = await storage.getCompanyById(req.session?.currentCompanyId || 0);
        if (currentCompany?.companyType === "factory") {
          const custId = linkedCustomer.id;
          const [salesRows, cbRows, lVoucherRows, cVoucherRows] = await Promise.all([
            db
              .select({
                total: sql<string>`COALESCE(SUM(CAST(${customerOrders.grandTotal} AS numeric)), 0)`,
              })
              .from(customerOrders)
              .where(
                and(
                  eq(customerOrders.customerId, custId),
                  eq(customerOrders.companyId, req.session?.currentCompanyId || 0),
                  eq(customerOrders.status, "FINALIZED")
                )
              ),

            db
              .select({
                net: sql<string>`COALESCE(SUM(CAST(${customerBalances.debitAmount} AS numeric) - CAST(${customerBalances.creditAmount} AS numeric)), 0)`,
              })
              .from(customerBalances)
              .where(
                and(
                  eq(customerBalances.customerId, custId),
                  eq(customerBalances.companyId, req.session?.currentCompanyId || 0),
                  sql`${customerBalances.referenceType} IS DISTINCT FROM 'INVOICE'`
                )
              ),

            db
              .select({
                net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
              })
              .from(voucherEntries)
              .innerJoin(
                vouchers,
                and(
                  eq(voucherEntries.voucherId, vouchers.id),
                  eq(vouchers.optional, false),
                  isNull(vouchers.deletedAt),
                  sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`
                )
              )
              .where(eq(voucherEntries.ledgerAccountId, ledgerAccountId)),

            db
              .select({
                net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
              })
              .from(voucherEntries)
              .innerJoin(
                vouchers,
                and(
                  eq(voucherEntries.voucherId, vouchers.id),
                  eq(vouchers.optional, false),
                  isNull(vouchers.deletedAt),
                  sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`
                )
              )
              .where(and(eq(voucherEntries.customerId, custId), isNull(voucherEntries.ledgerAccountId))),
          ]);

          const salesTotal = parseFloat(salesRows[0]?.total || "0");
          const nonInvNet = parseFloat(cbRows[0]?.net || "0");
          const vNet = parseFloat(lVoucherRows[0]?.net || "0") + parseFloat(cVoucherRows[0]?.net || "0");
          const ob = parseFloat(linkedCustomer.ob || "0");
          const obSide = linkedCustomer.side || "Dr";
          const balance = (obSide === "Dr" ? ob : -ob) + salesTotal + nonInvNet + vNet;
          return res.json({ balance });
        }
      }

      const companyIdForBalance = (req.session as any).currentCompanyId as number | undefined;
      const transactions = await storage.getVoucherEntriesByLedger(ledgerAccountId, undefined, undefined, companyIdForBalance);
      let debits = 0;
      let credits = 0;
      for (const tx of transactions) {
        debits += parseFloat(tx.debitAmount || "0");
        credits += parseFloat(tx.creditAmount || "0");
      }

      // Some bank accounts have a linkedLedgerId pointing to this ledger account.
      // Their voucher entries are stored under bankAccountId (not ledgerAccountId),
      // so getVoucherEntriesByLedger misses them. Mirror the factoryWorkerPayrollRoutes
      // pattern: find linked banks and fold in their entries + opening balances.
      const linkedBanks = await db
        .select({
          id: bankAccounts.id,
          openingBalance: bankAccounts.openingBalance,
          openingBalanceSide: bankAccounts.openingBalanceSide,
        })
        .from(bankAccounts)
        .where(eq(bankAccounts.linkedLedgerId, ledgerAccountId));

      let linkedBankOB = 0;
      for (const bank of linkedBanks) {
        const bankTxs = await storage.getVoucherEntriesByBankAccount(bank.id);
        for (const tx of bankTxs) {
          debits += parseFloat(tx.debitAmount || "0");
          credits += parseFloat(tx.creditAmount || "0");
        }
        const bOB = parseFloat(bank.openingBalance || "0");
        const bSide = bank.openingBalanceSide || "Dr";
        linkedBankOB += bOB * (bSide === "Cr" ? -1 : 1);
      }

      const rawOB = parseFloat((linkedCustomer?.ob ?? account.openingBalance) || "0");
      const rawSide = linkedCustomer?.side ?? account.openingBalanceSide;
      const balance = rawOB * (rawSide === "Cr" ? -1 : 1) + linkedBankOB + debits - credits;

      res.json({ balance });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get per-currency balance breakdown for a ledger account (all-time, no date filter)
  app.get("/api/accounts/ledger/:id/currency-balances", requireAuth, async (req, res) => {
    try {
      const ledgerAccountId = parseInt(req.params.id);
      if (isNaN(ledgerAccountId)) {
        return res.status(400).json({ message: "Invalid ledger account ID" });
      }

      const rows = await db
        .select({
          currency: vouchers.currency,
          totalDebit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric)), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
        })
        .from(voucherEntries)
        .leftJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(
          and(
            eq(voucherEntries.ledgerAccountId, ledgerAccountId),
            eq(vouchers.optional, false),
            isNull(vouchers.deletedAt)
          )
        )
        .groupBy(vouchers.currency);

      const result = rows.map((r: any) => ({
        currency: r.currency || "USD",
        totalDebit: parseFloat(r.totalDebit || "0"),
        totalCredit: parseFloat(r.totalCredit || "0"),
      }));

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  registerAccountTransactionRoutes(app);

  registerAccountStatementRoutes(app);


  // Get all vouchers with date filtering
}
