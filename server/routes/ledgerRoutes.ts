import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate, syncEmployeeBalancesFromEntries } from "./_helpers";
import {
  locations,
  inventory,
  stockItems,
  stockGroups,
  ledgerAccounts,
  employees,
  employeeGroups,
  employeeGroupMembers,
  suppliers,
  customers,
  customerBalances,
  customerOrders,
  stockTransferVouchers,
  stockTransferItems,
  stockAdjustmentVouchers,
  stockAdjustmentItems,
  containers,
  containerOffloads,
  containerOffloadItems,
  vouchers,
  voucherEntries,
  salesItems,
  insertLocationSchema,
  insertLedgerAccountSchema,
  updateLedgerAccountSchema,
  insertEmployeeSchema,
  insertEmployeeGroupSchema,
  insertSupplierSchema,
  insertCustomerSchema,
  userLocations,
  userCompanyRoles,
  companies,
  bankAccounts,
  fixedAssets,
  agentAccounts,
  auditLog,
  users,
  FEATURE_KEYS,
  salaryAdvances,
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

export function registerLedgerRoutes(app: Express) {
  app.get("/api/ledger-accounts", requireAuth, async (req, res) => {
    try {
      const { companyId, accountType, search, includeHidden } = req.query;
      const effectiveCompanyId = companyId ? parseInt(companyId as string) : req.session.currentCompanyId;

      if (!effectiveCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      let accounts;
      if (accountType && typeof accountType === "string" && accountType.trim()) {
        // Push accountType filter to SQL — avoids fetching all accounts then
        // discarding most of them in JS (e.g. 8 Cash accounts out of 400 total).
        const conditions: any[] = [
          eq(ledgerAccounts.companyId, effectiveCompanyId),
          isNull(ledgerAccounts.deletedAt),
          eq(ledgerAccounts.accountType, accountType.trim()),
        ];
        if (includeHidden !== "true") conditions.push(eq(ledgerAccounts.isHidden, false));
        accounts = await db
          .select()
          .from(ledgerAccounts)
          .where(and(...conditions))
          .orderBy(asc(ledgerAccounts.code));
      } else if (search && typeof search === "string" && search.trim()) {
        // Push search to DB (ILIKE) instead of fetching all accounts and filtering in JS
        const q = `%${search.trim()}%`;
        const searchConds: any[] = [
          eq(ledgerAccounts.companyId, effectiveCompanyId),
          isNull(ledgerAccounts.deletedAt),
          or(ilike(ledgerAccounts.name, q), ilike(ledgerAccounts.code, q)),
        ];
        if (includeHidden !== "true") searchConds.push(eq(ledgerAccounts.isHidden, false));
        accounts = await db
          .select()
          .from(ledgerAccounts)
          .where(and(...searchConds))
          .orderBy(asc(ledgerAccounts.code));
      } else {
        accounts = await storage.getAllLedgerAccounts(effectiveCompanyId, includeHidden === "true");
      }
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get all "empty" ledger accounts (no entries, zero OB, no children)
  // Must be registered BEFORE /:id so Express doesn't swallow "empty" as an id param.
  app.get("/api/ledger-accounts/empty", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allAccounts = await db
        .select()
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.companyId, companyId), isNull(ledgerAccounts.deletedAt)));

      const accountIds = allAccounts.map((a) => a.id);
      if (accountIds.length === 0) return res.json([]);

      // Accounts that have any voucher entries — scoped to this company only
      // The innerJoin on vouchers with companyId already scopes to this company's accounts;
      // the inArray is redundant since all accounts belong to this company.
      const usedInEntries = await db
        .selectDistinct({ accountId: voucherEntries.ledgerAccountId })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(and(isNotNull(voucherEntries.ledgerAccountId), eq(vouchers.companyId, companyId)));
      const usedIds = new Set(usedInEntries.map((r: any) => r.accountId));

      // Accounts that are parents to other accounts
      const parentIds = new Set(allAccounts.filter((a) => a.parentId !== null).map((a) => a.parentId as number));

      const empty = allAccounts.filter((a) => {
        if (usedIds.has(a.id)) return false;
        if (parentIds.has(a.id)) return false;
        const ob = parseFloat(a.openingBalance || "0");
        if (Math.abs(ob) > 0.001) return false;
        return true;
      });

      res.json(empty);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/ledger-accounts/:id", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const accountId = parseInt(req.params.id);
      if (isNaN(accountId)) {
        return res.status(400).json({ message: "Invalid ledger account ID" });
      }

      const account = await storage.getLedgerAccountById(accountId);
      if (!account) {
        return res.status(404).json({ message: "Ledger account not found" });
      }

      // Verify account belongs to current company
      if (account.companyId !== req.session.currentCompanyId) {
        return res.status(404).json({ message: "Ledger account not found" });
      }

      res.json(account);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/ledger-accounts", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const parsed = insertLedgerAccountSchema.parse(req.body);

      // Check for duplicate name within the same company
      const existingByName = await storage.getLedgerAccountByName(parsed.name, parsed.companyId);
      if (existingByName) {
        return res.status(400).json({
          message: "Duplicate ledger: A ledger account with this name already exists",
        });
      }

      // Auto-generate code from name if not provided
      if (!parsed.code) {
        // Generate code from name: take first 3 letters of each word, uppercase
        const words = parsed.name
          .trim()
          .split(/\s+/)
          .filter((w) => w.length > 0);
        let baseCode = words
          .map((w) => w.substring(0, 3))
          .join("")
          .toUpperCase();

        // Fallback if baseCode is empty (shouldn't happen with validation, but be safe)
        if (!baseCode || baseCode.length === 0) {
          baseCode = "ACC";
        }

        // Ensure uniqueness by adding suffix if needed
        let code = baseCode;
        let suffix = 1;
        while (await storage.getLedgerAccountByCode(code, req.session.currentCompanyId!)) {
          code = `${baseCode}${suffix}`;
          suffix++;
        }
        parsed.code = code;
      } else {
        // Check for duplicate code if manually provided
        const existing = await storage.getLedgerAccountByCode(parsed.code, req.session.currentCompanyId!);
        if (existing) {
          return res.status(400).json({ message: "Ledger account code already exists" });
        }
      }

      // Validate opening balance amount and side must both be present or both absent
      const hasBalance = parsed.openingBalance && parseFloat(parsed.openingBalance) !== 0;
      const hasSide = parsed.openingBalanceSide && (parsed.openingBalanceSide as string) !== "";

      if (hasBalance && !hasSide) {
        return res.status(400).json({ message: "Opening balance requires Dr/Cr side" });
      }

      if (!hasBalance && hasSide) {
        return res.status(400).json({ message: "Dr/Cr side requires opening balance amount" });
      }

      // Validate subType based on accountType
      // "Group" is a universal special subType used to mark an account as a parent group
      // and bypasses the per-type validation intentionally.
      const validSubTypes: Record<string, string[]> = {
        Income: ["Direct Income", "Indirect Income"],
        Expense: ["Direct Expense", "Indirect Expense"],
        Liability: ["Current Liability", "Long-term Liability", "Loans Payable", "Output Tax", "Tax Payable"],
        Asset: ["Current Asset", "Fixed Asset", "Input Tax", "Tax Receivable"],
      };

      if (parsed.subType && parsed.subType !== "Group" && validSubTypes[parsed.accountType]) {
        if (!validSubTypes[parsed.accountType].includes(parsed.subType)) {
          return res.status(400).json({
            message: `Invalid subType "${parsed.subType}" for accountType "${parsed.accountType}". Valid options: ${validSubTypes[parsed.accountType].join(", ")}`,
          });
        }
      }

      const account = await storage.createLedgerAccount(parsed);
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: parsed.companyId,
          action: "create",
          tableName: "ledger_accounts",
          recordId: account.id,
          recordIdentifier: account.name,
          changes: {
            name: { new: account.name },
            code: { new: account.code },
            accountType: { new: account.accountType },
            subType: { new: account.subType || null },
            openingBalance: { new: account.openingBalance || "0" },
            openingBalanceSide: { new: account.openingBalanceSide || null },
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

  app.put("/api/ledger-accounts/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const accountId = parseInt(req.params.id);
      if (isNaN(accountId)) {
        return res.status(400).json({ message: "Invalid account ID" });
      }

      // Verify account exists and belongs to current company
      const existingAccount = await storage.getLedgerAccountById(accountId);
      if (!existingAccount) {
        return res.status(404).json({ message: "Account not found" });
      }
      if (existingAccount.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({
          message: "Access denied: Account belongs to a different company",
        });
      }

      const parsed = updateLedgerAccountSchema.parse({
        ...req.body,
        id: accountId,
      });

      // Check for duplicate code if code is being changed
      if (parsed.code && parsed.code !== existingAccount.code) {
        const duplicate = await storage.getLedgerAccountByCode(parsed.code, req.session.currentCompanyId!);
        if (duplicate) {
          return res.status(400).json({ message: "Ledger account code already exists" });
        }
      }

      // Validate opening balance amount and side must both be present or both absent
      const hasBalance = parsed.openingBalance && parseFloat(parsed.openingBalance) !== 0;
      const hasSide = parsed.openingBalanceSide && (parsed.openingBalanceSide as string) !== "";

      if (hasBalance && !hasSide) {
        return res.status(400).json({ message: "Opening balance requires Dr/Cr side" });
      }

      if (!hasBalance && hasSide) {
        return res.status(400).json({ message: "Dr/Cr side requires opening balance amount" });
      }

      // Validate subType based on accountType if accountType is being updated
      const accountType = parsed.accountType || existingAccount.accountType;
      const validSubTypes: Record<string, string[]> = {
        Income: ["Direct Income", "Indirect Income"],
        Expense: ["Direct Expense", "Indirect Expense"],
        Liability: ["Current Liability", "Long-term Liability", "Loans Payable", "Output Tax", "Tax Payable"],
        Asset: ["Current Asset", "Fixed Asset", "Input Tax", "Tax Receivable"],
      };

      if (parsed.subType && parsed.subType !== "Group" && validSubTypes[accountType]) {
        if (!validSubTypes[accountType].includes(parsed.subType)) {
          return res.status(400).json({
            message: `Invalid subType "${parsed.subType}" for accountType "${accountType}". Valid options: ${validSubTypes[accountType].join(", ")}`,
          });
        }
      }

      // Atomic: ledger update + reverse-sync to linked customer must succeed
      // together or both roll back. Otherwise a sync failure would leave
      // ledger.openingBalance and customer.openingBalance permanently out of
      // sync — exactly the bug Phase 5 was meant to prevent.
      const updatedAccount = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(ledgerAccounts)
          .set(parsed)
          .where(eq(ledgerAccounts.id, accountId))
          .returning();

        if (parsed.openingBalance !== undefined || parsed.openingBalanceSide !== undefined) {
          const [linkedCust] = await tx
            .select({ id: customers.id })
            .from(customers)
            .where(eq(customers.ledgerAccountId, accountId))
            .limit(1);
          if (linkedCust) {
            const update: { openingBalance?: string; openingBalanceSide?: string } = {};
            if (parsed.openingBalance !== undefined) {
              update.openingBalance = updated.openingBalance ?? "0";
            }
            if (parsed.openingBalanceSide !== undefined) {
              update.openingBalanceSide = updated.openingBalanceSide ?? "Dr";
            }
            if (Object.keys(update).length > 0) {
              await tx.update(customers).set(update).where(eq(customers.id, linkedCust.id));
            }
          }
        }

        return updated;
      });

      try {
        const _ledChanges: Record<string, { old: any; new: any }> = {};
        for (const _f of [
          "name",
          "code",
          "accountType",
          "subType",
          "openingBalance",
          "openingBalanceSide",
          "active",
        ] as const) {
          if (String((existingAccount as any)[_f] ?? "") !== String((updatedAccount as any)[_f] ?? "")) {
            _ledChanges[_f] = { old: (existingAccount as any)[_f], new: (updatedAccount as any)[_f] };
          }
        }
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "update",
          tableName: "ledger_accounts",
          recordId: updatedAccount.id,
          recordIdentifier: updatedAccount.name,
          changes: _ledChanges,
        });
      } catch {
        /* non-fatal */
      }
      res.json(updatedAccount);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Bulk-assign parentId to multiple ledger accounts
  app.patch("/api/ledger-accounts/bulk-assign-parent", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const { accountIds, parentId } = req.body;
      if (!Array.isArray(accountIds) || accountIds.length === 0) {
        return res.status(400).json({ message: "accountIds must be a non-empty array" });
      }
      const companyId = req.session.currentCompanyId;
      const results = [];
      for (const id of accountIds) {
        const account = await storage.getLedgerAccountById(id);
        if (!account || account.companyId !== companyId) continue;
        if (parentId !== null && parentId !== undefined) {
          const parent = await storage.getLedgerAccountById(parentId);
          if (!parent || parent.companyId !== companyId) {
            return res.status(400).json({ message: `Parent account ${parentId} not found` });
          }
        }
        const updated = await storage.updateLedgerAccount({ id, parentId: parentId ?? null });
        results.push(updated);
      }
      res.json(results);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/ledger-accounts/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const accountId = parseInt(req.params.id);
      if (isNaN(accountId)) {
        return res.status(400).json({ message: "Invalid account ID" });
      }

      // Verify account exists and belongs to current company
      const existingAccount = await storage.getLedgerAccountById(accountId);
      if (!existingAccount) {
        return res.status(404).json({ message: "Account not found" });
      }
      if (existingAccount.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({
          message: "Access denied: Account belongs to a different company",
        });
      }

      // Check if account is used in any voucher entries
      const entries = await storage.getVoucherEntriesByLedger(accountId);
      if (entries && entries.length > 0) {
        return res.status(400).json({
          message:
            "Cannot delete ledger account: It has been used in transactions. Please remove all related transactions first.",
        });
      }

      // Check if account is a parent to other accounts
      const allAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);
      const hasChildren = allAccounts.some((acc) => acc.parentId === accountId);
      if (hasChildren) {
        return res.status(400).json({
          message:
            "Cannot delete ledger account: It is a parent account. Please remove or reassign child accounts first.",
        });
      }

      await storage.deleteLedgerAccount(accountId);
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "delete",
          tableName: "ledger_accounts",
          recordId: existingAccount.id,
          recordIdentifier: existingAccount.name,
          changes: {
            name: { old: existingAccount.name },
            code: { old: existingAccount.code },
            accountType: { old: existingAccount.accountType },
            subType: { old: existingAccount.subType || null },
            openingBalance: { old: existingAccount.openingBalance || "0" },
          },
        });
      } catch {
        /* non-fatal */
      }
      res.json({ message: "Ledger account deleted successfully" });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Bulk-delete empty ledger accounts
  app.post(
    "/api/ledger-accounts/bulk-delete",
    requireAuth,
    requireRole("Admin", "Owner"),
    requireNonPOS,
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const { accountIds } = req.body;
        if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
          return res.status(400).json({ message: "No accounts provided" });
        }

        const allAccounts = await db
          .select()
          .from(ledgerAccounts)
          .where(and(eq(ledgerAccounts.companyId, companyId), isNull(ledgerAccounts.deletedAt)));
        const accountMap = new Map(allAccounts.map((a) => [a.id, a]));
        const allAccountIds = allAccounts.map((a) => a.id);

        // Get IDs that have entries
        const usedRows =
          allAccountIds.length > 0
            ? await db
                .selectDistinct({ accountId: voucherEntries.ledgerAccountId })
                .from(voucherEntries)
                .where(inArray(voucherEntries.ledgerAccountId, allAccountIds))
            : [];
        const usedIds = new Set(usedRows.map((r: any) => r.accountId));
        const parentIds = new Set(allAccounts.filter((a) => a.parentId !== null).map((a) => a.parentId as number));

        const deleted: number[] = [];
        const skipped: { id: number; reason: string }[] = [];

        for (const rawId of accountIds) {
          const id = parseInt(rawId);
          const account = accountMap.get(id);
          if (!account) {
            skipped.push({ id, reason: "Not found or wrong company" });
            continue;
          }
          if (usedIds.has(id)) {
            skipped.push({ id, reason: "Has voucher entries" });
            continue;
          }
          if (parentIds.has(id)) {
            skipped.push({ id, reason: "Is a parent account" });
            continue;
          }
          const ob = parseFloat(account.openingBalance || "0");
          if (Math.abs(ob) > 0.001) {
            skipped.push({ id, reason: "Has opening balance" });
            continue;
          }
          await storage.deleteLedgerAccount(id);
          deleted.push(id);
        }

        res.json({ deleted: deleted.length, skipped: skipped.length, skippedDetails: skipped });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  // Zero opening balances for selected ledger accounts
  app.post("/api/ledger-accounts/zero-balances", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { accountIds } = req.body;
      if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
        return res.status(400).json({ message: "No accounts selected" });
      }

      // Get all accounts for this company
      const allAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);
      const validAccountIds = allAccounts.map((a) => a.id);

      // Filter to only accounts that belong to this company
      const accountsToUpdate = accountIds.filter((id: number) => validAccountIds.includes(id));

      if (accountsToUpdate.length === 0) {
        return res.status(400).json({ message: "No valid accounts found" });
      }

      // Update each account to zero its opening balance
      let count = 0;
      for (const accountId of accountsToUpdate) {
        await storage.updateLedgerAccount({
          id: accountId,
          openingBalance: "0",
          openingBalanceSide: undefined,
        });
        count++;
      }

      res.json({ message: `Opening balances zeroed for ${count} account(s)`, count });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Initialize Accounting Balances - creates Owner's Capital accounts to balance the Import Cycle
  app.post("/api/admin/initialize-accounting-balances", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const results: Array<{
        companyId: number;
        companyName: string;
        imbalance: number;
        accountCreated: boolean;
        accountUpdated?: boolean;
        accountCode?: string;
        accountName?: string;
        previousBalance?: string;
        openingBalance?: string;
        openingBalanceSide?: string;
        message: string;
        components?: {
          assets: { name: string; value: number }[];
          liabilities: { name: string; value: number }[];
          totalAssets: number;
          totalLiabilities: number;
        };
      }> = [];

      // Get all companies
      const allCompanies = await storage.getAllCompanies();

      for (const company of allCompanies) {
        const companyId = company.id;

        // Single-query aggregate replaces N+1 (fetch accounts → per-account entry fetch)
        const getAccountTypeBalance = async (accountType: string, isLiability: boolean = false) => {
          const rows = await db.execute(sql`
              SELECT
                la.opening_balance,
                la.opening_balance_side,
                COALESCE(SUM(CAST(ve.debit_amount  AS numeric)), 0) AS total_debit,
                COALESCE(SUM(CAST(ve.credit_amount AS numeric)), 0) AS total_credit
              FROM ledger_accounts la
              LEFT JOIN voucher_entries ve
                ON  ve.ledger_account_id = la.id
                AND ve.voucher_id IN (
                  SELECT id FROM vouchers
                   WHERE company_id  = ${companyId}
                     AND optional    = false
                     AND deleted_at IS NULL
                )
              WHERE la.company_id   = ${companyId}
                AND la.account_type = ${accountType}
                AND la.deleted_at  IS NULL
              GROUP BY la.id, la.opening_balance, la.opening_balance_side
            `);

          let totalBalance = 0;
          for (const row of rows.rows as any[]) {
            const openingBalanceRaw = parseFloat(row.opening_balance || "0");
            const openingSide = (row.opening_balance_side as string) || "Dr";
            const signedOpening = isLiability
              ? openingSide === "Cr"
                ? openingBalanceRaw
                : -openingBalanceRaw
              : openingSide === "Dr"
                ? openingBalanceRaw
                : -openingBalanceRaw;
            const debit = parseFloat(row.total_debit || "0");
            const credit = parseFloat(row.total_credit || "0");
            totalBalance += signedOpening + (isLiability ? credit - debit : debit - credit);
          }
          return totalBalance;
        };

        // Helper function: Get Import Charges balance (only under IMPORT_CHARGES parent account)
        // This must match the calculation in the import-cycle-balance endpoint
        const getImportChargesBalance = async () => {
          // First find the IMPORT_CHARGES parent account
          const [importChargesParent] = await db
            .select()
            .from(ledgerAccounts)
            .where(
              and(
                eq(ledgerAccounts.companyId, companyId),
                eq(ledgerAccounts.code, "IMPORT_CHARGES"),
                isNull(ledgerAccounts.deletedAt)
              )
            )
            .limit(1);

          if (!importChargesParent) {
            return 0; // No import charges yet
          }

          // Get all accounts under IMPORT_CHARGES parent (including the parent itself)
          const importChargeAccounts = await db
            .select()
            .from(ledgerAccounts)
            .where(
              and(
                eq(ledgerAccounts.companyId, companyId),
                or(eq(ledgerAccounts.id, importChargesParent.id), eq(ledgerAccounts.parentId, importChargesParent.id)),
                isNull(ledgerAccounts.deletedAt)
              )
            );

          if (importChargeAccounts.length === 0) {
            return 0;
          }

          const accountIds = importChargeAccounts.map((a) => a.id);

          // Get opening balances
          let totalBalance = importChargeAccounts.reduce((sum, account) => {
            const openingBalanceRaw = parseFloat(account.openingBalance || "0");
            const openingSide = account.openingBalanceSide || "Dr";
            // Expense accounts: Dr opening = positive
            return sum + (openingSide === "Dr" ? openingBalanceRaw : -openingBalanceRaw);
          }, 0);

          // Get all voucher entries for these accounts
          const entries = await db
            .select({
              creditAmount: voucherEntries.creditAmount,
              debitAmount: voucherEntries.debitAmount,
            })
            .from(voucherEntries)
            .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
            .where(
              and(
                inArray(voucherEntries.ledgerAccountId, accountIds),
                eq(vouchers.companyId, companyId),
                isNull(vouchers.deletedAt),
                eq(vouchers.optional, false)
              )
            );

          // Expense accounts: Debits increase (positive), Credits decrease (negative)
          totalBalance += entries.reduce((sum, entry) => {
            const credit = parseFloat(entry.creditAmount || "0");
            const debit = parseFloat(entry.debitAmount || "0");
            return sum + debit - credit;
          }, 0);

          return totalBalance;
        };

        // Calculate all balances (same logic as import-cycle-balance endpoint)
        // 1. Supplier Balance - calculated from voucher entries only (company-scoped)
        // NOTE: Supplier opening balances are global and cannot be attributed to a single company
        // Future enhancement: Add per-company supplier opening balances table
        const supplierEntries = await db
          .select({
            creditAmount: voucherEntries.creditAmount,
            debitAmount: voucherEntries.debitAmount,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(
            and(
              isNotNull(voucherEntries.supplierId),
              eq(vouchers.companyId, companyId),
              isNull(vouchers.deletedAt),
              eq(vouchers.optional, false)
            )
          );

        // Supplier is a liability: Credits increase (we owe more), Debits decrease (we paid)
        const supplierBalance = supplierEntries.reduce((sum, entry) => {
          const credit = parseFloat(entry.creditAmount || "0");
          const debit = parseFloat(entry.debitAmount || "0");
          return sum + credit - debit;
        }, 0);

        // 2. Stock OTW
        const otwContainers = await db
          .select()
          .from(containers)
          .where(and(eq(containers.companyId, companyId), eq(containers.status, "OTW")));
        const stockOtwValue = otwContainers.reduce((sum, container) => {
          return sum + parseFloat(container.grandTotal || "0");
        }, 0);

        // 3-10: All independent — run in parallel
        const [
          dutyAgentBalance,
          transporterAgentBalance,
          loansBalance,
          cashBalance,
          ledgerBankBalance,
          standaloneBankAccountEntries,
          standaloneBankAccountsForBalance,
          directExpenseBalance,
          indirectExpenseBalance,
          incomeBalance,
        ] = await Promise.all([
          getAccountTypeBalance("Duty Agent", true),
          getAccountTypeBalance("Transporter Agent", true),
          getAccountTypeBalance("Loans", true),
          getAccountTypeBalance("Cash", false),
          getAccountTypeBalance("Bank", false),
          db
            .select({
              bankAccountId: voucherEntries.bankAccountId,
              creditAmount: voucherEntries.creditAmount,
              debitAmount: voucherEntries.debitAmount,
            })
            .from(voucherEntries)
            .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
            .innerJoin(bankAccounts, eq(voucherEntries.bankAccountId, bankAccounts.id))
            .where(
              and(
                isNotNull(voucherEntries.bankAccountId),
                isNull(voucherEntries.ledgerAccountId),
                isNull(bankAccounts.linkedLedgerId),
                eq(bankAccounts.companyId, companyId),
                isNull(bankAccounts.deletedAt),
                eq(vouchers.companyId, companyId),
                isNull(vouchers.deletedAt),
                eq(vouchers.optional, false)
              )
            ),
          db
            .select()
            .from(bankAccounts)
            .where(
              and(
                eq(bankAccounts.companyId, companyId),
                isNull(bankAccounts.deletedAt),
                isNull(bankAccounts.linkedLedgerId)
              )
            ),
          getImportChargesBalance(),
          getAccountTypeBalance("Indirect Expense", false),
          getAccountTypeBalance("Income", true),
        ]);

        const standaloneBankOpeningBalance = standaloneBankAccountsForBalance.reduce((sum, account) => {
          const openingBalanceRaw = parseFloat(account.openingBalance || "0");
          const openingSide = account.openingBalanceSide || "Dr";
          return sum + (openingSide === "Dr" ? openingBalanceRaw : -openingBalanceRaw);
        }, 0);
        const standaloneBankVoucherBalance = standaloneBankAccountEntries.reduce((sum, entry) => {
          const credit = parseFloat(entry.creditAmount || "0");
          const debit = parseFloat(entry.debitAmount || "0");
          return sum + debit - credit;
        }, 0);
        const bankBalance = ledgerBankBalance + standaloneBankOpeningBalance + standaloneBankVoucherBalance;

        // 11. Stock on Floor
        // Calculate from quantity * averageRate to ensure accuracy (totalValue can get out of sync)
        const inventoryItems = await db
          .select({
            quantity: inventory.quantity,
            averageRate: inventory.averageRate,
          })
          .from(inventory)
          .innerJoin(locations, eq(inventory.locationId, locations.id))
          .where(and(eq(inventory.companyId, companyId), isNull(locations.deletedAt)));

        const stockOnFloorValue = inventoryItems.reduce((sum, item) => {
          const qty = parseFloat(item.quantity || "0");
          const rate = parseFloat(item.averageRate || "0");
          return sum + qty * rate;
        }, 0);

        // 12. COGS
        const cogsData = await db
          .select({
            totalCost: salesItems.totalCost,
          })
          .from(salesItems)
          .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
          .where(and(eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));

        const cogsBalance = cogsData.reduce((sum, item) => {
          return sum + parseFloat(item.totalCost || "0");
        }, 0);

        // 12b. Consumption expense (from stock adjustment items)
        // Includes: pure Consumption vouchers AND Mixed voucher items with negative quantity
        const consumptionData = await db
          .select({
            totalAmount: stockAdjustmentItems.totalAmount,
            quantity: stockAdjustmentItems.quantity,
            adjustmentType: stockAdjustmentVouchers.adjustmentType,
          })
          .from(stockAdjustmentItems)
          .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
          .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
          .where(
            and(
              eq(vouchers.companyId, companyId),
              isNull(vouchers.deletedAt),
              eq(vouchers.optional, false),
              sql`(LOWER(${stockAdjustmentVouchers.adjustmentType}) = 'consumption' OR LOWER(${stockAdjustmentVouchers.adjustmentType}) = 'mixed')`
            )
          );

        const consumptionBalance = consumptionData.reduce((sum, item) => {
          const qty = parseFloat(item.quantity || "0");
          const adjustmentType = (item.adjustmentType || "").toLowerCase();
          // Pure Consumption: always count (totalAmount is positive, represents consumed value)
          // Mixed: only count items with negative quantity (consumption items)
          if (adjustmentType === "consumption" || (adjustmentType === "mixed" && qty < 0)) {
            return sum + Math.abs(parseFloat(item.totalAmount || "0"));
          }
          return sum;
        }, 0);

        // 12c. Production balance (from stock adjustment items)
        // Includes: pure Production vouchers AND Mixed voucher items with positive quantity
        const productionData = await db
          .select({
            totalAmount: stockAdjustmentItems.totalAmount,
            quantity: stockAdjustmentItems.quantity,
            adjustmentType: stockAdjustmentVouchers.adjustmentType,
          })
          .from(stockAdjustmentItems)
          .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
          .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
          .where(
            and(
              eq(vouchers.companyId, companyId),
              isNull(vouchers.deletedAt),
              eq(vouchers.optional, false),
              sql`(LOWER(${stockAdjustmentVouchers.adjustmentType}) = 'production' OR LOWER(${stockAdjustmentVouchers.adjustmentType}) = 'mixed')`
            )
          );

        const productionBalance = productionData.reduce((sum, item) => {
          const qty = parseFloat(item.quantity || "0");
          const adjustmentType = (item.adjustmentType || "").toLowerCase();
          // Pure Production: always count (totalAmount is positive, represents produced value)
          // Mixed: only count items with positive quantity (production items)
          if (adjustmentType === "production" || (adjustmentType === "mixed" && qty > 0)) {
            return sum + parseFloat(item.totalAmount || "0");
          }
          return sum;
        }, 0);

        // 14. Salary Advances
        const advancesData = await db
          .select({
            remainingBalance: salaryAdvances.remainingBalance,
          })
          .from(salaryAdvances)
          .where(and(eq(salaryAdvances.companyId, companyId), eq(salaryAdvances.fullyPaid, false)));

        const salaryAdvancesBalance = advancesData.reduce((sum, advance) => {
          return sum + parseFloat(advance.remainingBalance || "0");
        }, 0);

        // 15. Payroll Liabilities
        const employeesData = await db
          .select({
            currentBalance: employees.currentBalance,
          })
          .from(employees)
          .where(and(eq(employees.companyId, companyId), isNull(employees.deletedAt)));

        const payrollLiabilitiesBalance = employeesData.reduce((sum, emp) => {
          const balance = parseFloat(emp.currentBalance || "0");
          return sum + (balance > 0 ? balance : 0);
        }, 0);

        // 16-19. Other account type balances
        const assetBalance = await getAccountTypeBalance("Asset", false);
        const governmentTaxesBalance = await getAccountTypeBalance("Government Taxes", false);
        const liabilityBalance = await getAccountTypeBalance("Liability", true);
        const profitBalance = await getAccountTypeBalance("Profit", true);

        // Build components breakdown for verification
        // NOTE: Production and Consumption are shown for reference but NOT included in the balance calculation
        //       Their effects are already reflected in stockOnFloorValue (inventory movements)
        const assetComponents = [
          { name: "Stock OTW", value: stockOtwValue },
          { name: "Cash", value: cashBalance },
          { name: "Bank", value: bankBalance },
          { name: "Stock on Floor", value: stockOnFloorValue },
          { name: "Assets", value: assetBalance },
          { name: "Direct Expenses", value: directExpenseBalance },
          { name: "Indirect Expenses", value: indirectExpenseBalance },
          { name: "Government Taxes", value: governmentTaxesBalance },
          { name: "COGS", value: cogsBalance },
          { name: "Salary Advances", value: salaryAdvancesBalance },
          { name: "Consumption (info only)", value: consumptionBalance },
          { name: "Production (info only)", value: productionBalance },
        ].filter((c) => Math.abs(c.value) >= 0.01);

        const liabilityComponents = [
          { name: "Supplier Balance", value: supplierBalance },
          { name: "Duty Agent", value: dutyAgentBalance },
          { name: "Transporter Agent", value: transporterAgentBalance },
          { name: "Loans", value: loansBalance },
          { name: "Liabilities", value: liabilityBalance },
          { name: "Profit/Equity", value: profitBalance },
          { name: "Income", value: incomeBalance },
          { name: "Payroll Liabilities", value: payrollLiabilitiesBalance },
        ].filter((c) => Math.abs(c.value) >= 0.01);

        // NOTE: Production and Consumption are EXCLUDED from the balance calculation
        // Their effects are already reflected in stockOnFloorValue (inventory movements)
        // They are tracked for informational/diagnostic purposes only
        // T003: directExpenseBalance is intentionally EXCLUDED here (matches the canonical import-cycle-balance formula).
        // Import charges (duties, transport, etc.) are already capitalized into stockOnFloorValue — including
        // them again in assets double-counts those costs and causes the profit recalculation to overshoot.
        const totalAssets =
          stockOtwValue +
          cashBalance +
          bankBalance +
          stockOnFloorValue +
          assetBalance +
          indirectExpenseBalance +
          governmentTaxesBalance +
          cogsBalance +
          salaryAdvancesBalance;

        // Calculate liabilities WITHOUT profit (to avoid circular dependency)
        const totalLiabilitiesWithoutProfit =
          supplierBalance +
          dutyAgentBalance +
          transporterAgentBalance +
          loansBalance +
          liabilityBalance +
          incomeBalance +
          payrollLiabilitiesBalance;

        // Total liabilities includes profit for display purposes
        const totalLiabilities = totalLiabilitiesWithoutProfit + profitBalance;

        // Calculate the net import cycle balance (imbalance)
        const netImportCycleBalance = totalAssets - totalLiabilities;

        // The TARGET profit to zero the balance: Profit = Assets - Liabilities_without_profit
        const targetProfitSigned = totalAssets - totalLiabilitiesWithoutProfit;

        const componentsBreakdown = {
          assets: assetComponents,
          liabilities: liabilityComponents,
          totalAssets,
          totalLiabilities,
        };

        // If imbalance is very small (< $1), consider it balanced
        if (Math.abs(netImportCycleBalance) < 1) {
          results.push({
            companyId,
            companyName: company.name,
            imbalance: netImportCycleBalance,
            accountCreated: false,
            message: "Already balanced (imbalance < $1)",
            components: componentsBreakdown,
          });
          continue;
        }

        // Check if any Profit account exists - if so, update the first one instead of creating new
        const existingProfitAccounts = await db
          .select()
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.companyId, companyId),
              eq(ledgerAccounts.accountType, "Profit"),
              isNull(ledgerAccounts.deletedAt)
            )
          );

        if (existingProfitAccounts.length > 0) {
          // Update the first/main Profit account instead of creating new
          const profitAccount = existingProfitAccounts[0];
          const currentBalance = parseFloat(profitAccount.openingBalance || "0");
          const currentSide = profitAccount.openingBalanceSide || "Cr";

          // Calculate the current opening balance as a signed value
          // For Profit accounts: Cr is positive (normal), Dr is negative
          const currentOpeningSigned = currentSide === "Cr" ? currentBalance : -currentBalance;

          // profitBalance = opening balance + voucher entries
          // So netEntries = profitBalance - currentOpeningSigned
          const netEntries = profitBalance - currentOpeningSigned;

          // We want total Profit balance (opening + entries) = targetProfitSigned
          // So: newOpening + netEntries = targetProfitSigned
          // Therefore: newOpening = targetProfitSigned - netEntries
          const newOpeningSigned = targetProfitSigned - netEntries;

          // Convert to absolute value and side (positive = Cr for equity/profit accounts)
          const newOpeningBalance = Math.abs(newOpeningSigned).toFixed(2);
          const newOpeningBalanceSide: "Dr" | "Cr" = newOpeningSigned >= 0 ? "Cr" : "Dr";

          // Update the account using raw query since storage.updateLedgerAccount may not support all fields
          await db
            .update(ledgerAccounts)
            .set({
              openingBalance: newOpeningBalance,
              openingBalanceSide: newOpeningBalanceSide,
            })
            .where(eq(ledgerAccounts.id, profitAccount.id));

          results.push({
            companyId,
            companyName: company.name,
            imbalance: netImportCycleBalance,
            accountCreated: false,
            accountUpdated: true,
            accountCode: profitAccount.code,
            accountName: profitAccount.name,
            previousBalance: `${currentBalance.toFixed(2)} ${currentSide}`,
            openingBalance: newOpeningBalance,
            openingBalanceSide: newOpeningBalanceSide,
            message: `Updated ${profitAccount.code} - ${profitAccount.name}: ${currentBalance.toFixed(2)} ${currentSide} → ${newOpeningBalance} ${newOpeningBalanceSide}`,
            components: componentsBreakdown,
          });
          continue;
        }

        // No existing Profit account - generate unique code for new capital account
        const nextCodeNum = 1;
        const accountCode = `CAP-${String(nextCodeNum).padStart(3, "0")}`;
        const accountName = "Owner's Capital";

        // Set Profit = Assets - Liabilities_without_profit to zero the import cycle
        // Positive target = Cr (equity), Negative target = Dr
        const openingBalanceSide: "Dr" | "Cr" = targetProfitSigned >= 0 ? "Cr" : "Dr";
        const openingBalanceAmount = Math.abs(targetProfitSigned).toFixed(2);

        // Create the Owner's Capital account
        await storage.createLedgerAccount({
          companyId,
          code: accountCode,
          name: accountName,
          accountType: "Profit",
          openingBalance: openingBalanceAmount,
          openingBalanceSide: openingBalanceSide,
          active: true,
        });

        results.push({
          companyId,
          companyName: company.name,
          imbalance: netImportCycleBalance,
          accountCreated: true,
          accountCode,
          accountName,
          openingBalance: openingBalanceAmount,
          openingBalanceSide,
          message: `Created ${accountCode} - ${accountName} with opening balance ${openingBalanceAmount} ${openingBalanceSide}`,
          components: componentsBreakdown,
        });
      }

      // Generate SQL summary for production database
      const sqlStatements: string[] = [];
      for (const result of results) {
        if (result.accountCreated) {
          sqlStatements.push(
            `INSERT INTO ledger_accounts (company_id, code, name, account_type, opening_balance, opening_balance_side, active)\nVALUES (${result.companyId}, '${result.accountCode}', '${result.accountName}', 'Profit', ${result.openingBalance}, '${result.openingBalanceSide}', true);`
          );
        } else if ((result as any).accountUpdated) {
          sqlStatements.push(
            `UPDATE ledger_accounts SET opening_balance = '${result.openingBalance}', opening_balance_side = '${result.openingBalanceSide}'\nWHERE company_id = ${result.companyId} AND code = '${result.accountCode}';`
          );
        }
      }

      res.json({
        message: `Processed ${results.length} companies`,
        results,
        sqlForProduction:
          sqlStatements.length > 0 ? sqlStatements.join("\n\n") : "No accounts needed to be created or updated",
      });
    } catch (error: any) {
      console.error("Error initializing accounting balances:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Employees
}
