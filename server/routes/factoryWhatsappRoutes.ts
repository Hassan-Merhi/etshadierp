/**
 * Factory Account WhatsApp Auto-Statement Routes
 *
 * GET  /api/factory/accounts/:accountId/whatsapp-rule  — fetch rule for an account
 * PUT  /api/factory/accounts/:accountId/whatsapp-rule  — upsert rule
 * POST /api/factory/accounts/:accountId/send-statement-whatsapp — manual send
 */

import type { Express } from "express";
import { db } from "../db";
import { factoryAccountWhatsappRules, ledgerAccounts } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { generateAccountStatementPdf } from "../lib/accountStatementPdfGenerator";
import { sendWhatsAppFileByUploadPos } from "../services/whatsappService";
import { format, startOfMonth, endOfMonth } from "date-fns";

export function registerFactoryWhatsappRoutes(app: Express, requireAuth: any) {

  // ── GET rule ──────────────────────────────────────────────────────────────
  app.get("/api/factory/accounts/:accountId/whatsapp-rule", requireAuth, async (req: any, res: any) => {
    try {
      const accountId = parseInt(req.params.accountId);
      const companyId = req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid account ID" });

      const [rule] = await db
        .select()
        .from(factoryAccountWhatsappRules)
        .where(and(
          eq(factoryAccountWhatsappRules.companyId, companyId),
          eq(factoryAccountWhatsappRules.ledgerAccountId, accountId),
        ));

      // Return null-ish defaults when rule doesn't exist yet
      res.json(rule ?? {
        id: null,
        companyId,
        ledgerAccountId: accountId,
        enabled: false,
        whatsappChatId: null,
        sendOnPayment: true,
        sendOnReceipt: true,
        sendOnJournal: true,
      });
    } catch (err: any) {
      console.error("[factory-wa] GET rule error", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── PUT (upsert) rule ─────────────────────────────────────────────────────
  app.put("/api/factory/accounts/:accountId/whatsapp-rule", requireAuth, async (req: any, res: any) => {
    try {
      const accountId = parseInt(req.params.accountId);
      const companyId = req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid account ID" });

      // Verify account belongs to this company
      const [acct] = await db.select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.companyId, companyId)));
      if (!acct) return res.status(404).json({ message: "Account not found" });

      const { enabled, whatsappChatId, sendOnPayment, sendOnReceipt, sendOnJournal } = req.body;

      const [upserted] = await db
        .insert(factoryAccountWhatsappRules)
        .values({
          companyId,
          ledgerAccountId: accountId,
          enabled:         Boolean(enabled),
          whatsappChatId:  whatsappChatId ?? null,
          sendOnPayment:   sendOnPayment  ?? true,
          sendOnReceipt:   sendOnReceipt  ?? true,
          sendOnJournal:   sendOnJournal  ?? true,
          updatedAt:       new Date(),
        })
        .onConflictDoUpdate({
          target: [factoryAccountWhatsappRules.companyId, factoryAccountWhatsappRules.ledgerAccountId],
          set: {
            enabled:       Boolean(enabled),
            whatsappChatId: whatsappChatId ?? null,
            sendOnPayment: sendOnPayment  ?? true,
            sendOnReceipt: sendOnReceipt  ?? true,
            sendOnJournal: sendOnJournal  ?? true,
            updatedAt:     new Date(),
          },
        })
        .returning();

      res.json(upserted);
    } catch (err: any) {
      console.error("[factory-wa] PUT rule error", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST manual send ──────────────────────────────────────────────────────
  app.post("/api/factory/accounts/:accountId/send-statement-whatsapp", requireAuth, async (req: any, res: any) => {
    try {
      const accountId = parseInt(req.params.accountId);
      const companyId = req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid account ID" });

      // Verify account belongs to company
      const [acct] = await db.select({ id: ledgerAccounts.id, name: ledgerAccounts.name })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.companyId, companyId)));
      if (!acct) return res.status(404).json({ message: "Account not found" });

      // Load rule
      const [rule] = await db.select()
        .from(factoryAccountWhatsappRules)
        .where(and(
          eq(factoryAccountWhatsappRules.companyId, companyId),
          eq(factoryAccountWhatsappRules.ledgerAccountId, accountId),
        ));

      if (!rule?.whatsappChatId) {
        return res.status(400).json({ message: "No WhatsApp target configured for this account" });
      }

      // Determine month from body (default: current month)
      const { month } = req.body as { month?: string };
      let startDate: string;
      let endDate: string;
      if (month) {
        const base = new Date(`${month}-01T00:00:00`);
        startDate = format(startOfMonth(base), "yyyy-MM-dd");
        endDate   = format(endOfMonth(base),   "yyyy-MM-dd");
      } else {
        const now = new Date();
        startDate = format(startOfMonth(now), "yyyy-MM-dd");
        endDate   = format(endOfMonth(now),   "yyyy-MM-dd");
      }

      const safeAccName = acct.name.replace(/[^\w\s.()\-]/g, "_");
      const monthLabel  = month ?? format(new Date(), "yyyy-MM");
      const fileName    = `${safeAccName} Statement ${monthLabel}.pdf`;
      const caption     = `${acct.name} — Statement ${monthLabel}`;

      const pdfBuf = await generateAccountStatementPdf({
        accountType: "ledger",
        accountId,
        companyId,
        startDate,
        endDate,
        lang: "en",
      });

      const result = await sendWhatsAppFileByUploadPos(
        rule.whatsappChatId,
        pdfBuf,
        fileName,
        caption,
      );

      if (!result.success) {
        console.error("[factory-wa] manual send failed", result.error);
        return res.status(502).json({ message: result.error ?? "WhatsApp send failed" });
      }

      res.json({ success: true, fileName });
    } catch (err: any) {
      console.error("[factory-wa] POST send error", err);
      res.status(500).json({ message: err.message });
    }
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Checks whether a WhatsApp statement would be triggered for this voucher,
 * WITHOUT actually sending. Used so the frontend can prompt the user.
 *
 * Returns { prompt: true, accountId, voucherDate, month } when a rule applies,
 * or { prompt: false } when no rule is configured / applicable.
 */
export async function checkAccountWhatsAppRule(opts: {
  companyId:    number;
  accountId:    number;
  accountType:  string;
  voucherType:  "Payment" | "Receipt" | "Journal";
  voucherDate:  string;
}): Promise<{ prompt: boolean; accountId?: number; voucherDate?: string; month?: string }> {
  const { companyId, accountId, accountType, voucherType, voucherDate } = opts;
  if (accountType !== "ledger") return { prompt: false };
  try {
    const [rule] = await db.select()
      .from(factoryAccountWhatsappRules)
      .where(and(
        eq(factoryAccountWhatsappRules.companyId, companyId),
        eq(factoryAccountWhatsappRules.ledgerAccountId, accountId),
      ));
    if (!rule || !rule.enabled || !rule.whatsappChatId) return { prompt: false };
    if (voucherType === "Payment" && !rule.sendOnPayment) return { prompt: false };
    if (voucherType === "Receipt" && !rule.sendOnReceipt) return { prompt: false };
    if (voucherType === "Journal" && !rule.sendOnJournal) return { prompt: false };
    const month = voucherDate.substring(0, 7); // "yyyy-MM"
    return { prompt: true, accountId, voucherDate, month };
  } catch {
    return { prompt: false };
  }
}

/**
 * Called after a voucher save (Payment/Receipt/Journal).
 * Fires-and-forgets — never throws, so voucher save is unaffected.
 *
 * Returns a result summary for the API response.
 */
export async function triggerAccountWhatsAppStatement(opts: {
  companyId:    number;
  accountId:    number;
  accountType:  string;    // "ledger" | "bank" | ...
  voucherType:  "Payment" | "Receipt" | "Journal";
  voucherDate:  string;    // yyyy-MM-dd
}): Promise<{ sent: boolean; error?: string }> {
  const { companyId, accountId, accountType, voucherType, voucherDate } = opts;

  // Only supported for ledger accounts
  if (accountType !== "ledger") return { sent: false };

  try {
    const [rule] = await db.select()
      .from(factoryAccountWhatsappRules)
      .where(and(
        eq(factoryAccountWhatsappRules.companyId, companyId),
        eq(factoryAccountWhatsappRules.ledgerAccountId, accountId),
      ));

    if (!rule || !rule.enabled || !rule.whatsappChatId) return { sent: false };

    // Check voucher-type gate
    if (voucherType === "Payment" && !rule.sendOnPayment) return { sent: false };
    if (voucherType === "Receipt" && !rule.sendOnReceipt) return { sent: false };
    if (voucherType === "Journal" && !rule.sendOnJournal) return { sent: false };

    // Month boundaries from voucher date
    const base      = new Date(`${voucherDate}T00:00:00`);
    const startDate = format(startOfMonth(base), "yyyy-MM-dd");
    const endDate   = format(endOfMonth(base),   "yyyy-MM-dd");
    const monthLabel = format(base, "yyyy-MM");

    const [acct] = await db.select({ name: ledgerAccounts.name })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.id, accountId));
    const accName  = acct?.name ?? `Account #${accountId}`;
    const safeAccName = accName.replace(/[^\w\s.()\-]/g, "_");
    const fileName = `${safeAccName} Statement ${monthLabel}.pdf`;
    const caption  = `${accName} — Statement ${monthLabel}`;

    const pdfBuf = await generateAccountStatementPdf({
      accountType: "ledger",
      accountId,
      companyId,
      startDate,
      endDate,
      lang: "en",
    });

    const result = await sendWhatsAppFileByUploadPos(
      rule.whatsappChatId,
      pdfBuf,
      fileName,
      caption,
    );

    if (!result.success) {
      console.error("[factory-wa] auto-send failed", { accountId, voucherType, error: result.error });
      return { sent: false, error: result.error };
    }

    console.log(`[factory-wa] statement sent for account ${accountId} (${voucherType}, ${monthLabel})`);
    return { sent: true };
  } catch (err: any) {
    console.error("[factory-wa] auto-send exception", err);
    return { sent: false, error: err.message };
  }
}
