import { pool } from "../../db";
import { generateStockPdf } from "../../helpers/generateStockPdf";
import { releaseManagedExportAttachment } from "../../helpers/exportAttachmentSource";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { sendWhatsAppFileToChatIdPos } from "../whatsappService";

interface ScheduleRow {
  location_id: number;
  company_id: number;
  location_name: string;
  company_name: string;
  enabled: boolean;
  frequency: "daily" | "selected_days";
  days_of_week: number[] | null;
  send_time: string;
  timezone: string;
  include_cost: boolean;
  include_zero_stock: boolean;
  include_negative_stock: boolean;
  stock_group_id: number | null;
  category_id: number | null;
  last_scheduled_for: string | Date | null;
  updated_by_user_id: string | null;
  whatsapp_group_chat_id: string | null;
  whatsapp_group_name: string | null;
  destination_enabled: boolean | null;
}

const DAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function safeFilePart(value: string): string {
  return value.replace(/[^\w\s.\-]/g, "_").replace(/\s+/g, "_");
}

function localScheduleParts(date: Date, timezone: string): { localDate: string; dayOfWeek: number; localTime: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const values = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const year = values.get("year")!;
  const month = values.get("month")!;
  const day = values.get("day")!;
  const weekday = values.get("weekday")!;
  const hour = values.get("hour")!;
  const minute = values.get("minute")!;
  return {
    localDate: `${year}-${month}-${day}`,
    dayOfWeek: DAY_INDEX[weekday] ?? date.getUTCDay(),
    localTime: `${hour}:${minute}`,
  };
}

function alreadyScheduledFor(row: ScheduleRow, localDate: string): boolean {
  if (!row.last_scheduled_for) return false;
  if (typeof row.last_scheduled_for === "string") return row.last_scheduled_for.slice(0, 10) === localDate;
  return row.last_scheduled_for.toISOString().slice(0, 10) === localDate;
}

function isDue(row: ScheduleRow, now: Date): { due: boolean; localDate: string } {
  let parts: ReturnType<typeof localScheduleParts>;
  try {
    parts = localScheduleParts(now, row.timezone || "UTC");
  } catch {
    return { due: false, localDate: "" };
  }

  if (alreadyScheduledFor(row, parts.localDate)) return { due: false, localDate: parts.localDate };
  const scheduledTime = String(row.send_time || "18:00").slice(0, 5);
  // Catch-up semantics are deliberate: if Render was asleep/redeploying at the
  // exact minute, the first scheduler tick later that local day still sends once.
  if (parts.localTime < scheduledTime) return { due: false, localDate: parts.localDate };

  if (row.frequency === "selected_days") {
    const days = Array.isArray(row.days_of_week) ? row.days_of_week.map(Number) : [];
    if (!days.includes(parts.dayOfWeek)) return { due: false, localDate: parts.localDate };
  }

  return { due: true, localDate: parts.localDate };
}

function permissionAllowed(role: string, explicit: boolean | undefined): boolean {
  if (role === "Developer" || role === "Admin") return true;
  if (role === "Normal User") return explicit === true;
  return explicit !== false;
}

async function scheduleAuthorStillAuthorized(row: ScheduleRow): Promise<boolean> {
  if (!row.updated_by_user_id) return false;
  const userResult = await pool.query<{ active: boolean; role: string }>(
    `SELECT u.active, ucr.role
       FROM users u
       JOIN user_company_roles ucr ON ucr.user_id = u.id
      WHERE u.id = $1 AND ucr.company_id = $2
      ORDER BY ucr.id DESC
      LIMIT 1`,
    [row.updated_by_user_id, row.company_id]
  );
  const user = userResult.rows[0];
  if (!user?.active || !user.role || user.role === "POS" || user.role === "View Only") return false;
  if (user.role === "Developer" || user.role === "Admin") return true;

  const keys = row.include_cost
    ? ["exp_whatsapp_send", "fld_cost_price", "fld_total_value"]
    : ["exp_whatsapp_send"];
  const permissions = await pool.query<{ feature_key: string; enabled: boolean }>(
    `SELECT feature_key, enabled
       FROM role_feature_permissions
      WHERE company_id = $1 AND role = $2 AND feature_key = ANY($3::text[])`,
    [row.company_id, user.role, keys]
  );
  const permissionMap = new Map(permissions.rows.map((permission) => [permission.feature_key, permission.enabled]));
  return keys.every((key) => permissionAllowed(user.role, permissionMap.get(key)));
}

async function finishSchedule(
  locationId: number,
  status: string,
  error: string | null,
  sent: boolean
): Promise<void> {
  await pool.query(
    `UPDATE location_whatsapp_stock_schedules
        SET last_status = $2,
            last_error = $3,
            last_sent_at = CASE WHEN $4::boolean THEN now() ELSE last_sent_at END,
            updated_at = now()
      WHERE location_id = $1`,
    [locationId, status, error ? error.slice(0, 1000) : null, sent]
  );
}

