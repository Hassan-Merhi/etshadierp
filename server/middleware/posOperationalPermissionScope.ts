import type { NextFunction, Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { ledgerAccounts, locations, userLocationCashAccounts, userLocations, vouchers } from "@shared/schema";
import { db } from "../db";
import { logger } from "../lib/logger";
import {
  ActiveCompanyPermissionContextError,
  getActiveCompanyPermissionContext,
  type ActiveCompanyPermissionContext,
} from "../services/security/activeCompanyPermissionContext";
import {
  isPosMutationAllowed,
  isPosSaleCreate,
  parsePosSaleEditVoucherId,
  resolveExplicitPosLocation,
} from "../services/security/posOperationalPermissionPolicy";

function requestPath(req: Request): string {
  return req.originalUrl.split("?", 1)[0] || req.path;
}

function deny(
  req: Request,
  res: Response,
  context: ActiveCompanyPermissionContext | null,
  status: number,
  code: string,
  message: string
): void {
  logger.error(
    JSON.stringify({
      event: "pos_operational_permission_denied",
      ts: new Date().toISOString(),
      userId: context?.userId ?? req.session.userId ?? null,
      role: context?.role ?? req.session.currentRole ?? null,
      companyId: context?.companyId ?? req.session.currentCompanyId ?? null,
      method: req.method,
      path: requestPath(req),
      code,
    })
  );
  res.status(status).json({ message, code });
}

function applyLiveContextToRequest(req: Request, context: ActiveCompanyPermissionContext): void {
  if (!req.user) return;
  const user = req.user as unknown as { role: unknown } & { assignedLocationId: unknown } & { posStation: unknown } & {
    cashAccountId: unknown;
  } & { canSellNegativeStock: unknown } & { posViewOnly: unknown } & { daybookEditDays: unknown } & {
    canAccessCustomers: unknown;
  } & { canDeleteRecords: unknown };
  user.role = context.role;
  user.assignedLocationId = context.assignedLocationId;
  user.posStation = context.posStation;
  user.cashAccountId = context.cashAccountId;
  user.canSellNegativeStock =
    ["Developer", "Admin", "Owner", "Manager"].includes(context.role) || context.canSellNegativeStock;
  user.posViewOnly = context.posViewOnly;
  user.daybookEditDays = context.daybookEditDays;
  user.canAccessCustomers = context.canAccessCustomers;
  user.canDeleteRecords = context.canDeleteRecords;
}

async function validateAssignedLocation(context: ActiveCompanyPermissionContext, locationId: number): Promise<boolean> {
  const [assignment] = await db
    .select({ id: userLocations.id })
    .from(userLocations)
    .innerJoin(
      locations,
      and(
        eq(locations.id, userLocations.locationId),
        eq(locations.companyId, context.companyId),
        eq(locations.active, true),
        isNull(locations.deletedAt)
      )
    )
    .where(
      and(
        eq(userLocations.userId, context.userId),
        eq(userLocations.companyId, context.companyId),
        eq(userLocations.locationId, locationId)
      )
    )
    .limit(1);
  return Boolean(assignment);
}

async function validateCashLedger(companyId: number, ledgerAccountId: number): Promise<boolean> {
  const [account] = await db
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.id, ledgerAccountId),
        eq(ledgerAccounts.companyId, companyId),
        eq(ledgerAccounts.accountType, "Cash"),
        eq(ledgerAccounts.active, true),
        isNull(ledgerAccounts.deletedAt)
      )
    )
    .limit(1);
  return Boolean(account);
}

