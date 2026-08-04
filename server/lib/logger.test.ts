import { describe, expect, it } from "vitest";
import { __loggerTesting } from "./logger";

describe("shared logger readability", () => {
  it("converts inventory row logs into a sentence", () => {
    expect(
      __loggerTesting.humanizeLegacyMessage(
        "[getLocationInventory] companyId=1 locationId=135 includeZero=false → 820 rows",
        {},
      ),
    ).toBe("Inventory loaded for location 135 with 820 items");
  });

  it("converts WhatsApp upload success into a sentence", () => {
    expect(
      __loggerTesting.humanizeLegacyMessage("[WA upload] Green API response", {
        fileName: "Hadi 2 Invoice 2026-08-04.pdf",
        size: 6779,
      }),
    ).toBe("WhatsApp uploaded Hadi 2 Invoice 2026-08-04.pdf successfully (6.6 KB)");
  });

  it("converts HTTP request lines into readable outcomes", () => {
    expect(
      __loggerTesting.humanizeLegacyMessage("POST /api/pos/send-invoice-pdf-backend 200", {
        durationMs: 1121,
      }),
    ).toBe("POST /api/pos/send-invoice-pdf-backend completed with status 200 in 1.12 seconds");
  });

  it("summarises bandwidth reporting windows", () => {
    expect(
      __loggerTesting.humanizeLegacyMessage("Ranked endpoint performance and bandwidth snapshot", {
        windowMs: 300000,
        totalApiResponseBytes: 24196990,
        apiEndpointCount: 42,
      }),
    ).toBe("API responses transferred 23.08 MB across 42 endpoints during the last 5.0 minutes");
  });

  it("derives stable event names from operational event codes", () => {
    expect(
      __loggerTesting.resolveEvent({
        module: "operational_events",
        action: "event_detected",
        code: "large_http_response",
      }),
    ).toBe("operational.large_http_response");
  });

  it("explains embedded access-denied JSON", () => {
    expect(
      __loggerTesting.humanizeLegacyMessage(
        '{"event":"access_denied","path":"/api/auth/me","reason":"SESSION_REQUIRED"}',
        {},
      ),
    ).toBe("Access to /api/auth/me was denied because an active session was required");
  });
});
