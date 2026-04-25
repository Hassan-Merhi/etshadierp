import type { Express, Request, Response } from "express";
import { pool } from "../db";
import { requireAuth, requireRole } from "../auth";
import { fetchAllCompanies } from "../services/exportDataService";
import { sendExportEmail } from "../services/emailService";
import { buildFullExportZip } from "../helpers/buildFullExportZip";
import {
  createJob, getJob, addStep, finishJob, failJob,
} from "../services/exportJobManager";
import { retryAsync, isEmailConfigError } from "../helpers/retryAsync";
import { createExportRun, updateExportRun, finishExportRun } from "../helpers/exportRunTracker";

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
      const runType = mode === "email" ? "manual_email" : "manual_download";
      const runId   = await createExportRun(runType);

      try {
        addStep(job, "Fetching company list...", "info");
        const companies = await fetchAllCompanies();
        if (!companies || companies.length === 0) {
          failJob(job, "No companies found");
          await finishExportRun(runId, { status: "failed", skippedReason: "No companies found." });
          return;
        }
        addStep(job, `Found ${companies.length} company/companies to export`, "success");

        const { zip: zipBuf, names, skipped } = await buildFullExportZip(
          companies,
          fromDate,
          toDate,
          (msg, level) => addStep(job, msg, level ?? "info"),
        );

        if (names.length === 0) {
          const msg = "ZIP is empty — no companies exported successfully. Nothing will be sent or downloaded.";
          failJob(job, msg);
          await finishExportRun(runId, { status: "failed", skippedReason: msg, companiesCount: companies.length });
          return;
        }

        if (skipped.length > 0) {
          addStep(job, `Skipped ${skipped.length} companies: ${skipped.join(", ")}`, "warning");
        }

        const dateLabel   = new Date().toISOString().substring(0, 10);
        const sizeMB      = (zipBuf.length / 1024 / 1024).toFixed(1);
        const zipSizeBytes = zipBuf.length;
        addStep(job, `ZIP archive ready — ${sizeMB} MB, ${names.length} companies`, "success");

        await updateExportRun(runId, {
          companiesCount:    companies.length,
          companyFilesCount: names.length,
          zipSizeBytes,
          skippedCompanies:  skipped.join(", ") || null,
        });

        if (mode === "email") {
          await updateExportRun(runId, { emailAttempted: true });
          addStep(job, "Sending email (up to 3 attempts, 30 s between retries)...", "info");
          let emailAttempts = 0;

          const emailRes = await retryAsync({
            label:       "ManualEmail",
            attempts:    3,
            delayMs:     30 * 1000,
            fn:          () => sendExportEmail(zipBuf, dateLabel, names),
            isSuccess:   r => r.success,
            shouldRetry: r => !r.error || !isEmailConfigError(r.error),
            onAttempt:   n => {
              emailAttempts = n;
              if (n > 1) addStep(job, `Retry attempt ${n}/3...`, "info");
            },
          });

          if (emailRes.result.success) {
            addStep(job, `Email sent successfully to all recipients (attempt ${emailRes.attempts})`, "success");
            finishJob(job);
            await finishExportRun(runId, {
              status:        "success",
              emailSuccess:  true,
              emailAttempts: emailRes.attempts,
            });
          } else {
            const errMsg = emailRes.result.error || "Email send failed";
            failJob(job, errMsg);
            await finishExportRun(runId, {
              status:        "failed",
              emailSuccess:  false,
              emailError:    errMsg,
              emailAttempts: emailRes.attempts,
            });
          }
        } else {
          finishJob(job, zipBuf);
          addStep(job, "Ready to download — starting download now", "success");
          await finishExportRun(runId, { status: "success" });
        }
      } catch (err: any) {
        failJob(job, err.message || "Unexpected error");
        await finishExportRun(runId, { status: "failed", skippedReason: err.message || "Unexpected error" }).catch(() => {});
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

  // ── Force-cleanup stuck export runs ─────────────────────────────────────────
  // Marks ALL 'running' rows as failed regardless of age. The UI only shows the
  // button when a run has been running >5 min client-side, so this is safe.
  app.post("/api/export/cleanup-stuck-runs", guard, async (_req: Request, res: Response) => {
    try {
      const r = await pool.query(`
        UPDATE daily_export_runs
           SET status         = 'failed',
               finished_at    = NOW(),
               skipped_reason = 'Manually dismissed — export did not complete (server restart or timeout)'
         WHERE status = 'running'
        RETURNING id, run_type
      `);
      const count = r.rowCount ?? 0;
      console.log(`[ExportRun] Manual dismiss: cleared ${count} stuck run(s)`);
      res.json({ cleared: count, ids: r.rows.map((x: any) => x.id) });
    } catch (e: any) {
      console.error("[ExportRun] Manual dismiss failed:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // ── Backup status ───────────────────────────────────────────────────────────

  app.get("/api/export/backup-status", guard, async (_req: Request, res: Response) => {
    try {
      // Latest run
      const latestQ = await pool.query(`
        SELECT * FROM daily_export_runs ORDER BY created_at DESC LIMIT 1
      `).catch(() => ({ rows: [] as any[] }));

      // Recent runs — full detail for all 10 so UI can render each independently
      const recentQ = await pool.query(`
        SELECT * FROM daily_export_runs ORDER BY created_at DESC LIMIT 10
      `).catch(() => ({ rows: [] as any[] }));

      // Readiness data
      const esQ  = await pool.query(`SELECT gmail_user, gmail_app_password, schedule_enabled FROM export_settings WHERE id = 1`).catch(() => ({ rows: [] as any[] }));
      const rcQ  = await pool.query(`SELECT COUNT(*)::int AS cnt FROM export_recipients WHERE active = true`).catch(() => ({ rows: [{ cnt: 0 }] }));
      const wsQ  = await pool.query(`SELECT enabled, daily_auto_send, daily_recipient_id FROM whatsapp_settings WHERE id = 1`).catch(() => ({ rows: [] as any[] }));
      const coQ  = await pool.query(`SELECT COUNT(*)::int AS cnt FROM companies`).catch(() => ({ rows: [{ cnt: 0 }] }));

      const es = esQ.rows[0] ?? {};
      const ws = wsQ.rows[0] ?? {};
      const recipientCount = rcQ.rows[0]?.cnt ?? 0;
      const companiesCount = coQ.rows[0]?.cnt ?? 0;

      let waRecipientActive = false;
      if (ws.daily_recipient_id) {
        const rrQ = await pool.query(
          `SELECT active FROM whatsapp_recipients WHERE id = $1`,
          [ws.daily_recipient_id],
        ).catch(() => ({ rows: [] as any[] }));
        waRecipientActive = rrQ.rows[0]?.active === true;
      }

      const issues: string[] = [];
      if (!es.schedule_enabled)                     issues.push("Email schedule is disabled.");
      if (!es.gmail_user || !es.gmail_app_password)  issues.push("Gmail credentials are missing.");
      if (recipientCount === 0)                       issues.push("No email recipients configured.");
      if (!ws.enabled)                                issues.push("WhatsApp is disabled.");
      if (ws.enabled && !ws.daily_auto_send)          issues.push("WhatsApp daily auto-send is off.");
      if (ws.enabled && !ws.daily_recipient_id)       issues.push("No WhatsApp daily recipient selected.");
      else if (ws.enabled && ws.daily_recipient_id && !waRecipientActive)
                                                      issues.push("Selected WhatsApp recipient is inactive or missing.");
      if (companiesCount === 0)                       issues.push("No companies found.");

      const row = latestQ.rows[0];
      res.json({
        latestRun: row ? {
          id:                 row.id,
          runType:            row.run_type,
          status:             row.status,
          startedAt:          row.started_at,
          finishedAt:         row.finished_at,
          zipSizeBytes:       row.zip_size_bytes,
          companiesCount:     row.companies_count,
          companyFilesCount:  row.company_files_count,
          skippedCompanies:   row.skipped_companies,
          emailAttempted:     row.email_attempted,
          emailSuccess:       row.email_success,
          emailError:         row.email_error,
          emailAttempts:      row.email_attempts,
          whatsappAttempted:  row.whatsapp_attempted,
          whatsappSuccess:    row.whatsapp_success,
          whatsappError:      row.whatsapp_error,
          whatsappAttempts:   row.whatsapp_attempts,
          skippedReason:      row.skipped_reason,
        } : null,
        recentRuns: recentQ.rows.map((r: any) => ({
          id:                r.id,
          runType:           r.run_type,
          status:            r.status,
          startedAt:         r.started_at,
          finishedAt:        r.finished_at,
          zipSizeBytes:      r.zip_size_bytes,
          companiesCount:    r.companies_count,
          companyFilesCount: r.company_files_count,
          skippedCompanies:  r.skipped_companies,
          skippedReason:     r.skipped_reason,
          emailAttempted:    r.email_attempted,
          emailSuccess:      r.email_success,
          emailError:        r.email_error,
          emailAttempts:     r.email_attempts,
          whatsappAttempted: r.whatsapp_attempted,
          whatsappSuccess:   r.whatsapp_success,
          whatsappError:     r.whatsapp_error,
          whatsappAttempts:  r.whatsapp_attempts,
        })),
        readiness: {
          emailScheduleEnabled:        !!es.schedule_enabled,
          gmailConfigured:             !!(es.gmail_user && es.gmail_app_password),
          emailRecipientCount:         recipientCount,
          whatsappEnabled:             !!ws.enabled,
          whatsappDailyAutoSend:       !!ws.daily_auto_send,
          whatsappDailyRecipientId:    ws.daily_recipient_id ?? null,
          whatsappDailyRecipientActive: waRecipientActive,
          companiesCount,
        },
        issues,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
