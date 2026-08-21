import type { Phase3SharedUiEntry } from "./sharedUiPhase3TranslationTypes";

// Reviewed shared interface translations added after PR #815.
// Keep these as exact user-facing entries so both the runtime translator and
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
  { en: "Article Code", ar: "رمز الصنف", fr: "Code article" },
  { en: "Arabic Name", ar: "الاسم بالعربية", fr: "Nom arabe" },
  { en: "Wt/Bale", ar: "الوزن/بالة", fr: "Poids/balle" },
  { en: "Sell Price", ar: "سعر البيع", fr: "Prix de vente" },
  { en: "Available Stock", ar: "المخزون المتاح", fr: "Stock disponible" },
  { en: "Total Loaded", ar: "إجمالي المحمّل", fr: "Total chargé" },
  { en: "Total KG", ar: "إجمالي كغ", fr: "Total kg" },
  { en: "Last Loaded", ar: "آخر تحميل", fr: "Dernier chargement" },
  { en: "Refund Total:", ar: "إجمالي الاسترداد:", fr: "Total du remboursement :" },
  { en: "Inventory Value:", ar: "قيمة المخزون:", fr: "Valeur du stock :" },
  { en: "Failed to fetch suppliers", ar: "تعذر جلب الموردين", fr: "Impossible de charger les fournisseurs" },
];