async function runOneLocationSchedule(row: ScheduleRow, localDate: string): Promise<void> {
  // Atomic claim: with multiple app instances only one process can mark this local
  // schedule date. The claim is persisted before the external WhatsApp call so a
  // second process cannot duplicate the same day's report.
  const claim = await pool.query(
    `UPDATE location_whatsapp_stock_schedules
        SET last_scheduled_for = $2::date,
            last_attempt_at = now(),
            last_status = 'running',
            last_error = NULL,
            updated_at = now()
      WHERE location_id = $1
        AND enabled = true
        AND (last_scheduled_for IS NULL OR last_scheduled_for <> $2::date)
      RETURNING location_id`,
    [row.location_id, localDate]
  );
  if (!claim.rows.length) return;

  try {
    if (!row.destination_enabled || !row.whatsapp_group_chat_id || !row.whatsapp_group_chat_id.endsWith("@g.us")) {
      await finishSchedule(row.location_id, "failed", "Linked WhatsApp group is missing or disabled", false);
      return;
    }

    if (!(await scheduleAuthorStillAuthorized(row))) {
      await finishSchedule(row.location_id, "failed", "Schedule owner no longer has permission to send this report", false);
      return;
    }

    const { buffer, pageCount, rowCount } = await generateStockPdf(
      row.company_id,
      row.company_name,
      row.location_id,
      row.location_name,
      row.include_cost,
      row.stock_group_id ?? undefined,
      {
        includeZeroStock: row.include_zero_stock,
        includeNegativeStock: row.include_negative_stock,
        categoryId: row.category_id,
      }
    );

    try {
      if (rowCount === 0) {
        await finishSchedule(row.location_id, "skipped_empty", null, false);
        return;
      }

      const maxAllowedPages = Math.ceil(rowCount / 20) + 5;
      if (pageCount > maxAllowedPages) {
        await finishSchedule(
          row.location_id,
          "failed",
          `PDF safety guard rejected ${pageCount} pages for ${rowCount} rows`,
          false
        );
        return;
      }

      const mode = row.include_cost ? "with_cost" : "no_cost";
      const fileName = `${safeFilePart(row.location_name)}_Godown_${localDate.replace(/-/g, "")}_${mode}.pdf`;
      const caption = `Stock Report — ${row.location_name} — ${row.include_cost ? "With Cost" : "Without Cost"}`;
      const sendResult = await sendWhatsAppFileToChatIdPos(
        row.whatsapp_group_chat_id,
        buffer,
        fileName,
        caption,
        "application/pdf"
      );
      if (!sendResult.success) {
        await finishSchedule(row.location_id, "failed", sendResult.error || "WhatsApp send failed", false);
        return;
      }

      await finishSchedule(row.location_id, "sent", null, true);
      logger.info("[LocationStockSchedule] sent", {
        companyId: row.company_id,
        locationId: row.location_id,
        localDate,
        timezone: row.timezone,
        includeCost: row.include_cost,
        rowCount,
        pageCount,
        whatsappGroupName: row.whatsapp_group_name,
      });
    } finally {
      await releaseManagedExportAttachment(buffer);
    }
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    await finishSchedule(row.location_id, "failed", message, false).catch(() => undefined);
    logger.error("[LocationStockSchedule] run failed", {
      companyId: row.company_id,
      locationId: row.location_id,
      error,
    });
  }
}

/**
 * Called every minute by the existing scheduler service. Each row evaluates time
 * in its own IANA timezone, supports selected weekdays, catches up after a brief
 * restart, and atomically claims one local calendar day before sending.
 */
export async function checkAndRunLocationStockReports(now = new Date()): Promise<void> {
  try {
    const result = await pool.query<ScheduleRow>(
      `SELECT s.location_id, s.company_id, s.enabled, s.frequency, s.days_of_week,
              s.send_time::text, s.timezone, s.include_cost, s.include_zero_stock,
              s.include_negative_stock, s.stock_group_id, s.category_id,
              s.last_scheduled_for, s.updated_by_user_id,
              l.name AS location_name,
              c.name AS company_name,
              d.whatsapp_group_chat_id,
              d.whatsapp_group_name,
              d.enabled AS destination_enabled
         FROM location_whatsapp_stock_schedules s
         JOIN locations l ON l.id = s.location_id AND l.company_id = s.company_id
         JOIN companies c ON c.id = s.company_id
         LEFT JOIN location_whatsapp_stock_reports d
           ON d.location_id = s.location_id AND d.company_id = s.company_id
        WHERE s.enabled = true
        ORDER BY s.company_id, s.location_id`
    );

    for (const row of result.rows) {
      const due = isDue(row, now);
      if (!due.due || !due.localDate) continue;
      await runOneLocationSchedule(row, due.localDate);
    }
  } catch (error: any) {
    // During a rolling deployment an older database may briefly precede the
    // startup migration. Treat that as no schedules rather than breaking all cron.
    if (error?.code === "42P01") return;
    logger.error("[LocationStockSchedule] scheduler check failed", { error });
  }
}
