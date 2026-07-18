export const SECURITY_EVENT_KINDS = [
  "authentication",
  "authorization",
  "company-isolation",
  "privileged-operation",
  "session",
  "input-validation",
  "protected-asset",
] as const;

export type SecurityEventKind = (typeof SECURITY_EVENT_KINDS)[number];
export type SecuritySeverity = "info" | "warning" | "critical";
export type SecurityOutcome = "allowed" | "denied" | "failed";

export interface SecurityEventInput {
  kind: SecurityEventKind;
  action: string;
  outcome: SecurityOutcome;
  companyId?: number | null;
  actorUserId?: string | number | null;
  targetType?: string | null;
  targetId?: string | number | null;
  reasonCode?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  occurredAt?: number;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface SecurityAuditRecord {
  eventKey: string;
  kind: SecurityEventKind;
  severity: SecuritySeverity;
  action: string;
  outcome: SecurityOutcome;
  companyId: number | null;
  actorUserId: string | null;
  targetType: string | null;
  targetId: string | null;
  reasonCode: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  occurredAt: number;
  metadata: Readonly<Record<string, unknown>>;
}

export interface SecurityAnomaly {
  code:
    | "REPEATED_DENIALS"
    | "CROSS_COMPANY_ATTEMPT"
    | "PRIVILEGED_OPERATION_FAILURE"
    | "CREDENTIAL_OR_SESSION_ANOMALY"
    | "PROTECTED_ASSET_PROBING";
  severity: Exclude<SecuritySeverity, "info">;
  eventKeys: readonly string[];
}

const SECRET_KEY = /(password|secret|token|cookie|authorization|credential|sessionid|csrf)/i;

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function redactMetadata(metadata: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SECRET_KEY.test(key)) safe[key] = "[REDACTED]";
    else if (typeof value === "string" && value.length > 500) safe[key] = `${value.slice(0, 500)}…`;
    else if (["string", "number", "boolean"].includes(typeof value) || value == null) safe[key] = value;
  }
  return Object.freeze(safe);
}

function severityFor(input: SecurityEventInput): SecuritySeverity {
  if (input.outcome === "allowed") return "info";
  if (input.kind === "company-isolation" || input.kind === "privileged-operation") return "critical";
  return "warning";
}

/** Builds an append-only, non-secret audit record. Adapters persist it transactionally. */
export function buildSecurityAuditRecord(input: SecurityEventInput): SecurityAuditRecord {
  const action = text(input.action);
  if (!action) throw new Error("Invalid security event");
  const occurredAt = input.occurredAt ?? Date.now();
  if (!Number.isFinite(occurredAt) || occurredAt <= 0) throw new Error("Invalid security event");
  if (input.companyId != null && (!Number.isSafeInteger(input.companyId) || input.companyId <= 0)) {
    throw new Error("Invalid security event");
  }
  const actorUserId = text(input.actorUserId) || null;
  const targetType = text(input.targetType) || null;
  const targetId = text(input.targetId) || null;
  const reasonCode = text(input.reasonCode) || null;
  const eventKey = [input.kind, input.outcome, input.companyId ?? "global", actorUserId ?? "anonymous", action, targetType ?? "none", targetId ?? "none", occurredAt].join(":");
  return Object.freeze({
    eventKey,
    kind: input.kind,
    severity: severityFor(input),
    action,
    outcome: input.outcome,
    companyId: input.companyId ?? null,
    actorUserId,
    targetType,
    targetId,
    reasonCode,
    ipAddress: text(input.ipAddress) || null,
    userAgent: text(input.userAgent).slice(0, 500) || null,
    occurredAt,
    metadata: redactMetadata(input.metadata),
  });
}

export function detectSecurityAnomalies(
  events: readonly SecurityAuditRecord[],
  options: { windowMs?: number; denialThreshold?: number; now?: number } = {}
): readonly SecurityAnomaly[] {
  const now = options.now ?? Date.now();
  const windowMs = options.windowMs ?? 15 * 60 * 1000;
  const denialThreshold = options.denialThreshold ?? 5;
  const recent = events.filter((event) => event.occurredAt <= now && now - event.occurredAt <= windowMs);
  const anomalies: SecurityAnomaly[] = [];
  const denied = recent.filter((event) => event.outcome !== "allowed");
  if (denied.length >= denialThreshold) anomalies.push({ code: "REPEATED_DENIALS", severity: "warning", eventKeys: denied.map((e) => e.eventKey) });
  for (const [kind, code] of [
    ["company-isolation", "CROSS_COMPANY_ATTEMPT"],
    ["privileged-operation", "PRIVILEGED_OPERATION_FAILURE"],
    ["session", "CREDENTIAL_OR_SESSION_ANOMALY"],
    ["protected-asset", "PROTECTED_ASSET_PROBING"],
  ] as const) {
    const matches = denied.filter((event) => event.kind === kind);
    if (matches.length) anomalies.push({ code, severity: kind === "session" || kind === "protected-asset" ? "warning" : "critical", eventKeys: matches.map((e) => e.eventKey) });
  }
  return Object.freeze(anomalies);
}
