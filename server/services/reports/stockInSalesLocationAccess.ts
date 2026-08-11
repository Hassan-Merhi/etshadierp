import { and, eq } from "drizzle-orm";

import { db } from "../../db";
import { locations, userLocations } from "@shared/schema";

const UNRESTRICTED_ROLES = new Set(["Developer", "Admin", "Owner", "Manager"]);

export class StockInSalesLocationAccessError extends Error {
  readonly statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name = "StockInSalesLocationAccessError";
  }
}

export function applyRequestedLocationScope(requestedLocationIds: number[], allowedLocationIds: number[]): number[] {
  const allowed = Array.from(new Set(allowedLocationIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (allowed.length === 0) {
    throw new StockInSalesLocationAccessError("No report locations are assigned to this user");
  }

  const requested = Array.from(new Set(requestedLocationIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (requested.length === 0) return allowed;

  const allowedSet = new Set(allowed);
  const denied = requested.filter((id) => !allowedSet.has(id));
  if (denied.length > 0) {
    throw new StockInSalesLocationAccessError("You can only view report data for your assigned locations");
  }

  return requested;
}

export async function resolveStockInSalesLocationIds(params: {
  userId: string;
  companyId: number;
  role: string;
  currentLocationId?: number | null;
  requestedLocationIds: number[];
}): Promise<number[]> {
  if (UNRESTRICTED_ROLES.has(params.role)) {
    if (params.requestedLocationIds.length > 0) return params.requestedLocationIds;

    const companyLocations = await db
      .select({ locationId: locations.id })
      .from(locations)
      .where(eq(locations.companyId, params.companyId));

    const locationIds = companyLocations.map((row) => row.locationId);
    if (locationIds.length === 0) {
      throw new StockInSalesLocationAccessError("No report locations are available for this company");
    }
    return locationIds;
  }

  const assignments = await db
    .select({ locationId: userLocations.locationId })
    .from(userLocations)
    .where(and(eq(userLocations.userId, params.userId), eq(userLocations.companyId, params.companyId)));

  const allowedLocationIds = assignments.map((row) => row.locationId);
  if (allowedLocationIds.length === 0 && params.currentLocationId) {
    allowedLocationIds.push(params.currentLocationId);
  }

  return applyRequestedLocationScope(params.requestedLocationIds, allowedLocationIds);
}
