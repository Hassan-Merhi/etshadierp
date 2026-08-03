import fs from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return fs.readFileSync(path, "utf8");
}

describe("Phase 9 final verification and release contract", () => {
  it("locks the approved untranslated-text baseline exactly", () => {
    const approved = JSON.parse(read("config/i18n-phase9-final-release.json"));
    const verifier = read("scripts/verify-phase9-final-i18n-baseline.mjs");

    expect(approved.detectorVersion).toBe(9);
    expect(approved.totals.actionable).toBe(12545);
    expect(approved.totals.unclassified).toBe(0);
    expect(approved.modules["backend-messages"]).toBe(0);
    expect(approved.modules["shared-ui"]).toBe(0);
    expect(verifier).toContain("report.totals[key] !== approved.totals[key]");
    expect(verifier).toContain("report.modules[module]?.actionable");
    expect(verifier).toContain("Unclassified findings must remain zero");
  });

  it("tests English Arabic and French browser direction across responsive viewports", () => {
    const smoke = read("scripts/run-phase9-language-browser-smoke.mjs");

    expect(smoke).toContain('{ code: "en", direction: "ltr"');
    expect(smoke).toContain('{ code: "ar", direction: "rtl"');
    expect(smoke).toContain('{ code: "fr", direction: "ltr"');
    expect(smoke).toContain('{ name: "phone", width: 390, height: 844');
    expect(smoke).toContain('{ name: "tablet", width: 768, height: 1024');
    expect(smoke).toContain('{ name: "desktop", width: 1440, height: 900');
    expect(smoke).toContain("state.ltrViolations.length > 0");
    expect(smoke).toContain("state.horizontalOverflow");
    expect(smoke).toContain("ERP_SMOKE_USERNAME");
  });

  it("runs the complete Phase 9 release matrix", () => {
    const workflow = read(".github/workflows/phase9-final-release.yml");

    for (const token of [
      "TypeScript",
      "Production build",
      "Lint",
      "Prepare disposable PostgreSQL schema",
      "Application startup and multilingual browser smoke",
      "Full backend tests",
      "Backend coverage thresholds",
      "Full frontend tests",
      "Frontend coverage thresholds",
      "API smoke sweep",
      "Final untranslated-text baseline",
      "Focused security checks",
      "Critical production dependency audit",
      "Verified secret scan",
      "Final production readiness",
    ]) {
      expect(workflow).toContain(token);
    }

    expect(workflow).toContain("postgres:15");
    expect(workflow).toContain("scripts/run-phase9-language-browser-smoke.mjs");
    expect(workflow).toContain("scripts/verify-phase9-final-i18n-baseline.mjs");
    expect(workflow).toContain("test \"$PHASE9_STATUS\" = \"success\"");
  });
});
