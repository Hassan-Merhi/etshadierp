#!/usr/bin/env python3
from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if new in source:
        return source
    if old not in source:
        raise RuntimeError(f"Missing Phase 10 target: {label}")
    return source.replace(old, new, 1)


# ---------------------------------------------------------------------------
# WhatsApp provider: accept file-backed sources and serialize materialization.
# ---------------------------------------------------------------------------
path = Path("server/services/whatsappService.ts")
source = path.read_text()
source = replace_once(
    source,
    'import FormDataLib from "form-data";\n',
    '''import FormDataLib from "form-data";
import {
  getExportAttachmentSize,
  withSerializedExportAttachmentBuffer,
  type ExportAttachmentSource,
} from "../helpers/exportAttachmentSource";
''',
    "WhatsApp export attachment imports",
)
start = source.index("async function sendGreenApiFileUpload({")
end = source.index("\n// ─── Send file", start)
new_helper = '''async function sendGreenApiFileUpload({
  settings,
  chatId,
  buffer,
  fileName,
  caption,
  mimeType,
}: {
  settings: WaSettings;
  chatId: string;
  buffer: ExportAttachmentSource;
  fileName: string;
  caption: string;
  mimeType: string;
}): Promise<{ success: boolean; error?: string }> {
  const url = baseUrl(settings.instanceId, settings.apiToken, "sendFileByUpload");
  const sizeBytes = getExportAttachmentSize(buffer);

  return withSerializedExportAttachmentBuffer(buffer, async (materializedBuffer) => {
    // Green API still requires form-data#getBuffer(). Only the active upload
    // materializes the file-backed export; queued retries keep the reusable
    // source on disk and cannot create several multipart bodies concurrently.
    const form = new FormDataLib();
    form.append("chatId", chatId);
    if (caption) form.append("caption", caption);
    form.append("file", materializedBuffer, { filename: fileName, contentType: mimeType });

    const multipartBody = form.getBuffer();
    const response = await fetch(url, {
      method: "POST",
      body: multipartBody,
      headers: form.getHeaders(),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error("[WA upload] Green API error", {
        status: response.status,
        body,
        chatId,
        fileName,
        size: sizeBytes,
      });
      return { success: false, error: `Green API ${response.status}: ${body}` };
    }

    const json = (await response.json().catch(() => ({}))) as unknown;
    logger.info("[WA upload] Green API response", {
      response: json,
      chatId,
      fileName,
      size: sizeBytes,
    });
    return { success: true };
  });
}
'''
source = source[:start] + new_helper + source[end:]
source = replace_once(
    source,
    '''export async function sendWhatsAppFileToChatId(
  chatId: string,
  buffer: Buffer,''',
    '''export async function sendWhatsAppFileToChatId(
  chatId: string,
  buffer: ExportAttachmentSource,''',
    "main WhatsApp file source signature",
)
path.write_text(source)

