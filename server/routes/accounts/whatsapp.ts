/**
 * accountRoutes: AccountWhatsapp endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { factoryAccountWhatsappRules, ledgerAccounts } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { generateAccountStatementPdf } from "../../lib/accountStatementPdfGenerator";
import { sendWhatsAppFileByUploadPos } from "../../services/whatsappService";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { parseId } from "../../lib/parseId";
import { logger } from "../../lib/logger";

export function registerAccountWhatsappRoutes(app: Express) {
  // ERP-mode WhatsApp rule GET — mirrors /api/factory/accounts/:id/whatsapp-rule
  // without the factory-company middleware guard.
  app.get("/api/accounts/:accountId/whatsapp-rule", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseId(req.params.accountId);
      if (accountId === null) return res.status(400).json({ message: "Invalid id" });
      const companyId = req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const [rule] = await db
        .select()
        .from(factoryAccountWhatsappRules)
        .where(
          and(
            eq(factoryAccountWhatsappRules.companyId, companyId),
            eq(factoryAccountWhatsappRules.ledgerAccountId, accountId)
          )
        );

      res.json(
        rule ?? {
          id: null,
          companyId,
          ledgerAccountId: accountId,
          enabled: false,
          whatsappChatId: null,
          sendOnPayment: true,
          sendOnReceipt: true,
          sendOnJournal: true,
        }
      );
    } catch (err: unknown) {
      logger.error("[erp-wa] GET rule error", { error: err });
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });

  // ERP-mode WhatsApp rule PUT (upsert) — mirrors /api/factory/accounts/:id/whatsapp-rule.
  app.put("/api/accounts/:accountId/whatsapp-rule", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseId(req.params.accountId);
      if (accountId === null) return res.status(400).json({ message: "Invalid id" });
      const companyId = req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const [acct] = await db
        .select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.companyId, companyId)));
      if (!acct) return res.status(404).json({ message: "Account not found" });

      const { enabled, whatsappChatId, sendOnPayment, sendOnReceipt, sendOnJournal } = req.body;

      const [upserted] = await db
        .insert(factoryAccountWhatsappRules)
        .values({
          companyId,
          ledgerAccountId: accountId,
          enabled: Boolean(enabled),
          whatsappChatId: whatsappChatId ?? null,
          sendOnPayment: sendOnPayment ?? true,
          sendOnReceipt: sendOnReceipt ?? true,
          sendOnJournal: sendOnJournal ?? true,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [factoryAccountWhatsappRules.companyId, factoryAccountWhatsappRules.ledgerAccountId],
          set: {
            enabled: Boolean(enabled),
            whatsappChatId: whatsappChatId ?? null,
            sendOnPayment: sendOnPayment ?? true,
            sendOnReceipt: sendOnReceipt ?? true,
            sendOnJournal: sendOnJournal ?? true,
            updatedAt: new Date(),
          },
        })
        .returning();

      res.json(upserted);
    } catch (err: unknown) {
      logger.error("[erp-wa] PUT rule error", { error: err });
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });

  // ERP-mode WhatsApp statement send — identical logic to the factory-prefixed
  // route but without the factory-company middleware guard, so ERP users can use it.
  app.post("/api/accounts/:accountId/send-statement-whatsapp", requireAuth, async (req: Request, res: Response) => {
    const _t = Date.now();
    const _uid = req.session?.userId;
    const _cid = req.session?.currentCompanyId;
    try {
      const accountId = parseId(req.params.accountId);
      if (accountId === null) return res.status(400).json({ message: "Invalid id" });
      const companyId = req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const [acct] = await db
        .select({ id: ledgerAccounts.id, name: ledgerAccounts.name })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.companyId, companyId)));
      if (!acct) return res.status(404).json({ message: "Account not found" });

      const [rule] = await db
        .select()
        .from(factoryAccountWhatsappRules)
        .where(
          and(
            eq(factoryAccountWhatsappRules.companyId, companyId),
            eq(factoryAccountWhatsappRules.ledgerAccountId, accountId)
          )
        );
      if (!rule?.whatsappChatId) {
        return res.status(400).json({ message: "No WhatsApp target configured for this account" });
      }

      const { month } = req.body as { month?: string };
      let startDate: string;
      let endDate: string;
      if (month) {
        const base = new Date(`${month}-01T00:00:00`);
        startDate = format(startOfMonth(base), "yyyy-MM-dd");
        endDate = format(endOfMonth(base), "yyyy-MM-dd");
      } else {
        const now = new Date();
        startDate = format(startOfMonth(now), "yyyy-MM-dd");
        endDate = format(endOfMonth(now), "yyyy-MM-dd");
      }

      const safeAccName = acct.name.replace(/[^\w\s.()-]/g, "_");
      const monthLabel = month ?? format(new Date(), "yyyy-MM");
      const fileName = `${safeAccName} Statement ${monthLabel}.pdf`;
      const caption = `${acct.name} — Statement ${monthLabel}`;

      const pdfBuf = await generateAccountStatementPdf({
        accountType: "ledger",
        accountId,
        companyId,
        startDate,
        endDate,
        lang: "en",
      });

      const result = await sendWhatsAppFileByUploadPos(rule.whatsappChatId, pdfBuf, fileName, caption);
      if (!result.success) {
        logger.error("[erp-wa] manual send failed", { error: result.error });
        return res.status(502).json({ message: result.error ?? "WhatsApp send failed" });
      }

      logger.info("erp whatsapp send-statement succeeded", {
        module: "erpWhatsapp",
        action: "sendStatement",
        userId: _uid,
        companyId: _cid,
        durationMs: Date.now() - _t,
      });
      res.json({ success: true, fileName });
    } catch (err: unknown) {
      logger.error("[erp-wa] POST send error", { error: err });
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });

  // Get all vouchers with date filtering
}
