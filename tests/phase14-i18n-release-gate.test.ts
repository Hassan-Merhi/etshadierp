import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Phase 14 trilingual release gate", () => {
  it("loads RTL hardening globally", () => {
    const app = fs.readFileSync("client/src/App.tsx", "utf8");
    const css = fs.readFileSync("client/src/styles/rtl-hardening.css", "utf8");
    expect(app).toContain('import "@/styles/rtl-hardening.css"');
    expect(css).toContain('html[dir="rtl"]');
    expect(css).toContain("unicode-bidi: isolate");
    expect(css).toContain("[data-business-value]");
    expect(css).toContain("[data-account-code]");
  });

  it("keeps an executable untranslated-text audit and ratchet baseline", () => {
    const audit = fs.readFileSync("scripts/audit-i18n-phase14.mjs", "utf8");
    const baseline = JSON.parse(fs.readFileSync("config/i18n-phase14-baseline.json", "utf8"));
    expect(audit).toContain("Untranslated-text candidates increased");
    expect(audit).toContain("process.exit(1)");
    expect(baseline.maxFindings).toBeGreaterThan(0);
  });

  it("preserves business identifiers while translating interface attributes", () => {
    const translator = fs.readFileSync("client/src/components/ApplicationInterfaceTranslator.tsx", "utf8");
    expect(translator).toContain('"aria-label"');
    expect(translator).toContain('"placeholder"');
    expect(translator).toContain('"title"');
    expect(translator).toContain('"[data-account-code]"');
    expect(translator).toContain('"[data-container-number]"');
    expect(translator).toContain('"[data-voucher-number]"');
  });

  it("supports all three languages and Arabic-only RTL", () => {
    const contract = fs.readFileSync("shared/applicationLanguageContract.ts", "utf8");
    expect(contract).toContain('"en"');
    expect(contract).toContain('"ar"');
    expect(contract).toContain('"fr"');
    expect(contract).toContain('language === "ar"');
  });
});
