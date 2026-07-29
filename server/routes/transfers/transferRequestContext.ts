import type { Request } from "express";

import { storage } from "../../storage";
import { TransferRouteError } from "./transferErrors";

export function getActiveTransferCompanyId(req: Request): number {
  const companyId = Number(req.session?.currentCompanyId);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    throw new TransferRouteError(400, "No company selected");
  }
  return companyId;
}

export function getTransferUserId(req: Request): string {
  const userId = req.session.userId;
  if (!userId) throw new TransferRouteError(401, "Authentication required");
  return userId;
}

export async function requireCompanyAccess(userId: string, companyIds: number[]): Promise<void> {
  const roles = await storage.getUserCompaniesWithRoles(userId);
  const accessibleCompanyIds = new Set(roles.map((role: any) => role.companyId));
  if (companyIds.some((companyId) => !accessibleCompanyIds.has(companyId))) {
    throw new TransferRouteError(403, "No access to one or both companies");
  }
}

export async function requireCompanyAccountAccess(
  userId: string,
  requestedCompanyId: number,
  activeCompanyId: number | undefined,
): Promise<void> {
  if (activeCompanyId === requestedCompanyId) return;
  const roles = await storage.getUserCompaniesWithRoles(userId);
  if (!roles.some((role: any) => role.companyId === requestedCompanyId)) {
    throw new TransferRouteError(403, "No access to this company");
  }
}
