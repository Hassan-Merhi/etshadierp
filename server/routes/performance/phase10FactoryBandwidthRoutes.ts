import type { Express, NextFunction, Request, Response } from "express";
import { and, asc, eq, ilike, isNull, or } from "drizzle-orm";
import { factoryBaleProducts, factoryWorkers } from "@shared/schema";
import { requireAuth } from "../../auth";
import { db, pool } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";

function getFactoryCompanyId(req: Request): number | undefined {
  const value = Number((req.session as any).factoryCompanyId || req.session.currentCompanyId);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function parsePositiveId(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseLimit(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Math.min(maximum, Math.max(1, Number.isInteger(parsed) ? parsed : fallback));
}

async function sendProformaSummaries(req: Request, res: Response) {
  const companyId = getFactoryCompanyId(req);
  if (!companyId) return res.status(400).json({ message: "No company selected" });
  const customerId = parsePositiveId(req.query.customerId);
  if (!customerId) return res.status(400).json({ message: "customerId is required" });
  const limit = parseLimit(req.query.limit, 100, 250);

  const result = await pool.query<{
    id: number;
    company_id: number;
    customer_id: number;
    name: string | null;
    is_active?: boolean | null;
    deleted_at: string | null;
    created_at: string;
    updated_at: string | null;
    line_count: string;
    total_quantity: string;
  }>(
    `SELECT p.*,
            COALESCE(lines.line_count, 0)::text AS line_count,
            COALESCE(lines.total_quantity, 0)::text AS total_quantity
       FROM customer_proformas p
       LEFT JOIN (
         SELECT proforma_id,
                COUNT(*)::int AS line_count,
                COALESCE(SUM(quantity::numeric), 0) AS total_quantity
           FROM customer_proforma_lines
          GROUP BY proforma_id
       ) lines ON lines.proforma_id = p.id
      WHERE p.company_id = $1
        AND p.customer_id = $2
        AND p.deleted_at IS NULL
      ORDER BY p.name ASC
      LIMIT $3`,
    [companyId, customerId, limit],
  );

  res.setHeader("X-Result-Profile", "summary");
  res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
  return res.json(
    result.rows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      customerId: row.customer_id,
      name: row.name ?? "",
      isActive: row.is_active ?? false,
      deletedAt: row.deleted_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
      lineCount: Number.parseInt(row.line_count || "0", 10) || 0,
      totalQuantity: Number.parseFloat(row.total_quantity || "0") || 0,
    })),
  );
}

