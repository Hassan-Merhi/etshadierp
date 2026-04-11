import type { Express, Request, Response } from "express";
import archiver from "archiver";
import { pool } from "../db";
import { requireAuth, requireRole } from "../auth";
import { fetchAllCompanies, fetchCompanyExportData } from "../services/exportDataService";
import { buildCompanyWorkbook } from "../services/exportExcelService";
import { sendExportEmail } from "../services/emailService";
import { buildZipBuffer } from "../services/schedulerService";

const ALLOWED_ROLES = ["Admin", "Owner", "Developer"];

export function registerExportRoutes(app: Express) {
  const guard = [requireAuth, requireRole(...ALLOWED_ROLES)];

  // ── Recipients ─────────────────────────────────────────────────────────────

  app.get("/api/export/recipients", guard, async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(`SELECT id, email, active, created_at FROM export_recipients ORDER BY id`);
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/export/recipients", guard, async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ message: "Valid email required" });
    }
    try {
      const result = await pool.query(
        `INSERT INTO export_recipients (email, active) VALUES ($1, true) RETURNING *`,
        [email.trim().toLowerCase()]
      );
      res.json(result.rows[0]);
    } catch (err: any) {
      if (err.message?.includes("unique") || err.message?.includes("duplicate")) {
        return res.status(409).json({ message: "Email already exists" });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/export/recipients/:id", guard, async (req: Request, res: Response) => {
    try {
      await pool.query(`DELETE FROM export_recipients WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Settings ───────────────────────────────────────────────────────────────

  app.get("/api/export/settings", guard, async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT id, gmail_user, schedule_enabled, last_run_at FROM export_settings WHERE id = 1`
      );
      if (!result.rows || result.rows.length === 0) {
        return res.json({ gmailUser: "", scheduleEnabled: false, lastRunAt: null });
      }
      const row = result.rows[0];
      res.json({
        gmailUser: row.gmail_user || "",
        scheduleEnabled: row.schedule_enabled || false,
        lastRunAt: row.last_run_at || null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/export/settings", guard, async (req: Request, res: Response) => {
    const { gmailUser, gmailAppPassword, scheduleEnabled } = req.body;
    try {
      const existing = await pool.query(`SELECT id FROM export_settings WHERE id = 1`);

      if (!existing.rows || existing.rows.length === 0) {
        await pool.query(
          `INSERT INTO export_settings (id, gmail_user, gmail_app_password, schedule_enabled) VALUES (1, $1, $2, $3)`,
          [gmailUser || "", gmailAppPassword || "", scheduleEnabled ?? false]
        );
      } else {
        const setParts: string[] = [];
        const params: any[] = [];
        let idx = 1;
        if (gmailUser !== undefined) { setParts.push(`gmail_user = $${idx++}`); params.push(gmailUser); }
        if (gmailAppPassword !== undefined && gmailAppPassword !== "") {
          setParts.push(`gmail_app_password = $${idx++}`);
          params.push(gmailAppPassword);
        }
        setParts.push(`schedule_enabled = $${idx++}`);
        params.push(scheduleEnabled ?? false);
        params.push(1);
        await pool.query(
          `UPDATE export_settings SET ${setParts.join(", ")} WHERE id = $${idx}`,
          params
        );
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Manual export run ──────────────────────────────────────────────────────

  app.post("/api/export/run", guard, async (req: Request, res: Response) => {
    const { mode, fromDate, toDate, companyIds } = req.body;

    try {
      const allCompanies = await fetchAllCompanies();
      const companies = companyIds && Array.isArray(companyIds) && companyIds.length > 0
        ? allCompanies.filter((c: any) => companyIds.includes(c.id))
        : allCompanies;

      if (!companies || companies.length === 0) {
        return res.status(404).json({ message: "No companies found" });
      }

      if (mode === "email") {
        const { zip, names } = await buildZipBuffer(companies);
        const dateLabel = new Date().toISOString().substring(0, 10);
        const result = await sendExportEmail(zip, dateLabel, names);
        return res.json(result);
      }

      // mode === "download" — stream zip to client
      const dateLabel = new Date().toISOString().substring(0, 10);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="DailyExport_${dateLabel}.zip"`);

      const arc = archiver("zip", { zlib: { level: 6 } });
      arc.pipe(res);

      for (const company of companies) {
        try {
          const data = await fetchCompanyExportData(company.id, fromDate, toDate);
          const xlsxBuf = await buildCompanyWorkbook(data);
          const safeName = (company.name as string).replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
          arc.append(xlsxBuf as any, { name: `${safeName}_Export_${dateLabel}.xlsx` });
        } catch (err: any) {
          console.error(`[Export] Company ${company.id} failed:`, err.message);
        }
      }

      await arc.finalize();
    } catch (err: any) {
      if (!res.headersSent) res.status(500).json({ message: err.message });
    }
  });

  // ── Companies list for UI ───────────────────────────────────────────────────
  app.get("/api/export/companies", guard, async (_req: Request, res: Response) => {
    try {
      const companies = await fetchAllCompanies();
      res.json(companies);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
