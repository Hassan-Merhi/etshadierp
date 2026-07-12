/**
 * Structured logger for server-side use.
 *
 * Production emits one-line JSON. Development emits compact readable lines.
 * Context is sanitised before output and must never contain request/response bodies.
 */
const isDev = process.env.NODE_ENV !== "production";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  module?: string;
  action?: string;
  requestId?: string;
  userId?: number | string | null;
  companyId?: number | string | null;
  factoryCompanyId?: number | string | null;
  locationId?: number | string | null;
  voucherId?: number | string | null;
  accountId?: number | string | null;
  containerId?: number | string | null;
  orderId?: number | string | null;
  durationMs?: number;
  status?: number | string;
  error?: unknown;
  [key: string]: unknown;
}

const SENSITIVE_KEY_PATTERN = /(?:password|passwd|secret|token|authorization|cookie|session|csrf|api[-_]?key|private[-_]?key)/i;
const MAX_STRING_LENGTH = 2_000;
const MAX_DEPTH = 4;

function safeError(err: unknown): { message: string; stack?: string } | undefined {
  if (err === undefined || err === null) return undefined;
  if (err instanceof Error) {
    return isDev ? { message: err.message, stack: err.stack } : { message: err.message };
  }
  return { message: String(err).slice(0, MAX_STRING_LENGTH) };
}

function sanitiseValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  if (value instanceof Error) return safeError(value);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (depth >= MAX_DEPTH) return "[MaxDepth]";

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (Array.isArray(value)) {
      return value.slice(0, 50).map((entry) => sanitiseValue(entry, depth + 1, seen));
    }

    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitiseValue(entry, depth + 1, seen);
    }
    return output;
  }

  return String(value);
}

function sanitiseContext(ctx: LogContext): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (key === "error") continue;
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitiseValue(value);
  }
  return output;
}

function emit(level: LogLevel, message: string, ctx: LogContext = {}): void {
  if (level === "debug" && !isDev) return;

  const safeContext = sanitiseContext(ctx);
  const error = safeError(ctx.error);

  if (isDev) {
    const parts: string[] = [`[${level.toUpperCase()}]`, message];
    if (ctx.module) parts.push(`[${ctx.module}${ctx.action ? `:${ctx.action}` : ""}]`);
    if (ctx.requestId) parts.push(`request=${ctx.requestId}`);
    if (ctx.userId != null) parts.push(`user=${ctx.userId}`);
    if (ctx.companyId != null) parts.push(`co=${ctx.companyId}`);
    if (ctx.voucherId != null) parts.push(`voucher=${ctx.voucherId}`);
    if (ctx.containerId != null) parts.push(`container=${ctx.containerId}`);
    if (ctx.durationMs != null) parts.push(`(${ctx.durationMs}ms)`);
    if (error) parts.push(`— ${error.message}`);
    const line = parts.join(" ");
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    return;
  }

  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    message: message.slice(0, MAX_STRING_LENGTH),
    ...safeContext,
  };
  if (error !== undefined) entry.error = error;

  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch {
    line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "ERROR",
      message: "Logger serialization failed",
      module: "logger",
      action: "serialize",
    });
  }

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, ctx?: LogContext) => emit("debug", message, ctx),
  info: (message: string, ctx?: LogContext) => emit("info", message, ctx),
  warn: (message: string, ctx?: LogContext) => emit("warn", message, ctx),
  error: (message: string, ctx?: LogContext) => emit("error", message, ctx),
};
