import type { ApplicationLanguage } from "@shared/applicationLanguageContract";

type SharedEntry = Record<ApplicationLanguage, string>;

export const sharedInterfaceTranslations: SharedEntry[] = [
  { en: "Dashboard", ar: "لوحة التحكم", fr: "Tableau de bord" },
  { en: "Inventory", ar: "المخزون", fr: "Stock" },
  { en: "Sales", ar: "المبيعات", fr: "Ventes" },
  { en: "Purchases", ar: "المشتريات", fr: "Achats" },
  { en: "Accounting", ar: "المحاسبة", fr: "Comptabilité" },
  { en: "Accounts", ar: "الحسابات", fr: "Comptes" },
  { en: "Daybook", ar: "دفتر اليومية", fr: "Journal" },
  { en: "Reports", ar: "التقارير", fr: "Rapports" },
  { en: "Customers", ar: "العملاء", fr: "Clients" },
  { en: "Suppliers", ar: "الموردون", fr: "Fournisseurs" },
  { en: "Containers", ar: "الحاويات", fr: "Conteneurs" },
  { en: "Factory", ar: "المصنع", fr: "Usine" },
  { en: "Production", ar: "الإنتاج", fr: "Production" },
  { en: "Payroll", ar: "الرواتب", fr: "Paie" },
  { en: "Properties", ar: "العقارات", fr: "Propriétés" },
  { en: "Settings", ar: "الإعدادات", fr: "Paramètres" },
  { en: "Users", ar: "المستخدمون", fr: "Utilisateurs" },
  { en: "Search", ar: "بحث", fr: "Rechercher" },
  { en: "Filter", ar: "تصفية", fr: "Filtrer" },
  { en: "Actions", ar: "الإجراءات", fr: "Actions" },
  { en: "Add", ar: "إضافة", fr: "Ajouter" },
  { en: "Edit", ar: "تعديل", fr: "Modifier" },
  { en: "Delete", ar: "حذف", fr: "Supprimer" },
  { en: "Save", ar: "حفظ", fr: "Enregistrer" },
  { en: "Cancel", ar: "إلغاء", fr: "Annuler" },
  { en: "Close", ar: "إغلاق", fr: "Fermer" },
  { en: "Confirm", ar: "تأكيد", fr: "Confirmer" },
  { en: "Continue", ar: "متابعة", fr: "Continuer" },
  { en: "Back", ar: "رجوع", fr: "Retour" },
  { en: "Next", ar: "التالي", fr: "Suivant" },
  { en: "Previous", ar: "السابق", fr: "Précédent" },
  { en: "Refresh", ar: "تحديث", fr: "Actualiser" },
  { en: "Export", ar: "تصدير", fr: "Exporter" },
  { en: "Import", ar: "استيراد", fr: "Importer" },
  { en: "Print", ar: "طباعة", fr: "Imprimer" },
  { en: "Download", ar: "تنزيل", fr: "Télécharger" },
  { en: "Upload", ar: "رفع", fr: "Téléverser" },
  { en: "Date", ar: "التاريخ", fr: "Date" },
  { en: "Status", ar: "الحالة", fr: "Statut" },
  { en: "Name", ar: "الاسم", fr: "Nom" },
  { en: "Description", ar: "الوصف", fr: "Description" },
  { en: "Quantity", ar: "الكمية", fr: "Quantité" },
  { en: "Price", ar: "السعر", fr: "Prix" },
  { en: "Total", ar: "الإجمالي", fr: "Total" },
  { en: "Loading…", ar: "جارٍ التحميل…", fr: "Chargement…" },
  { en: "No results", ar: "لا توجد نتائج", fr: "Aucun résultat" },
  { en: "Select an option", ar: "اختر خيارًا", fr: "Sélectionnez une option" },
  { en: "Log out", ar: "تسجيل الخروج", fr: "Déconnexion" },
  { en: "My Settings", ar: "إعداداتي", fr: "Mes paramètres" },
];

const entryByVisibleText = new Map<string, SharedEntry>();
for (const entry of sharedInterfaceTranslations) {
  entryByVisibleText.set(entry.en, entry);
  entryByVisibleText.set(entry.ar, entry);
  entryByVisibleText.set(entry.fr, entry);
}

export function translateSharedInterfaceText(value: string, language: ApplicationLanguage): string | null {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const normalized = value.trim();
  if (!normalized) return null;
  const entry = entryByVisibleText.get(normalized);
  return entry ? `${leading}${entry[language]}${trailing}` : null;
}
