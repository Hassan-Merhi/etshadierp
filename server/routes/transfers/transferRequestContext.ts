import type { Request } from "express";

import {
  assertCompaniesAccess,
  assertCompanyAccess,
  getCompanyAccessContext,
} from "../../security/companyAccessBoundary";
import { TransferRouteError } from "./transferErrors";

export function getActiveTransferCompanyId(req: Request): number {
  try {
    return getCompanyAccessContext(req).activeCompanyId;
  } catch (error: any) {
    throw new TransferRouteError(error?.status ?? 400, error?.message ?? "No company selected");
  }
}

export function getTransferUserId(req: Request): string {
  try {
    return getCompanyAccessContext(req).userId;
  } catch (error: any) {
    throw new TransferRouteError(error?.status ?? 401, error?.message ?? "Authentication required");
  }
}

export async function requireCompanyAccess(userId: string, companyIds: number[]): Promise<void> {
  try {
    await assertCompaniesAccess(userId, companyIds);
  } catch (error: any) {
    throw new TransferRouteError(error?.status ?? 403, error?.message ?? "No access to one or both companies");
  }
}

export async function requireCompanyAccountAccess(
  userId: string,
  requestedCompanyId: number,
  activeCompanyId: number | undefined,
): Promise<void> {
  try {
    if (activeCompanyId === requestedCompanyId) {
      await assertCompanyAccess(userId, requestedCompanyId);
      return;
    }
    await assertCompanyAccess(userId, requestedCompanyId);
  } catch (error: any) {
    throw new TransferRouteError(error?.status ?? 403, error?.message ?? "No access to this company");
  }
}
