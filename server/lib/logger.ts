/**
 * Shared structured logger for server-side use.
 *
 * - Render defaults to concise readable lines because Render already prefixes
 *   every line with its own timestamp.
 * - Other production environments default to one-line JSON for log shipping.
 * - Set LOG_FORMAT=json or LOG_FORMAT=pretty to override the automatic choice.
 * - Set LOG_LEVEL=debug|info|warn|error to control verbosity.
 *
 * Context is sanitised before output and must never contain request/response
 * bodies, credentials, cookies or authorization headers.
 */
import { markRuntimeFailure } from "./runtimePerformance";
import { getTraceContext } from "./traceContext";

const isDev = process.env.NODE_ENV !== "production";
const isRender = process.env.RENDER === "true" || Boolean(process.env.RENDER_SERVICE_ID);

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "json" | "pretty";

export interface LogContext {
  event?: string;
  module?: string;
  action?: string;
  category?: string;
  code?: string;
  requestId?: string;
  routeTemplate?: string;
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

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = String(process.env.LOG_LEVEL || (isDev ? "debug" : "info")).toLowerCase();
const minimumLevel: LogLevel = configuredLevel in LEVEL_WEIGHT ? configuredLevel as LogLevel : "info";
const configuredFormat = String(process.env.LOG_FORMAT || "").toLowerCase();
const outputFormat: LogFormat = configuredFormat === "json" || configuredFormat === "pretty"
  ? configuredFormat
  : (isDev || isRender ? "pretty" : "json");

const SENSITIVE_KEY_PATTERN = /(?:password|passwd|secret|token|authorization|cookie|session|csrf|api[-_]?key|private[-_]?key)/i;
const MAX_STRING_LENGTH = 2_000;
const MAX_DEPTH = 4;

function safeError(
  err: unknown,
  depth = 0
): { message: string; stack?: string; code?: string; detail?: string; cause?: unknown } | undefined {
  if (err === undefined || err === null) return undefined;
  if (err instanceof Error) {
    const out: { message: string; stack?: string; code?: string; detail?: string; cause?: unknown } = {
      message: err.message.slice(0, MAX_STRING_LENGTH),
    };
    if (isDev) out.stack = err.stack;
    const e = err as unknown as Record<string, unknown>;
    if (typeof e["code"] === "string") out.code = e["code"];
    if (typeof e["detail"] === "string") out.detail = e["detail"].slice(0, MAX_STRING_LENGTH);
    if (depth < 3 && e["cause"] != null) {
      out.cause = safeError(e["cause"] as unknown, depth + 1);
    }
    return out;
  }
  return { message: String(err).slice(0, MAX_STRING_LENGTH) };
}

function sanitiseValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  if (value instanceof Error) return safeError(value);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (depth >= MAX_DEPTH) return "[MaxDepth]";
  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitiseValue(entry, depth + 1, seen));
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
    if (key === "error" || value === undefined) continue;
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitiseValue(value);
  }
  return output;
}

function formatBytes(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "an unknown amount of data";
  if (bytes < 1_024) return `${Math.round(bytes)} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(bytes >= 10_240 ? 0 : 1)} KB`;
  if (bytes < 1_024 * 1_024 * 1_024) return `${(bytes / (1_024 * 1_024)).toFixed(bytes >= 10 * 1_024 * 1_024 ? 1 : 2)} MB`;
  return `${(bytes / (1_024 * 1_024 * 1_024)).toFixed(2)} GB`;
}

