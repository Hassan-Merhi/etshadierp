import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../auth";
import { db, pool } from "../db";
import { getErrorMessage } from "../lib/httpHandlers";
import { userLocations } from "@shared/schema";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 250;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePagination(req: Request): { page: number; limit: number; offset: number } {
  const limit = Math.min(MAX_PAGE_SIZE, parsePositiveInt(req.query.limit ?? req.query.pageSize, DEFAULT_PAGE_SIZE));
  if (req.query.offset !== undefined) {
    const offset = Math.max(0, Number.parseInt(String(req.query.offset), 10) || 0);
    return { page: Math.floor(offset / limit) + 1, limit, offset };
  }
  const page = parsePositiveInt(req.query.page, 1);
  return { page, limit, offset: (page - 1) * limit };
}

function normalizeDate(value: unknown): string | undefined {
  return typeof value === "string" && ISO_DATE.test(value) ? value : undefined;
}

export function registerDaybookPaginationRoutes(app: Express): void {
  app.get("/api/daybook", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      let startDate = normalizeDate(req.query.startDate);
      let endDate = normalizeDate(req.query.endDate);
      if (!startDate || !endDate) {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 90);
        startDate = start.toISOString().slice(0, 10);
        endDate = end.toISOString().slice(0, 10);
      }

      const values: unknown[] = [companyId, startDate, endDate];
      const bind = (value: unknown): string => {
        values.push(value);
        return `$${values.length}`;
      };
      const voucherConditions = [
        "v.company_id = $1",
        "v.deleted_at IS NULL",
        "v.voucher_date >= $2::date",
        "v.voucher_date <= $3::date",
        "v.voucher_number NOT LIKE 'SP-OTW-REV-%'",
        "v.voucher_number NOT LIKE 'SP-STOCK-%'",
        "v.voucher_number NOT LIKE 'SP-OPNSTK-%'",
      ];
      const offloadConditions = [
        "c.company_id = $1",
        "co.offloaded_at >= $2::date",
        "co.offloaded_at < ($3::date + INTERVAL '1 day')",
      ];

      const voucherType = typeof req.query.voucherType === "string" ? req.query.voucherType.trim() : "";
      if (voucherType && voucherType !== "all") voucherConditions.push(`v.voucher_type = ${bind(voucherType)}`);

      const statusFilter = typeof req.query.statusFilter === "string" ? req.query.statusFilter : "all";
      if (statusFilter === "active") voucherConditions.push("v.optional = false");
      else if (statusFilter === "optional") voucherConditions.push("v.optional = true");

      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      if (search) {
        const param = bind(`%${search}%`);
        voucherConditions.push(`(v.voucher_number ILIKE ${param} OR COALESCE(v.description, '') ILIKE ${param} OR COALESCE(v.location_name, '') ILIKE ${param})`);
      }

      const minAmount = Number.parseFloat(String(req.query.minAmount ?? ""));
      const maxAmount = Number.parseFloat(String(req.query.maxAmount ?? ""));
      if (Number.isFinite(minAmount)) voucherConditions.push(`v.total_amount::numeric >= ${bind(minAmount)}`);
      if (Number.isFinite(maxAmount)) voucherConditions.push(`v.total_amount::numeric <= ${bind(maxAmount)}`);

      if (req.session.currentRole === "POS" && req.user?.id) {
        const assignedLocations = await db
          .select({ locationId: userLocations.locationId })
          .from(userLocations)
          .where(and(eq(userLocations.userId, req.user.id), eq(userLocations.companyId, companyId)));
        const locationIds = assignedLocations.map((row) => row.locationId);
        if (locationIds.length > 0) {
          voucherConditions.push(`(v.location_id IS NULL OR v.location_id = ANY(${bind(locationIds)}::int[]))`);
        }
      }

      const { page, limit, offset } = parsePagination(req);
      const limitParam = bind(limit);
      const offsetParam = bind(offset);
      const direction = req.query.sortOrder === "asc" ? "ASC" : "DESC";

      const query = `
        WITH voucher_rows AS (
          SELECT
            'voucher'::text AS row_type,
            COALESCE(v.effective_date, v.voucher_date)::date AS sort_date,
            v.id AS sort_id,
            jsonb_build_object(
              'id', v.id,
              'companyId', v.company_id,
              'locationId', v.location_id,
              'locationName', v.location_name,
              'voucherNumber', v.voucher_number,
              'voucherType', v.voucher_type,
              'voucherDate', v.voucher_date,
              'effectiveDate', v.effective_date,
              'description', v.description,
              'totalAmount', v.total_amount,
              'currency', v.currency,
              'optional', v.optional,
              'shiftId', v.shift_id,
              'exchangeRate', v.exchange_rate,
              'sourceModule', v.source_module,
              'isCreditSale', v.is_credit_sale,
              'clientSaleId', v.client_sale_id,
              'createdAt', v.created_at
            ) AS payload
          FROM vouchers v
          WHERE ${voucherConditions.join(" AND ")}
        ),
        offload_rows AS (
          SELECT
            'offload'::text AS row_type,
            co.offloaded_at::date AS sort_date,
            co.id AS sort_id,
            jsonb_build_object(
              'id', co.id,
              'containerId', co.container_id,
              'containerNumber', c.container_number,
              'locationId', co.location_id,
              'locationName', l.name,
              'duties', co.duties,
              'officeCharges', co.office_charges,
              'transferCharges', co.transfer_charges,
              'transportFees', co.transport_fees,
              'totalCharges', co.total_charges,
              'totalBales', co.total_bales,
              'additionalCostPerBale', co.additional_cost_per_bale,
              'offloadedAt', co.offloaded_at,
              'itemsTotal', COALESCE((SELECT SUM(coi.total_value) FROM container_offload_items coi WHERE coi.offload_id = co.id), 0)
            ) AS payload
          FROM container_offloads co
          JOIN containers c ON c.id = co.container_id
          LEFT JOIN locations l ON l.id = co.location_id
          WHERE ${offloadConditions.join(" AND ")}
        ),
        combined AS (
          SELECT * FROM voucher_rows
          UNION ALL
          SELECT * FROM offload_rows
        ),
        page_rows AS (
          SELECT *
          FROM combined
          ORDER BY sort_date ${direction},
                   CASE WHEN row_type = 'voucher' THEN 0 ELSE 1 END ASC,
                   sort_id ${direction}
          LIMIT ${limitParam} OFFSET ${offsetParam}
        )
        SELECT
          (SELECT COUNT(*)::int FROM combined) AS total,
          COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object('_type', row_type, 'data', payload)
                ORDER BY sort_date ${direction}, CASE WHEN row_type = 'voucher' THEN 0 ELSE 1 END ASC, sort_id ${direction}
              )
              FROM page_rows
            ),
            '[]'::jsonb
          ) AS items
      `;

      const result = await pool.query(query, values);
      const total = Number(result.rows[0]?.total || 0);
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
      const items = Array.isArray(result.rows[0]?.items) ? result.rows[0].items : [];
      return res.json({
        items,
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1 && totalPages > 0,
      });
    } catch (error: unknown) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
