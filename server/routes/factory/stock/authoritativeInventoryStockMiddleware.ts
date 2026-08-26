import type { Express, NextFunction, Request, Response } from "express";
import { requireAuth } from "../../../auth";
import { parseId } from "../../../lib/parseId";
import { getAuthoritativeAvailableStockSnapshot } from "../../../services/factory/authoritativeAvailableStock";
import { patchInventoryStockRows } from "../../../services/factory/authoritativeStockPatch";

function isInventoryJsonTarget(req: Request): boolean {
  if (req.method !== "GET") return false;
  const suffix = req.path.replace(/\/+$/, "") || "/";
  return suffix === "/" || suffix === "/available";
}

async function authoritativeInventoryStockMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isInventoryJsonTarget(req)) return next();

  try {
    const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
    if (!companyId) return next();

    const locationId = parseId(req.params.locationId);
    if (locationId == null || Number.isNaN(locationId)) return next();

    const snapshot = await getAuthoritativeAvailableStockSnapshot(Number(companyId), locationId);
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => originalJson(patchInventoryStockRows(body, snapshot))) as typeof res.json;
    return next();
  } catch (error) {
    return next(error);
  }
}

export function registerAuthoritativeInventoryStockMiddleware(app: Express) {
  app.use("/api/factory/location-inventory/:locationId", requireAuth, authoritativeInventoryStockMiddleware);
}
