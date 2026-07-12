import { auditLog } from "@shared/schema";
import { db } from "../../db";
import { logger } from "../../lib/logger";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "reverse"
  | "login"
  | "logout"
  | "import"
  | "migrate";

export type AuditChange = { old?: unknown; new?: unknown };
export type AuditChanges = Record<string, AuditChange>;

export interface AuditActor {
  userId: string;
  username: string;
  companyId?: number | null;
}

export interface AuditEvent extends AuditActor {
  action: AuditAction;
  tableName: string;
  recordId?: number | null;
  recordIdentifier?: string | null;
  changes?: AuditChanges | null;
}

export interface AuditExecutor {
  insert: typeof db.insert;
}

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;
const MAX_STRING_LENGTH = 2_000;
const MAX_ARRAY_LENGTH = 100;
const MAX_OBJECT_KEYS = 100;
const SENSITIVE_KEY_PATTERN =
  /(^|_)(password|passcode|pin|secret|token|cookie|authorization|api[_-]?key|session|csrf|private[_-]?key|connection[_-]?string)($|_)/i;

function sanitizeString(value: string): string {
  return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
}

export function sanitizeAuditValue(value: unknown, key?: string, depth = 0): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) return REDACTED;
  if (depth > MAX_DEPTH) return "[MAX_DEPTH]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: sanitizeString(value.name),
      message: sanitizeString(value.message),
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeAuditValue(item, undefined, depth + 1));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS);
    return Object.fromEntries(entries.map(([entryKey, entryValue]) => [entryKey, sanitizeAuditValue(entryValue, entryKey, depth + 1)]));
  }
  return sanitizeString(String(value));
}

export function sanitizeAuditChanges(changes?: AuditChanges | null): AuditChanges | null {
  if (!changes) return null;
  return Object.fromEntries(
    Object.entries(changes).map(([field, change]) => [
      field,
      {
        ...(Object.prototype.hasOwnProperty.call(change, "old")
          ? { old: sanitizeAuditValue(change.old, field) }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(change, "new")
          ? { new: sanitizeAuditValue(change.new, field) }
          : {}),
      },
    ])
  );
}

export function buildAuditChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  fields?: string[]
): AuditChanges {
  const keys = fields ?? Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  const changes: AuditChanges = {};

  for (const key of keys) {
    const oldValue = before?.[key];
    const newValue = after?.[key];
    if (JSON.stringify(sanitizeAuditValue(oldValue, key)) === JSON.stringify(sanitizeAuditValue(newValue, key))) continue;
    changes[key] = {
      ...(before && Object.prototype.hasOwnProperty.call(before, key) ? { old: oldValue } : {}),
      ...(after && Object.prototype.hasOwnProperty.call(after, key) ? { new: newValue } : {}),
    };
  }

  return sanitizeAuditChanges(changes) ?? {};
}

export async function writeAuditEvent(event: AuditEvent, executor: AuditExecutor = db): Promise<void> {
  const tableName = event.tableName.trim();
  const userId = event.userId.trim();
  const username = event.username.trim();

  if (!tableName) throw new Error("Audit tableName is required");
  if (!userId) throw new Error("Audit userId is required");
  if (!username) throw new Error("Audit username is required");

  const values = {
    userId,
    username,
    companyId: event.companyId ?? null,
    action: event.action,
    tableName,
    recordId: event.recordId ?? null,
    recordIdentifier: event.recordIdentifier?.trim() || null,
    changes: sanitizeAuditChanges(event.changes),
  };

  try {
    await executor.insert(auditLog).values(values);
  } catch (error) {
    logger.error("Audit write failed", {
      module: "audit",
      action: "write_failed",
      auditAction: event.action,
      tableName,
      recordId: event.recordId ?? null,
      companyId: event.companyId ?? null,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
