import { logger, type LogLevel } from "./logger";

/**
 * Backward-compatible server logger facade.
 *
 * Existing callers keep the `serverLog.<level>(source, ...parts)` API, while
 * output is routed through the structured logger used elsewhere in the server.
 * This keeps log levels, production JSON formatting, and error sanitisation
 * consistent without changing business logic at call sites.
 */

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function emit(level: LogLevel, source: string, parts: unknown[]): void {
  const error = parts.find((part) => part instanceof Error);
  const message = parts
    .filter((part) => part !== error)
    .map(safeStringify)
    .join(" ") || source;

  logger[level](message, {
    module: source,
    ...(error ? { error } : {}),
  });
}

export const serverLog = {
  debug: (source: string, ...parts: unknown[]) => emit("debug", source, parts),
  info: (source: string, ...parts: unknown[]) => emit("info", source, parts),
  warn: (source: string, ...parts: unknown[]) => emit("warn", source, parts),
  error: (source: string, ...parts: unknown[]) => emit("error", source, parts),
};
