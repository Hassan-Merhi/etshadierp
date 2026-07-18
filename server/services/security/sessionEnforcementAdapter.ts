import type { Session } from "express-session";
import {
  decideSessionSecurity,
  type SessionSecurityCode,
  type SessionSecurityState,
} from "./sessionSecurityPolicy";

const DEFAULT_ABSOLUTE_LIFETIME_MS = 12 * 60 * 60 * 1000;

export interface EnforceSessionOptions {
  requireCompanyContext: boolean;
  requireRecentPasswordConfirmation?: boolean;
  now?: number;
}

export interface EnforcedSessionResult {
  valid: boolean;
  code: SessionSecurityCode;
  status: 401 | 403;
  destroySession: boolean;
}

type RuntimeSession = Session & Partial<SessionSecurityState> & {
  loginAt?: string | null;
  activeCredentialVersion?: number | null;
};

function initialCreatedAt(session: RuntimeSession, now: number): number {
  if (typeof session.createdAt === "number" && Number.isFinite(session.createdAt)) {
    return session.createdAt;
  }
  if (session.loginAt) {
    const parsed = Date.parse(session.loginAt);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= now) return parsed;
  }
  return now;
}

/**
 * Bridges express-session state into the Program 3 pure session policy.
 * Existing authenticated sessions are upgraded once with bounded timestamps so
 * deployment does not force every user to re-login. New sessions should set the
 * same fields at login. Credential version zero is the legacy baseline until a
 * persisted per-user credential-version store is introduced.
 */
export function enforceRuntimeSession(
  session: RuntimeSession,
  options: EnforceSessionOptions
): EnforcedSessionResult {
  const now = options.now ?? Date.now();

  if (session.userId) {
    const createdAt = initialCreatedAt(session, now);
    session.createdAt ??= createdAt;
    session.lastSeenAt ??= now;
    session.absoluteExpiresAt ??= createdAt + DEFAULT_ABSOLUTE_LIFETIME_MS;
    session.credentialVersion ??= 0;
  }

  const activeCredentialVersion =
    Number.isInteger(session.activeCredentialVersion) && Number(session.activeCredentialVersion) >= 0
      ? Number(session.activeCredentialVersion)
      : 0;

  const decision = decideSessionSecurity({
    session,
    activeCredentialVersion,
    now,
    requireCompanyContext: options.requireCompanyContext,
    requireRecentPasswordConfirmation: options.requireRecentPasswordConfirmation,
  });

  if (decision.valid) {
    session.lastSeenAt = now;
    return { valid: true, code: decision.code, status: 401, destroySession: false };
  }

  const unauthorizedCodes = new Set<SessionSecurityCode>([
    "SESSION_REQUIRED",
    "SESSION_TIMESTAMPS_INVALID",
    "SESSION_IDLE_EXPIRED",
    "SESSION_ABSOLUTE_EXPIRED",
    "SESSION_CREDENTIALS_REVOKED",
    "SESSION_COMPANY_REQUIRED",
  ]);

  return {
    valid: false,
    code: decision.code,
    status: unauthorizedCodes.has(decision.code) ? 401 : 403,
    destroySession: !["SESSION_REQUIRED", "SESSION_COMPANY_REQUIRED", "SESSION_PASSWORD_CONFIRMATION_REQUIRED"].includes(
      decision.code
    ),
  };
}
