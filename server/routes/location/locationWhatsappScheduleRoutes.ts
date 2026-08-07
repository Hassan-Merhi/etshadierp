import type { Express, NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { stockCategories, stockGroups } from "@shared/schema";
import { db, pool } from "../../db";
import { requireAuth, requireNonPOS } from "../../auth";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { requireExportAccess, requireSensitiveAccess } from "../../lib/permissionMiddleware";
import { storage } from "../../storage";
import { logAudit } from "../_helpers";

const LOCATION_WHATSAPP_PERMISSION = "exp_whatsapp_send";
const requireCostPriceAccess = requireSensitiveAccess("fld_cost_price");
const requireTotalValueAccess = requireSensitiveAccess("fld_total_value");
const DEFAULT_TIMEZONE = "Africa/Lubumbashi";

function parseBoolean(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === "1" || value === "true";
}

function requireCostScheduleAccess(req: Request, res: Response, next: NextFunction): void {
  if (!parseBoolean(req.body?.includeCost)) {
    next();
    return;
  }

  requireCostPriceAccess(req, res, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }
    requireTotalValueAccess(req, res, next);
  });
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function normalizeSendTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeDays(value: unknown, frequency: string): number[] | null {
  if (frequency === "daily") return [0, 1, 2, 3, 4, 5, 6];
  if (!Array.isArray(value)) return null;
  const days = Array.from(new Set(value.map(Number))).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  if (!days.length) return null;
  return days.sort((a, b) => a - b);
}

async function validateOptionalFilter(
  companyId: number,
  rawId: unknown,
  kind: "group" | "category"
): Promise<number | null> {
  if (rawId === undefined || rawId === null || rawId === "" || rawId === "all") return null;
  const id = Number.parseInt(String(rawId), 10);
  if (!Number.isFinite(id) || id <= 0) throw new Error(`Invalid ${kind} ID`);

  if (kind === "group") {
    const [row] = await db
      .select({ id: stockGroups.id })
      .from(stockGroups)
      .where(and(eq(stockGroups.id, id), eq(stockGroups.companyId, companyId)))
      .limit(1);
    if (!row) throw new Error("Stock group not found for this company");
  } else {
    const [row] = await db
      .select({ id: stockCategories.id })
      .from(stockCategories)
      .where(and(eq(stockCategories.id, id), eq(stockCategories.companyId, companyId)))
      .limit(1);
    if (!row) throw new Error("Stock category not found for this company");
  }
  return id;
}

function defaultSchedule(locationId: number) {
  return {
    locationId,
    enabled: false,
    frequency: "daily" as const,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    sendTime: "18:00",
    timezone: DEFAULT_TIMEZONE,
    includeCost: false,
    includeZeroStock: false,
    includeNegativeStock: true,
    stockGroupId: null as number | null,
    categoryId: null as number | null,
    lastSentAt: null as string | null,
    lastStatus: null as string | null,
    lastError: null as string | null,
  };
}

function serializeSchedule(row: any, locationId: number) {
  if (!row) return defaultSchedule(locationId);
  const sendTime = typeof row.send_time === "string" ? row.send_time.slice(0, 5) : "18:00";
  return {
    locationId,
    enabled: row.enabled === true,
    frequency: row.frequency === "selected_days" ? "selected_days" : "daily",
    daysOfWeek: Array.isArray(row.days_of_week) ? row.days_of_week.map(Number) : [0, 1, 2, 3, 4, 5, 6],
    sendTime,
    timezone: row.timezone || DEFAULT_TIMEZONE,
    includeCost: row.include_cost === true,
    includeZeroStock: row.include_zero_stock === true,
    includeNegativeStock: row.include_negative_stock !== false,
    stockGroupId: row.stock_group_id == null ? null : Number(row.stock_group_id),
    categoryId: row.category_id == null ? null : Number(row.category_id),
    lastSentAt: row.last_sent_at ? new Date(row.last_sent_at).toISOString() : null,
    lastStatus: row.last_status ?? null,
    lastError: row.last_error ?? null,
  };
}

