import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger";
import { resolveActiveCompanyId } from "../routes/helpers/resolveActiveCompanyId";
import { decideAdminCompanyScope } from "../services/security/adminCompanyScopePolicy";

export function enforceAdminCompanyScope(req: Request, res: Response, next: NextFunction) {
  const decision = decideAdminCompanyScope({
    activeCompanyId: resolveActiveCompanyId(req),
    queryCompanyId: req.query?.companyId,
    bodyCompanyId: (req.body as Record<string, unknown> | undefined)?.companyId,
    pathCompanyId: req.params?.companyId,
  });

  if (decision.kind === "none" || decision.kind === "match") return next();

  logger.error(
    JSON.stringify({
      event: "admin_company_scope_denied",
      userId: req.session.userId ?? null,
      username: req.session.username ?? null,
      role: req.session.currentRole ?? null,
      activeCompanyId: resolveActiveCompanyId(req),
      method: req.method,
      path: req.path,
      decision: decision.kind,
    })
  );

  if (decision.kind === "invalid") {
    return res.status(400).json({
      code: "COMPANY_ID_INVALID",
      message: `Invalid companyId in request ${decision.source}.`,
    });
  }

  if (decision.kind === "conflict") {
    return res.status(400).json({
      code: "COMPANY_ID_CONFLICT",
      message: "All companyId values in the request must match.",
    });
  }

  return res.status(403).json({
    code: "CROSS_COMPANY_ACCESS_DENIED",
    message: "Forbidden",
  });
}
