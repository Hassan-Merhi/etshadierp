const MAX_RECENT_EVENTS = 50;

const counters = new Map();
const recentEvents = [];

function sanitizeDetail(detail) {
  if (detail == null) return undefined;
  const text = String(detail);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

export function recordSecurityEvent({ code, method, statusCode, detail }) {
  const safeCode = String(code || "SECURITY_EVENT");
  counters.set(safeCode, (counters.get(safeCode) || 0) + 1);

  const event = Object.freeze({
    timestamp: new Date().toISOString(),
    code: safeCode,
    method: String(method || "UNKNOWN").slice(0, 16),
    statusCode: Number(statusCode) || 0,
    detail: sanitizeDetail(detail),
  });

  recentEvents.push(event);
  if (recentEvents.length > MAX_RECENT_EVENTS) recentEvents.shift();

  console.warn(JSON.stringify({
    level: "WARN",
    module: "runtime-security",
    action: "request-rejected",
    ...event,
  }));
}

export function getSecurityEventSnapshot() {
  return Object.freeze({
    counters: Object.freeze(Object.fromEntries(counters.entries())),
    recentEvents: Object.freeze([...recentEvents]),
  });
}