function formatDuration(value: unknown): string {
  const durationMs = Number(value);
  if (!Number.isFinite(durationMs) || durationMs < 0) return "an unknown time";
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs >= 10_000 ? 1 : 2)} seconds`;
  return `${(durationMs / 60_000).toFixed(1)} minutes`;
}

function ensureSentence(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, " ");
  if (!trimmed) return "Application event recorded.";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

function resolveEvent(ctx: LogContext): string | undefined {
  const explicit = typeof ctx.event === "string" ? ctx.event.trim() : "";
  if (explicit) return explicit.toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").slice(0, 120);
  if (ctx.module === "operational_events" && typeof ctx.code === "string" && ctx.code.trim()) {
    return `operational.${ctx.code.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_")}`.slice(0, 120);
  }
  const moduleName = typeof ctx.module === "string" ? ctx.module.trim() : "";
  const actionName = typeof ctx.action === "string" ? ctx.action.trim() : "";
  if (!moduleName && !actionName) return undefined;
  return [moduleName, actionName]
    .filter(Boolean)
    .join(".")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .slice(0, 120);
}

function formatRankedEndpoints(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const summaries = value
    .slice(0, 3)
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const row = entry as Record<string, unknown>;
      const method = typeof row.method === "string" ? row.method.toUpperCase() : "HTTP";
      const path = typeof row.path === "string" ? row.path : "unknown endpoint";
      const bytes = row.totalResponseBytes;
      return `${method} ${path} ${formatBytes(bytes)}`;
    })
    .filter(Boolean);
  return summaries.join("; ");
}

