import { logger } from "./logger";

export type OperationalEventCategory = "error" | "bandwidth" | "integrity";
export type OperationalEventSeverity = "warning" | "critical";

export interface OperationalEventInput {
  category: OperationalEventCategory;
  code: string;
  severity: OperationalEventSeverity;
  message: string;
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  responseBytes?: number;
  companyId?: number;
  userId?: number;
}

interface OperationalEventRecord extends OperationalEventInput {
  timestamp: string;
}

const MAX_RECENT_EVENTS = 50;
const counts: Record<OperationalEventCategory, number> = {
  error: 0,
  bandwidth: 0,
  integrity: 0,
};
const recentEvents: OperationalEventRecord[] = [];

function normalizeCode(code: string): string {
  const normalized = code.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_");
  return normalized.slice(0, 80) || "unknown_event";
}

function normalizeMessage(message: string): string {
  return message.trim().slice(0, 200) || "Operational event detected";
}

export function recordOperationalEvent(input: OperationalEventInput): void {
  const event: OperationalEventRecord = {
    ...input,
    code: normalizeCode(input.code),
    message: normalizeMessage(input.message),
    timestamp: new Date().toISOString(),
  };

  counts[event.category] += 1;
  recentEvents.unshift(event);
  if (recentEvents.length > MAX_RECENT_EVENTS) recentEvents.length = MAX_RECENT_EVENTS;

  const context = {
    module: "operational_events",
    action: "event_detected",
    category: event.category,
    code: event.code,
    severity: event.severity,
    requestId: event.requestId,
    method: event.method,
    path: event.path,
    status: event.status,
    durationMs: event.durationMs,
    responseBytes: event.responseBytes,
    companyId: event.companyId,
    userId: event.userId,
  };

  if (event.severity === "critical") logger.error(event.message, context);
  else logger.warn(event.message, context);
}

export function recordIntegrityEvent(
  code: string,
  message: string,
  context: Omit<OperationalEventInput, "category" | "code" | "message"> = {
    severity: "warning",
  },
): void {
  recordOperationalEvent({
    category: "integrity",
    code,
    message,
    ...context,
  });
}

export function getOperationalEventSnapshot() {
  return {
    counts: { ...counts },
    recent: recentEvents.map((event) => ({ ...event })),
  };
}

export function resetOperationalEventsForTests(): void {
  counts.error = 0;
  counts.bandwidth = 0;
  counts.integrity = 0;
  recentEvents.length = 0;
}
