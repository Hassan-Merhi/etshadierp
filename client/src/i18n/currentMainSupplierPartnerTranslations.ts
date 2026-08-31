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
    en: "Golden Coast sale was posted without a revenue voucher",
    ar: "تم ترحيل بيع Golden Coast دون سند إيرادات",
    fr: "La vente Golden Coast a été comptabilisée sans pièce de revenu",
  },
  {
    en: "POS is still loading",
    ar: "لا تزال نقطة البيع قيد التحميل",
    fr: "Le point de vente est encore en cours de chargement",
  },
  {
    en: "Please wait while the active Supplier Partner POS configuration is verified.",
    ar: "يرجى الانتظار ريثما يتم التحقق من إعدادات نقطة بيع شريك المورد النشطة.",
    fr: "Veuillez patienter pendant la vérification de la configuration active du point de vente Partenaire fournisseur.",
  },
  {
    en: "Golden Coast POS unavailable",
    ar: "نقطة بيع Golden Coast غير متاحة",
    fr: "Point de vente Golden Coast indisponible",
  },
  {
    en: "Sale request refreshed",
    ar: "تم تحديث طلب البيع",
    fr: "Demande de vente actualisée",
  },
  {
    en: "The previous sale request no longer matches these items. Please click Save again.",
    ar: "لم يعد طلب البيع السابق مطابقاً لهذه الأصناف. يرجى الضغط على حفظ مرة أخرى.",
    fr: "La demande de vente précédente ne correspond plus à ces articles. Veuillez cliquer de nouveau sur Enregistrer.",
  },
  {
    en: "Golden Coast POS is unavailable",
    ar: "نقطة بيع Golden Coast غير متاحة حالياً",
    fr: "Le point de vente Golden Coast est indisponible",
  },
  {
    en: "No parent company",
    ar: "لا توجد شركة أم",
    fr: "Aucune société mère",
  },
  {
    en: "Parent Company",
    ar: "الشركة الأم",
    fr: "Société mère",
  },
  {
    en: "For Golden Coast Supplier Partners, choose the active HADI parent company.",
    ar: "بالنسبة لشركاء المورد في Golden Coast، اختر شركة HADI الأم النشطة.",
    fr: "Pour les partenaires fournisseurs Golden Coast, choisissez la société mère HADI active.",
  },
  {
    en: "Daily Supplier Partner work, reporting, stock setup, aliases, and account configuration.",
    ar: "العمل اليومي لشريك المورد، والتقارير، وإعداد المخزون، والأسماء البديلة، وتهيئة الحسابات.",
    fr: "Travail quotidien du partenaire fournisseur, rapports, configuration du stock, alias et paramétrage des comptes.",
  },
  {
    en: "Profit & Loss and Sales Form export",
    ar: "تصدير قائمة الأرباح والخسائر ونموذج المبيعات",
    fr: "Export du compte de résultat et du formulaire de ventes",
  },
  {
    en: "Profit Split",
    ar: "تقسيم الأرباح",
    fr: "Partage des bénéfices",
  },
  {
    en: "Choose the report month and split it using the ledger-derived Golden Coast monthly close.",
    ar: "اختر شهر التقرير وقسّمه باستخدام الإقفال الشهري لـ Golden Coast المستمد من دفتر الأستاذ.",
    fr: "Choisissez le mois du rapport et répartissez-le à partir de la clôture mensuelle Golden Coast issue du grand livre.",
  },
  {
    en: "Supplier Partner Setup",
    ar: "إعداد شريك المورد",
    fr: "Configuration du partenaire fournisseur",
  },
  {
    en: "Configure and repair Supplier Partner accounts and links.",
    ar: "تهيئة وإصلاح حسابات شريك المورد وروابطها.",
    fr: "Configurez et réparez les comptes et liens du partenaire fournisseur.",
  },
  {
    en: "Carry-forward status is unavailable",
    ar: "حالة الترحيل غير متاحة",
    fr: "Le statut du report est indisponible",
  },
  {
    en: "Golden Coast account setup is not configured for this company",
    ar: "لم يتم تهيئة إعداد حسابات Golden Coast لهذه الشركة",
    fr: "La configuration des comptes Golden Coast n’est pas définie pour cette société",
  },
  {
    en: "Golden Coast existing position carry-forward — ${GOLDEN_COAST_CUTOVER_DATE}",
    ar: "ترحيل المركز القائم لـ Golden Coast — ${GOLDEN_COAST_CUTOVER_DATE}",
    fr: "Report de la position existante Golden Coast — ${GOLDEN_COAST_CUTOVER_DATE}",
  },
  {
    en: "Golden Coast current inventory cost lot from inventory #${row.inventoryId}",
    ar: "دفعة تكلفة المخزون الحالية لـ Golden Coast من المخزون رقم ${row.inventoryId}",
    fr: "Lot de coût du stock actuel Golden Coast issu du stock #${row.inventoryId}",
  },
  {
    en: "Golden Coast ${GOLDEN_COAST_CUTOVER_DATE} existing-position FIFO snapshot from ERP inventory #${inventoryId}",
    ar: "لقطة FIFO للمركز القائم لـ Golden Coast بتاريخ ${GOLDEN_COAST_CUTOVER_DATE} من مخزون ERP رقم ${inventoryId}",
    fr: "Instantané FIFO de la position existante Golden Coast au ${GOLDEN_COAST_CUTOVER_DATE} depuis le stock ERP #${inventoryId}",
  },
  {
    en: "Golden Coast POS edit requires a valid cash or bank payment account",
    ar: "يتطلب تعديل نقطة بيع Golden Coast حساب دفع نقدي أو بنكي صالح",
    fr: "La modification d’une vente Golden Coast nécessite un compte de paiement caisse ou banque valide",
  },
  {
    en: "Golden Coast POS payable reclassification",
    ar: "إعادة تصنيف ذمم نقطة بيع Golden Coast",
    fr: "Reclassement des dettes du point de vente Golden Coast",
  },
  {
    en: "Golden Coast POS cash transferred to HADI",
    ar: "تم تحويل نقدية نقطة بيع Golden Coast إلى HADI",
    fr: "Espèces du point de vente Golden Coast transférées à HADI",
  },
  {
    en: "Golden Coast POS cash received by HADI",
    ar: "تم استلام نقدية نقطة بيع Golden Coast من قبل HADI",
    fr: "Espèces du point de vente Golden Coast reçues par HADI",
  },
  {
    en: "Golden Coast POS settlement reversal ${marker.voucher.voucherNumber}",
    ar: "عكس تسوية نقطة بيع Golden Coast ${marker.voucher.voucherNumber}",
    fr: "Extourne du règlement du point de vente Golden Coast ${marker.voucher.voucherNumber}",
  },
  {
    en: '${label} must have account type ${accountTypes.join(" or ")}',
    ar: 'يجب أن يكون ${label} من نوع الحساب ${accountTypes.join(" or ")}',
    fr: '${label} doit avoir le type de compte ${accountTypes.join(" or ")}',
  },
  {
    en: "Payment bank account ${accountId} is not active in company ${companyId}",
    ar: "حساب الدفع البنكي ${accountId} غير نشط في الشركة ${companyId}",
    fr: "Le compte bancaire de paiement ${accountId} n’est pas actif dans la société ${companyId}",
  },
  {
    en: "Payment cash account ${accountId} is not active in company ${companyId}",
    ar: "حساب الدفع النقدي ${accountId} غير نشط في الشركة ${companyId}",
    fr: "Le compte de caisse de paiement ${accountId} n’est pas actif dans la société ${companyId}",
  },
  {
    en: 'HADI has no active Cash/Bank account named "${name}" to receive Golden Coast POS cash',
    ar: 'لا يوجد لدى HADI حساب نقدي/بنكي نشط باسم "${name}" لاستلام نقدية نقطة بيع Golden Coast',
    fr: 'HADI n’a aucun compte caisse/banque actif nommé "${name}" pour recevoir les espèces du point de vente Golden Coast',
  },
  {
    en: "HADI has no active location for the Golden Coast POS cash receipt",
    ar: "لا يوجد لدى HADI موقع نشط لسند قبض نقدية نقطة بيع Golden Coast",
    fr: "HADI n’a aucun emplacement actif pour l’encaissement du point de vente Golden Coast",
  },
  {
    en: "Golden Coast must have an active, distinct parent HADI company",
    ar: "يجب أن يكون لدى Golden Coast شركة HADI أم نشطة ومستقلة",
    fr: "Golden Coast doit avoir une société mère HADI active et distincte",
  },
  {
    en: "Golden Coast parent HADI company is missing or inactive",
    ar: "شركة HADI الأم لـ Golden Coast مفقودة أو غير نشطة",
    fr: "La société mère HADI de Golden Coast est absente ou inactive",
  },
  {
    en: "Golden Coast POS requires clientSaleId for settlement idempotency",
    ar: "تتطلب نقطة بيع Golden Coast clientSaleId لضمان عدم تكرار التسوية",
    fr: "Le point de vente Golden Coast exige clientSaleId pour l’idempotence du règlement",
  },
  {
    en: "Golden Coast POS settlement voucher ${item.voucherId} is missing",
    ar: "سند تسوية نقطة بيع Golden Coast ${item.voucherId} مفقود",
    fr: "La pièce de règlement du point de vente Golden Coast ${item.voucherId} est introuvable",
  },
] as const satisfies readonly Phase4SupplierPartnerEntry[];
