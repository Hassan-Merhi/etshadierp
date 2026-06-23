/**
 * End Production Routes
 *
 * POST /api/factory/stock-entry/end-production
 *   Generates the Worker Bales PDF for today (same data as StockEntryHistory →
 *   Worker PDF), sends it to the configured production WhatsApp group, then
 *   marks the session as ended.  Returns an error if send fails — in that case
 *   the session is NOT marked ended.
 *
 * GET  /api/factory/stock-entry/production-session?date=YYYY-MM-DD
 *   Returns the production session record for the given date (or today).
 *
 * POST /api/factory/bales/send-worker-pdf-whatsapp
 *   Manual send: generates + sends the Worker PDF for the given date WITHOUT
 *   marking production ended.
 */

import type { Express } from "express";
import { db, pool } from "../../db";
import { factoryProductionSessions, factorySettings } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { getClientDate } from "../../lib/dateUtils";
import { generateWorkerBalesPdf } from "../../lib/workerBalesPdfGenerator";
import { sendWhatsAppFileByUploadPos } from "../../services/whatsappService";

// ── Helper: fetch bale groups for a date (mirrors factoryBalesRoutes query) ──
async function fetchBaleGroupsForDate(companyId: number, date: string) {
  const rows = await db.execute(sql`
    SELECT
      fb.finalized_by              AS "workerId",
      fw.full_name                 AS "workerName",
      fb.product_id                AS "productId",
      fbp.name                     AS "productName",
      fbp.article_code             AS "articleCode",
      COUNT(*)::int                AS "baleCount",
      ROUND(SUM(CAST(fb.weight_kg AS numeric)), 3) AS "totalWeight",
      JSON_AGG(JSON_BUILD_OBJECT(
        'id',              fb.id,
        'referenceNumber', fb.reference_number,
        'weightKg',        fb.weight_kg,
        'status',          fb.status,
        'workerName',      fw.full_name,
        'productName',     fbp.name,
        'articleCode',     fbp.article_code
      ) ORDER BY fb.finalized_at ASC) AS "bales"
    FROM factory_bales fb
    LEFT JOIN factory_workers fw
      ON fb.finalized_by = fw.id AND fw.company_id = ${companyId}
    LEFT JOIN factory_bale_products fbp
      ON fb.product_id = fbp.id AND fbp.company_id = ${companyId}
    WHERE fb.company_id = ${companyId}
      AND fb.stock_entry_date IS NOT NULL
      AND fb.stock_entry_date = ${date}
    GROUP BY fb.finalized_by, fw.full_name, fb.product_id, fbp.name, fbp.article_code
    ORDER BY fw.full_name NULLS LAST, fbp.name NULLS LAST
  `);
  return rows.rows as any[];
}

// ── Helper: get company name ──────────────────────────────────────────────────
async function getCompanyName(companyId: number): Promise<string> {
  const res = await pool.query("SELECT name FROM companies WHERE id = $1", [companyId]);
  return res.rows?.[0]?.name ?? "";
}

// ── Helper: get production WhatsApp group from factory_settings.extraSettings ─
async function getProductionWaGroupId(companyId: number): Promise<string | null> {
  const [settings] = await db
    .select({ extraSettings: factorySettings.extraSettings })
    .from(factorySettings)
    .where(eq(factorySettings.companyId, companyId));

  const extra = (settings?.extraSettings as any) ?? {};
  return extra.productionWorkerMatrixWhatsappGroupId ?? null;
}

// ── Helper: sanitise filename ─────────────────────────────────────────────────
function safeFileName(companyName: string, date: string): string {
  const safe = companyName
    .replace(/[^a-zA-Z0-9 \-_.]/g, "")
    .trim()
    .slice(0, 60);
  return `Worker Matrix ${safe} ${date}.pdf`;
}

