/**
 * WhatsApp settings & send routes (Green API)
 *
 * GET  /api/whatsapp/settings              – get credentials + flags
 * PUT  /api/whatsapp/settings              – save credentials + flags
 * GET  /api/whatsapp/recipients            – list all recipients
 * POST /api/whatsapp/recipients            – add recipient
 * PUT  /api/whatsapp/recipients/:id        – update (name, active)
 * DELETE /api/whatsapp/recipients/:id      – remove
 * GET  /api/whatsapp/chats                 – fetch chats from Green API (for group picker)
 * POST /api/whatsapp/send-net-position     – manually send current company's net position Excel
 */

import type { Express } from "express";
import { requireAuth } from "../auth";
import { pool } from "../db";
import { storage } from "../storage";
import {
  getWaSettings,
  normaliseChatId,
  fetchGreenApiChats,
  sendWhatsAppFile,
} from "../services/whatsappService";
import { generateNetPositionExcel, generateMonthEnds } from "../helpers/generateNetPositionExcel";

export function registerWhatsAppRoutes(app: Express) {
  // ── Settings (singleton row id=1) ──────────────────────────────────────────

  app.get("/api/whatsapp/settings", requireAuth, async (_req, res) => {
    try {
      const s = await getWaSettings();
      if (!s) {
        return res.json({ instanceId: "", apiToken: "", enabled: false, monthlyAutoSend: false });
      }
      res.json({
        instanceId:      s.instanceId,
        apiToken:        s.apiToken ? "••••••" : "",
        enabled:         s.enabled,
        monthlyAutoSend: s.monthlyAutoSend,
        dailyAutoSend:   s.dailyAutoSend,
        hasCredentials:  !!(s.instanceId && s.apiToken),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/whatsapp/settings", requireAuth, async (req, res) => {
    try {
      const { instanceId, apiToken, enabled, monthlyAutoSend, dailyAutoSend } = req.body as Record<string, any>;

      await pool.query(`
        INSERT INTO whatsapp_settings (id, instance_id, api_token, enabled, monthly_auto_send, daily_auto_send)
        VALUES (1, $1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          instance_id       = EXCLUDED.instance_id,
          api_token         = CASE WHEN $2 = '' OR $2 = '••••••' THEN whatsapp_settings.api_token ELSE EXCLUDED.api_token END,
          enabled           = EXCLUDED.enabled,
          monthly_auto_send = EXCLUDED.monthly_auto_send,
          daily_auto_send   = EXCLUDED.daily_auto_send
      `, [
        instanceId      ?? "",
        apiToken        ?? "",
        enabled         ?? false,
        monthlyAutoSend ?? false,
        dailyAutoSend   ?? false,
      ]);

      res.json({ message: "Saved" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Recipients ─────────────────────────────────────────────────────────────

  app.get("/api/whatsapp/recipients", requireAuth, async (_req, res) => {
    try {
      const result = await pool.query(
        "SELECT id, chat_id, name, is_group, active FROM whatsapp_recipients ORDER BY id",
      );
      res.json(result.rows.map((r) => ({
        id:      r.id,
        chatId:  r.chat_id,
        name:    r.name,
        isGroup: r.is_group,
        active:  r.active,
      })));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/whatsapp/recipients", requireAuth, async (req, res) => {
    try {
      const { chatId: rawChatId, name } = req.body as { chatId: string; name?: string };
      if (!rawChatId?.trim()) return res.status(400).json({ message: "chatId is required" });

      const chatId  = normaliseChatId(rawChatId);
      const isGroup = chatId.endsWith("@g.us");
      const label   = (name?.trim()) || chatId;

      const result = await pool.query(
        `INSERT INTO whatsapp_recipients (chat_id, name, is_group, active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (chat_id) DO UPDATE SET name = $2, active = true
         RETURNING id, chat_id, name, is_group, active`,
        [chatId, label, isGroup],
      );
      const r = result.rows[0];
      res.json({ id: r.id, chatId: r.chat_id, name: r.name, isGroup: r.is_group, active: r.active });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/whatsapp/recipients/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, active } = req.body as { name?: string; active?: boolean };
      await pool.query(
        `UPDATE whatsapp_recipients SET
           name   = COALESCE($1, name),
           active = COALESCE($2, active)
         WHERE id = $3`,
        [name ?? null, active ?? null, id],
      );
      res.json({ message: "Updated" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/whatsapp/recipients/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await pool.query("DELETE FROM whatsapp_recipients WHERE id = $1", [id]);
      res.json({ message: "Deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Fetch chats from Green API (for group picker) ──────────────────────────

  app.get("/api/whatsapp/chats", requireAuth, async (_req, res) => {
    try {
      const s = await getWaSettings();
      if (!s?.instanceId || !s?.apiToken) {
        return res.status(400).json({ message: "WhatsApp credentials not configured" });
      }
      const chats = await fetchGreenApiChats(s.instanceId, s.apiToken);
      res.json(chats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Send net-position Excel manually ───────────────────────────────────────

  app.post("/api/whatsapp/send-net-position", requireAuth, async (req, res) => {
    try {
      const user    = req.session.user as any;
      const isAdmin = user?.role === "Admin" || user?.role === "Developer";
      const requestedCompanyId = req.body.companyId ? parseInt(req.body.companyId) : null;
      const companyId = isAdmin && requestedCompanyId
        ? requestedCompanyId
        : req.session.currentCompanyId;

      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allCompanies = await storage.getAllCompanies();
      const company      = allCompanies.find((c: any) => c.id === companyId);
      const companyName  = company?.name || "Company";

      const endDate   = (req.body.endDate   as string) || new Date().toISOString().split("T")[0];
      const startDate = (req.body.startDate as string) || (() => {
        const d = new Date(endDate);
        d.setFullYear(d.getFullYear() - 1);
        return d.toISOString().split("T")[0];
      })();

      if (generateMonthEnds(startDate, endDate).length === 0) {
        return res.status(400).json({ message: "No months in range" });
      }

      const buffer   = await generateNetPositionExcel(companyId, companyName, startDate, endDate);
      const safe     = companyName.replace(/[^a-z0-9]/gi, "_");
      const fileName = `NetPosition_${safe}_${endDate}.xlsx`;
      const caption  = `Net Position Report — ${companyName}\nPeriod: ${startDate} → ${endDate}`;

      const result = await sendWhatsAppFile(buffer, fileName, caption);

      if (result.success) {
        res.json({ message: `Sent to ${result.sent} recipient(s)`, ...result });
      } else {
        res.status(502).json({ message: result.errors[0] || "Send failed", ...result });
      }
    } catch (err: any) {
      console.error("[WhatsApp] send-net-position error:", err);
      res.status(500).json({ message: err.message });
    }
  });
}
