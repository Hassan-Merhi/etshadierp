import type { Request, Response } from "express";
import { and, eq, like, ne } from "drizzle-orm";
import { db } from "../../db";
import {
  companies,
  containers,
  purchaseOrders,
  userCompanyRoles,
  users,
  voucherEntries,
  vouchers,
} from "@shared/schema";
import {
  classifyScopedAdministrationRequest,
  decideSharedUserMutation,
} from "../../services/security/companyScopedAdministrationPolicy";

function activeCompanyId(req: Request): number | null {
  return (
    (req.session as any).factoryCompanyId ??
    req.session.currentCompanyId ??
    null
  );
}

function parsePositiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function loadTargetUserCompanyScope(userId: string) {
  return db
    .select({ companyId: userCompanyRoles.companyId, role: userCompanyRoles.role })
    .from(userCompanyRoles)
    .where(eq(userCompanyRoles.userId, userId));
}

async function guardSingleCompanyUserMutation(req: Request, res: Response): Promise<boolean> {
  const companyId = activeCompanyId(req);
  if (!companyId) {
    res.status(403).json({ code: "COMPANY_CONTEXT_REQUIRED", message: "No company selected" });
    return true;
  }

  const targetUserId = String(req.params.id ?? req.params.userId ?? "").trim();
  if (!targetUserId) {
    res.status(400).json({ code: "USER_ID_INVALID", message: "Invalid user ID" });
    return true;
  }

  const roles = await loadTargetUserCompanyScope(targetUserId);
  const decision = decideSharedUserMutation(
    companyId,
    roles.map((row) => row.companyId)
  );
  if (decision === "not-found") {
    res.status(404).json({ message: "User not found" });
    return true;
  }
  if (decision === "shared-user-blocked") {
    res.status(409).json({
      code: "SHARED_USER_GLOBAL_MUTATION_BLOCKED",
      message: "This user belongs to multiple companies. Manage the company role instead of changing the shared account globally.",
    });
    return true;
  }

  return false;
}

async function guardRoleRecordCompany(req: Request, res: Response): Promise<boolean> {
  const companyId = activeCompanyId(req);
  const roleId = parsePositiveId(req.params.id);
  if (!companyId) {
    res.status(403).json({ code: "COMPANY_CONTEXT_REQUIRED", message: "No company selected" });
    return true;
  }
  if (!roleId) {
    res.status(400).json({ code: "ROLE_ID_INVALID", message: "Invalid role ID" });
    return true;
  }

  const [roleRecord] = await db
    .select({ companyId: userCompanyRoles.companyId })
    .from(userCompanyRoles)
    .where(eq(userCompanyRoles.id, roleId))
    .limit(1);

  if (!roleRecord || roleRecord.companyId !== companyId) {
    res.status(404).json({ message: "Role assignment not found" });
    return true;
  }

  const requestedCompanyId = req.body?.companyId;
  if (requestedCompanyId !== undefined && Number(requestedCompanyId) !== companyId) {
    res.status(403).json({
      code: "CROSS_COMPANY_ACCESS_DENIED",
      message: "Role assignments cannot be moved between companies.",
    });
    return true;
  }

  return false;
}

async function respondWithCompanyUsers(req: Request, res: Response): Promise<boolean> {
  const companyId = activeCompanyId(req);
  if (!companyId) {
    res.status(403).json({ code: "COMPANY_CONTEXT_REQUIRED", message: "No company selected" });
    return true;
  }

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      active: users.active,
      chatbotEnabled: users.chatbotEnabled,
      hiddenErpCostFields: users.hiddenErpCostFields,
      createdAt: users.createdAt,
    })
    .from(users)
    .innerJoin(
      userCompanyRoles,
      and(eq(userCompanyRoles.userId, users.id), eq(userCompanyRoles.companyId, companyId))
    )
    .where(ne(userCompanyRoles.role, "Developer"));

  res.json(rows);
  return true;
}

