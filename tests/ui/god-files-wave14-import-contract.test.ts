import { describe, expect, it } from "vitest";

describe("god-files Wave 14 import compatibility", () => {
  it("preserves the original FactorySettings default export path", async () => {
    const module = await import("@/pages/factory/FactorySettings");
    expect(module.default).toBeTypeOf("function");
  });

  it("preserves the original DataToolsTab named export path", async () => {
    const module = await import("@/pages/settings/DataToolsTab");
    expect(module.DataToolsTab).toBeTypeOf("function");
  });
});
