import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("translation phases 12, 9 and 11", () => {
  const dictionary = read("client/src/i18n/sharedInterfaceTranslations.ts");
  const bridge = read("client/src/components/ApplicationInterfaceTranslator.tsx");

  it("covers POS, properties, supplier partner and settings surfaces", () => {
    for (const label of [
      "Point of Sale",
      "Checkout",
      "Properties",
      "Rent Payments",
      "Supplier Partner",
      "User Management",
      "Permissions",
      "POS Settings",
    ]) {
      expect(dictionary).toContain(`en: \"${label}\"`);
    }
  });

  it("covers ERP inventory, tracking, containers and sales surfaces", () => {
    for (const label of [
      "Location Inventory",
      "Stock Movements",
      "Transfer Orders",
      "Container Tracking",
      "Containers on the Way",
      "Sales Orders",
      "Purchase Orders",
      "Customers",
      "Suppliers",
    ]) {
      expect(dictionary).toContain(`en: \"${label}\"`);
    }
  });

  it("covers remaining Factory surface vocabulary", () => {
    for (const label of [
      "Raw Stock",
      "Mix Batches",
      "Bale Products",
      "Offloading",
      "Customer Proformas",
      "Sheets & Sacks",
      "Workers",
      "Recalculate",
    ]) {
      expect(dictionary).toContain(`en: \"${label}\"`);
    }
  });

  it("translates interface attributes but protects stored business values", () => {
    expect(bridge).toContain('"aria-label", "title", "placeholder"');
    expect(bridge).toContain('"[data-business-value]"');
    expect(bridge).toContain('"[data-stock-name]"');
    expect(bridge).toContain('"[data-stock-group]"');
    expect(bridge).toContain('"[data-article-code]"');
    expect(bridge).toContain('"[data-account-code]"');
    expect(bridge).toContain('"[data-container-number]"');
    expect(bridge).toContain('"[data-voucher-number]"');
  });

  it("contains Arabic and French translations for every reviewed entry", () => {
    const entries = dictionary.match(/\{ en: .*? ar: .*? fr: .*? \}/g) ?? [];
    expect(entries.length).toBeGreaterThan(140);
    for (const entry of entries) {
      expect(entry).toMatch(/ar: \".+\"/);
      expect(entry).toMatch(/fr: \".+\"/);
    }
  });
});
