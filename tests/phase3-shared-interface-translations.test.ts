import { describe, expect, it } from "vitest";
import {
  isPhase3SharedUiText,
  phase3SharedUiTranslations,
  translatePhase3SharedUiText,
} from "../client/src/i18n/sharedUiPhase3Translations";

describe("Phase 3 shared interface translations", () => {
  it("covers every reviewed shared UI phrase exactly once", () => {
    // 542 (main) + 2: "Particulars" and "Adjust your filters and try again" were
    // added when AnalyticsLegacy.tsx was split. That split moved those literals into
    // the reports-exports i18n module, which must stay at zero actionable strings, so
    // translating them was the only resolution that neither renamed a component to
    // dodge the path-based classifier nor weakened that invariant. The same split
    // exposed 23 sales-panel findings (22 unique phrases) to the sales-pos classifier,
    // so those phrases are translated instead of raising the reviewed Phase 9 release cap.
    // +16: the Convergence Reconciliation screen. The report already existed as
    // an endpoint with nothing rendering it; giving it a page introduced its
    // labels as literals, and the shared-ui and other-client modules are both
    // ratcheted, so every one of them is translated here rather than counted as
    // new backlog. Six of them ("Domain", "Record", "Finding", "Expected",
    // "Recorded", "Everything agrees") also cover pre-existing literals
    // elsewhere, which is why the audit total fell rather than held. Three more
    // ("Discrepancies", "To investigate", "This report never changes data.") the
    // detector does not flag at all; they are translated regardless, because a
    // screen that is half Arabic is a defect whether or not a ratchet noticed.
    // +13: reviewed Customer Loading column/filter copy added by the current repair
    // branch. These entries are real translations, so the exact uniqueness contract
    // advances with the translation table rather than treating them as audit backlog.
    expect(phase3SharedUiTranslations).toHaveLength(595);
    expect(new Set(phase3SharedUiTranslations.map((entry) => entry.en)).size).toBe(595);

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

  it("translates the analytics sales panel exposed by the current-main split", () => {
    expect(translatePhase3SharedUiText("Sales by Location", "ar")).toBe("المبيعات حسب الموقع");
    expect(translatePhase3SharedUiText("Factory POS", "fr")).toBe("Point de vente usine");
    expect(translatePhase3SharedUiText("Total Transactions:", "fr")).toBe("Total des transactions :");
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