async function respondWithCompanyRoles(req: Request, res: Response): Promise<boolean> {
  const companyId = activeCompanyId(req);
  if (!companyId) {
    res.status(403).json({ code: "COMPANY_CONTEXT_REQUIRED", message: "No company selected" });
    return true;
  }

  const roles = await db
    .select({
      id: userCompanyRoles.id,
      userId: userCompanyRoles.userId,
      companyId: userCompanyRoles.companyId,
      role: userCompanyRoles.role,
      assignedLocationId: userCompanyRoles.assignedLocationId,
      cashAccountId: userCompanyRoles.cashAccountId,
      posStation: userCompanyRoles.posStation,
      canSellNegativeStock: userCompanyRoles.canSellNegativeStock,
      posViewOnly: userCompanyRoles.posViewOnly,
      daybookEditDays: userCompanyRoles.daybookEditDays,
      canAccessCustomers: userCompanyRoles.canAccessCustomers,
      canDeleteRecords: userCompanyRoles.canDeleteRecords,
      createdAt: userCompanyRoles.createdAt,
      companyName: companies.name,
      companyCode: companies.code,
    })
    .from(userCompanyRoles)
    .innerJoin(companies, eq(companies.id, userCompanyRoles.companyId))
    .where(
      and(
        eq(userCompanyRoles.userId, req.params.userId),
        eq(userCompanyRoles.companyId, companyId)
      )
    );

  res.json(roles);
  return true;
}

async function cleanupCompanyOrphanedCharges(req: Request, res: Response): Promise<boolean> {
  const companyId = activeCompanyId(req);
  if (!companyId) {
    res.status(403).json({ code: "COMPANY_CONTEXT_REQUIRED", message: "No company selected" });
    return true;
  }

  const chargeVouchers = await db
    .select({ id: vouchers.id, voucherNumber: vouchers.voucherNumber })
    .from(vouchers)
    .where(and(eq(vouchers.companyId, companyId), like(vouchers.voucherNumber, "CHARGE-%")));

  const orphanedIds: number[] = [];
  for (const chargeVoucher of chargeVouchers) {
    const parts = chargeVoucher.voucherNumber.split("-");
    const containerNumber = parts.length >= 3 ? `${parts[1]}-${parts[2]}` : "";
    if (!containerNumber) continue;

    const [remainingPo] = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .innerJoin(containers, eq(purchaseOrders.containerId, containers.id))
      .where(
        and(
          eq(containers.companyId, companyId),
          eq(containers.containerNumber, containerNumber)
        )
      )
      .limit(1);

    if (!remainingPo) orphanedIds.push(chargeVoucher.id);
  }

  if (orphanedIds.length > 0) {
    await db.transaction(async (tx) => {
      for (const voucherId of orphanedIds) {
        await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));
        await tx
          .delete(vouchers)
          .where(and(eq(vouchers.id, voucherId), eq(vouchers.companyId, companyId)));
      }
    });
  }

  res.json({
    message: `Cleaned up ${orphanedIds.length} orphaned charge vouchers`,
    deletedCount: orphanedIds.length,
  });
  return true;
}

/**
 * Runs inside requireAuth before legacy route middleware. Returns true when the
 * request has been fully handled or rejected; false means normal routing may continue.
 */
export async function interceptCompanyScopedUserAdministration(
  req: Request,
  res: Response
): Promise<boolean> {
  const role = req.session.currentRole;
  if (role !== "Admin" && role !== "Developer") return false;

  const action = classifyScopedAdministrationRequest(req.method, req.path);
  switch (action) {
    case "list-company-users":
      return respondWithCompanyUsers(req, res);
    case "list-company-user-roles":
      return respondWithCompanyRoles(req, res);
    case "mutate-global-user":
      return guardSingleCompanyUserMutation(req, res);
    case "mutate-company-role":
      return guardRoleRecordCompany(req, res);
    case "cleanup-orphaned-charges":
      return cleanupCompanyOrphanedCharges(req, res);
    default:
      return false;
  }
}
