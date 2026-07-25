import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger";
import {
  CompanyAuthorizationError,
  assertUserCompanyMembership,
} from "../services/security/companyAuthorizationService";
import { decideExplicitCompanyScope } from "../services/security/companyRequestScopePolicy";

export async function enforceExplicitCompanyRequestScope(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const decision = decideExplicitCompanyScope({
      queryCompanyId: req.query?.companyId,
      bodyCompanyId: (req.body as Record<string, unknown> | undefined)?.companyId,
      currentCompanyId: req.session.currentCompanyId,
      factoryCompanyId: (req.session as any).factoryCompanyId,
    });

    if (decision.kind === "none" || decision.kind === "authorized-session") {
      next();
      return;
    }

    if (decision.kind === "invalid") {
      res.status(400).json({
        code: "COMPANY_ID_INVALID",
        message: `Invalid companyId in request ${decision.source}.`,
      });
      return;
    }

    if (decision.kind === "conflict") {
      res.status(400).json({
        code: "COMPANY_ID_CONFLICT",
        message: "The companyId in the request query and body must match.",
      });
      return;
    }

    const userId = req.session.userId;
    if (!userId) {
      // Authentication middleware remains authoritative for public and first-touch routes.
      next();
      return;
    }

    await assertUserCompanyMembership(userId, decision.companyId);
    next();
  } catch (error: unknown) {
    if (error instanceof CompanyAuthorizationError) {
      logger.error(
        JSON.stringify({
          event: "company_scope_denied",
          ts: new Date().toISOString(),
          userId: req.session.userId ?? null,
          username: req.session.username ?? null,
          currentCompanyId: req.session.currentCompanyId ?? null,
          factoryCompanyId: (req.session as any).factoryCompanyId ?? null,
          method: req.method,
          path: req.path,
          code: error.code,
        })
      );
      res.status(error.status).json({ code: error.code, message: error.message });
      return;
    }

    next(error);
  }
}
