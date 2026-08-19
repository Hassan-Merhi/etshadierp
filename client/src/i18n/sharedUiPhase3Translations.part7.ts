import type { Phase3SharedUiEntry } from "./sharedUiPhase3TranslationTypes";

// Customer Loading column chooser translations added after PR #815.
// Keep these as exact visible-text entries so both the runtime translator and
// the classified i18n audit recognize them as reviewed multilingual UI copy.
export const phase3SharedUiTranslationsPart7: readonly Phase3SharedUiEntry[] = [
  { en: "Columns", ar: "الأعمدة", fr: "Colonnes" },
  { en: "Visible Columns", ar: "الأعمدة الظاهرة", fr: "Colonnes visibles" },
  {
    en: "Turn columns on or off for the Customer Loading table.",
    ar: "فعّل أو عطّل الأعمدة في جدول تحميل العملاء.",
    fr: "Activez ou désactivez les colonnes du tableau de chargement client.",
  },
  { en: "Show All", ar: "إظهار الكل", fr: "Tout afficher" },
  { en: "Done", ar: "تم", fr: "Terminé" },
];
