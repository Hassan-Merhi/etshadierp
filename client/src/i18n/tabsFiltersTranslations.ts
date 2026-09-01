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

  // Common filters and select values used throughout every application shell.
  { en: "All Categories", ar: "كل الفئات", fr: "Toutes les catégories" },
  { en: "All Suppliers", ar: "كل الموردين", fr: "Tous les fournisseurs" },
  { en: "All Grades", ar: "كل الدرجات", fr: "Toutes les qualités" },
  { en: "All Locations", ar: "كل المواقع", fr: "Tous les emplacements" },
  { en: "All Companies", ar: "كل الشركات", fr: "Toutes les entreprises" },
  { en: "All Customers", ar: "كل العملاء", fr: "Tous les clients" },
  { en: "All Statuses", ar: "كل الحالات", fr: "Tous les statuts" },
  { en: "All Types", ar: "كل الأنواع", fr: "Tous les types" },
  { en: "All Groups", ar: "كل المجموعات", fr: "Tous les groupes" },
  { en: "All Items", ar: "كل الأصناف", fr: "Tous les articles" },
  { en: "All Accounts", ar: "كل الحسابات", fr: "Tous les comptes" },
  { en: "All Employees", ar: "كل الموظفين", fr: "Tous les employés" },
  { en: "All Workers", ar: "كل العمال", fr: "Tous les travailleurs" },
  { en: "All Containers", ar: "كل الحاويات", fr: "Tous les conteneurs" },
  { en: "All Orders", ar: "كل الطلبات", fr: "Toutes les commandes" },
  { en: "All Vouchers", ar: "كل السندات", fr: "Toutes les pièces" },
  { en: "All Transactions", ar: "كل المعاملات", fr: "Toutes les transactions" },
  { en: "All Properties", ar: "كل العقارات", fr: "Toutes les propriétés" },
  { en: "All Units", ar: "كل الوحدات", fr: "Toutes les unités" },
  { en: "All Tenants", ar: "كل المستأجرين", fr: "Tous les locataires" },
  { en: "All Dates", ar: "كل التواريخ", fr: "Toutes les dates" },
  { en: "Select Category", ar: "اختر الفئة", fr: "Sélectionner une catégorie" },
  { en: "Select Supplier", ar: "اختر المورد", fr: "Sélectionner un fournisseur" },
  { en: "Select Grade", ar: "اختر الدرجة", fr: "Sélectionner une qualité" },
  { en: "Select Location", ar: "اختر الموقع", fr: "Sélectionner un emplacement" },
  { en: "Select Status", ar: "اختر الحالة", fr: "Sélectionner un statut" },
  { en: "Select Company", ar: "اختر الشركة", fr: "Sélectionner une entreprise" },
  { en: "Select Customer", ar: "اختر العميل", fr: "Sélectionner un client" },
  { en: "Select Account", ar: "اختر الحساب", fr: "Sélectionner un compte" },
  { en: "Select Item", ar: "اختر الصنف", fr: "Sélectionner un article" },
  { en: "Select Group", ar: "اختر المجموعة", fr: "Sélectionner un groupe" },
  { en: "Select Type", ar: "اختر النوع", fr: "Sélectionner un type" },
  { en: "Select Date", ar: "اختر التاريخ", fr: "Sélectionner une date" },

  // Search fields and placeholders.
  {
    en: "Search by name, container, supplier, grade or category...",
    ar: "ابحث بالاسم أو الحاوية أو المورد أو الدرجة أو الفئة...",
    fr: "Rechercher par nom, conteneur, fournisseur, qualité ou catégorie...",
  },
  { en: "Search by name, code or category...", ar: "ابحث بالاسم أو الرمز أو الفئة...", fr: "Rechercher par nom, code ou catégorie..." },
  { en: "Search by name or code...", ar: "ابحث بالاسم أو الرمز...", fr: "Rechercher par nom ou code..." },
  { en: "Search by name...", ar: "ابحث بالاسم...", fr: "Rechercher par nom..." },
  { en: "Search items...", ar: "ابحث عن الأصناف...", fr: "Rechercher des articles..." },
  { en: "Search customers...", ar: "ابحث عن العملاء...", fr: "Rechercher des clients..." },
  { en: "Search suppliers...", ar: "ابحث عن الموردين...", fr: "Rechercher des fournisseurs..." },
  { en: "Search accounts...", ar: "ابحث عن الحسابات...", fr: "Rechercher des comptes..." },
  { en: "Search containers...", ar: "ابحث عن الحاويات...", fr: "Rechercher des conteneurs..." },
  { en: "Search locations...", ar: "ابحث عن المواقع...", fr: "Rechercher des emplacements..." },
  { en: "Search...", ar: "بحث...", fr: "Rechercher..." },
  { en: "Type to search...", ar: "اكتب للبحث...", fr: "Saisir pour rechercher..." },

  // Global KPI labels shared by dashboards, reports, inventory, accounting, POS and Factory.
  { en: "Total Items", ar: "إجمالي الأصناف", fr: "Total des articles" },
  { en: "Total Customers", ar: "إجمالي العملاء", fr: "Total des clients" },
  { en: "Total Suppliers", ar: "إجمالي الموردين", fr: "Total des fournisseurs" },
  { en: "Total Accounts", ar: "إجمالي الحسابات", fr: "Total des comptes" },
  { en: "Total Employees", ar: "إجمالي الموظفين", fr: "Total des employés" },
  { en: "Total Workers", ar: "إجمالي العمال", fr: "Total des travailleurs" },
  { en: "Total Containers", ar: "إجمالي الحاويات", fr: "Total des conteneurs" },
  { en: "Total Orders", ar: "إجمالي الطلبات", fr: "Total des commandes" },
  { en: "Total Transactions", ar: "إجمالي المعاملات", fr: "Total des transactions" },
  { en: "Total Vouchers", ar: "إجمالي السندات", fr: "Total des pièces" },
  { en: "Total Payments", ar: "إجمالي المدفوعات", fr: "Total des paiements" },
  { en: "Total Receipts", ar: "إجمالي المقبوضات", fr: "Total des encaissements" },
  { en: "Total Sales", ar: "إجمالي المبيعات", fr: "Total des ventes" },
  { en: "Total Purchases", ar: "إجمالي المشتريات", fr: "Total des achats" },
  { en: "Total Expenses", ar: "إجمالي المصروفات", fr: "Total des dépenses" },
  { en: "Total Revenue", ar: "إجمالي الإيرادات", fr: "Revenu total" },
  { en: "Total Profit", ar: "إجمالي الربح", fr: "Bénéfice total" },
  { en: "Total Balance", ar: "إجمالي الرصيد", fr: "Solde total" },
  { en: "Total Amount", ar: "إجمالي المبلغ", fr: "Montant total" },
  { en: "Total Quantity", ar: "إجمالي الكمية", fr: "Quantité totale" },
  { en: "Total Value", ar: "القيمة الإجمالية", fr: "Valeur totale" },
  { en: "Total Cost", ar: "إجمالي التكلفة", fr: "Coût total" },
  { en: "Total Weight", ar: "إجمالي الوزن", fr: "Poids total" },
  { en: "Total Stock", ar: "إجمالي المخزون", fr: "Stock total" },
  { en: "Active Items", ar: "الأصناف النشطة", fr: "Articles actifs" },
  { en: "Inactive Items", ar: "الأصناف غير النشطة", fr: "Articles inactifs" },
  { en: "Active Customers", ar: "العملاء النشطون", fr: "Clients actifs" },
  { en: "Inactive Customers", ar: "العملاء غير النشطين", fr: "Clients inactifs" },
  { en: "Pending Orders", ar: "الطلبات قيد الانتظار", fr: "Commandes en attente" },
  { en: "Completed Orders", ar: "الطلبات المكتملة", fr: "Commandes terminées" },
  { en: "Cancelled Orders", ar: "الطلبات الملغاة", fr: "Commandes annulées" },
  { en: "Open Orders", ar: "الطلبات المفتوحة", fr: "Commandes ouvertes" },
  { en: "Closed Orders", ar: "الطلبات المغلقة", fr: "Commandes fermées" },
  { en: "Paid", ar: "مدفوع", fr: "Payé" },
  { en: "Unpaid", ar: "غير مدفوع", fr: "Impayé" },
  { en: "Available Stock", ar: "المخزون المتاح", fr: "Stock disponible" },
  { en: "Current Stock", ar: "المخزون الحالي", fr: "Stock actuel" },
  { en: "Low Stock", ar: "مخزون منخفض", fr: "Stock faible" },
  { en: "Out of Stock", ar: "نفد المخزون", fr: "Rupture de stock" },
  { en: "Opening Balance", ar: "الرصيد الافتتاحي", fr: "Solde d’ouverture" },
  { en: "Closing Balance", ar: "الرصيد الختامي", fr: "Solde de clôture" },
  { en: "Current Balance", ar: "الرصيد الحالي", fr: "Solde actuel" },
  { en: "Outstanding Balance", ar: "الرصيد المستحق", fr: "Solde impayé" },
  { en: "Average Cost", ar: "متوسط التكلفة", fr: "Coût moyen" },
  { en: "Average Price", ar: "متوسط السعر", fr: "Prix moyen" },
  { en: "Average Rate", ar: "متوسط المعدل", fr: "Taux moyen" },
  { en: "Average Profit", ar: "متوسط الربح", fr: "Bénéfice moyen" },
  { en: "Today", ar: "اليوم", fr: "Aujourd’hui" },
  { en: "This Month", ar: "هذا الشهر", fr: "Ce mois-ci" },
  { en: "Last Month", ar: "الشهر الماضي", fr: "Le mois dernier" },
  { en: "This Year", ar: "هذه السنة", fr: "Cette année" },
  { en: "Last Year", ar: "السنة الماضية", fr: "L’année dernière" },
  { en: "Unique Items", ar: "أصناف فريدة", fr: "Articles uniques" },

  // POS price-list filters, KPIs and empty states.
  { en: "Price List", ar: "قائمة الأسعار", fr: "Liste des prix" },
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
  { en: "Item Name", ar: "اسم الصنف", fr: "Nom de l’article" },
  { en: "Container", ar: "الحاوية", fr: "Conteneur" },
  { en: "Rate", ar: "السعر", fr: "Taux" },
];

