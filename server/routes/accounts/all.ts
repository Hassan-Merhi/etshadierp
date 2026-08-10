/**
 * accountRoutes: AccountList endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth } from "../../auth";
import { resolveParentCompanyId, getSupplierBalanceForContext } from "../helpers/supplierBalanceHelpers";
import { vouchers, voucherEntries, customerBalances, customerOrders } from "@shared/schema";
import { eq, and, inArray, sql, isNull, isNotNull } from "drizzle-orm";
import { getClientDate } from "../../lib/dateUtils";
import { resultRows } from "../../lib/queryResult";

export function registerAccountListRoutes(app: Express) {
  app.get("/api/accounts/all", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const companyId = req.session.currentCompanyId;

      // Fire all independent lookups in parallel instead of serially.
      // getAllSuppliers is always fetched; for factory companies the result is
      // discarded — the wasted query is small compared to the serial latency saved.
      const [currentCompany, ledgersAll, banks, assets, employees, allSuppliers, companyCustomers] = await Promise.all([
        storage.getCompanyById(companyId),
        storage.getAllLedgerAccounts(companyId, true), // include hidden so cash/loan/bank accounts appear in pickers
        storage.getAllBankAccounts(companyId),
        storage.getAllFixedAssets(companyId),
        storage.getAllEmployees(companyId),
        storage.getAllSuppliers(),
        storage.getAllCustomers(companyId),
      ]);
      // Strip internal system-only accounts (isHidden=true for a reason — never show in pickers)
      const ledgers = ledgersAll.filter((a) => !["sp_stock", "sp_opnbal"].includes(a.subType ?? ""));
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
          const workerAdvRow = resultRows(workerAdvRes)[0] ?? {};
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
        typeof req.query.startDate === "string" && ISO_DATE.test(req.query.startDate) ? req.query.startDate : undefined;
      const rawEndDate =
        typeof req.query.endDate === "string" && ISO_DATE.test(req.query.endDate) ? req.query.endDate : undefined;
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
      const companyLedgerConditions = [
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
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
