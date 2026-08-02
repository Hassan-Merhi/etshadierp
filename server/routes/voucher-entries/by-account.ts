/**
 * voucherEntryRoutes: VoucherEntryByAccount endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { db } from "../../db";
import { requireAuth, requireNonPOS } from "../../auth";
import { vouchers, voucherEntries, ledgerAccounts } from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { z } from "zod";

export function registerVoucherEntryByAccountRoutes(app: Express) {
  // ── ACCOUNT TRANSFER: fetch all entries for a ledger account ──
  app.get("/api/voucher-entries/by-account/:accountId", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const accountId = parseInt(req.params.accountId);
      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid account ID" });

      const [account] = await db
        .select()
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.companyId, companyId)));
      if (!account) return res.status(404).json({ message: "Account not found" });

      const rows = await db
        .select({
          id: voucherEntries.id,
          voucherId: voucherEntries.voucherId,
          narration: voucherEntries.narration,
          debitAmount: voucherEntries.debitAmount,
          creditAmount: voucherEntries.creditAmount,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          voucherDescription: vouchers.description,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
        .where(and(eq(voucherEntries.ledgerAccountId, accountId), eq(vouchers.companyId, companyId)))
        .orderBy(desc(vouchers.voucherDate), desc(vouchers.id));

      res.json(rows);
    } catch (e: unknown) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // ── ACCOUNT TRANSFER: move selected entries to a different ledger account ──
  app.post("/api/voucher-entries/transfer-account", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { entryIds, toAccountId } = z
        .object({
          entryIds: z.array(z.number().int().positive()).min(1, "Select at least one entry"),
          toAccountId: z.number().int().positive("Destination account required"),
        })
        .parse(req.body);

      const [toAccount] = await db
        .select()
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, toAccountId), eq(ledgerAccounts.companyId, companyId)));
      if (!toAccount) return res.status(404).json({ message: "Destination account not found" });

      // Verify all entries belong to the current company via their vouchers
      const entriesWithVouchers = await db
        .select({ id: voucherEntries.id, companyId: vouchers.companyId })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(vouchers.id, voucherEntries.voucherId))
        .where(inArray(voucherEntries.id, entryIds));

      const unauthorised = entriesWithVouchers.filter((e) => e.companyId !== companyId);
      if (unauthorised.length > 0) {
        return res.status(403).json({ message: "Some entries do not belong to the current company" });
      }
      if (entriesWithVouchers.length !== entryIds.length) {
        return res.status(404).json({ message: "Some entries were not found" });
      }

      await db.update(voucherEntries).set({ ledgerAccountId: toAccountId }).where(inArray(voucherEntries.id, entryIds));

      res.json({ moved: entryIds.length, toAccount: toAccount.name });
    } catch (e: unknown) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.issues.map((x) => x.message).join(", ") });
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });
}
