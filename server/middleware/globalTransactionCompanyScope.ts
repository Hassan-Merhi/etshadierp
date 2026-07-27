import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { vouchers } from "@shared/schema";
import { db } from "../db";
import { logger } from "../lib/logger";
import { userCanAccessGlobalCompany } from "../services/security/globalCompanyScopeService";
import { classifyGlobalVoucherRoute } from "../services/security/globalTransactionRoutePolicy";

export async function enforceGlobalTransactionCompanyScope(
  req: Request,
  res: Response
): Promise<boolean> {
  const match = classifyGlobalVoucherRoute(req.path);
  if (!match) return true;

  const userId = req.session.userId;
  const role = req.session.currentRole;
  if (!userId || !role) return true;

  const [voucher] = await db
    .select({ companyId: vouchers.companyId })
    .from(vouchers)
    .where(eq(vouchers.id, match.voucherId))
    .limit(1);

  const allowed =
    !!voucher &&
    (await userCanAccessGlobalCompany(userId, role, voucher.companyId));
  if (allowed) return true;

  logger.error(
    JSON.stringify({
      event: "global_transaction_scope_denied",
      ts: new Date().toISOString(),
      userId,
      username: req.session.username ?? null,
      role,
      method: req.method,
      path: req.path,
      voucherId: match.voucherId,
      voucherCompanyId: voucher?.companyId ?? null,
    })
  );
  res.status(404).json({ message: "Voucher not found" });
  return false;
}