export function registerEndProductionRoutes(app: Express, requireAuth: any) {
  // ── GET production session ─────────────────────────────────────────────────
  app.get("/api/factory/stock-entry/production-session", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session?.factoryCompanyId || req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const date = (req.query.date as string) || getClientDate(req);

      const [session] = await db
        .select()
        .from(factoryProductionSessions)
        .where(
          and(eq(factoryProductionSessions.companyId, companyId), eq(factoryProductionSessions.sessionDate, date))
        );

      res.json(session ?? null);
    } catch (err: any) {
      console.error("[endProduction] GET session error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST end-production ────────────────────────────────────────────────────
  app.post("/api/factory/stock-entry/end-production", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session?.factoryCompanyId || req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const date = (req.body?.date as string) || getClientDate(req);
      const endedBy = req.session?.username ?? req.session?.userId ?? null;

      // Check not already ended
      const [existing] = await db
        .select()
        .from(factoryProductionSessions)
        .where(
          and(eq(factoryProductionSessions.companyId, companyId), eq(factoryProductionSessions.sessionDate, date))
        );

      if (existing?.productionEndedAt) {
        return res.status(409).json({
          message: "Production already ended for this date.",
          session: existing,
        });
      }

      // Load bale data
      const groups = await fetchBaleGroupsForDate(companyId, date);
      if (!groups || groups.length === 0) {
        return res.status(404).json({ message: "No stock entry session found for today." });
      }

      // Get configured WhatsApp group
      const chatId = await getProductionWaGroupId(companyId);
      if (!chatId) {
        return res.status(400).json({ message: "No production WhatsApp group configured." });
      }

      // Generate PDF (same structure as Worker PDF in StockEntryHistory)
      const companyName = await getCompanyName(companyId);
      const pdfBuffer = await generateWorkerBalesPdf(groups, date, companyName);

      const fileName = safeFileName(companyName, date);

      // Send via WhatsApp (chatId, fileBuffer, fileName, caption, mimeType)
      const waResult = await sendWhatsAppFileByUploadPos(
        chatId,
        pdfBuffer,
        fileName,
        `Worker Matrix — ${companyName} — ${date}`,
        "application/pdf"
      );

      if (!waResult?.success) {
        return res.status(502).json({
          message: `Worker Matrix WhatsApp send failed. Production was not ended. ${waResult?.error ?? ""}`.trim(),
        });
      }

      // Mark production ended
      const now = new Date();
      const [session] = await db
        .insert(factoryProductionSessions)
        .values({
          companyId,
          sessionDate: date,
          productionEndedAt: now,
          productionEndedBy: endedBy ? String(endedBy) : null,
          workerMatrixWhatsappSentAt: now,
          workerMatrixWhatsappMessageId: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [factoryProductionSessions.companyId, factoryProductionSessions.sessionDate],
          set: {
            productionEndedAt: now,
            productionEndedBy: endedBy ? String(endedBy) : null,
            workerMatrixWhatsappSentAt: now,
            workerMatrixWhatsappMessageId: null,
            updatedAt: now,
          },
        })
        .returning();

      res.json({
        message: "Production ended. Worker Matrix PDF sent to WhatsApp.",
        session,
        whatsapp: waResult,
      });
    } catch (err: any) {
      console.error("[endProduction] POST end-production error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST manual send (no production end) ──────────────────────────────────
  app.post("/api/factory/bales/send-worker-pdf-whatsapp", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session?.factoryCompanyId || req.session?.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const date = (req.body?.date as string) || getClientDate(req);

      const groups = await fetchBaleGroupsForDate(companyId, date);
      if (!groups || groups.length === 0) {
        return res.status(404).json({ message: "No stock entry data found for the given date." });
      }

      const chatId = await getProductionWaGroupId(companyId);
      if (!chatId) {
        return res.status(400).json({ message: "No production WhatsApp group configured." });
      }

      const companyName = await getCompanyName(companyId);
      const pdfBuffer = await generateWorkerBalesPdf(groups, date, companyName);
      const fileName = safeFileName(companyName, date);

      const waResult = await sendWhatsAppFileByUploadPos(
        chatId,
        pdfBuffer,
        fileName,
        `Worker Matrix — ${companyName} — ${date}`,
        "application/pdf"
      );

      if (!waResult?.success) {
        return res.status(502).json({
          message: `WhatsApp send failed. ${waResult?.error ?? ""}`.trim(),
        });
      }

      res.json({ message: "Worker Matrix PDF sent to WhatsApp.", whatsapp: waResult });
    } catch (err: any) {
      console.error("[endProduction] POST manual send error:", err);
      res.status(500).json({ message: err.message });
    }
  });
}