function parseAccessDeniedMessage(text: string): Record<string, unknown> | undefined {
  if (!text.startsWith("{") || !text.endsWith("}")) return undefined;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return parsed.event === "access_denied" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function resolveEffectiveLevel(level: LogLevel, message: string, ctx: LogContext): LogLevel {
  if (level !== "info") return level;

  const text = message.trim();
  const moduleName = String(ctx.module || "").toLowerCase();
  const actionName = String(ctx.action || "").toLowerCase();
  const isStartupModule = /(?:startup|server|scheduler|migration|bootstrap)/.test(moduleName);

  if (
    !isStartupModule &&
    (/(?:^|\s)(?:started|starting|beginning)$/.test(text.toLowerCase()) ||
      /(?:^|[_.-])(?:start|started|begin|beginning)$/.test(actionName))
  ) {
    return "debug";
  }

  if (/^\[getLocationInventory\]/i.test(text)) return "debug";
  if (/\[express\]\s*\[SLOW API\]/i.test(text)) return "debug";
  if (/^\[(?:POS Sale|Stock Transfer|Inventory|Cache|Query|Auth|Session)\]/i.test(text)) return "debug";
  if (/\b(?:polling?|heartbeat|keepalive|cache hit|cache miss|query started|query completed|auth check|session check|reference data loaded)\b/i.test(text)) {
    return "debug";
  }
  if (/(?:poll|heartbeat|keepalive|cache_hit|cache_miss|auth_check|session_check|reference_data)/.test(actionName)) {
    return "debug";
  }

  const accessDenied = parseAccessDeniedMessage(text);
  if (
    accessDenied?.reason === "SESSION_REQUIRED" &&
    accessDenied.path === "/api/auth/me"
  ) {
    return "debug";
  }

  return level;
}

function humanizeLegacyMessage(message: string, ctx: LogContext): string {
  const text = message.trim();
  let match: RegExpMatchArray | null;

  match = text.match(/^\[getLocationInventory\] companyId=(\d+) locationId=(\d+) includeZero=(true|false) → (\d+) rows$/i);
  if (match) {
    const itemCount = Number(match[4]);
    return `Inventory loaded for location ${match[2]} with ${plural(itemCount, "item")}`;
  }

  match = text.match(/^\[WA invoice backend\] voucherId=(\d+) locationId=(\d+) itemCount=(\d+) pageCount=(\d+) pdfSize=(\d+) compactMode=(true|false) dryRun=(true|false)$/i);
  if (match) {
    const itemCount = Number(match[3]);
    const pageCount = Number(match[4]);
    const dryRun = match[7] === "true";
    return `${dryRun ? "Invoice preview" : "Invoice"} ${match[1]} was generated for location ${match[2]} with ${plural(itemCount, "item")} across ${plural(pageCount, "page")}`;
  }

  match = text.match(/^\[WA stock backend\].*?file=(.+?\.pdf)\s+size=(\d+)\s+pageCount=(\d+)\s+rowCount=(\d+)$/i);
  if (match) {
    const pageCount = Number(match[3]);
    const rowCount = Number(match[4]);
    return `Stock report ${match[1]} was generated with ${plural(rowCount, "item")} across ${plural(pageCount, "page")}`;
  }

  if (text === "[WA upload] Green API response") {
    const fileName = typeof ctx.fileName === "string" ? ctx.fileName : "the file";
    const size = ctx.size == null ? "" : ` (${formatBytes(ctx.size)})`;
    return `WhatsApp uploaded ${fileName} successfully${size}`;
  }

  if (text === "[WA upload] Green API error") {
    const fileName = typeof ctx.fileName === "string" ? ctx.fileName : "the file";
    return `WhatsApp could not upload ${fileName}`;
  }

  if (text === "POS sale update started") {
    return ctx.voucherId != null ? `Updating POS sale ${ctx.voucherId}` : "Updating a POS sale";
  }
  if (text === "POS sale update succeeded") {
    return ctx.voucherId != null ? `POS sale ${ctx.voucherId} was updated successfully` : "The POS sale was updated successfully";
  }
  if (text === "POS sale update failed") {
    return ctx.voucherId != null ? `POS sale ${ctx.voucherId} could not be updated` : "The POS sale could not be updated";
  }

  if (text === "container tracking update started") {
    return ctx.containerId != null ? `Updating tracking for container ${ctx.containerId}` : "Updating container tracking";
  }
  if (text === "container tracking update succeeded") {
    return ctx.containerId != null ? `Tracking for container ${ctx.containerId} was updated successfully` : "Container tracking was updated successfully";
  }
  if (text === "container tracking update failed") {
    return ctx.containerId != null ? `Tracking for container ${ctx.containerId} could not be updated` : "Container tracking could not be updated";
  }

  if (text === "Ranked endpoint performance and bandwidth snapshot") {
    const windowMs = Number(ctx.windowMs);
    const windowText = Number.isFinite(windowMs) ? ` during the last ${formatDuration(windowMs)}` : " in the current reporting window";
    const endpointCount = Number(ctx.apiEndpointCount ?? ctx.endpointCount ?? 0);
    const topEndpoints = formatRankedEndpoints(ctx.ranked);
    const topText = topEndpoints ? `. Top endpoints: ${topEndpoints}` : "";
    return `API responses transferred ${formatBytes(ctx.totalApiResponseBytes)} across ${plural(endpointCount, "endpoint")}${windowText}${topText}`;
  }

  if (text === "Large HTTP response detected") {
    const method = typeof ctx.method === "string" ? ctx.method : "HTTP";
    const path = typeof ctx.path === "string" ? ctx.path : "request";
    const threshold = ctx.budgetBytes == null ? "" : `, exceeding the ${formatBytes(ctx.budgetBytes)} warning threshold`;
    return `${method} ${path} returned a large ${formatBytes(ctx.responseBytes)} response${threshold}`;
  }

  match = text.match(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+)\s+(\d{3})$/i);
  if (match) {
    const status = Number(match[3]);
    const outcome = status >= 500 ? "failed" : status >= 400 ? "was rejected" : "completed";
    const duration = ctx.durationMs == null ? "" : ` in ${formatDuration(ctx.durationMs)}`;
    const threshold = ctx.slow === true && ctx.thresholdMs != null
      ? `; warning threshold ${formatDuration(ctx.thresholdMs)}`
      : "";
    return `${match[1].toUpperCase()} ${match[2]} ${outcome} with status ${status}${duration}${threshold}`;
  }

  const parsedAccessDenied = parseAccessDeniedMessage(text);
  if (parsedAccessDenied) {
    const path = typeof parsedAccessDenied.path === "string" ? parsedAccessDenied.path : "the requested page";
    const reason = parsedAccessDenied.reason === "SESSION_REQUIRED" ? "an active session was required" : "access was not permitted";
    return `Access to ${path} was denied because ${reason}`;
  }

  match = text.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (match) {
    const prefix = match[1].replace(/^\//, "").replace(/[-_/]+/g, " ").trim();
    const rest = match[2].trim();
    return rest ? `${prefix}: ${rest}` : `${prefix} event recorded`;
  }

  return text;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[minimumLevel];
}

function formatPrettyContext(ctx: Record<string, unknown>): string[] {
  const keys = [
    "event",
    "requestId",
    "routeTemplate",
    "userId",
    "companyId",
    "factoryCompanyId",
    "locationId",
    "voucherId",
    "containerId",
    "orderId",
    "status",
    "durationMs",
    "thresholdMs",
    "thresholdClass",
    "responseBytes",
    "budgetBytes",
    "dbQueryCount",
    "dbDurationMs",
    "buildVersion",
  ];
  const parts: string[] = [];
  for (const key of keys) {
    const value = ctx[key];
    if (value === undefined || value === null || value === "") continue;
    if (key === "durationMs" || key === "dbDurationMs" || key === "thresholdMs") parts.push(`${key}=${formatDuration(value)}`);
    else if (key === "responseBytes" || key === "budgetBytes") parts.push(`${key}=${formatBytes(value)}`);
    else parts.push(`${key}=${String(value)}`);
  }
  return parts;
}

function emit(level: LogLevel, message: string, ctx: LogContext = {}): void {
  const effectiveLevel = resolveEffectiveLevel(level, message, ctx);
  if (!shouldLog(effectiveLevel)) return;
  if (effectiveLevel === "error") markRuntimeFailure();

  const trace = getTraceContext();
  const mergedContext: LogContext = { ...(trace || {}), ...ctx };
  const event = resolveEvent(mergedContext);
  if (event) mergedContext.event = event;
  const readableMessage = ensureSentence(humanizeLegacyMessage(message, mergedContext));
  const safeContext = sanitiseContext(mergedContext);
  const error = safeError(mergedContext.error);

  if (outputFormat === "pretty") {
    const parts: string[] = [`[${effectiveLevel.toUpperCase()}]`, readableMessage, ...formatPrettyContext(safeContext)];
    if (error) parts.push(`error=${error.message}`);
    const line = parts.join(" ");
    if (effectiveLevel === "error") console.error(line);
    else if (effectiveLevel === "warn") console.warn(line);
    else console.log(line);
    return;
  }

  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level: effectiveLevel.toUpperCase(),
    message: readableMessage.slice(0, MAX_STRING_LENGTH),
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
      message: "Logger serialization failed.",
      module: "logger",
      action: "serialize",
      event: "logger.serialize",
    });
  }
  if (effectiveLevel === "error") console.error(line);
  else if (effectiveLevel === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, ctx?: LogContext) => emit("debug", message, ctx),
  info: (message: string, ctx?: LogContext) => emit("info", message, ctx),
  warn: (message: string, ctx?: LogContext) => emit("warn", message, ctx),
  error: (message: string, ctx?: LogContext) => emit("error", message, ctx),
};

export function createScopedLogger(module: string, defaults: LogContext = {}) {
  const contextFor = (action: string, ctx?: LogContext): LogContext => ({
    ...defaults,
    ...ctx,
    module,
    action,
    event: ctx?.event || `${module}.${action}`,
  });
  return {
    debug: (action: string, message: string, ctx?: LogContext) => logger.debug(message, contextFor(action, ctx)),
    info: (action: string, message: string, ctx?: LogContext) => logger.info(message, contextFor(action, ctx)),
    warn: (action: string, message: string, ctx?: LogContext) => logger.warn(message, contextFor(action, ctx)),
    error: (action: string, message: string, ctx?: LogContext) => logger.error(message, contextFor(action, ctx)),
  };
}

(globalThis as unknown as { __erpLogger?: typeof logger }).__erpLogger = logger;

export const __loggerTesting = {
  formatBytes,
  formatDuration,
  formatRankedEndpoints,
  humanizeLegacyMessage,
  resolveEffectiveLevel,
  resolveEvent,
  outputFormat,
  minimumLevel,
};