const searchTerms: Record<string, Entry> = {
  name: { en: "name", ar: "الاسم", fr: "nom" },
  code: { en: "code", ar: "الرمز", fr: "code" },
  "article code": { en: "article code", ar: "رمز الصنف", fr: "code article" },
  barcode: { en: "barcode", ar: "الباركود", fr: "code-barres" },
  item: { en: "item", ar: "الصنف", fr: "article" },
  items: { en: "items", ar: "الأصناف", fr: "articles" },
  "stock item": { en: "stock item", ar: "صنف المخزون", fr: "article de stock" },
  "stock items": { en: "stock items", ar: "أصناف المخزون", fr: "articles de stock" },
  product: { en: "product", ar: "المنتج", fr: "produit" },
  products: { en: "products", ar: "المنتجات", fr: "produits" },
  account: { en: "account", ar: "الحساب", fr: "compte" },
  accounts: { en: "accounts", ar: "الحسابات", fr: "comptes" },
  customer: { en: "customer", ar: "العميل", fr: "client" },
  customers: { en: "customers", ar: "العملاء", fr: "clients" },
  supplier: { en: "supplier", ar: "المورد", fr: "fournisseur" },
  suppliers: { en: "suppliers", ar: "الموردين", fr: "fournisseurs" },
  container: { en: "container", ar: "الحاوية", fr: "conteneur" },
  containers: { en: "containers", ar: "الحاويات", fr: "conteneurs" },
  "container number": { en: "container number", ar: "رقم الحاوية", fr: "numéro de conteneur" },
  location: { en: "location", ar: "الموقع", fr: "emplacement" },
  locations: { en: "locations", ar: "المواقع", fr: "emplacements" },
  group: { en: "group", ar: "المجموعة", fr: "groupe" },
  groups: { en: "groups", ar: "المجموعات", fr: "groupes" },
  "stock group": { en: "stock group", ar: "مجموعة المخزون", fr: "groupe de stock" },
  "stock groups": { en: "stock groups", ar: "مجموعات المخزون", fr: "groupes de stock" },
  category: { en: "category", ar: "الفئة", fr: "catégorie" },
  categories: { en: "categories", ar: "الفئات", fr: "catégories" },
  grade: { en: "grade", ar: "الدرجة", fr: "qualité" },
  grades: { en: "grades", ar: "الدرجات", fr: "qualités" },
  description: { en: "description", ar: "الوصف", fr: "description" },
  reference: { en: "reference", ar: "المرجع", fr: "référence" },
  document: { en: "document", ar: "المستند", fr: "document" },
  documents: { en: "documents", ar: "المستندات", fr: "documents" },
  voucher: { en: "voucher", ar: "السند", fr: "pièce" },
  vouchers: { en: "vouchers", ar: "السندات", fr: "pièces" },
  invoice: { en: "invoice", ar: "الفاتورة", fr: "facture" },
  invoices: { en: "invoices", ar: "الفواتير", fr: "factures" },
  order: { en: "order", ar: "الطلب", fr: "commande" },
  orders: { en: "orders", ar: "الطلبات", fr: "commandes" },
  phone: { en: "phone", ar: "الهاتف", fr: "téléphone" },
  "phone number": { en: "phone number", ar: "رقم الهاتف", fr: "numéro de téléphone" },
  email: { en: "email", ar: "البريد الإلكتروني", fr: "e-mail" },
  username: { en: "username", ar: "اسم المستخدم", fr: "nom d’utilisateur" },
  company: { en: "company", ar: "الشركة", fr: "entreprise" },
  companies: { en: "companies", ar: "الشركات", fr: "entreprises" },
  property: { en: "property", ar: "العقار", fr: "propriété" },
  properties: { en: "properties", ar: "العقارات", fr: "propriétés" },
  unit: { en: "unit", ar: "الوحدة", fr: "unité" },
  units: { en: "units", ar: "الوحدات", fr: "unités" },
  tenant: { en: "tenant", ar: "المستأجر", fr: "locataire" },
  tenants: { en: "tenants", ar: "المستأجرين", fr: "locataires" },
  worker: { en: "worker", ar: "العامل", fr: "travailleur" },
  workers: { en: "workers", ar: "العمال", fr: "travailleurs" },
  employee: { en: "employee", ar: "الموظف", fr: "employé" },
  employees: { en: "employees", ar: "الموظفين", fr: "employés" },
  driver: { en: "driver", ar: "السائق", fr: "chauffeur" },
  drivers: { en: "drivers", ar: "السائقين", fr: "chauffeurs" },
  vehicle: { en: "vehicle", ar: "المركبة", fr: "véhicule" },
  vehicles: { en: "vehicles", ar: "المركبات", fr: "véhicules" },
  status: { en: "status", ar: "الحالة", fr: "statut" },
  statuses: { en: "statuses", ar: "الحالات", fr: "statuts" },
  date: { en: "date", ar: "التاريخ", fr: "date" },
  dates: { en: "dates", ar: "التواريخ", fr: "dates" },
  batch: { en: "batch", ar: "الدفعة", fr: "lot" },
  batches: { en: "batches", ar: "الدفعات", fr: "lots" },
  payment: { en: "payment", ar: "الدفع", fr: "paiement" },
  payments: { en: "payments", ar: "المدفوعات", fr: "paiements" },
  receipt: { en: "receipt", ar: "الإيصال", fr: "encaissement" },
  receipts: { en: "receipts", ar: "الإيصالات", fr: "encaissements" },
  transaction: { en: "transaction", ar: "المعاملة", fr: "transaction" },
  transactions: { en: "transactions", ar: "المعاملات", fr: "transactions" },
  shop: { en: "shop", ar: "المحل", fr: "boutique" },
  shops: { en: "shops", ar: "المحلات", fr: "boutiques" },
  agent: { en: "agent", ar: "الوكيل", fr: "agent" },
  agents: { en: "agents", ar: "الوكلاء", fr: "agents" },
  notes: { en: "notes", ar: "الملاحظات", fr: "notes" },
  amount: { en: "amount", ar: "المبلغ", fr: "montant" },
  number: { en: "number", ar: "الرقم", fr: "numéro" },
};

