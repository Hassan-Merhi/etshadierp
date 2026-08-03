import type { Phase7BackendMessagesEntry } from "./backendMessagesPhase7TranslationTypes";

export const currentMainSupplierPartnerTranslations: readonly Phase7BackendMessagesEntry[] = [
  {
    en: "Explain why the full sale is being reversed…",
    ar: "اشرح سبب عكس عملية البيع بالكامل…",
    fr: "Expliquez pourquoi la vente complète est annulée…",
  },
  { en: "Loading sales…", ar: "جارٍ تحميل المبيعات…", fr: "Chargement des ventes…" },
  {
    en: "No Supplier Partner sales have been posted yet.",
    ar: "لم يتم تسجيل أي مبيعات للشريك المورّد حتى الآن.",
    fr: "Aucune vente du Partenaire Fournisseur n’a encore été enregistrée.",
  },
  { en: "Reverse", ar: "عكس", fr: "Annuler" },
  {
    en: "Recent Supplier Partner sales",
    ar: "مبيعات الشريك المورّد الأخيرة",
    fr: "Ventes récentes du Partenaire Fournisseur",
  },
  { en: "Required reason", ar: "السبب مطلوب", fr: "Motif obligatoire" },
  { en: "Keep sale", ar: "الاحتفاظ بالبيع", fr: "Conserver la vente" },
  { en: "Sale reversed", ar: "تم عكس البيع", fr: "Vente annulée" },
  {
    en: "Stock and accounting were restored together. Reversal voucher #${data.reversalVoucherId}.",
    ar: "تمت استعادة المخزون والمحاسبة معًا. سند العكس رقم #{0}.",
    fr: "Le stock et la comptabilité ont été restaurés ensemble. Pièce d’annulation n° {0}.",
  },
  { en: "Reversal failed", ar: "فشل العكس", fr: "Échec de l’annulation" },
  { en: "No sale selected", ar: "لم يتم تحديد عملية بيع", fr: "Aucune vente sélectionnée" },
  {
    en: "Missing Supplier Partner permission: ${permission}",
    ar: "إذن الشريك المورّد مفقود: {0}",
    fr: "Permission Partenaire Fournisseur manquante : {0}",
  },
  {
    en: "Type exactly: ${sensitive.confirmation}",
    ar: "اكتب بالضبط: {0}",
    fr: "Saisissez exactement : {0}",
  },
  {
    en: "A meaningful reason of at least 5 characters is required.",
    ar: "يلزم سبب واضح لا يقل عن 5 أحرف.",
    fr: "Un motif explicite d’au moins 5 caractères est requis.",
  },
  {
    en: "Idempotency-Key is required for this sensitive action.",
    ar: "مفتاح Idempotency-Key مطلوب لهذا الإجراء الحساس.",
    fr: "Une clé Idempotency-Key est requise pour cette action sensible.",
  },
  {
    en: "This sensitive request has already been submitted.",
    ar: "تم إرسال هذا الطلب الحساس مسبقًا.",
    fr: "Cette demande sensible a déjà été soumise.",
  },
  {
    en: "Invalid Supplier Partner container ID",
    ar: "معرّف حاوية الشريك المورّد غير صالح",
    fr: "Identifiant de conteneur Partenaire Fournisseur non valide",
  },
  {
    en: "Supplier Partner container not found",
    ar: "لم يتم العثور على حاوية الشريك المورّد",
    fr: "Conteneur Partenaire Fournisseur introuvable",
  },
  {
    en: "Only open Supplier Partner containers can be edited. Current status: ${container.status}.",
    ar: "يمكن تعديل حاويات الشريك المورّد المفتوحة فقط. الحالة الحالية: {0}.",
    fr: "Seuls les conteneurs Partenaire Fournisseur ouverts peuvent être modifiés. Statut actuel : {0}.",
  },
  {
    en: "Invalid Supplier Partner sale ID",
    ar: "معرّف بيع الشريك المورّد غير صالح",
    fr: "Identifiant de vente Partenaire Fournisseur non valide",
  },
  {
    en: "Supplier Partner sale reversal #${saleId} — ${reason}",
    ar: "عكس بيع الشريك المورّد رقم #{0} — {1}",
    fr: "Annulation de la vente Partenaire Fournisseur n° {0} — {1}",
  },
  {
    en: "Supplier Partner container cancellation #${containerId} — ${reason}",
    ar: "إلغاء حاوية الشريك المورّد رقم #{0} — {1}",
    fr: "Annulation du conteneur Partenaire Fournisseur n° {0} — {1}",
  },
  {
    en: "Unknown Supplier Partner permission",
    ar: "إذن شريك مورّد غير معروف",
    fr: "Permission Partenaire Fournisseur inconnue",
  },
  {
    en: "Type exactly: CHANGE SP PERMISSION",
    ar: "اكتب بالضبط: CHANGE SP PERMISSION",
    fr: "Saisissez exactement : CHANGE SP PERMISSION",
  },
  {
    en: "A meaningful reason is required.",
    ar: "يلزم سبب واضح.",
    fr: "Un motif explicite est requis.",
  },
  {
    en: "Supplier Partner is USD-only for this release. Expected ${SP_RELEASE_CURRENCY} at exchange rate 1.",
    ar: "يقتصر الشريك المورّد على الدولار الأمريكي في هذا الإصدار. المتوقع {0} بسعر صرف 1.",
    fr: "Le Partenaire Fournisseur est limité au dollar américain pour cette version. Valeur attendue : {0} au taux de change 1.",
  },
  {
    en: "Search by invoice, container, supplier…",
    ar: "ابحث بالفاتورة أو الحاوية أو المورّد…",
    fr: "Rechercher par facture, conteneur ou fournisseur…",
  },
  {
    en: "Explain why the open container is being cancelled…",
    ar: "اشرح سبب إلغاء الحاوية المفتوحة…",
    fr: "Expliquez pourquoi le conteneur ouvert est annulé…",
  },
  { en: "Total (USD)", ar: "الإجمالي (دولار أمريكي)", fr: "Total (USD)" },
  {
    en: "Cancel Supplier Partner container",
    ar: "إلغاء حاوية الشريك المورّد",
    fr: "Annuler le conteneur Partenaire Fournisseur",
  },
  { en: "Keep container", ar: "الاحتفاظ بالحاوية", fr: "Conserver le conteneur" },
  { en: "Container cancelled", ar: "تم إلغاء الحاوية", fr: "Conteneur annulé" },
  { en: "Cancellation failed", ar: "فشل الإلغاء", fr: "Échec de l’annulation" },
  { en: "No container selected", ar: "لم يتم تحديد حاوية", fr: "Aucun conteneur sélectionné" },
];
