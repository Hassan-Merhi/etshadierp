import type { Phase3SharedUiEntry } from "./sharedUiPhase3TranslationTypes";

export const phase3RemainingTranslationsPart24: readonly Phase3SharedUiEntry[] = [
  { en: "Clear categories", ar: "مسح الفئات", fr: "Effacer les catégories" },
  { en: "Clear suppliers", ar: "مسح الموردين", fr: "Effacer les fournisseurs" },
  { en: "Offloaded date", ar: "تاريخ التفريغ", fr: "Date de déchargement" },
  {
    en: "NVM — Finalize Only",
    ar: "لا يهم — إنهاء فقط",
    fr: "Peu importe — finaliser uniquement",
  },
  { en: "Your locations", ar: "مواقعك", fr: "Vos emplacements" },
  { en: "Inventory location", ar: "موقع المخزون", fr: "Emplacement du stock" },
  { en: "Open inventory", ar: "فتح المخزون", fr: "Ouvrir le stock" },
  {
    en: "Access denied: Supplier belongs to a different company",
    ar: "تم رفض الوصول: المورد تابع لشركة أخرى",
    fr: "Accès refusé : le fournisseur appartient à une autre société",
  },
  {
    en: "Freight ledger account must belong to the purchase order company",
    ar: "يجب أن ينتمي حساب دفتر الشحن إلى شركة أمر الشراء",
    fr: "Le compte de fret doit appartenir à la société du bon de commande",
  },
  {
    en: "Customer ledger account must belong to the customer company",
    ar: "يجب أن ينتمي حساب دفتر العميل إلى شركة العميل",
    fr: "Le compte client doit appartenir à la société du client",
  },
  {
    en: "Access denied: Customer belongs to a different company",
    ar: "تم رفض الوصول: العميل تابع لشركة أخرى",
    fr: "Accès refusé : le client appartient à une autre société",
  },
  {
    en: "Continuation loading created from order #${orderId}",
    ar: "تم إنشاء تحميل متابعة من الطلب رقم {{0}}",
    fr: "Chargement de continuation créé depuis la commande n°{{0}}",
  },
  {
    en: "Linked ledger account must belong to the customer company",
    ar: "يجب أن ينتمي حساب دفتر الأستاذ المرتبط إلى شركة العميل",
    fr: "Le compte lié doit appartenir à la société du client",
  },
  {
    en: 'Supplier payment: ${spSupplier?.name || "Unknown"} – ${parseFloat(payment.amount).toFixed(2)} ${payment.currencyCode}',
    ar: 'دفعة المورد: ${spSupplier?.name || "غير معروف"} – ${parseFloat(payment.amount).toFixed(2)} ${payment.currencyCode}',
    fr: 'Paiement fournisseur : ${spSupplier?.name || "Inconnu"} – ${parseFloat(payment.amount).toFixed(2)} ${payment.currencyCode}',
  },
  {
    en: "Access denied: Ledger account belongs to a different company",
    ar: "تم رفض الوصول: حساب دفتر الأستاذ تابع لشركة أخرى",
    fr: "Accès refusé : le compte appartient à une autre société",
  },
  {
    en: "Access denied: Mix batch belongs to a different company",
    ar: "تم رفض الوصول: دفعة الخلط تابعة لشركة أخرى",
    fr: "Accès refusé : le lot de mélange appartient à une autre société",
  },
];
