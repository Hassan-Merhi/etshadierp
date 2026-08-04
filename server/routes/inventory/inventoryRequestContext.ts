import type { Request } from "express";

import { InventoryRouteError } from "./inventoryErrors";

export interface InventoryListFilters {
  page: number;
  pageSize: number;
  search?: string;
  locationId?: number;
  stockGroupId?: number;
  unassignedStockGroup?: boolean;
  categoryIds?: number[];
  includeUncategorized?: boolean;
  profile?: string;
}

export interface QuickAdjustmentInput {
  stockItemId: number;
  locationId: number;
  quantity: number;
  type: "add" | "subtract";
}

export interface InventoryAuditActor {
  userId: string;
  username: string;
}

export function getActiveInventoryCompanyId(req: Request): number {
  const companyId = Number(req.session?.currentCompanyId);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    throw new InventoryRouteError(400, "No company selected");
  }
  return companyId;
}

export function parseInventoryListFilters(req: Request): InventoryListFilters {
  const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize || "50"), 10) || 50));
  const search =
    typeof req.query.search === "string" && req.query.search.trim() ? req.query.search.trim().slice(0, 100) : undefined;
  const locationId = req.query.locationId ? Number.parseInt(String(req.query.locationId), 10) : undefined;

  const stockGroupRaw = String(req.query.stockGroupId ?? "");
  const unassignedStockGroup = stockGroupRaw === "none" || stockGroupRaw === "null";
  const stockGroupId = /^\d+$/.test(stockGroupRaw) ? Number.parseInt(stockGroupRaw, 10) : undefined;

  const categoryParts = String(req.query.categoryIds ?? req.query.categoryId ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const includeUncategorized = categoryParts.includes("none") || categoryParts.includes("null");
  const categoryIds = Array.from(
    new Set(categoryParts.filter((part) => /^\d+$/.test(part)).map((part) => Number.parseInt(part, 10)))
  ).slice(0, 50);

  const profile = typeof req.query.profile === "string" ? req.query.profile : undefined;
  return {
    page,
    pageSize,
    search,
    locationId,
    stockGroupId,
    unassignedStockGroup,
    categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
    includeUncategorized,
    profile,
  };
}

export function parseQuickAdjustmentInput(input: unknown): QuickAdjustmentInput {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const { stockItemId, locationId, quantity, type } = body;
  if (!stockItemId || !locationId || !quantity || !type) {
    throw new InventoryRouteError(400, "Missing required fields: stockItemId, locationId, quantity, type");
  }

  const parsedStockItemId = Number(stockItemId);
  const parsedLocationId = Number(locationId);
  const parsedQuantity = Number.parseFloat(String(quantity));
  if (!Number.isInteger(parsedStockItemId) || parsedStockItemId <= 0) {
    throw new InventoryRouteError(400, "Invalid stock item ID");
  }
  if (!Number.isInteger(parsedLocationId) || parsedLocationId <= 0) {
    throw new InventoryRouteError(400, "Invalid location ID");
  }
  if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
    throw new InventoryRouteError(400, "Quantity must be a positive number");
  }
  if (type !== "add" && type !== "subtract") {
    throw new InventoryRouteError(400, "Type must be 'add' or 'subtract'");
  }

  return {
    stockItemId: parsedStockItemId,
    locationId: parsedLocationId,
    quantity: parsedQuantity,
    type,
  };
}

export function getInventoryAuditActor(req: Request): InventoryAuditActor {
  return {
    userId: req.session.userId!,
    username: req.session.username || "unknown",
  };
}
