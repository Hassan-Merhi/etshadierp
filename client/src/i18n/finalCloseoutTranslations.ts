import type { ApplicationLanguage } from "@shared/applicationLanguageContract";

const FINAL_CLOSEOUT_TRANSLATIONS: Record<string, { ar: string; fr: string }> = {
  "Enter new name": { ar: "أدخل الاسم الجديد", fr: "Saisir le nouveau nom" },
  "Search groups...": { ar: "ابحث عن المجموعات...", fr: "Rechercher des groupes..." },
  "Rename Location": { ar: "إعادة تسمية الموقع", fr: "Renommer l’emplacement" },
  "Location Name": { ar: "اسم الموقع", fr: "Nom de l’emplacement" },
  "Supplier Partner Deduction (per BL)": {
    ar: "خصم شريك المورد (لكل BL)",
    fr: "Déduction partenaire fournisseur (par BL)",
  },
  "Archive Stock Group": { ar: "أرشفة مجموعة المخزون", fr: "Archiver le groupe de stock" },
  "Location WhatsApp Stock Reports": {
    ar: "تقارير مخزون الموقع عبر واتساب",
    fr: "Rapports de stock du site via WhatsApp",
  },
  "WhatsApp Group": { ar: "مجموعة واتساب", fr: "Groupe WhatsApp" },
  "WhatsApp groups could not be loaded": {
    ar: "تعذر تحميل مجموعات واتساب",
    fr: "Impossible de charger les groupes WhatsApp",
  },
  "No WhatsApp groups found": { ar: "لم يتم العثور على مجموعات واتساب", fr: "Aucun groupe WhatsApp trouvé" },
  "Linked destination": { ar: "الوجهة المرتبطة", fr: "Destination liée" },
  "Enable stock reports": { ar: "تفعيل تقارير المخزون", fr: "Activer les rapports de stock" },
  "Amount automatically deducted from SP payables for this location.": {
    ar: "المبلغ المخصوم تلقائيًا من مستحقات شريك المورد لهذا الموقع.",
    fr: "Montant déduit automatiquement des dettes du partenaire fournisseur pour cet emplacement.",
  },
  "Only groups from the connected WhatsApp account are shown. Individual contacts cannot be selected.": {
    ar: "يتم عرض المجموعات من حساب واتساب المتصل فقط. لا يمكن اختيار جهات اتصال فردية.",
    fr: "Seuls les groupes du compte WhatsApp connecté sont affichés. Les contacts individuels ne peuvent pas être sélectionnés.",
  },
  Unlink: { ar: "إلغاء الربط", fr: "Dissocier" },
  "No WhatsApp group is linked to this location.": {
    ar: "لا توجد مجموعة واتساب مرتبطة بهذا الموقع.",
    fr: "Aucun groupe WhatsApp n’est lié à cet emplacement.",
  },
  "Allows this linked group to be used by the Location Inventory stock-report feature.": {
    ar: "يسمح باستخدام هذه المجموعة المرتبطة في ميزة تقارير مخزون الموقع.",
    fr: "Permet d’utiliser ce groupe lié pour la fonction de rapport de stock de l’inventaire par emplacement.",
  },
  "Send WITHOUT COST": { ar: "إرسال بدون تكلفة", fr: "Envoyer SANS COÛT" },
  "Quantity-only Godown Summary PDF": {
    ar: "ملف PDF لملخص المستودع بالكميات فقط",
    fr: "PDF du résumé de dépôt, quantités uniquement",
  },
  "Send WITH COST": { ar: "إرسال مع التكلفة", fr: "Envoyer AVEC COÛT" },
  "Negative Stock": { ar: "مخزون سالب", fr: "Stock négatif" },
  "Cost report restricted": { ar: "تقرير التكلفة مقيّد", fr: "Rapport de coût restreint" },
  "Your role does not have permission to send cost price and total inventory value.": {
    ar: "دورك لا يملك صلاحية إرسال سعر التكلفة وإجمالي قيمة المخزون.",
    fr: "Votre rôle n’autorise pas l’envoi du prix de revient et de la valeur totale du stock.",
  },
  "WhatsApp send failed": { ar: "فشل الإرسال عبر واتساب", fr: "Échec de l’envoi WhatsApp" },
  "WhatsApp Stock Delivery History": { ar: "سجل إرسال مخزون واتساب", fr: "Historique d’envoi du stock WhatsApp" },
  "Loading delivery history…": { ar: "جارٍ تحميل سجل الإرسال…", fr: "Chargement de l’historique d’envoi…" },
  "Could not load delivery history.": {
    ar: "تعذر تحميل سجل الإرسال.",
    fr: "Impossible de charger l’historique d’envoi.",
  },
  "Last successful send": { ar: "آخر إرسال ناجح", fr: "Dernier envoi réussi" },
  "Latest attempt": { ar: "آخر محاولة", fr: "Dernière tentative" },
  "Destination:": { ar: "الوجهة:", fr: "Destination :" },
  "User:": { ar: "المستخدم:", fr: "Utilisateur :" },
  "Generated:": { ar: "تم الإنشاء:", fr: "Généré :" },
  "Items:": { ar: "الأصناف:", fr: "Articles :" },
  "Pages:": { ar: "الصفحات:", fr: "Pages :" },
  "Completed:": { ar: "اكتمل:", fr: "Terminé :" },
  "Scheduled day:": { ar: "اليوم المجدول:", fr: "Jour planifié :" },
  "Stock group:": { ar: "مجموعة المخزون:", fr: "Groupe de stock :" },
  "Category:": { ar: "الفئة:", fr: "Catégorie :" },
  "Report file:": { ar: "ملف التقرير:", fr: "Fichier du rapport :" },
  "Retry loading": { ar: "إعادة محاولة التحميل", fr: "Réessayer le chargement" },
  "No WhatsApp stock reports have been attempted for this location yet.": {
    ar: "لم تتم محاولة إرسال أي تقارير مخزون عبر واتساب لهذا الموقع بعد.",
    fr: "Aucun rapport de stock WhatsApp n’a encore été tenté pour cet emplacement.",
  },
  Sent: { ar: "تم الإرسال", fr: "Envoyé" },
  "No matching stock": { ar: "لا يوجد مخزون مطابق", fr: "Aucun stock correspondant" },
  Sending: { ar: "جارٍ الإرسال", fr: "Envoi en cours" },
  "Retry failed": { ar: "فشلت إعادة المحاولة", fr: "Échec de la nouvelle tentative" },
  "Cost-price and total-value permission is required to retry this report.": {
    ar: "يلزم إذن سعر التكلفة والقيمة الإجمالية لإعادة محاولة هذا التقرير.",
    fr: "L’autorisation du prix de revient et de la valeur totale est requise pour réessayer ce rapport.",
  },
  "Unknown error": { ar: "خطأ غير معروف", fr: "Erreur inconnue" },
  "No attempts yet": { ar: "لا توجد محاولات بعد", fr: "Aucune tentative pour le moment" },
  "Africa/Lubumbashi": { ar: "Africa/Lubumbashi", fr: "Africa/Lubumbashi" },
  "All stock groups": { ar: "جميع مجموعات المخزون", fr: "Tous les groupes de stock" },
  "All categories": { ar: "جميع الفئات", fr: "Toutes les catégories" },
  Schedule: { ar: "الجدولة", fr: "Planification" },
  "to its linked WhatsApp group.": { ar: "إلى مجموعة واتساب المرتبطة به.", fr: "vers son groupe WhatsApp lié." },
  "Loading schedule…": { ar: "جارٍ تحميل الجدولة…", fr: "Chargement de la planification…" },
  "WhatsApp destination": { ar: "وجهة واتساب", fr: "Destination WhatsApp" },
  "Next automatic send": { ar: "الإرسال التلقائي التالي", fr: "Prochain envoi automatique" },
  "Last attempt": { ar: "آخر محاولة", fr: "Dernière tentative" },
  "Last successful auto-send": { ar: "آخر إرسال تلقائي ناجح", fr: "Dernier envoi automatique réussi" },
  "Last automatic send error:": { ar: "خطأ آخر إرسال تلقائي:", fr: "Erreur du dernier envoi automatique :" },
  "Automatic sending": { ar: "الإرسال التلقائي", fr: "Envoi automatique" },
  Frequency: { ar: "التكرار", fr: "Fréquence" },
  "Every day": { ar: "كل يوم", fr: "Tous les jours" },
  "Selected days": { ar: "أيام محددة", fr: "Jours sélectionnés" },
  "Send time": { ar: "وقت الإرسال", fr: "Heure d’envoi" },
  Days: { ar: "الأيام", fr: "Jours" },
  Timezone: { ar: "المنطقة الزمنية", fr: "Fuseau horaire" },
  "Use an IANA timezone such as Africa/Lubumbashi.": {
    ar: "استخدم منطقة زمنية IANA مثل Africa/Lubumbashi.",
    fr: "Utilisez un fuseau horaire IANA tel que Africa/Lubumbashi.",
  },
  "WITHOUT COST": { ar: "بدون تكلفة", fr: "SANS COÛT" },
  "Include zero stock": { ar: "تضمين المخزون الصفري", fr: "Inclure le stock nul" },
  "Add items whose current quantity is zero.": {
    ar: "أضف الأصناف التي كميتها الحالية صفر.",
    fr: "Ajouter les articles dont la quantité actuelle est nulle.",
  },
  "Include negative stock": { ar: "تضمين المخزون السالب", fr: "Inclure le stock négatif" },
  "Include negative quantities in the PDF.": {
    ar: "تضمين الكميات السالبة في ملف PDF.",
    fr: "Inclure les quantités négatives dans le PDF.",
  },
  "Stock group filter": { ar: "تصفية مجموعة المخزون", fr: "Filtre du groupe de stock" },
  "Category filter": { ar: "تصفية الفئة", fr: "Filtre de catégorie" },
  "Active schedule:": { ar: "الجدولة النشطة:", fr: "Planification active :" },
  "Generate from live inventory when the scheduled time arrives.": {
    ar: "أنشئ التقرير من المخزون المباشر عند حلول الوقت المجدول.",
    fr: "Générer à partir du stock en temps réel à l’heure planifiée.",
  },
  Mon: { ar: "الاثنين", fr: "Lun" },
  Tue: { ar: "الثلاثاء", fr: "Mar" },
  Wed: { ar: "الأربعاء", fr: "Mer" },
  Thu: { ar: "الخميس", fr: "Jeu" },
  Fri: { ar: "الجمعة", fr: "Ven" },
  Sat: { ar: "السبت", fr: "Sam" },
  Sun: { ar: "الأحد", fr: "Dim" },
  "Could not load this schedule.": { ar: "تعذر تحميل هذه الجدولة.", fr: "Impossible de charger cette planification." },
  "Failed to load stock groups": { ar: "فشل تحميل مجموعات المخزون", fr: "Échec du chargement des groupes de stock" },
  "Failed to load stock categories": {
    ar: "فشل تحميل فئات المخزون",
    fr: "Échec du chargement des catégories de stock",
  },
  "Scan or type bale code...": { ar: "امسح أو اكتب رمز البالة...", fr: "Scannez ou saisissez le code de la balle..." },
  "Charge name...": { ar: "اسم التكلفة...", fr: "Nom des frais..." },
  "No bales scanned yet": { ar: "لم يتم مسح أي بالات بعد", fr: "Aucune balle scannée pour le moment" },
  Freight: { ar: "الشحن", fr: "Fret" },
  Other: { ar: "أخرى", fr: "Autre" },
  "Invalid audit log id": { ar: "معرّف سجل التدقيق غير صالح", fr: "Identifiant du journal d’audit invalide" },
  "Audit log entry not found": {
    ar: "لم يتم العثور على إدخال سجل التدقيق",
    fr: "Entrée du journal d’audit introuvable",
  },
};

export function releaseDebtEnglish<T extends string>(value: T): T {
  return value;
}

export function isFinalCloseoutText(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(FINAL_CLOSEOUT_TRANSLATIONS, value.trim());
}

export function translateFinalCloseoutText(value: string, language: ApplicationLanguage): string | null {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const normalized = value.trim();
  const entry = FINAL_CLOSEOUT_TRANSLATIONS[normalized];
  if (!entry) return null;
  const translated = language === "en" ? normalized : entry[language];
  return `${leading}${translated}${trailing}`;
}