function normalizeVisibleText(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/…/g, "...").toLocaleLowerCase("en");
}

const byVisibleText = new Map<string, Entry>();
for (const entry of entries) {
  byVisibleText.set(normalizeVisibleText(entry.en), entry);
  byVisibleText.set(normalizeVisibleText(entry.ar), entry);
  byVisibleText.set(normalizeVisibleText(entry.fr), entry);
}

function translateSearchCriteria(criteria: string, language: ApplicationLanguage): string | null {
  const parts = criteria
    .trim()
    .toLocaleLowerCase("en")
    .split(/(\s*,\s*|\s+or\s+|\s+and\s+|\s*\/\s*|\s*&\s*)/i)
    .filter(Boolean);

  const translated: string[] = [];
  for (const part of parts) {
    const normalized = part.trim().toLocaleLowerCase("en");
    if (!normalized) continue;
    if (normalized === ",") {
      translated.push(language === "ar" ? "، " : ", ");
      continue;
    }
    if (normalized === "or") {
      translated.push(language === "ar" ? " أو " : language === "fr" ? " ou " : " or ");
      continue;
    }
    if (normalized === "and" || normalized === "&") {
      translated.push(language === "ar" ? " و" : language === "fr" ? " et " : " and ");
      continue;
    }
    if (normalized === "/") {
      translated.push(" / ");
      continue;
    }

    const term = searchTerms[normalized];
    if (!term) return null;
    translated.push(term[language]);
  }

  return translated.join("");
}

