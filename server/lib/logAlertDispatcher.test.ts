import { afterEach, describe, expect, it } from "vitest";
import { __logAlertTesting, resetLogAlertCooldownsForTests } from "./logAlertDispatcher";

const originalEnv = {
  enabled: process.env.LOG_ALERTS_ENABLED,
  url: process.env.LOG_ALERT_WEBHOOK_URL,
  minimum: process.env.LOG_ALERT_MIN_SEVERITY,
  cooldown: process.env.LOG_ALERT_COOLDOWN_MS,
};

afterEach(() => {
  resetLogAlertCooldownsForTests();
  for (const [key, value] of Object.entries(originalEnv)) {
    const envName = key === "enabled" ? "LOG_ALERTS_ENABLED" : key === "url" ? "LOG_ALERT_WEBHOOK_URL" : key === "minimum" ? "LOG_ALERT_MIN_SEVERITY" : "LOG_ALERT_COOLDOWN_MS";
    if (value === undefined) delete process.env[envName];
    else process.env[envName] = value;
  }
});

const event = {
  severity: "warning" as const,
  category: "bandwidth",
  code: "api_bandwidth_budget_exceeded",
  message: "Bandwidth exceeded its budget",
  timestamp: "2026-08-04T12:00:00.000Z",
  path: "/api/inventory",
};

describe("operational alert dispatcher", () => {
  it("does not send unless explicitly enabled with a webhook", () => {
    delete process.env.LOG_ALERTS_ENABLED;
    delete process.env.LOG_ALERT_WEBHOOK_URL;
    expect(__logAlertTesting.shouldSend(event, 1_000)).toBe(false);
  });

  it("respects minimum severity and cooldown", () => {
    process.env.LOG_ALERTS_ENABLED = "true";
    process.env.LOG_ALERT_WEBHOOK_URL = "https://example.invalid/alerts";
    process.env.LOG_ALERT_MIN_SEVERITY = "warning";
    process.env.LOG_ALERT_COOLDOWN_MS = "300000";

    expect(__logAlertTesting.shouldSend(event, 1_000_000)).toBe(true);
    expect(__logAlertTesting.shouldSend(event, 1_001_000)).toBe(false);
    expect(__logAlertTesting.shouldSend(event, 1_301_000)).toBe(true);

    resetLogAlertCooldownsForTests();
    process.env.LOG_ALERT_MIN_SEVERITY = "critical";
    expect(__logAlertTesting.shouldSend(event, 2_000_000)).toBe(false);
  });

  it("builds a bounded provider-neutral payload", () => {
    const payload = __logAlertTesting.safePayload({ ...event, message: "x".repeat(800) });
    expect(payload.source).toBe("etshadi-erp");
    expect(payload.message).toHaveLength(500);
    expect(payload.logger.redactionEnabled).toBe(true);
  });
});
