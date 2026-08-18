import type { Request } from "express";

const AUTH_KEY = /user|role|permission|access|\bcan|can[A-Z_]|company|factory|location|station|account|credential/i;

type AuthorizationValue =
  | string
  | number
  | boolean
  | null
  | AuthorizationValue[]
  | { [key: string]: AuthorizationValue };

function authorizationValue(value: unknown): AuthorizationValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    const normalized = value.map(authorizationValue).filter((item): item is AuthorizationValue => item !== undefined);
    return normalized;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => [key, authorizationValue(child)] as const)
      .filter((entry): entry is readonly [string, AuthorizationValue] => entry[1] !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries) as { [key: string]: AuthorizationValue };
  }
  return undefined;
}

function authorizationFields(source: unknown): Record<string, AuthorizationValue> {
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const entries = Object.entries(source as Record<string, unknown>)
    .filter(([key]) => AUTH_KEY.test(key))
    .map(([key, value]) => [key, authorizationValue(value)] as const)
    .filter((entry): entry is readonly [string, AuthorizationValue] => entry[1] !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

/**
 * Snapshot only fields that can affect authorization. Volatile cookie/timestamp
 * data is intentionally excluded so an ordinary session touch does not break a
 * legitimate replay, while user/role/company/credential/access changes do.
 * Structured permission/access collections are preserved because a revoked
 * action permission must invalidate a previously stored replay result.
 */
export function replayAuthorizationContext(req: Request): Record<string, unknown> {
  return {
    userId: req.session?.userId ?? req.user?.id ?? null,
    role: req.session?.currentRole ?? req.user?.role ?? null,
    session: authorizationFields(req.session),
    user: authorizationFields(req.user),
  };
}
