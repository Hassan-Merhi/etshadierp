import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  phase3SharedUiTranslations,
  translatePhase3SharedUiText,
} from "../client/src/i18n/sharedUiPhase3Translations";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Phase 3 shared interface translations", () => {
  it("covers every reviewed shared UI phrase exactly once", () => {
    expect(phase3SharedUiTranslations).toHaveLength(461);
    expect(new Set(phase3SharedUiTranslations.map((entry) => entry.en)).size).toBe(461);

    for (const entry of phase3SharedUiTranslations) {
      expect(entry.en.trim()).not.toBe("");
      expect(entry.ar.trim()).not.toBe("");
      expect(entry.fr.trim()).not.toBe("");
    }
  });

  it("translates global navigation, status and offline messages", () => {
    expect(translatePhase3SharedUiText("Search pages...", "ar")).toBe("ابحث في الصفحات...");
    expect(translatePhase3SharedUiText("No pending actions", "fr")).toBe("Aucune action en attente");
    expect(translatePhase3SharedUiText("Page not available offline", "ar")).toBe(
      "الصفحة غير متاحة دون اتصال",
    );
  });

  it("preserves dynamic business references while translating their interface message", () => {
    expect(translatePhase3SharedUiText("42 kg added to MIX-17", "ar")).toBe(
      "تمت إضافة 42 كغ إلى MIX-17",
    );
    expect(translatePhase3SharedUiText("Switched to GC Lshi #2", "fr")).toBe(
      "Passage à GC Lshi #2",
    );
    expect(translatePhase3SharedUiText("Mirror voucher PV-301 created.", "ar")).toBe(
      "تم إنشاء السند المقابل PV-301.",
    );
  });

  it("can switch directly between Arabic and French visible text", () => {
    expect(translatePhase3SharedUiText("اختصارات لوحة المفاتيح", "fr")).toBe(
      "Raccourcis clavier",
    );
    expect(translatePhase3SharedUiText("Aucune action en attente", "en")).toBe(
      "No pending actions",
    );
  });

  it("does not translate unknown stored business values", () => {
    expect(translatePhase3SharedUiText("CUSTOM-ITEM-001", "ar")).toBeNull();
    expect(translatePhase3SharedUiText("Blue Denim", "fr")).toBeNull();
    expect(translatePhase3SharedUiText("Hassan Supplier Account", "ar")).toBeNull();
  });

  it("keeps the runtime bridge protected and the audit ratchet at zero", () => {
    const bridge = read("client/src/components/ApplicationInterfaceTranslator.tsx");
    const audit = read("scripts/audit-i18n-phase14.mjs");
    const baseline = JSON.parse(read("config/i18n-phase14-baseline.json"));

    expect(bridge).toContain("isPhase3SharedUiText");
    expect(bridge).toContain('"[data-business-value]"');
    expect(bridge).toContain('"[data-stock-name]"');
    expect(bridge).toContain('"[data-account-name]"');
    expect(audit).toContain("sharedUiPhase3Translations.part5.ts");
    expect(baseline.detectorVersion).toBe(4);
    expect(baseline.modules["shared-ui"].maxActionable).toBe(0);
  });
});
