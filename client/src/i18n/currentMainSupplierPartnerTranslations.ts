import type { Phase4SupplierPartnerEntry } from "./supplierPartnerPhase4TranslationTypes";

/**
 * Supplier Partner messages introduced on current main after the Phase 4
 * translation inventory was frozen. Keeping them here makes the compatibility
 * audit and the runtime interface translator use the same reviewed copy.
 */
export const currentMainSupplierPartnerTranslations = [
  {
    en: "Golden Coast POS is not ready for automatic HADI cash routing.",
    ar: "نقطة بيع Golden Coast غير جاهزة لتوجيه النقد تلقائياً إلى HADI.",
    fr: "Le point de vente Golden Coast n’est pas prêt pour l’acheminement automatique des espèces vers HADI.",
  },
  {
    en: "Golden Coast POS requires a stable client sale id.",
    ar: "تتطلب نقطة بيع Golden Coast معرّف بيع ثابتاً من العميل.",
    fr: "Le point de vente Golden Coast nécessite un identifiant de vente côté client stable.",
  },
  {
    en: "Unresolved stock code",
    ar: "رمز مخزون غير محلول",
    fr: "Code de stock non résolu",
  },
  {
    en: "Unresolved",
    ar: "غير محلول",
    fr: "Non résolu",
  },
  {
    en: "Link item first",
    ar: "اربط الصنف أولاً",
    fr: "Lier d’abord l’article",
  },
  {
    en: "proforma price",
    ar: "سعر الفاتورة الأولية",
    fr: "prix proforma",
  },
] as const satisfies readonly Phase4SupplierPartnerEntry[];
