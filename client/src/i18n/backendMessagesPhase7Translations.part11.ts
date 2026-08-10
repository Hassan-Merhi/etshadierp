import type { Phase7BackendMessagesEntry } from "./backendMessagesPhase7TranslationTypes";

/** Bandwidth Phases 1–5 messages reviewed during the final integrated verification pass. */
export const backendMessagesPhase7TranslationsPart11: readonly Phase7BackendMessagesEntry[] = [
  {
    en: "Failed to load location summary (${response.status})",
    ar: "فشل تحميل ملخص المواقع ({0})",
    fr: "Échec du chargement du récapitulatif des emplacements ({0})",
  },
  {
    en: "groupId is required for profile=group",
    ar: "groupId مطلوب عندما يكون profile=group",
    fr: "groupId est requis lorsque profile=group",
  },
  {
    en: "Stock group not found",
    ar: "لم يتم العثور على مجموعة المخزون",
    fr: "Groupe de stock introuvable",
  },
  {
    en: "Barcode code is required",
    ar: "رمز الباركود مطلوب",
    fr: "Le code-barres est requis",
  },
  {
    en: "Barcode code is too long",
    ar: "رمز الباركود طويل جدًا",
    fr: "Le code-barres est trop long",
  },
  {
    en: "format must be svg or png",
    ar: "يجب أن يكون التنسيق svg أو png",
    fr: "Le format doit être svg ou png",
  },
  {
    en: "Invalid section",
    ar: "قسم غير صالح",
    fr: "Section invalide",
  },
  {
    en: "Invalid productId",
    ar: "معرّف المنتج غير صالح",
    fr: "productId invalide",
  },
  {
    en: "${bales.length} matching bale(s) selected.",
    ar: "تم تحديد {0} بالة مطابقة.",
    fr: "{0} balle(s) correspondante(s) sélectionnée(s).",
  },
  {
    en: "${response.bale.referenceNumber} — ${response.bale.productName}",
    ar: "{0} — {1}",
    fr: "{0} — {1}",
  },
  {
    en: "${result.totalBales} bale(s) marked as disposed (${result.dispatch.dispatchNumber})",
    ar: "تم تعليم {0} بالة على أنها متخلّص منها ({1})",
    fr: "{0} balle(s) marquée(s) comme éliminée(s) ({1})",
  },
  {
    en: "${result.restoredBales} bale(s) restored to stock.",
    ar: "تمت إعادة {0} بالة إلى المخزون.",
    fr: "{0} balle(s) remise(s) en stock.",
  },
  {
    en: "Invalid product id",
    ar: "معرّف المنتج غير صالح",
    fr: "Identifiant de produit invalide",
  },
  {
    en: "Reference is required",
    ar: "المرجع مطلوب",
    fr: "La référence est requise",
  },
  {
    en: 'No eligible waste bale with ref "${reference}"',
    ar: "لا توجد بالة هدر مؤهلة بالمرجع «{0}»",
    fr: "Aucune balle de déchets admissible avec la référence « {0} »",
  },
  {
    en: "Invalid dispatch id",
    ar: "معرّف التصريف غير صالح",
    fr: "Identifiant d’évacuation invalide",
  },
  {
    en: "Dispatch not found",
    ar: "لم يتم العثور على التصريف",
    fr: "Évacuation introuvable",
  },
  {
    en: "Sales report summary failed: ${response.status}",
    ar: "فشل ملخص تقرير المبيعات: {0}",
    fr: "Échec du résumé du rapport des ventes : {0}",
  },
  {
    en: "Invalid sales report summary response",
    ar: "استجابة ملخص تقرير المبيعات غير صالحة",
    fr: "Réponse de résumé du rapport des ventes invalide",
  },
  {
    en: "Sales report export failed: ${response.status}",
    ar: "فشل تصدير تقرير المبيعات: {0}",
    fr: "Échec de l’export du rapport des ventes : {0}",
  },
  {
    en: "Invalid sales report export response",
    ar: "استجابة تصدير تقرير المبيعات غير صالحة",
    fr: "Réponse d’export du rapport des ventes invalide",
  },
];