export function registerLocationWhatsappScheduleRoutes(app: Express) {
  app.get(
    "/api/locations/:locationId/whatsapp-schedule",
    requireAuth,
    requireNonPOS,
    requireExportAccess(LOCATION_WHATSAPP_PERMISSION),
    async (req, res) => {
      try {
        const locationId = Number.parseInt(req.params.locationId, 10);
        if (!Number.isFinite(locationId)) return res.status(400).json({ message: "Invalid location ID" });
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const location = await storage.getLocationById(locationId);
        if (!location) return res.status(404).json({ message: "Location not found" });
        if (location.companyId !== companyId) return res.status(403).json({ message: "Access denied" });

        const result = await pool.query(
          `SELECT enabled, frequency, days_of_week, send_time, timezone,
                  include_cost, include_zero_stock, include_negative_stock,
                  stock_group_id, category_id, last_sent_at, last_status, last_error
             FROM location_whatsapp_stock_schedules
            WHERE location_id = $1 AND company_id = $2`,
          [locationId, companyId]
        );
        res.json(serializeSchedule(result.rows[0], locationId));
      } catch (error: any) {
        if (error?.code === "42P01") {
          return res.json(defaultSchedule(Number.parseInt(req.params.locationId, 10)));
        }
        logger.error("[LocationStockSchedule] GET failed", { error });
        res.status(500).json({ message: getErrorMessage(error) });
      }
    }
  );

  app.put(
    "/api/locations/:locationId/whatsapp-schedule",
    requireAuth,
    requireNonPOS,
    requireExportAccess(LOCATION_WHATSAPP_PERMISSION),
    requireCostScheduleAccess,
    async (req, res) => {
      try {
        const locationId = Number.parseInt(req.params.locationId, 10);
        if (!Number.isFinite(locationId)) return res.status(400).json({ message: "Invalid location ID" });
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const location = await storage.getLocationById(locationId);
        if (!location) return res.status(404).json({ message: "Location not found" });
        if (location.companyId !== companyId) return res.status(403).json({ message: "Access denied" });

        const enabled = parseBoolean(req.body?.enabled);
        const frequency = req.body?.frequency === "selected_days" ? "selected_days" : req.body?.frequency === "daily" ? "daily" : null;
        if (!frequency) return res.status(400).json({ message: "Frequency must be daily or selected_days" });

        const daysOfWeek = normalizeDays(req.body?.daysOfWeek, frequency);
        if (!daysOfWeek) return res.status(400).json({ message: "Select at least one day for this schedule" });

        const sendTime = normalizeSendTime(req.body?.sendTime);
        if (!sendTime) return res.status(400).json({ message: "Invalid send time. Use HH:mm" });

        const timezone = typeof req.body?.timezone === "string" ? req.body.timezone.trim() : "";
        if (!timezone || !isValidTimezone(timezone)) {
          return res.status(400).json({ message: "Invalid IANA timezone" });
        }

        const includeCost = parseBoolean(req.body?.includeCost);
        const includeZeroStock = parseBoolean(req.body?.includeZeroStock);
        const includeNegativeStock = parseBoolean(req.body?.includeNegativeStock, true);
        const stockGroupId = await validateOptionalFilter(companyId, req.body?.stockGroupId, "group");
        const categoryId = await validateOptionalFilter(companyId, req.body?.categoryId, "category");

        const destination = await pool.query<{ whatsapp_group_chat_id: string | null; enabled: boolean }>(
          `SELECT whatsapp_group_chat_id, enabled
             FROM location_whatsapp_stock_reports
            WHERE location_id = $1 AND company_id = $2`,
          [locationId, companyId]
        );
        const destinationRow = destination.rows[0];
        if (enabled && (!destinationRow?.whatsapp_group_chat_id || destinationRow.enabled !== true)) {
          return res.status(400).json({
            message: "Link and enable the location WhatsApp group before enabling automatic stock reports",
          });
        }
        if (enabled && !destinationRow.whatsapp_group_chat_id!.endsWith("@g.us")) {
          return res.status(400).json({ message: "The linked WhatsApp destination is not a valid group" });
        }

        const previousResult = await pool.query(
          `SELECT enabled, frequency, days_of_week, send_time, timezone,
                  include_cost, include_zero_stock, include_negative_stock,
                  stock_group_id, category_id
             FROM location_whatsapp_stock_schedules
            WHERE location_id = $1 AND company_id = $2`,
          [locationId, companyId]
        );
        const previous = previousResult.rows[0] ?? null;

        const result = await pool.query(
          `INSERT INTO location_whatsapp_stock_schedules (
              location_id, company_id, enabled, frequency, days_of_week, send_time, timezone,
              include_cost, include_zero_stock, include_negative_stock,
              stock_group_id, category_id, updated_by_user_id, updated_at
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
            ON CONFLICT (location_id) DO UPDATE SET
              company_id = EXCLUDED.company_id,
              enabled = EXCLUDED.enabled,
              frequency = EXCLUDED.frequency,
              days_of_week = EXCLUDED.days_of_week,
              send_time = EXCLUDED.send_time,
              timezone = EXCLUDED.timezone,
              include_cost = EXCLUDED.include_cost,
              include_zero_stock = EXCLUDED.include_zero_stock,
              include_negative_stock = EXCLUDED.include_negative_stock,
              stock_group_id = EXCLUDED.stock_group_id,
              category_id = EXCLUDED.category_id,
              updated_by_user_id = EXCLUDED.updated_by_user_id,
              updated_at = now()
            RETURNING enabled, frequency, days_of_week, send_time, timezone,
                      include_cost, include_zero_stock, include_negative_stock,
                      stock_group_id, category_id, last_sent_at, last_status, last_error`,
          [
            locationId,
            companyId,
            enabled,
            frequency,
            daysOfWeek,
            sendTime,
            timezone,
            includeCost,
            includeZeroStock,
            includeNegativeStock,
            stockGroupId,
            categoryId,
            req.session.userId!,
          ]
        );

        try {
          await logAudit({
            userId: req.session.userId!,
            username: (req.session as any).username || "unknown",
            companyId,
            action: "update_location_whatsapp_stock_schedule",
            tableName: "location_whatsapp_stock_schedules",
            recordId: locationId,
            recordIdentifier: location.name,
            changes: {
              enabled: { old: previous?.enabled ?? false, new: enabled },
              frequency: { old: previous?.frequency ?? null, new: frequency },
              daysOfWeek: { old: previous?.days_of_week ?? null, new: daysOfWeek },
              sendTime: { old: previous?.send_time ?? null, new: sendTime },
              timezone: { old: previous?.timezone ?? null, new: timezone },
              includeCost: { old: previous?.include_cost ?? false, new: includeCost },
              includeZeroStock: { old: previous?.include_zero_stock ?? false, new: includeZeroStock },
              includeNegativeStock: { old: previous?.include_negative_stock ?? true, new: includeNegativeStock },
              stockGroupId: { old: previous?.stock_group_id ?? null, new: stockGroupId },
              categoryId: { old: previous?.category_id ?? null, new: categoryId },
            },
          });
        } catch {
          /* schedule save remains valid if audit persistence is temporarily unavailable */
        }

        res.json(serializeSchedule(result.rows[0], locationId));
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        if (message.startsWith("Invalid ") || message.includes("not found for this company")) {
          return res.status(400).json({ message });
        }
        logger.error("[LocationStockSchedule] PUT failed", { error });
        res.status(500).json({ message });
      }
    }
  );
}
