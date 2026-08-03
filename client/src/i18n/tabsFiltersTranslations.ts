import type { ApplicationLanguage } from "@shared/applicationLanguageContract";

type Entry = Record<ApplicationLanguage, string>;

const entries: Entry[] = [
  // Shared page tabs used across ERP, Factory, Supplier Partner, Properties and POS.
  { en: "By Location", ar: "حسب الموقع", fr: "Par emplacement" },
  { en: "On The Way", ar: "في الطريق", fr: "En route" },
  { en: "Containers", ar: "الحاويات", fr: "Conteneurs" },
  { en: "Combined", ar: "مجمّع", fr: "Combiné" },
  { en: "Overview", ar: "نظرة عامة", fr: "Aperçu" },
  { en: "Details", ar: "التفاصيل", fr: "Détails" },
  { en: "Summary", ar: "الملخص", fr: "Résumé" },
  { en: "History", ar: "السجل", fr: "Historique" },
  { en: "Transactions", ar: "المعاملات", fr: "Transactions" },
  { en: "Items", ar: "الأصناف", fr: "Articles" },
  { en: "Groups", ar: "المجموعات", fr: "Groupes" },
  { en: "Locations", ar: "المواقع", fr: "Emplacements" },
  { en: "Orders", ar: "الطلبات", fr: "Commandes" },
  { en: "Pending", ar: "قيد الانتظار", fr: "En attente" },
  { en: "Approved", ar: "موافق عليه", fr: "Approuvé" },
  { en: "Completed", ar: "مكتمل", fr: "Terminé" },
  { en: "Cancelled", ar: "ملغى", fr: "Annulé" },
  { en: "Active", ar: "نشط", fr: "Actif" },
  { en: "Inactive", ar: "غير نشط", fr: "Inactif" },

  // Common filters and select values.
  { en: "All Categories", ar: "كل الفئات", fr: "Toutes les catégories" },
  { en: "All Suppliers", ar: "كل الموردين", fr: "Tous les fournisseurs" },
  { en: "All Grades", ar: "كل الدرجات", fr: "Toutes les qualités" },
  { en: "All Locations", ar: "كل المواقع", fr: "Tous les emplacements" },
  { en: "All Companies", ar: "كل الشركات", fr: "Toutes les entreprises" },
  { en: "All Customers", ar: "كل العملاء", fr: "Tous les clients" },
  { en: "All Statuses", ar: "كل الحالات", fr: "Tous les statuts" },
  { en: "All Types", ar: "كل الأنواع", fr: "Tous les types" },
  { en: "All Groups", ar: "كل المجموعات", fr: "Tous les groupes" },
  { en: "All groups", ar: "كل المجموعات", fr: "Tous les groupes" },
  { en: "Select Category", ar: "اختر الفئة", fr: "Sélectionner une catégorie" },
  { en: "Select Supplier", ar: "اختر المورد", fr: "Sélectionner un fournisseur" },
  { en: "Select Grade", ar: "اختر الدرجة", fr: "Sélectionner une qualité" },
  { en: "Select Location", ar: "اختر الموقع", fr: "Sélectionner un emplacement" },
  { en: "Select Status", ar: "اختر الحالة", fr: "Sélectionner un statut" },

  // Search fields and placeholders.
  {
    en: "Search by name, container, supplier, grade or category...",
    ar: "ابحث بالاسم أو الحاوية أو المورد أو الدرجة أو الفئة...",
    fr: "Rechercher par nom, conteneur, fournisseur, qualité ou catégorie...",
  },
  { en: "Search by name, code or category...", ar: "ابحث بالاسم أو الرمز أو الفئة...", fr: "Rechercher par nom, code ou catégorie..." },
  { en: "Search by name or code...", ar: "ابحث بالاسم أو الرمز...", fr: "Rechercher par nom ou code..." },
  { en: "Search by name or code…", ar: "ابحث بالاسم أو الرمز…", fr: "Rechercher par nom ou code…" },
  { en: "Search by name...", ar: "ابحث بالاسم...", fr: "Rechercher par nom..." },
  { en: "Search items...", ar: "ابحث عن الأصناف...", fr: "Rechercher des articles..." },
  { en: "Search customers...", ar: "ابحث عن العملاء...", fr: "Rechercher des clients..." },
  { en: "Search suppliers...", ar: "ابحث عن الموردين...", fr: "Rechercher des fournisseurs..." },
  { en: "Type to search...", ar: "اكتب للبحث...", fr: "Saisir pour rechercher..." },

  // POS price-list filters, KPIs and empty states.
  { en: "Price List", ar: "قائمة الأسعار", fr: "Liste des prix" },
  { en: "Total Items", ar: "إجمالي الأصناف", fr: "Total des articles" },
  { en: "Priced", ar: "مسعّرة", fr: "Tarifés" },
  { en: "Unpriced", ar: "غير مسعّرة", fr: "Sans prix" },
  { en: "Show All", ar: "إظهار الكل", fr: "Afficher tout" },
  { en: "Hide All", ar: "إخفاء الكل", fr: "Masquer tout" },
  { en: "Select a location", ar: "اختر موقعًا", fr: "Sélectionner un emplacement" },
  {
    en: "Choose a location from the panel on the left.",
    ar: "اختر موقعًا من اللوحة الموجودة على اليسار.",
    fr: "Choisissez un emplacement dans le panneau de gauche.",
  },
  {
    en: "Tap a location above to view prices.",
    ar: "اضغط على موقع أعلاه لعرض الأسعار.",
    fr: "Touchez un emplacement ci-dessus pour afficher les prix.",
  },
  { en: "No locations.", ar: "لا توجد مواقع.", fr: "Aucun emplacement." },
  { en: "No items match your filters.", ar: "لا توجد أصناف تطابق عوامل التصفية.", fr: "Aucun article ne correspond à vos filtres." },
  { en: "All items are priced.", ar: "جميع الأصناف مسعّرة.", fr: "Tous les articles ont un prix." },
  {
    en: "All groups hidden — click a group chip above to show items.",
    ar: "تم إخفاء كل المجموعات — اضغط على مجموعة أعلاه لإظهار الأصناف.",
    fr: "Tous les groupes sont masqués — cliquez sur un groupe ci-dessus pour afficher les articles.",
  },
  { en: "(No Group)", ar: "(بدون مجموعة)", fr: "(Sans groupe)" },
  { en: "Template", ar: "قالب", fr: "Modèle" },
  { en: "Upload", ar: "رفع", fr: "Téléverser" },
  { en: "Export", ar: "تصدير", fr: "Exporter" },
  { en: "Exporting…", ar: "جارٍ التصدير…", fr: "Exportation…" },

  // Inventory on-the-way page and its KPIs.
  { en: "Stock On The Way", ar: "المخزون في الطريق", fr: "Stock en route" },
  {
    en: "All stock items from containers currently in transit",
    ar: "جميع أصناف المخزون الموجودة في الحاويات قيد النقل حاليًا",
    fr: "Tous les articles des conteneurs actuellement en transit",
  },
  { en: "Containers OTW", ar: "حاويات في الطريق", fr: "Conteneurs en route" },
  { en: "Unique Items", ar: "أصناف فريدة", fr: "Articles uniques" },
  { en: "Total Quantity", ar: "إجمالي الكمية", fr: "Quantité totale" },
  { en: "Total Value", ar: "القيمة الإجمالية", fr: "Valeur totale" },
  { en: "Item Name", ar: "اسم الصنف", fr: "Nom de l’article" },
  { en: "Total Cost", ar: "إجمالي التكلفة", fr: "Coût total" },
  { en: "Container", ar: "الحاوية", fr: "Conteneur" },
  { en: "Rate", ar: "السعر", fr: "Taux" },
];

const byVisibleText = new Map<string, Entry>();
for (const entry of entries) {
  byVisibleText.set(entry.en, entry);
  byVisibleText.set(entry.ar, entry);
  byVisibleText.set(entry.fr, entry);
}

export function translateTabsFiltersText(value: string, language: ApplicationLanguage): string | null {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const normalized = value.trim();
  if (!normalized) return null;
  const entry = byVisibleText.get(normalized);
  return entry ? `${leading}${entry[language]}${trailing}` : null;
}
