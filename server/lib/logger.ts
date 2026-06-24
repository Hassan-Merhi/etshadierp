/**
 * Structured logger for server-side use.
 *
 * In production (NODE_ENV=production): emits one-line JSON to stdout/stderr —
 * readable by Render's log aggregator and any structured-log tool.
 * In development: emits a compact human-readable line.
 *
 * Security rules baked in:
 *  - Never log passwords, tokens, cookies, or session secrets.
 *  - Stack traces are only included in development.
 *  - The `error` field is sanitised: only message (+ dev stack) is forwarded.
 *
 * Usage:
 *   import { logger } from "../lib/logger";
 *   const t = Date.now();
 *   logger.info("Voucher create started", { module: "vouchers", action: "create", userId, companyId });
 *   logger.info("Voucher create succeeded", { module: "vouchers", action: "create", voucherId, durationMs: Date.now() - t });
 *   logger.error("Voucher create failed",  { module: "vouchers", action: "create", durationMs: Date.now() - t, error });
 */

const isDev = process.env.NODE_ENV !== "production";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  module?: string;
  action?: string;
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

function safeError(err: unknown): { message: string; stack?: string } | undefined {
  if (err === undefined || err === null) return undefined;
  if (err instanceof Error) {
    return isDev ? { message: err.message, stack: err.stack } : { message: err.message };
  }
  return { message: String(err) };
}

function emit(level: LogLevel, message: string, ctx: LogContext = {}): void {
  if (level === "debug" && !isDev) return;

  const { error, ...rest } = ctx;

  if (isDev) {
    const parts: string[] = [`[${level.toUpperCase()}]`, message];
    if (ctx.module) parts.push(`[${ctx.module}${ctx.action ? `:${ctx.action}` : ""}]`);
    if (ctx.userId != null) parts.push(`user=${ctx.userId}`);
    if (ctx.companyId != null) parts.push(`co=${ctx.companyId}`);
    if (ctx.voucherId != null) parts.push(`voucher=${ctx.voucherId}`);
    if (ctx.containerId != null) parts.push(`container=${ctx.containerId}`);
    if (ctx.durationMs != null) parts.push(`(${ctx.durationMs}ms)`);
    if (error) {
      const e = safeError(error);
      if (e) parts.push(`— ${e.message}`);
    }
    const line = parts.join(" ");
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    return;
  }

  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    message,
    ...rest,
  };
  if (error !== undefined) {
    entry.error = safeError(error);
  }

  const line = JSON.stringify(entry);
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
