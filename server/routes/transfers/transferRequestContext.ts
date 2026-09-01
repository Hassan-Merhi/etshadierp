import { getErrorDetails } from "@shared/errorUtils";
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
  } catch (error) {
    throw new TransferRouteError(
      getErrorDetails(error).status ?? 400,
      getErrorDetails(error).optionalMessage ?? "No company selected"
    );
  }
}

export function getTransferUserId(req: Request): string {
  try {
    return getCompanyAccessContext(req).userId;
  } catch (error) {
    throw new TransferRouteError(
      getErrorDetails(error).status ?? 401,
      getErrorDetails(error).optionalMessage ?? "Authentication required"
    );
  }
}

export async function requireCompanyAccess(userId: string, companyIds: number[]): Promise<void> {
  try {
    await assertCompaniesAccess(userId, companyIds);
  } catch (error) {
    throw new TransferRouteError(
      getErrorDetails(error).status ?? 403,
      getErrorDetails(error).optionalMessage ?? "No access to one or both companies"
    );
  }
}

export async function requireCompanyAccountAccess(
  userId: string,
  requestedCompanyId: number,
  activeCompanyId: number | undefined
): Promise<void> {
  try {
    if (activeCompanyId === requestedCompanyId) {
      await assertCompanyAccess(userId, requestedCompanyId);
      return;
    }
    await assertCompanyAccess(userId, requestedCompanyId);
  } catch (error) {
    throw new TransferRouteError(
      getErrorDetails(error).status ?? 403,
      getErrorDetails(error).optionalMessage ?? "No access to this company"
    );
  }
}
