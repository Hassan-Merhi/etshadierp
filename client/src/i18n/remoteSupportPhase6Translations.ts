import type { ApplicationLanguage } from "@shared/applicationLanguageContract";
import type { Phase7BackendMessagesEntry } from "./backendMessagesPhase7TranslationTypes";

export const remoteSupportPhase6Translations: readonly Phase7BackendMessagesEntry[] = [
  { en: "Keyboard control", ar: "التحكم بلوحة المفاتيح", fr: "Contrôle du clavier" },
  { en: "Stop keyboard", ar: "إيقاف لوحة المفاتيح", fr: "Arrêter le clavier" },
  { en: "Enable keyboard", ar: "تفعيل لوحة المفاتيح", fr: "Activer le clavier" },
  { en: "Mouse control required", ar: "يلزم تفعيل الماوس", fr: "Le contrôle de la souris est requis" },
  {
    en: "Confirm your password to enable keyboard control for up to 5 minutes.",
    ar: "أكد كلمة المرور لتفعيل التحكم بلوحة المفاتيح لمدة تصل إلى 5 دقائق.",
    fr: "Confirmez votre mot de passe pour activer le contrôle du clavier pendant 5 minutes maximum.",
  },
  {
    en: "Click a safe field in the watched screen, then type here.",
    ar: "انقر على حقل آمن في الشاشة المشاهدة، ثم اكتب هنا.",
    fr: "Cliquez sur un champ sûr dans l’écran observé, puis saisissez ici.",
  },
  { en: "Type remote text here", ar: "اكتب النص البعيد هنا", fr: "Saisissez le texte distant ici" },
  {
    en: "Only safe search, filter and explicitly approved fields can be edited.",
    ar: "يمكن تعديل حقول البحث والتصفية والحقول المعتمدة صراحةً فقط.",
    fr: "Seuls les champs sûrs de recherche, de filtre et explicitement approuvés peuvent être modifiés.",
  },
  {
    en: "Clipboard shortcuts and paste are blocked.",
    ar: "اختصارات الحافظة واللصق محظورة.",
    fr: "Les raccourcis du presse-papiers et le collage sont bloqués.",
  },
  {
    en: "That field is protected and cannot be edited remotely.",
    ar: "هذا الحقل محمي ولا يمكن تعديله عن بُعد.",
    fr: "Ce champ est protégé et ne peut pas être modifié à distance.",
  },
  {
    en: "Unable to enable keyboard control.",
    ar: "تعذر تفعيل التحكم بلوحة المفاتيح.",
    fr: "Impossible d’activer le contrôle du clavier.",
  },
  {
    en: "Keyboard command failed.",
    ar: "فشل أمر لوحة المفاتيح.",
    fr: "La commande clavier a échoué.",
  },
  {
    en: "Keyboard control is disabled.",
    ar: "التحكم بلوحة المفاتيح معطل.",
    fr: "Le contrôle du clavier est désactivé.",
  },
  {
    en: "Enable mouse control before keyboard control.",
    ar: "فعّل التحكم بالماوس قبل التحكم بلوحة المفاتيح.",
    fr: "Activez le contrôle de la souris avant le contrôle du clavier.",
  },
  {
    en: "This keyboard channel is not bound to this ERP tab.",
    ar: "قناة لوحة المفاتيح هذه غير مرتبطة بعلامة تبويب ERP هذه.",
    fr: "Ce canal clavier n’est pas lié à cet onglet ERP.",
  },
  {
    en: "Keyboard commands are being sent too quickly.",
    ar: "يتم إرسال أوامر لوحة المفاتيح بسرعة كبيرة.",
    fr: "Les commandes clavier sont envoyées trop rapidement.",
  },
  {
    en: "Confirm your password before enabling keyboard control.",
    ar: "أكد كلمة المرور قبل تفعيل التحكم بلوحة المفاتيح.",
    fr: "Confirmez votre mot de passe avant d’activer le contrôle du clavier.",
  },
  {
    en: "Unsupported keyboard command.",
    ar: "أمر لوحة مفاتيح غير مدعوم.",
    fr: "Commande clavier non prise en charge.",
  },
  {
    en: "Keyboard text is invalid or too long.",
    ar: "نص لوحة المفاتيح غير صالح أو طويل جدًا.",
    fr: "Le texte clavier est invalide ou trop long.",
  },
  {
    en: "This keyboard key is not allowed.",
    ar: "مفتاح لوحة المفاتيح هذا غير مسموح.",
    fr: "Cette touche du clavier n’est pas autorisée.",
  },
  {
    en: "The employee ERP tab is not ready to receive keyboard commands.",
    ar: "علامة تبويب ERP الخاصة بالموظف غير جاهزة لاستقبال أوامر لوحة المفاتيح.",
    fr: "L’onglet ERP de l’employé n’est pas prêt à recevoir les commandes clavier.",
  },
  {
    en: "Keyboard command not found.",
    ar: "لم يتم العثور على أمر لوحة المفاتيح.",
    fr: "Commande clavier introuvable.",
  },
  {
    en: "Unsupported keyboard command result.",
    ar: "نتيجة أمر لوحة المفاتيح غير مدعومة.",
    fr: "Résultat de commande clavier non pris en charge.",
  },
  { en: "Mouse active", ar: "الماوس نشط", fr: "Souris active" },
  { en: "Keyboard active", ar: "لوحة المفاتيح نشطة", fr: "Clavier actif" },
  { en: "Mouse and keyboard active", ar: "الماوس ولوحة المفاتيح نشطان", fr: "Souris et clavier actifs" },
];

const translationByText = new Map<string, Phase7BackendMessagesEntry>();
for (const entry of remoteSupportPhase6Translations) {
  translationByText.set(entry.en, entry);
  translationByText.set(entry.ar, entry);
  translationByText.set(entry.fr, entry);
}

export function translateRemoteSupportPhase6Text(value: string, language: ApplicationLanguage): string {
  return translationByText.get(value)?.[language] ?? value;
}