async function validatePosCashAccount(
  context: ActiveCompanyPermissionContext,
  locationId: number
): Promise<{ valid: true } | { valid: false; message: string; code: string }> {
  const [mapping] = await db
    .select({ cashAccountId: userLocationCashAccounts.cashAccountId })
    .from(userLocationCashAccounts)
    .where(
      and(
        eq(userLocationCashAccounts.userId, context.userId),
        eq(userLocationCashAccounts.companyId, context.companyId),
        eq(userLocationCashAccounts.locationId, locationId)
      )
    )
    .limit(1);

  if (mapping) {
    if (await validateCashLedger(context.companyId, mapping.cashAccountId)) {
      return { valid: true };
    }
    return {
      valid: false,
      code: "POS_CASH_ACCOUNT_INVALID",
      message: "The cash account assigned to this POS location is inactive or invalid. Contact admin.",
    };
  }

  const [anyMapping] = await db
    .select({ id: userLocationCashAccounts.id })
    .from(userLocationCashAccounts)
    .where(
      and(
        eq(userLocationCashAccounts.userId, context.userId),
        eq(userLocationCashAccounts.companyId, context.companyId)
      )
    )
    .limit(1);

  if (anyMapping) {
    return {
      valid: false,
      code: "POS_LOCATION_CASH_ACCOUNT_REQUIRED",
      message: "No cash account is assigned for this POS location. Contact admin.",
    };
  }

  if (context.cashAccountId && (await validateCashLedger(context.companyId, context.cashAccountId))) {
    return { valid: true };
  }

  return {
    valid: false,
    code: "POS_CASH_ACCOUNT_REQUIRED",
    message: "No valid cash account is assigned to this POS user. Contact admin.",
  };
}

export async function enforcePosOperationalPermissionScope(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  let context: ActiveCompanyPermissionContext | null = null;
  try {
    context = await getActiveCompanyPermissionContext(req);
    applyLiveContextToRequest(req, context);

    if (
      !isPosMutationAllowed({
        method: req.method,
        role: context.role,
        posViewOnly: context.posViewOnly,
      })
    ) {
      deny(
        req,
        res,
        context,
        403,
        "POS_VIEW_ONLY_WRITE_DENIED",
        "This POS account is view-only and cannot make changes."
      );
      return;
    }

    if (context.role !== "POS") {
      next();
      return;
    }

    const path = requestPath(req);
    const explicitLocation = resolveExplicitPosLocation({
      bodyLocationId: (req.body as Record<string, unknown> | undefined)?.locationId,
      queryLocationId: req.query?.locationId,
      pathLocationId: req.params?.locationId,
    });

    if (explicitLocation.conflict) {
      deny(req, res, context, 400, "POS_LOCATION_CONFLICT", "All POS location identifiers in the request must match.");
      return;
    }

    let requiredLocationId = explicitLocation.locationId;
    const editVoucherId = parsePosSaleEditVoucherId(req.method, path);
    if (editVoucherId) {
      const [voucher] = await db
        .select({ locationId: vouchers.locationId })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.id, editVoucherId),
            eq(vouchers.companyId, context.companyId),
            eq(vouchers.voucherType, "Sales"),
            isNull(vouchers.deletedAt)
          )
        )
        .limit(1);
      if (!voucher?.locationId) {
        deny(req, res, context, 404, "POS_SALE_NOT_FOUND", "Sale not found");
        return;
      }
      if (requiredLocationId && requiredLocationId !== voucher.locationId) {
        deny(
          req,
          res,
          context,
          403,
          "POS_SALE_LOCATION_CHANGE_DENIED",
          "POS users cannot change the location of an existing sale."
        );
        return;
      }
      requiredLocationId = voucher.locationId;
    }

    if (requiredLocationId && !(await validateAssignedLocation(context, requiredLocationId))) {
      deny(req, res, context, 403, "POS_LOCATION_ACCESS_DENIED", "You are not allowed to use this POS location.");
      return;
    }

    if (isPosSaleCreate(req.method, path) && !(req.body as Record<string, unknown> | undefined)?.isCreditSale) {
      if (!requiredLocationId) {
        deny(req, res, context, 400, "POS_LOCATION_REQUIRED", "Location is required for POS sales.");
        return;
      }
      const cashValidation = await validatePosCashAccount(context, requiredLocationId);
      if (!cashValidation.valid) {
        deny(req, res, context, 400, cashValidation.code, cashValidation.message);
        return;
      }
    }

    next();
  } catch (error) {
    if (error instanceof ActiveCompanyPermissionContextError) {
      deny(req, res, context, error.status, error.code, error.message);
      return;
    }
    next(error);
  }
}
