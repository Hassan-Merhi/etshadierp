import type { Request } from "express";

const AUTH_KEY = /(?:^|_)(?:user|role|permission|access|can|company|factory|location|station|account|credential)(?:_|$)/i;

function primitive(value: unknown): string | number | boolean | null | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function authorizationFields(source: unknown): Record<string, string | number | boolean | null> {
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const entries = Object.entries(source as Record<string, unknown>)
    .filter(([key]) => AUTH_KEY.test(key))
    .map(([key, value]) => [key, primitive(value)] as const)
    .filter((entry): entry is readonly [string, string | number | boolean | null] => entry[1] !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

/**
 * Snapshot only fields that can affect authorization. Volatile cookie/timestamp
 * data is intentionally excluded so an ordinary session touch does not break a
 * legitimate replay, while user/role/company/credential/access changes do.
 */
export function replayAuthorizationContext(req: Request): Record<string, unknown> {
  return {
    userId: req.session?.userId ?? req.user?.id ?? null,
    role: req.session?.currentRole ?? req.user?.role ?? null,
    session: authorizationFields(req.session),
    user: authorizationFields(req.user),
  };
}
