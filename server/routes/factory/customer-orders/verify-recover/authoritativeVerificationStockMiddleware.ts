import type { Express, NextFunction, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth } from "../../../../auth";
import { db } from "../../../../db";
import { parseId } from "../../../../lib/parseId";
import { resultRows } from "../../../../lib/queryResult";
import { getAuthoritativeAvailableStockSnapshot } from "../../../../services/factory/authoritativeAvailableStock";
import { patchVerificationSummaryStock } from "../../../../services/factory/authoritativeStockPatch";

interface OrderLocationRow {
  location_id: number | null;
}

async function authoritativeVerificationStockMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "GET") return next();

  try {
    const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
    if (!companyId) return next();

    const orderId = parseId(req.params.id);
    if (orderId == null || Number.isNaN(orderId)) return next();

    const orderLocationRaw = await db.execute(sql`
      SELECT location_id
      FROM customer_orders
      WHERE id = ${orderId}
        AND company_id = ${companyId}
      LIMIT 1
    `);
    const [orderRow] = resultRows<OrderLocationRow>(orderLocationRaw);
    if (!orderRow) return next();

    const locationId = orderRow.location_id == null ? null : Number(orderRow.location_id);
    const snapshot = await getAuthoritativeAvailableStockSnapshot(Number(companyId), locationId);
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => originalJson(patchVerificationSummaryStock(body, snapshot))) as typeof res.json;
    return next();
  } catch (error) {
    return next(error);
  }
}

export function registerAuthoritativeVerificationStockMiddleware(app: Express) {
  app.use(
    "/api/factory/customer-orders/:id/verification-summary",
    requireAuth,
    authoritativeVerificationStockMiddleware
  );
}
