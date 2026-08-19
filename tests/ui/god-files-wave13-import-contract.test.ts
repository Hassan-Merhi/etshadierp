import { describe, expect, it } from "vitest";

describe("god-files Wave 13 import compatibility", () => {
  it("preserves the original BarcodeLookup default export path", async () => {
    const module = await import("@/pages/BarcodeLookup");
    expect(module.default).toBeTypeOf("function");
  });

  it("preserves the original FactorySuppliers default export path", async () => {
    const module = await import("@/pages/factory/FactorySuppliers");
    expect(module.default).toBeTypeOf("function");
  });

  it("preserves the original SupplierProfitCheck default export path", async () => {
    const module = await import("@/pages/SupplierProfitCheck");
    expect(module.default).toBeTypeOf("function");
  });

  it("preserves the original GcLshiMigration default export path", async () => {
    const module = await import("@/pages/sp/GcLshiMigration");
    expect(module.default).toBeTypeOf("function");
  });
});
