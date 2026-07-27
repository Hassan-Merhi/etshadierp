import type { NextFunction, Request, Response } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { stockItemLocationPrices, stockItems } from "@shared/schema";
import { db } from "../db";
import { requirePosCapability } from "../lib/permissionMiddleware";
import { getActiveCompanyPermissionContext } from "../services/security/activeCompanyPermissionContext";
import {
  isPosSaleSubmission,
  requestedPosSaleCapabilities,
  type PosSaleCapabilityBody,
} from "../services/security/posCapabilityPolicy";

function requestPath(req: Request): string {
  return req.originalUrl.split("?", 1)[0] || req.path;
}

function positiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function hasConfiguredPriceOverride(req: Request): Promise<boolean> {
  const path = requestPath(req);
  if (!isPosSaleSubmission(req.method, path)) return false;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const locationId = positiveId(body.locationId);
  const items = Array.isArray(body.items) ? body.items : [];
  if (!locationId || items.length === 0) return false;

  const itemIds = [...new Set(
    items
      .map((item) => positiveId((item as Record<string, unknown> | null)?.stockItemId))
      .filter((value): value is number => value !== null)
  )];
  if (itemIds.length === 0) return false;

  const context = await getActiveCompanyPermissionContext(req);
  const configuredRows = await db
    .select({
      stockItemId: stockItems.id,
      defaultPrice: stockItems.sellingPrice,
      locationPrice: stockItemLocationPrices.sellingPrice,
    })
    .from(stockItems)
    .leftJoin(
      stockItemLocationPrices,
      and(
        eq(stockItemLocationPrices.stockItemId, stockItems.id),
        eq(stockItemLocationPrices.locationId, locationId)
      )
    )
    .where(
      and(
        eq(stockItems.companyId, context.companyId),
        inArray(stockItems.id, itemIds),
        isNull(stockItems.deletedAt)
      )
    );

  const configuredByItem = new Map(
    configuredRows.map((row) => [
      row.stockItemId,
      Number(row.locationPrice ?? row.defaultPrice ?? 0),
    ])
  );

  return items.some((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    const itemId = positiveId(row.stockItemId);
    if (!itemId) return false;

    const submittedPrice = Number(row.rate ?? row.sellingPrice);
    const configuredPrice = configuredByItem.get(itemId) ?? 0;
    if (!Number.isFinite(submittedPrice) || configuredPrice <= 0) return false;
    return Math.abs(submittedPrice - configuredPrice) > 0.000001;
  });
}

async function permissionAllows(
  req: Request,
  res: Response,
  permissionKey: string
): Promise<boolean> {
  let allowed = false;
  await requirePosCapability(permissionKey)(req, res, () => {
    allowed = true;
  });
  return allowed;
}

export async function enforcePosCapabilityScope(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const path = requestPath(req);
    if (!isPosSaleSubmission(req.method, path)) {
      next();
      return;
    }

    const body = (req.body ?? {}) as PosSaleCapabilityBody;
    const capabilities = requestedPosSaleCapabilities({
      method: req.method,
      path,
      body,
      hasPriceOverride: await hasConfiguredPriceOverride(req),
    });

    for (const permissionKey of capabilities) {
      if (!(await permissionAllows(req, res, permissionKey))) return;
    }

    next();
  } catch (error) {
    next(error);
  }
}