# ---------------------------------------------------------------------------
# Daily scheduler: explicit file-backed artifact with deterministic cleanup.
# ---------------------------------------------------------------------------
path = Path("server/services/scheduler/daily-export.ts")
source = path.read_text()
source = source.replace('import { buildFullExportZip } from "../../helpers/buildFullExportZip";\n', "")
source = replace_once(
    source,
    'import { createExportRun, updateExportRun, finishExportRun } from "../../helpers/exportRunTracker";\n',
    '''import { createExportRun, updateExportRun, finishExportRun } from "../../helpers/exportRunTracker";
import { createScheduledExportArtifact } from "../../helpers/scheduledExportArtifact";
''',
    "daily scheduled artifact import",
)
start = source.index("export async function runDailyExport(): Promise<boolean> {")
end = source.index("\n// ─── Daily WhatsApp send", start)
new_run = '''export async function runDailyExport(): Promise<boolean> {
  const cronFiredAt = new Date().toISOString();
  logger.info(`[DailyExport] Scheduled run triggered at ${cronFiredAt}`);

  const emailEnabled = await isScheduleEnabled();
  const waSettings = await getWaSettings();
  const whatsappReady = !!(waSettings?.enabled && waSettings?.dailyAutoSend && waSettings?.dailyRecipientId);

  logger.info(`[DailyExport] Email enabled: ${emailEnabled} | WhatsApp ready: ${whatsappReady}`);

  if (!emailEnabled && !whatsappReady) {
    logger.info("[DailyExport] Email schedule and WhatsApp daily auto-send are both disabled. Nothing to send.");
    const rid = await createExportRun("scheduled");
    await finishExportRun(rid, {
      status: "skipped",
      skippedReason: "Email schedule and WhatsApp daily auto-send are both disabled.",
    });
    return true;
  }

  const runId = await createExportRun("scheduled");
  logger.info(`[DailyExport] Run id=${runId} started.`);

  try {
    const companies = await fetchAllCompanies();
    if (!companies || companies.length === 0) {
      logger.info("[DailyExport] No companies found — skipping export.");
      await finishExportRun(runId, { status: "failed", skippedReason: "No companies found." });
      return false;
    }

    const today = getTodayLabel();
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    const exportFromDate = threeYearsAgo.toISOString().substring(0, 10);

    logger.info(
      `[DailyExport] Building export for ${companies.length} company/companies (label: ${today}, from: ${exportFromDate})`,
    );

    const artifact = await createScheduledExportArtifact(
      `daily-${runId}`,
      companies,
      exportFromDate,
      undefined,
    );

    try {
      const { attachment, names, skipped, sizeBytes } = artifact;
      if (!names.length || sizeBytes <= 0) {
        logger.error("[DailyExport] ZIP is empty — no companies exported successfully. Nothing will be sent.");
        await finishExportRun(runId, {
          status: "failed",
          companiesCount: companies.length,
          skippedReason: "Export ZIP is empty — no companies exported successfully.",
        });
        return false;
      }

      const zipSizeMb = (sizeBytes / 1024 / 1024).toFixed(1);
      logger.info(
        `[DailyExport] Run ${runId} — ZIP ready: ${zipSizeMb} MB, ${names.length} companies${
          skipped.length ? `, ${skipped.length} skipped: ${skipped.join(", ")}` : ""
        }`,
      );

      await updateExportRun(runId, {
        companiesCount: companies.length,
        companyFilesCount: names.length,
        zipSizeBytes: sizeBytes,
        skippedCompanies: skipped.join(", ") || null,
      });

      let emailSuccess = false;
      let emailError: string | undefined;
      let emailAttempts = 0;

      if (emailEnabled) {
        await updateExportRun(runId, { emailAttempted: true });
        logger.info("[DailyExport] Sending email (up to 3 attempts, 2 min delay)...");

        const emailRes = await retryAsync({
          label: "DailyExport/Email",
          attempts: 3,
          delayMs: 2 * 60 * 1000,
          fn: () => sendExportEmail(attachment, today, names),
          isSuccess: (result) => result.success,
          shouldRetry: (result) => !result.error || !isEmailConfigError(result.error),
          onAttempt: (attempt) => {
            emailAttempts = attempt;
            logger.info(`[DailyExport] Email attempt ${attempt}/3...`);
          },
        });

        emailSuccess = emailRes.result.success;
        emailAttempts = emailRes.attempts;
        emailError = emailRes.result.error;

        if (emailSuccess) {
          logger.info(`[DailyExport] Email sent successfully (attempt ${emailAttempts}).`);
          await pool.query(`UPDATE export_settings SET last_run_at = now() WHERE id = 1`).catch(() => {});
        } else {
          logger.error(`[DailyExport] Email failed after ${emailAttempts} attempt(s): ${emailError}`);
        }
      } else {
        logger.info("[DailyExport] Email schedule is disabled — skipping email.");
      }

      let waSuccess = false;
      let waError: string | undefined;
      let waAttempts = 0;

      if (whatsappReady) {
        await updateExportRun(runId, { whatsappAttempted: true });
        logger.info("[DailyExport] Sending via WhatsApp (up to 3 attempts, 2 min delay)...");

        const waRes = await retryAsync({
          label: "DailyExport/WhatsApp",
          attempts: 3,
          delayMs: 2 * 60 * 1000,
          fn: () => runDailyWhatsAppSend(attachment, today, companies),
          isSuccess: (result) => result.sent,
          shouldRetry: (result) => !result.skipped && (!result.error || !isWaConfigError(result.error)),
          onAttempt: (attempt) => {
            waAttempts = attempt;
            logger.info(`[DailyExport] WhatsApp attempt ${attempt}/3...`);
          },
        });

        waSuccess = waRes.result.sent;
        waAttempts = waRes.attempts;
        waError = waRes.result.error || waRes.result.skipReason;

        if (waSuccess) {
          logger.info(`[DailyExport] WhatsApp sent successfully (attempt ${waAttempts}).`);
        } else if (waRes.result.skipped) {
          logger.info(`[DailyExport] WhatsApp skipped: ${waError}.`);
        } else {
          logger.error(`[DailyExport] WhatsApp failed after ${waAttempts} attempt(s): ${waError}`);
        }
      } else {
        logger.info("[DailyExport] WhatsApp not ready — skipping WhatsApp send.");
      }

      const bothSucceeded = (!emailEnabled || emailSuccess) && (!whatsappReady || waSuccess);
      const atLeastOne = (emailEnabled && emailSuccess) || (whatsappReady && waSuccess);
      const finalStatus = bothSucceeded ? "success" : atLeastOne ? "partial_failed" : "failed";

      logger.info(
        `[DailyExport] Run ${runId} finished — status: ${finalStatus}` +
          ` | email: ${emailEnabled ? (emailSuccess ? "ok" : "failed") : "n/a"}` +
          ` | wa: ${whatsappReady ? (waSuccess ? "ok" : "failed") : "n/a"}`,
      );

      await finishExportRun(runId, {
        status: finalStatus,
        emailSuccess,
        emailError: emailError ?? null,
        emailAttempts,
        whatsappSuccess: waSuccess,
        whatsappError: waError ?? null,
        whatsappAttempts: waAttempts,
      });

      return finalStatus !== "failed";
    } finally {
      await artifact.dispose();
    }
  } catch (err: unknown) {
    logger.error(`[DailyExport] Unexpected error in run ${runId}:`, {
      error: getErrorStack(err) || getErrorMessage(err) || err,
    });
    await finishExportRun(runId, {
      status: "failed",
      skippedReason: getErrorMessage(err) || "Unexpected error",
    }).catch(() => {});
    return false;
  }
}
'''
source = source[:start] + new_run + source[end:]
path.write_text(source)

