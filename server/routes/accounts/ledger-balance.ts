/**
 * accountRoutes: AccountLedgerBalance endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth } from "../../auth";
import { bankAccounts, vouchers, voucherEntries, customers, customerBalances, customerOrders } from "@shared/schema";
import { eq, and, sql, isNull } from "drizzle-orm";

export function registerAccountLedgerBalanceRoutes(app: Express) {
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

      const companyIdForBalance = req.session.currentCompanyId as number | undefined;
      const transactions = await storage.getVoucherEntriesByLedger(
        ledgerAccountId,
        undefined,
        undefined,
        companyIdForBalance
      );
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
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
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

      const result = rows.map((r) => ({
        currency: r.currency || "USD",
        totalDebit: parseFloat(r.totalDebit || "0"),
        totalCredit: parseFloat(r.totalCredit || "0"),
      }));

      res.json(result);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