function translateDynamicSearch(value: string, language: ApplicationLanguage): string | null {
  const normalized = value.trim().replace(/…/g, "...");
  const match = normalized.match(/^(search|find|filter)(?:\s+(by|for))?\s*(.*?)(\.\.\.)?$/i);
  if (!match) return null;

  const action = match[1].toLocaleLowerCase("en");
  const mode = match[2]?.toLocaleLowerCase("en");
  const criteria = match[3].trim();
  const ellipsis = match[4] ? "…" : "";

  if (!criteria) {
    if (language === "ar") return `بحث${ellipsis}`;
    if (language === "fr") return `Rechercher${ellipsis}`;
    return `Search${ellipsis}`;
  }

  const translatedCriteria = translateSearchCriteria(criteria, language);
  if (!translatedCriteria) return null;

  if (language === "ar") {
    const prefix = action === "filter" || mode === "by" ? "ابحث حسب " : "ابحث عن ";
    return `${prefix}${translatedCriteria}${ellipsis}`;
  }
  if (language === "fr") {
    const prefix = action === "filter" ? "Filtrer par " : mode === "by" ? "Rechercher par " : "Rechercher ";
    return `${prefix}${translatedCriteria}${ellipsis}`;
  }

  const prefix = action === "filter" ? "Filter by " : mode === "by" ? "Search by " : action === "find" ? "Find " : "Search ";
  return `${prefix}${criteria}${ellipsis}`;
}

export function translateTabsFiltersText(value: string, language: ApplicationLanguage): string | null {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const normalized = value.trim();
  if (!normalized) return null;

  const entry = byVisibleText.get(normalizeVisibleText(normalized));
  if (entry) return `${leading}${entry[language]}${trailing}`;

  const dynamicSearch = translateDynamicSearch(normalized, language);
  return dynamicSearch ? `${leading}${dynamicSearch}${trailing}` : null;
}
