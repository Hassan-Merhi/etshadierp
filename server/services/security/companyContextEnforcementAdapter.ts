import type { NextFunction, Request, Response } from "express";
import { logger } from "../../lib/logger";
import { db } from "../../db";
import { persistSecurityEvent } from "./securityAuditRuntime";
import {
  collectCompanyAssertions,
  decideExplicitCompanyContext,
  type CompanyContextDecision,
} from "./companyContextPolicy";

export { decideExplicitCompanyContext } from "./companyContextPolicy";
export type { CompanyContextDecision } from "./companyContextPolicy";

export type CompanyAssertionSource = "body" | "query" | "params";

export interface CompanyContextOptions {
  assertionFields?: string[];
  includeLegacyFactorySessionAssertion?: boolean;
}

async function auditCompanyDecision(req: Request, decision: CompanyContextDecision): Promise<void> {
  await persistSecurityEvent(
    db,
    {
      kind: "company-isolation",
      action: "company-context.enforce",
      outcome: decision.allowed ? "allowed" : "denied",
      companyId: decision.companyId,
      actorUserId: req.session?.userId ?? null,
      targetType: "company-context",
      targetId: decision.companyId == null ? null : String(decision.companyId),
      reasonCode: decision.code,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      metadata: { method: req.method, path: req.path },
    },
    req.session?.username || req.session?.userId || "anonymous",
  );
}

export function requireExplicitCompanyContext(options: CompanyContextOptions = {}) {
  const fields = options.assertionFields ?? ["companyId", "factoryCompanyId"];
  return async (req: Request, res: Response, next: NextFunction) => {
    const assertions = collectCompanyAssertions([req.body, req.query, req.params], fields);
    const decision = decideExplicitCompanyContext(
      req.session as any,
      assertions,
      options.includeLegacyFactorySessionAssertion !== false,
    );

    try {
      await auditCompanyDecision(req, decision);
    } catch (auditError) {
      logger.error("Security audit persistence failed:", { error: auditError });
      if (!decision.allowed) return res.status(500).json({ message: "Security audit unavailable" });
    }

    if (!decision.allowed) {
      const status = decision.code === "COMPANY_CONTEXT_REQUIRED" ? 400 : 403;
      const message = decision.code === "COMPANY_CONTEXT_REQUIRED" ? "No company selected" : "Forbidden";
      return res.status(status).json({ message, code: decision.code });
    }

    // Normalize legacy factory consumers to the authenticated company. This is not
    // fallback resolution: any pre-existing legacy value was already required to match.
    (req.session as any).factoryCompanyId = decision.companyId;
    (req as any).securityCompanyId = decision.companyId;
    next();
  };
}
