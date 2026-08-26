import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Keep this regression behavior-based: validate the HTTP contract, not source text.
vi.mock("../server/auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../server/routes/factory/shipping-containers/_helpers", () => ({
  getCompanyId: () => 1,
  fetchInternalBuffer: vi.fn(),
}));

describe("shipping container ZIP package regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a ZIP request with no selected files before touching storage", async () => {
    const { registerShippingZipPackageRoutes } =
      await import("../server/routes/factory/shipping-containers/zip-package");
    const app = express();
    registerShippingZipPackageRoutes(app);

    const response = await request(app).get("/api/factory/shipping-container-rows/1/zip-package");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "No files selected" });
  });

  it("rejects a non-numeric shipping-row id", async () => {
    const { registerShippingZipPackageRoutes } =
      await import("../server/routes/factory/shipping-containers/zip-package");
    const app = express();
    registerShippingZipPackageRoutes(app);

    const response = await request(app).get(
      "/api/factory/shipping-container-rows/not-a-number/zip-package?fileIds=invoice_excel"
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "Invalid id" });
  });

  it("rejects ZIP builds with no entries", async () => {
    const { buildShippingZipBuffer } = await import("../server/routes/factory/shipping-containers/zip-package");

    await expect(buildShippingZipBuffer([])).rejects.toThrow("Download failed");
  });

  it("builds a non-empty ZIP from in-memory files", async () => {
    const { buildShippingZipBuffer } = await import("../server/routes/factory/shipping-containers/zip-package");

    const zip = await buildShippingZipBuffer([
      { name: "Commercial_Invoice.xlsx", data: Buffer.from("invoice-data") },
      { name: "Customer_Statement.pdf", data: Buffer.from("statement-data") },
    ]);

    expect(zip.length).toBeGreaterThan(30);
    expect(zip.subarray(0, 2).toString("ascii")).toBe("PK");
    expect(zip.includes(Buffer.from("Commercial_Invoice.xlsx"))).toBe(true);
    expect(zip.includes(Buffer.from("Customer_Statement.pdf"))).toBe(true);
  });
});
