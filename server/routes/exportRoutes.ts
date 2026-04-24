import type { Express, Request, Response } from "express";
import { pool } from "../db";
import { requireAuth, requireRole } from "../auth";
import { fetchAllCompanies } from "../services/exportDataService";
import { sendExportEmail } from "../services/emailService";
import { buildFullExportZip } from "../helpers/buildFullExportZip";
import {
  createJob, getJob, addStep, finishJob, failJob,
} from "../services/exportJobManager";

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

  // ── Async export job: start ────────────────────────────────────────────────

  app.post("/api/export/start", guard, async (req: Request, res: Response) => {
    const { mode, fromDate, toDate } = req.body;
    if (mode !== "download" && mode !== "email") {
      return res.status(400).json({ message: "mode must be 'download' or 'email'" });
    }

    const job = createJob(mode);
    res.json({ jobId: job.id });

    // Run async without blocking the response
    (async () => {
      try {
        addStep(job, "Fetching company list...", "info");
        const companies = await fetchAllCompanies();
        if (!companies || companies.length === 0) {
          failJob(job, "No companies found");
          return;
        }
        addStep(job, `Found ${companies.length} company/companies to export`, "success");

        // buildFullExportZip throws if the ZIP would be empty — failJob is called in catch below
        const { zip: zipBuf, names, skipped } = await buildFullExportZip(
          companies,
          fromDate,
          toDate,
          (msg, level) => addStep(job, msg, level ?? "info"),
        );

        if (names.length === 0) {
          failJob(job, "ZIP is empty — no companies exported successfully. Nothing will be sent or downloaded.");
          return;
        }

        if (skipped.length > 0) {
          addStep(job, `Skipped ${skipped.length} companies: ${skipped.join(", ")}`, "warning");
        }

        const dateLabel = new Date().toISOString().substring(0, 10);
        const sizeMB = (zipBuf.length / 1024 / 1024).toFixed(1);
        addStep(job, `ZIP archive ready — ${sizeMB} MB, ${names.length} companies`, "success");

        if (mode === "email") {
          addStep(job, "Sending email to recipients...", "info");
          const result = await sendExportEmail(zipBuf, dateLabel, names);
          if (result.success) {
            addStep(job, "Email sent successfully to all recipients", "success");
            finishJob(job);
          } else {
            failJob(job, result.error || "Email send failed");
          }
        } else {
          finishJob(job, zipBuf);
          addStep(job, "Ready to download — starting download now", "success");
        }
      } catch (err: any) {
        failJob(job, err.message || "Unexpected error");
      }
    })();
  });

  // ── Async export job: poll status ──────────────────────────────────────────

  app.get("/api/export/job/:jobId", guard, (req: Request, res: Response) => {
    const job = getJob(req.params.jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    res.json({
      status: job.status,
      steps: job.steps,
      error: job.error,
      hasZip: !!job.zipBuffer,
    });
  });

  // ── Async export job: download zip ─────────────────────────────────────────

  app.get("/api/export/download/:jobId", guard, (req: Request, res: Response) => {
    const job = getJob(req.params.jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    if (!job.zipBuffer) return res.status(400).json({ message: "ZIP not ready" });
    const dateLabel = new Date().toISOString().substring(0, 10);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="DailyExport_${dateLabel}.zip"`);
    res.send(job.zipBuffer);
    // Free memory after download
    job.zipBuffer = undefined;
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
