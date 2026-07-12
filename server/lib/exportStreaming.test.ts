import { describe, expect, it, vi } from "vitest";
import {
  applyExportStreamingHeaders,
  createExportResponseHardeningMiddleware,
  isStreamedExportContentType,
  streamExcelWorkbook,
} from "./exportStreaming";

function makeResponse() {
  const headers = new Map<string, unknown>();
  return {
    headers,
    writableEnded: false,
    setHeader(name: string, value: unknown) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    end: vi.fn(function (this: any) {
      this.writableEnded = true;
    }),
  } as any;
}

describe("Phase 7D export streaming", () => {
  it("recognizes PDF and XLSX response types only", () => {
    expect(isStreamedExportContentType("application/pdf")).toBe(true);
    expect(isStreamedExportContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(true);
    expect(isStreamedExportContentType("application/json")).toBe(false);
  });

  it("adds no-store and proxy no-buffering headers", () => {
    const res = makeResponse();
    applyExportStreamingHeaders(res);
    expect(res.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(res.headers.get("pragma")).toBe("no-cache");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
  });

  it("hardens export responses when a route sets the content type", () => {
    const res = makeResponse();
    const next = vi.fn();
    createExportResponseHardeningMiddleware()({} as any, res, next);
    res.setHeader("Content-Type", "application/pdf");

    expect(next).toHaveBeenCalledOnce();
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("writes ExcelJS output directly to the response and ends once", async () => {
    const res = makeResponse();
    const write = vi.fn(async (target: unknown) => {
      expect(target).toBe(res);
    });
    const workbook = { xlsx: { write } } as any;

    await streamExcelWorkbook(workbook, res);

    expect(write).toHaveBeenCalledOnce();
    expect(res.end).toHaveBeenCalledOnce();
    expect(res.headers.get("content-type")).toContain("spreadsheetml.sheet");
  });
});
