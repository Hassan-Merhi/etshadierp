import { afterEach, describe, expect, it } from "vitest";
import { __bandwidthDebugTesting } from "./bandwidthDebug";

const originalEnv = {
  defaultThreshold: process.env.BANDWIDTH_DEBUG_THRESHOLD_KB,
  staticThreshold: process.env.BANDWIDTH_DEBUG_STATIC_THRESHOLD_KB,
  documentThreshold: process.env.BANDWIDTH_DEBUG_DOCUMENT_THRESHOLD_KB,
};

afterEach(() => {
  if (originalEnv.defaultThreshold === undefined) delete process.env.BANDWIDTH_DEBUG_THRESHOLD_KB;
  else process.env.BANDWIDTH_DEBUG_THRESHOLD_KB = originalEnv.defaultThreshold;
  if (originalEnv.staticThreshold === undefined) delete process.env.BANDWIDTH_DEBUG_STATIC_THRESHOLD_KB;
  else process.env.BANDWIDTH_DEBUG_STATIC_THRESHOLD_KB = originalEnv.staticThreshold;
  if (originalEnv.documentThreshold === undefined) delete process.env.BANDWIDTH_DEBUG_DOCUMENT_THRESHOLD_KB;
  else process.env.BANDWIDTH_DEBUG_DOCUMENT_THRESHOLD_KB = originalEnv.documentThreshold;
});

describe("bandwidth logging policy", () => {
  it("does not warn for normal PDF, WhatsApp or export payload sizes", () => {
    delete process.env.BANDWIDTH_DEBUG_THRESHOLD_KB;
    delete process.env.BANDWIDTH_DEBUG_STATIC_THRESHOLD_KB;
    delete process.env.BANDWIDTH_DEBUG_DOCUMENT_THRESHOLD_KB;

    expect(__bandwidthDebugTesting.getLargeResponseThresholdBytes("/api/pos/send-invoice-pdf-backend")).toBe(
      10 * 1024 * 1024
    );
    expect(__bandwidthDebugTesting.getLargeResponseThresholdBytes("/api/reports/sales/export-xlsx")).toBe(
      10 * 1024 * 1024
    );
  });

  it("uses a higher threshold for static bundles than normal API responses", () => {
    delete process.env.BANDWIDTH_DEBUG_THRESHOLD_KB;
    delete process.env.BANDWIDTH_DEBUG_STATIC_THRESHOLD_KB;

    expect(__bandwidthDebugTesting.getLargeResponseThresholdBytes("/assets/index-D63eTXMH.js")).toBe(2 * 1024 * 1024);
    expect(__bandwidthDebugTesting.getLargeResponseThresholdBytes("/api/factory/bales/stock-entry-history")).toBe(
      500 * 1024
    );
  });

  it("recognises document and export endpoints", () => {
    expect(__bandwidthDebugTesting.isDocumentOrExportPath("/api/factory/customer-statement/download-pdf")).toBe(true);
    expect(__bandwidthDebugTesting.isDocumentOrExportPath("/api/locations/135/inventory")).toBe(false);
  });
});