# ---------------------------------------------------------------------------
# Manual email exports: use the same explicit temporary artifact lifecycle.
# ---------------------------------------------------------------------------
path = Path("server/routes/exportRoutes.ts")
source = path.read_text()
source = source.replace('import { buildFullExportZip } from "../helpers/buildFullExportZip";\n', "")
source = replace_once(
    source,
    'import { createTemporaryExportArchive, streamTemporaryExportArchive } from "../helpers/temporaryExportArchive";\n',
    '''import { createTemporaryExportArchive, streamTemporaryExportArchive } from "../helpers/temporaryExportArchive";
import { createScheduledExportArtifact } from "../helpers/scheduledExportArtifact";
''',
    "manual scheduled artifact import",
)
start = source.index("        // Email providers require complete attachment bytes")
end = source.index("      } catch (err: unknown) {", start)
new_manual = '''        const artifact = await createScheduledExportArtifact(
          `manual-email-${job.id}`,
          companies,
          fromDate,
          toDate,
          (message, level) => addStep(job, message, level ?? "info"),
        );

        try {
          const { attachment, names, skipped, sizeBytes } = artifact;
          if (names.length === 0 || sizeBytes <= 0) {
            const message = "ZIP is empty — no companies exported successfully. Nothing will be sent.";
            failJob(job, message);
            await finishExportRun(runId, {
              status: "failed",
              skippedReason: message,
              companiesCount: companies.length,
            });
            return;
          }

          if (skipped.length > 0) {
            addStep(job, `Skipped ${skipped.length} companies: ${skipped.join(", ")}`, "warning");
          }

          const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);
          addStep(job, `ZIP archive ready — ${sizeMB} MB, ${names.length} companies`, "success");

          await updateExportRun(runId, {
            companiesCount: companies.length,
            companyFilesCount: names.length,
            zipSizeBytes: sizeBytes,
            skippedCompanies: skipped.join(", ") || null,
          });

          await updateExportRun(runId, { emailAttempted: true });
          addStep(job, "Sending email (up to 3 attempts, 30 s between retries)...", "info");

          const emailRes = await retryAsync({
            label: "ManualEmail",
            attempts: 3,
            delayMs: 30 * 1000,
            fn: () => sendExportEmail(attachment, dateLabel, names),
            isSuccess: (result) => result.success,
            shouldRetry: (result) => !result.error || !isEmailConfigError(result.error),
            onAttempt: (attempt) => {
              if (attempt > 1) addStep(job, `Retry attempt ${attempt}/3...`, "info");
            },
          });

          if (emailRes.result.success) {
            addStep(job, `Email sent successfully to all recipients (attempt ${emailRes.attempts})`, "success");
            finishJob(job);
            logger.info("Export job completed", {
              module: "export",
              action: "start",
              status: "success",
              durationMs: Date.now() - _t,
            });
            await finishExportRun(runId, {
              status: "success",
              emailSuccess: true,
              emailAttempts: emailRes.attempts,
            });
          } else {
            const errorMessage = emailRes.result.error || "Email send failed";
            failJob(job, errorMessage);
            logger.warn("Export job email failed", {
              module: "export",
              action: "start",
              status: "emailFailed",
              durationMs: Date.now() - _t,
            });
            await finishExportRun(runId, {
              status: "failed",
              emailSuccess: false,
              emailError: errorMessage,
              emailAttempts: emailRes.attempts,
            });
          }
        } finally {
          await artifact.dispose();
        }
'''
source = source[:start] + new_manual + source[end:]
path.write_text(source)

print("Bandwidth Phase 10 completion applied.")
