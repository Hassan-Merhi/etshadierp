import { describe, expect, it } from "vitest";
import {
  isPhase3SharedUiText,
  phase3SharedUiTranslations,
  translatePhase3SharedUiText,
} from "../client/src/i18n/sharedUiPhase3Translations";

describe("Phase 3 shared interface translations", () => {
  it("covers every reviewed shared UI phrase exactly once", () => {
    expect(phase3SharedUiTranslations).toHaveLength(494);
    expect(new Set(phase3SharedUiTranslations.map((entry) => entry.en)).size).toBe(494);

    for (const entry of phase3SharedUiTranslations) {
      expect(entry.en.trim()).not.toBe("");
      expect(entry.ar.trim()).not.toBe("");
      expect(entry.fr.trim()).not.toBe("");
    }
  });

  it("translates global navigation, status and offline messages", () => {
    expect(translatePhase3SharedUiText("Search pages...", "ar")).toBe("ابحث في الصفحات...");
    expect(translatePhase3SharedUiText("No pending actions", "fr")).toBe("Aucune action en attente");
    expect(translatePhase3SharedUiText("Page not available offline", "ar")).toBe("الصفحة غير متاحة دون اتصال");
  });

  it("preserves dynamic business references while translating their interface message", () => {
    expect(translatePhase3SharedUiText("42 kg added to MIX-17", "ar")).toBe("تمت إضافة 42 كغ إلى MIX-17");
    expect(translatePhase3SharedUiText("Switched to GC Lshi #2", "fr")).toBe("Passage à GC Lshi #2");
    expect(translatePhase3SharedUiText("Mirror voucher PV-301 created.", "ar")).toBe("تم إنشاء السند المقابل PV-301.");
  });

  it("can switch directly between Arabic and French visible text", () => {
    expect(translatePhase3SharedUiText("اختصارات لوحة المفاتيح", "fr")).toBe("Raccourcis clavier");
    expect(translatePhase3SharedUiText("Aucune action en attente", "en")).toBe("No pending actions");
  });

  it("recognizes only reviewed shared interface copy", () => {
    expect(isPhase3SharedUiText("Search pages...")).toBe(true);
    expect(isPhase3SharedUiText("تم إنشاء السند المقابل PV-301.")).toBe(true);
    expect(isPhase3SharedUiText("CUSTOM-ITEM-001")).toBe(false);
  });

  it("does not translate unknown stored business values", () => {
    expect(translatePhase3SharedUiText("CUSTOM-ITEM-001", "ar")).toBeNull();
    expect(translatePhase3SharedUiText("Blue Denim", "fr")).toBeNull();
    expect(translatePhase3SharedUiText("Hassan Supplier Account", "ar")).toBeNull();
  });
});
