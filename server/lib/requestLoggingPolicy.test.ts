import { describe, expect, it } from "vitest";
import {
  classifyRequestTiming,
  getSlowRequestThresholdConfig,
  getSlowRequestThresholdMs,
} from "./requestLoggingPolicy";

describe("request logging policy", () => {
  it("uses the agreed endpoint timing classes", () => {
    expect(classifyRequestTiming("/api/accounts/all")).toBe("default");
    expect(classifyRequestTiming("/api/invoices/42/pdf")).toBe("pdf");
    expect(classifyRequestTiming("/api/pos/send-invoice-pdf-backend")).toBe("whatsapp");
    expect(classifyRequestTiming("/api/reports/sales/export-xlsx")).toBe("report_export");
    expect(classifyRequestTiming("/api/admin/reconciliation/run")).toBe("background_job");
  });

  it("uses 1s, 3s, 5s and 10s production defaults", () => {
    const env = {};
    expect(getSlowRequestThresholdMs("/api/accounts/all", env)).toBe(1_000);
    expect(getSlowRequestThresholdMs("/api/invoices/42/pdf", env)).toBe(3_000);
    expect(getSlowRequestThresholdMs("/api/pos/send-invoice-pdf-backend", env)).toBe(5_000);
    expect(getSlowRequestThresholdMs("/api/reports/sales/export-xlsx", env)).toBe(5_000);
    expect(getSlowRequestThresholdMs("/api/admin/reconciliation/run", env)).toBe(10_000);
  });

  it("keeps the legacy SLOW_REQUEST_MS override for the default class", () => {
    expect(getSlowRequestThresholdConfig({ SLOW_REQUEST_MS: "2500" }).default).toBe(2_500);
    expect(
      getSlowRequestThresholdConfig({
        SLOW_REQUEST_MS: "2500",
        SLOW_REQUEST_WHATSAPP_MS: "7000",
      }).whatsapp,
    ).toBe(7_000);
  });
});
