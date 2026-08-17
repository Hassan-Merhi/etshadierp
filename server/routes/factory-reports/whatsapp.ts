/**
 * factoryReportRoutes: FactoryMixBatchWhatsapp endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { pool } from "../../db";
import { logAudit } from "../_helpers";

export function registerFactoryMixBatchWhatsappRoutes(app: Express, requireAuth: any, db: any) {
  // ── Send mix batch image to WhatsApp ─────────────────────────────────────
  app.post("/api/factory/send-mix-batch-image-whatsapp", requireAuth, async (req: Request, res: Response) => {
    try {
      const { imageBase64, date, fileName } = req.body ?? {};
      if (!imageBase64) return res.status(400).json({ message: "imageBase64 is required" });

      const r = await pool.query(
        `SELECT weekly_report_wa_group_chat_id, instance_id, api_token, enabled FROM whatsapp_settings WHERE id = 1`
      );
      const s = r.rows?.[0];
      if (!s?.weekly_report_wa_group_chat_id) {
        return res
          .status(400)
          .json({ message: "No WhatsApp group configured. Go to Settings → Export Settings to configure one." });
      }
      if (!s.instance_id || !s.api_token) {
        return res.status(400).json({ message: "WhatsApp credentials not configured." });
      }
      if (!s.enabled) {
        return res.status(400).json({ message: "WhatsApp sending is disabled." });
      }

      const base64Data = String(imageBase64).replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const today = date || new Date().toISOString().substring(0, 10);
      const finalFileName = String(fileName || `MixBatch_${today}.png`);
      const caption = `Mix Batch Details — ${today}`;

      const { sendWhatsAppFileToChatId } = await import("../../services/whatsappService");
      const result = await sendWhatsAppFileToChatId(
        s.weekly_report_wa_group_chat_id,
        buffer,
        finalFileName,
        caption,
        "image/png"
      );
      if (!result.success) {
        return res.status(500).json({ message: result.error || "Failed to send" });
      }
      // Non-fatal: audit write must not block the WhatsApp confirmation response
      try {
        const waCompanyId = req.session.factoryCompanyId || req.session.currentCompanyId;
        if (waCompanyId) {
          await logAudit({
            userId: req.session.userId!,
            username: req.session.username || req.session.userId!,
            companyId: waCompanyId,
            action: "send_whatsapp",
            tableName: "reports",
            recordId: null,
            recordIdentifier: `Mix Batch Details — ${today}`,
            changes: { format: { old: null, new: "image/png" } },
          });
        }
      } catch (auditErr) {
        logger.error("[mix-batch-wa] audit write failed:", { error: auditErr });
      }
      res.json({ ok: true, message: "Mix batch image sent to WhatsApp group." });
    } catch (err: unknown) {
      logger.error("[mix-batch-wa] send error:", { error: err });
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });
}
