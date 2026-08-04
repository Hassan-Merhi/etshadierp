import { getLoggerConfiguration } from "./logger";

export type AlertSeverity = "warning" | "critical";

export interface LogAlertInput {
  severity: AlertSeverity;
  category: string;
  code: string;
  message: string;
  timestamp: string;
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  responseBytes?: number;
  budgetBytes?: number;
  companyId?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1_000;
const lastSentAt = new Map<string, number>();

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isEnabled(): boolean {
  return process.env.LOG_ALERTS_ENABLED === "true" && Boolean(process.env.LOG_ALERT_WEBHOOK_URL?.trim());
}

function shouldSend(input: LogAlertInput, now = Date.now()): boolean {
  if (!isEnabled()) return false;
  if (input.severity === "warning" && process.env.LOG_ALERT_MIN_SEVERITY === "critical") return false;
  const cooldownMs = positiveNumber(process.env.LOG_ALERT_COOLDOWN_MS, DEFAULT_COOLDOWN_MS);
  const key = `${input.severity}:${input.category}:${input.code}:${input.path || ""}`;
  const previous = lastSentAt.get(key) ?? 0;
  if (now - previous < cooldownMs) return false;
  lastSentAt.set(key, now);
  return true;
}

function safePayload(input: LogAlertInput) {
  const loggerConfig = getLoggerConfiguration();
  return {
    source: "etshadi-erp",
    environment: process.env.NODE_ENV || "development",
    service: process.env.RENDER_SERVICE_NAME || process.env.RENDER_SERVICE_ID || "erp",
    buildVersion: process.env.BUILD_VERSION || process.env.RENDER_GIT_COMMIT?.slice(0, 8) || "unknown",
    severity: input.severity,
    category: input.category,
    code: input.code,
    message: input.message.slice(0, 500),
    timestamp: input.timestamp,
    requestId: input.requestId,
    method: input.method,
    path: input.path,
    status: input.status,
    durationMs: input.durationMs,
    responseBytes: input.responseBytes,
    budgetBytes: input.budgetBytes,
    companyId: input.companyId,
    logger: {
      format: loggerConfig.format,
      minimumLevel: loggerConfig.minimumLevel,
      redactionEnabled: loggerConfig.redactionEnabled,
    },
  };
}

export async function dispatchOperationalAlert(input: LogAlertInput): Promise<boolean> {
  if (!shouldSend(input)) return false;
  const controller = new AbortController();
  const timeoutMs = positiveNumber(process.env.LOG_ALERT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(process.env.LOG_ALERT_WEBHOOK_URL!.trim(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.LOG_ALERT_WEBHOOK_BEARER_TOKEN
          ? { authorization: `Bearer ${process.env.LOG_ALERT_WEBHOOK_BEARER_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(safePayload(input)),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function getLogAlertConfiguration() {
  return {
    enabled: isEnabled(),
    minimumSeverity: process.env.LOG_ALERT_MIN_SEVERITY === "critical" ? "critical" : "warning",
    cooldownMs: positiveNumber(process.env.LOG_ALERT_COOLDOWN_MS, DEFAULT_COOLDOWN_MS),
    timeoutMs: positiveNumber(process.env.LOG_ALERT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    webhookConfigured: Boolean(process.env.LOG_ALERT_WEBHOOK_URL?.trim()),
  };
}

export function resetLogAlertCooldownsForTests(): void {
  lastSentAt.clear();
}

export const __logAlertTesting = { shouldSend, safePayload };
