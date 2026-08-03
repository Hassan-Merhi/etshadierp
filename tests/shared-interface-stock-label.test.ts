import { describe, expect, it } from "vitest";
import { translateSharedInterfaceText } from "../client/src/i18n/sharedInterfaceTranslations";

describe("shared Inventory and Stock labels", () => {
  it("keeps the Stock route named Stock in English", () => {
    expect(translateSharedInterfaceText("Stock", "en")).toBe("Stock");
  });

  it("keeps Inventory and Stock distinct across supported languages", () => {
    expect(translateSharedInterfaceText("Inventory", "ar")).toBe("الجرد");
    expect(translateSharedInterfaceText("Inventory", "fr")).toBe("Inventaire");

    expect(translateSharedInterfaceText("Stock", "ar")).toBe("المخزون");
    expect(translateSharedInterfaceText("Stock", "fr")).toBe("Stock");
  });

  it("can switch translated labels back to their canonical English labels", () => {
    expect(translateSharedInterfaceText("Inventaire", "en")).toBe("Inventory");
    expect(translateSharedInterfaceText("المخزون", "en")).toBe("Stock");
  });
});
