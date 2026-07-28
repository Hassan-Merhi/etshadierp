import { assertRequestCompanyMatchesSession, CompanyIsolationError } from "./companyIsolationPolicy";
import type { AuthorizationActor } from "./authorizationPolicy";

interface CompanyScopedSession {
  userId?: string | number | null;
  currentRole?: string | null;
  currentCompanyId?: number | null;
  factoryCompanyId?: number | null;
}

interface CompanyScopedRequestLike {
  session?: CompanyScopedSession;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

function parsePositiveCompanyId(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseActorUserId(value: unknown): string | number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

export function resolveSessionCompanyActor(request: CompanyScopedRequestLike): AuthorizationActor {
  const session = request.session;
  const companyId = parsePositiveCompanyId(session?.factoryCompanyId ?? session?.currentCompanyId);
  const userId = parseActorUserId(session?.userId);

  if (!companyId || userId == null) {
    throw new CompanyIsolationError("RESOURCE_COMPANY_INVALID");
  }

  return {
    userId,
    role: session?.currentRole ?? "",
    companyId,
  };
}

export function resolveRequestCompanyId(request: CompanyScopedRequestLike): number {
  const actor = resolveSessionCompanyActor(request);
  const supplied = request.body?.companyId ?? request.query?.companyId;
  const requestedCompanyId = supplied == null || supplied === "" ? actor.companyId : parsePositiveCompanyId(supplied);

  if (!requestedCompanyId) {
    throw new CompanyIsolationError("RESOURCE_COMPANY_INVALID");
  }

  assertRequestCompanyMatchesSession(actor, requestedCompanyId);
  return actor.companyId;
}

export function isCompanyIsolationError(error: unknown): error is CompanyIsolationError {
  return error instanceof CompanyIsolationError;
}
