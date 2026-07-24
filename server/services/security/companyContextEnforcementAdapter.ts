import type { NextFunction, Request, Response } from "express";
import { logger } from "../../lib/logger";
import { db } from "../../db";
import { persistSecurityEvent } from "./securityAuditRuntime";

export type CompanyAssertionSource = "body" | "query" | "params";

export interface CompanyContextOptions {
  assertionFields?: string[];
  includeLegacyFactorySessionAssertion?: boolean;
}

export interface CompanyContextDecision {
  allowed: boolean;
  companyId: number | null;
  code: "COMPANY_CONTEXT_OK" | "COMPANY_CONTEXT_REQUIRED" | "COMPANY_CONTEXT_MISMATCH";
}

function positiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function assertionValues(req: Request, fields: string[]): number[] {
  const containers: unknown[] = [req.body, req.query, req.params];
  const values: number[] = [];
  for (const container of containers) {
    if (!container || typeof container !== "object") continue;
    for (const field of fields) {
      const raw = (container as Record<string, unknown>)[field];
      if (raw === undefined || raw === null || raw === "") continue;
      const parsed = positiveInteger(raw);
      if (parsed === null) return [-1];
      values.push(parsed);
    }
  }
  return values;
}

export function decideExplicitCompanyContext(
  session: any,
  requestAssertions: number[] = [],
  includeLegacyFactorySessionAssertion = true
): CompanyContextDecision {
  const companyId = positiveInteger(session?.currentCompanyId);
  if (!companyId) return { allowed: false, companyId: null, code: "COMPANY_CONTEXT_REQUIRED" };

  const assertions = [...requestAssertions];
  if (includeLegacyFactorySessionAssertion && session?.factoryCompanyId !== undefined && session?.factoryCompanyId !== null) {
    const legacy = positiveInteger(session.factoryCompanyId);
    if (legacy === null) return { allowed: false, companyId, code: "COMPANY_CONTEXT_MISMATCH" };
    assertions.push(legacy);
  }

  if (assertions.some((assertion) => assertion !== companyId)) {
    return { allowed: false, companyId, code: "COMPANY_CONTEXT_MISMATCH" };
  }
  return { allowed: true, companyId, code: "COMPANY_CONTEXT_OK" };
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
    req.session?.username || req.session?.userId || "anonymous"
  );
}

export function requireExplicitCompanyContext(options: CompanyContextOptions = {}) {
  const fields = options.assertionFields ?? ["companyId", "factoryCompanyId"];
  return async (req: Request, res: Response, next: NextFunction) => {
    const assertions = assertionValues(req, fields);
    const decision = decideExplicitCompanyContext(
      req.session as any,
      assertions,
      options.includeLegacyFactorySessionAssertion !== false
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
