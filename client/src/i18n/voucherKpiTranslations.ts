import type { ApplicationLanguage } from "@shared/applicationLanguageContract";

type Entry = Record<ApplicationLanguage, string>;

const entries: Entry[] = [
  // Voucher details and voucher editing
  { en: "Voucher Details", ar: "تفاصيل السند", fr: "Détails de la pièce" },
  { en: "Voucher Number", ar: "رقم السند", fr: "Numéro de pièce" },
  { en: "Voucher Date", ar: "تاريخ السند", fr: "Date de la pièce" },
  { en: "Voucher Type", ar: "نوع السند", fr: "Type de pièce" },
  { en: "Description", ar: "الوصف", fr: "Description" },
  { en: "Created At", ar: "تاريخ الإنشاء", fr: "Créé le" },
  { en: "Entries", ar: "القيود", fr: "Écritures" },
  { en: "Paid From", ar: "مدفوع من", fr: "Payé depuis" },
  { en: "Received In", ar: "مستلم في", fr: "Reçu dans" },
  { en: "Balance", ar: "الرصيد", fr: "Solde" },
  { en: "Account", ar: "الحساب", fr: "Compte" },
  { en: "Amount", ar: "المبلغ", fr: "Montant" },
  { en: "Total", ar: "الإجمالي", fr: "Total" },
  { en: "Close", ar: "إغلاق", fr: "Fermer" },
  { en: "Edit", ar: "تعديل", fr: "Modifier" },
  { en: "Edit Voucher", ar: "تعديل السند", fr: "Modifier la pièce" },
  { en: "New Voucher", ar: "سند جديد", fr: "Nouvelle pièce" },
  { en: "Save Voucher", ar: "حفظ السند", fr: "Enregistrer la pièce" },
  { en: "Delete Voucher", ar: "حذف السند", fr: "Supprimer la pièce" },
  { en: "Payment", ar: "دفع", fr: "Paiement" },
  { en: "Receipt", ar: "قبض", fr: "Encaissement" },
  { en: "Journal Entry", ar: "قيد يومية", fr: "Écriture de journal" },
  { en: "Detailed", ar: "مفصل", fr: "Détaillé" },
  { en: "Condensed", ar: "مختصر", fr: "Condensé" },

  // Factory production report KPIs and sections
  { en: "Payroll Overview", ar: "نظرة عامة على الرواتب", fr: "Aperçu de la paie" },
  { en: "Workers + Transport", ar: "العمال + النقل", fr: "Travailleurs + transport" },
  { en: "Worker Remaining", ar: "المتبقي للعمال", fr: "Reste dû aux travailleurs" },
  { en: "Total Payroll", ar: "إجمالي الرواتب", fr: "Paie totale" },
  { en: "Employee Expected", ar: "المتوقع للموظفين", fr: "Prévision employés" },
  { en: "Paid This Month", ar: "المدفوع هذا الشهر", fr: "Payé ce mois-ci" },
  { en: "Employee Monthly", ar: "رواتب الموظفين الشهرية", fr: "Mensuel employés" },
  { en: "Workers", ar: "العمال", fr: "Travailleurs" },
  { en: "Transport", ar: "النقل", fr: "Transport" },
  { en: "Origin Batches", ar: "دفعات المصدر", fr: "Lots d’origine" },
  { en: "Bales Produced", ar: "البالات المنتجة", fr: "Balles produites" },
  { en: "Wipers & Garbage", ar: "المماسح والنفايات", fr: "Chiffons et déchets" },
  { en: "Balance on Table", ar: "الرصيد على الطاولة", fr: "Solde sur table" },
  { en: "Weight", ar: "الوزن", fr: "Poids" },
  { en: "Batch Rate", ar: "معدل الدفعة", fr: "Taux du lot" },
  { en: "Value", ar: "القيمة", fr: "Valeur" },
  { en: "Bales", ar: "البالات", fr: "Balles" },
  { en: "Rate / KG", ar: "المعدل / كغ", fr: "Taux / kg" },
  { en: "Wipers", ar: "المماسح", fr: "Chiffons" },
  { en: "Garbage", ar: "النفايات", fr: "Déchets" },
  { en: "Total Wiper + Garbage", ar: "إجمالي المماسح + النفايات", fr: "Total chiffons + déchets" },
  { en: "% of Input", ar: "% من المدخلات", fr: "% des entrées" },
  { en: "Production Profit", ar: "ربح الإنتاج", fr: "Bénéfice de production" },
  { en: "Production by Category", ar: "الإنتاج حسب الفئة", fr: "Production par catégorie" },
  { en: "Mixed Batches", ar: "الدفعات المختلطة", fr: "Lots mélangés" },
  { en: "Categories", ar: "الفئات", fr: "Catégories" },
  { en: "Products", ar: "المنتجات", fr: "Produits" },
  { en: "Batch", ar: "دفعة", fr: "Lot" },
  { en: "QTY", ar: "الكمية", fr: "QTÉ" },
  { en: "KG", ar: "كغ", fr: "KG" },
];

const byVisibleText = new Map<string, Entry>();
for (const entry of entries) {
  byVisibleText.set(entry.en.toLowerCase(), entry);
  byVisibleText.set(entry.ar.toLowerCase(), entry);
  byVisibleText.set(entry.fr.toLowerCase(), entry);
}

export function translateVoucherKpiText(value: string, language: ApplicationLanguage): string | null {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const normalized = value.trim();
  if (!normalized) return null;

  const entry = byVisibleText.get(normalized.toLowerCase());
  return entry ? `${leading}${entry[language]}${trailing}` : null;
}