export function registerPhase10FactoryBandwidthRoutes(app: Express): void {
  // Query-profile alias keeps the legacy URL available while allowing incremental
  // client migration without embedding every proforma line in the list response.
  app.get(
    "/api/factory/customer-proformas",
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      if (req.query.profile !== "summary") return next();
      try {
        return await sendProformaSummaries(req, res);
      } catch (error: unknown) {
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    },
  );

  app.get("/api/factory/customer-proformas/summary", requireAuth, async (req: Request, res: Response) => {
    try {
      return await sendProformaSummaries(req, res);
    } catch (error: unknown) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Lines are fetched only when a proforma is opened or edited.
  app.get("/api/factory/customer-proformas/:id/lines", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const proformaId = parsePositiveId(req.params.id);
      if (!proformaId) return res.status(400).json({ message: "Invalid proforma ID" });

      const result = await pool.query<any>(
        `SELECT l.*,
                COALESCE(bp.name, l.product_name, '') AS resolved_product_name,
                COALESCE(bp.weight_per_bale_kg, 0)::text AS weight_per_bale_kg
           FROM customer_proforma_lines l
           JOIN customer_proformas p ON p.id = l.proforma_id
           LEFT JOIN factory_bale_products bp
             ON bp.company_id = p.company_id
            AND bp.article_code = l.article_code
          WHERE l.proforma_id = $1
            AND p.company_id = $2
            AND p.deleted_at IS NULL
          ORDER BY l.article_code ASC, l.id ASC`,
        [proformaId, companyId],
      );

      res.setHeader("X-Result-Profile", "detail-lines");
      res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
      return res.json(
        result.rows.map((line: any) => ({
          id: line.id,
          proformaId: line.proforma_id,
          articleCode: line.article_code ?? "",
          productName: line.resolved_product_name ?? line.product_name ?? "",
          quantity: Number(line.quantity) || 0,
          pricePerBale: line.price_per_bale ?? "0",
          productionPricePerBale: line.production_price_per_bale ?? "0",
          priceFixed: line.price_fixed ?? false,
          pricingMode: line.pricing_mode ?? "per_bale",
          pricePerKg: line.price_per_kg ?? null,
          weightPerBaleKg: line.weight_per_bale_kg ?? "0",
          createdAt: line.created_at,
        })),
      );
    } catch (error: unknown) {
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Selector projection for the many factory workflows that only need a worker
  // identity, assignment grouping, and display label.
  app.get(
    "/api/factory/workers",
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      if (req.query.profile !== "selector") return next();
      try {
        const companyId = getFactoryCompanyId(req);
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const limit = parseLimit(req.query.limit, 250, 500);
        const conditions: any[] = [eq(factoryWorkers.companyId, companyId)];
        if (req.query.active !== "false") conditions.push(eq(factoryWorkers.active, true));
        const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
        if (search) {
          const pattern = `%${search}%`;
          conditions.push(or(ilike(factoryWorkers.fullName, pattern), ilike(factoryWorkers.employeeCode, pattern)));
        }

        const rows = await db
          .select({
            id: factoryWorkers.id,
            employeeCode: factoryWorkers.employeeCode,
            fullName: factoryWorkers.fullName,
            position: factoryWorkers.position,
            department: factoryWorkers.department,
            active: factoryWorkers.active,
          })
          .from(factoryWorkers)
          .where(and(...conditions))
          .orderBy(asc(factoryWorkers.fullName))
          .limit(limit);

        res.setHeader("X-Result-Profile", "selector");
        res.setHeader("Cache-Control", "private, max-age=60, stale-while-revalidate=120");
        return res.json(rows);
      } catch (error: unknown) {
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    },
  );

  // Product selector keeps description, timestamps, and other management-only
  // fields out of scanner, loading, and assignment screens.
  app.get(
    "/api/factory/bale-products",
    requireAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      if (req.query.profile !== "selector") return next();
      try {
        const companyId = getFactoryCompanyId(req);
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const limit = parseLimit(req.query.limit, 500, 1000);
        const conditions: any[] = [eq(factoryBaleProducts.companyId, companyId), isNull(factoryBaleProducts.deletedAt)];
        if (req.query.active !== "false") conditions.push(eq(factoryBaleProducts.active, true));
        const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
        if (search) {
          const pattern = `%${search}%`;
          conditions.push(
            or(
              ilike(factoryBaleProducts.name, pattern),
              ilike(factoryBaleProducts.code, pattern),
              ilike(factoryBaleProducts.articleCode, pattern),
            ),
          );
        }

        const rows = await db
          .select({
            id: factoryBaleProducts.id,
            code: factoryBaleProducts.code,
            articleCode: factoryBaleProducts.articleCode,
            name: factoryBaleProducts.name,
            categoryId: factoryBaleProducts.categoryId,
            weightPerBaleKg: factoryBaleProducts.weightPerBaleKg,
            active: factoryBaleProducts.active,
          })
          .from(factoryBaleProducts)
          .where(and(...conditions))
          .orderBy(asc(factoryBaleProducts.name))
          .limit(limit);

        res.setHeader("X-Result-Profile", "selector");
        res.setHeader("Cache-Control", "private, max-age=60, stale-while-revalidate=120");
        return res.json(rows);
      } catch (error: unknown) {
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    },
  );
}
