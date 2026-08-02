import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { countMissingTranslations, resolveModuleText } from "../client/src/i18n/moduleCatalog";
import type { ModuleCatalog } from "../client/src/i18n/moduleCatalog";

const MODULE_DIR = "client/src/i18n/modules";

describe("module translation conversion", () => {
  it("falls back to English until a translation is reviewed", () => {
    const catalog: ModuleCatalog = {
      done: { en: "Cancel", fr: "Annuler", ar: "إلغاء" },
      pending: { en: "Checkout" },
    };
    expect(resolveModuleText(catalog, "done", "fr")).toBe("Annuler");
    expect(resolveModuleText(catalog, "done", "ar")).toBe("إلغاء");
    expect(resolveModuleText(catalog, "pending", "fr")).toBe("Checkout");
    expect(resolveModuleText(catalog, "pending", "ar")).toBe("Checkout");
    expect(resolveModuleText(catalog, "pending", "en")).toBe("Checkout");
  });

  it("returns the key rather than an empty string for an unknown lookup", () => {
    expect(resolveModuleText({}, "missing.key", "fr")).toBe("missing.key");
  });

  it("counts both languages as outstanding for an untranslated entry", () => {
    expect(countMissingTranslations({ a: { en: "A" } })).toBe(2);
    expect(countMissingTranslations({ a: { en: "A", fr: "A" } })).toBe(1);
    expect(countMissingTranslations({ a: { en: "A", fr: "A", ar: "أ" } })).toBe(0);
  });

  it("keeps both audit gates wired so a conversion cannot look finished", () => {
    const workflow = fs.readFileSync(".github/workflows/i18n-audit.yml", "utf8");
    expect(workflow).toContain("scripts/audit-i18n-phase14.mjs");
    expect(workflow).toContain("scripts/audit-i18n-missing-translations.mjs");
    expect(fs.existsSync("config/i18n-missing-translations-baseline.json")).toBe(true);
  });

  it("gives every catalog entry English source text", () => {
    for (const file of fs.readdirSync(MODULE_DIR).filter((f) => f.endsWith(".ts"))) {
      const source = fs.readFileSync(path.join(MODULE_DIR, file), "utf8");
      const entries = source.match(/\{\s*en:\s*"(?:[^"\\]|\\.)*"[^}]*\}/g) ?? [];
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry).toMatch(/en:\s*"(?:[^"\\]|\\.)+"/);
      }
    }
  });
});
