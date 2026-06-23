import { log as expressLog } from "../vite";

/**
 * Structured server logger with levels. Wraps the existing express timestamp
 * formatter from server/vite.ts and adds level prefixes. Use this in place of
 * raw `console.log` / `console.warn` / `console.error` going forward so that
 * (a) log level is explicit, (b) production logs can be filtered/redacted in
 * one place, and (c) all timestamps share a single format.
 *
 * Existing console.* call sites (~170 across the server) are not auto-migrated
 * — they continue to work as plain stdout/stderr writes. Migrate opportun-
 * istically when touching nearby code.
 *
 * In production (NODE_ENV === "production") debug-level messages are silently
 * dropped to keep the deploy log clean.
 */

const isProd = process.env.NODE_ENV === "production";

function emit(level: "DEBUG" | "INFO" | "WARN" | "ERROR", source: string, parts: unknown[]) {
  if (level === "DEBUG" && isProd) return;
  const message = parts.map((p) => (typeof p === "string" ? p : safeStringify(p))).join(" ");
  expressLog(`[${level}] ${message}`, source);
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const serverLog = {
  debug: (source: string, ...parts: unknown[]) => emit("DEBUG", source, parts),
  info: (source: string, ...parts: unknown[]) => emit("INFO", source, parts),
  warn: (source: string, ...parts: unknown[]) => emit("WARN", source, parts),
  error: (source: string, ...parts: unknown[]) => emit("ERROR", source, parts),
};
