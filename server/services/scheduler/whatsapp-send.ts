import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { pool } from "../../db";
import { getWaSettings, sendWhatsAppFileToChatId } from "../whatsappService";
import {
  getExportAttachmentSize,
  type ExportAttachmentSource,
} from "../../helpers/exportAttachmentSource";
import { WHATSAPP_ATTACHMENT_LIMIT_MB } from "./daily-export";

interface DailyWaSendResult {
  sent: boolean;
  skipped: boolean;
  skipReason?: string;
  error?: string;
}

export async function runDailyWhatsAppSend(
  dailyZip: ExportAttachmentSource,
  dateLabel: string,
  companies: { id: number; name: string }[],
  opts: { bypassAutoSendCheck?: boolean } = {},
): Promise<DailyWaSendResult> {
  const skip = (skipReason: string): DailyWaSendResult => {
    logger.info(`[WhatsApp] ${skipReason} — skipping daily ZIP send.`);
    return { sent: false, skipped: true, skipReason };
  };

  const settings = await getWaSettings();

  if (!settings?.enabled) {
    return skip("WhatsApp is disabled");
  }

  // Only enforce the dailyAutoSend toggle for the scheduled cron, not manual triggers
  if (!opts.bypassAutoSendCheck && !settings.dailyAutoSend) {
    return skip("Daily auto-send toggle is off");
  }

  const recipientId = settings.dailyRecipientId;
  if (!recipientId) {
    return skip("No daily export WhatsApp group configured");
  }

  const rRow = await pool.query("SELECT chat_id FROM whatsapp_recipients WHERE id = $1 AND active = true", [
    recipientId,
  ]);
  if (!rRow.rows.length) {
    return skip(`Daily export recipient id=${recipientId} not found or inactive`);
  }

  // ZIP size check — WhatsApp has a lower attachment limit than email.
  const zipSizeMb = getExportAttachmentSize(dailyZip) / 1024 / 1024;
  if (zipSizeMb > WHATSAPP_ATTACHMENT_LIMIT_MB) {
    const msg = `ZIP is too large for WhatsApp. Size: ${zipSizeMb.toFixed(1)} MB (limit: ${WHATSAPP_ATTACHMENT_LIMIT_MB} MB).`;
    logger.error(`[WhatsApp] ${msg}`);
    return { sent: false, skipped: false, error: msg };
  }

  const chatId = rRow.rows[0].chat_id as string;
  const zipFileName = `DailyExport_${dateLabel}.zip`;
  const zipCaption = "";
  logger.info(`[WhatsApp] Sending daily export ZIP (${zipSizeMb.toFixed(1)} MB) to ${chatId}…`);

  try {
    const zipRes = await sendWhatsAppFileToChatId(chatId, dailyZip, zipFileName, zipCaption, "application/zip");
    if (zipRes.success) {
      logger.info("[WhatsApp] Daily ZIP sent successfully.");
      return { sent: true, skipped: false };
    }
    const errMsg = zipRes.error || "Send failed";
    logger.error(`[WhatsApp] Daily ZIP send error: ${errMsg}`);
    return { sent: false, skipped: false, error: errMsg };
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err) || "Unknown error";
    logger.error("[WhatsApp] Daily send error:", { error: errMsg });
    return { sent: false, skipped: false, error: errMsg };
  }
}

// ─── Stock + Net Position Report — independent schedule ───────────────────────

/** Returns true if, given frequency/day config and last_sent_at, it's time to send. */
export function shouldSendStockReport(cfg: {
  frequency: string;
  sendHour: number;
  sendDayOfWeek: number | null;
  lastSentAt: Date | null;
}): boolean {
  // All times in EST (America/New_York)
  const nowEst = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const currentHour = nowEst.getHours();
  const currentDay = nowEst.getDay(); // 0=Sun … 6=Sat

  if (currentHour !== cfg.sendHour) return false;

  // Check if already sent in the current period
  if (cfg.lastSentAt) {
    const lastEst = new Date(new Date(cfg.lastSentAt).toLocaleString("en-US", { timeZone: "America/New_York" }));
    const sameDay = lastEst.toDateString() === nowEst.toDateString();
    const sameWeek = isSameIsoWeek(lastEst, nowEst);
    const sameMonth = lastEst.getFullYear() === nowEst.getFullYear() && lastEst.getMonth() === nowEst.getMonth();

    if (cfg.frequency === "daily" && sameDay) return false;
    if (cfg.frequency === "weekly" && sameWeek) return false;
    if (cfg.frequency === "monthly" && sameMonth) return false;
  }

  if (cfg.frequency === "daily") return true;

  if (cfg.frequency === "weekly") {
    const targetDay = cfg.sendDayOfWeek ?? 1; // default Monday
    return currentDay === targetDay;
  }

  if (cfg.frequency === "monthly") {
    return nowEst.getDate() === 1;
  }

  return false;
}

function isSameIsoWeek(a: Date, b: Date): boolean {
  const getMonday = (d: Date) => {
    const copy = new Date(d);
    const day = copy.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    copy.setDate(copy.getDate() + diff);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };
  return getMonday(a).getTime() === getMonday(b).getTime();
}
