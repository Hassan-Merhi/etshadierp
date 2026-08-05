import type { ApplicationLanguage } from "@shared/applicationLanguageContract";
import type { Phase7BackendMessagesEntry } from "./backendMessagesPhase7TranslationTypes";

export const remoteSupportPhase5Translations: readonly Phase7BackendMessagesEntry[] = [
  { en: "Mouse control", ar: "التحكم بالماوس", fr: "Contrôle de la souris" },
  {
    en: "Safe viewing and navigation",
    ar: "عرض وتنقل آمنان",
    fr: "Consultation et navigation sécurisées",
  },
  {
    en: "Keyboard disabled",
    ar: "لوحة المفاتيح معطلة",
    fr: "Clavier désactivé",
  },
  { en: "Stop mouse", ar: "إيقاف الماوس", fr: "Arrêter la souris" },
  { en: "Enable", ar: "تفعيل", fr: "Activer" },
  {
    en: "Confirm your password to enable mouse control for up to 5 minutes.",
    ar: "أكد كلمة المرور لتفعيل التحكم بالماوس لمدة تصل إلى 5 دقائق.",
    fr: "Confirmez votre mot de passe pour activer le contrôle de la souris pendant 5 minutes maximum.",
  },
  { en: "Password", ar: "كلمة المرور", fr: "Mot de passe" },
  { en: "Confirm", ar: "تأكيد", fr: "Confirmer" },
  {
    en: "Active: click and scroll on allowlisted controls",
    ar: "نشط: النقر والتمرير على عناصر التحكم المسموح بها",
    fr: "Actif : clic et défilement sur les commandes autorisées",
  },
  {
    en: "Read-only until explicitly enabled",
    ar: "للقراءة فقط حتى يتم التفعيل صراحةً",
    fr: "Lecture seule jusqu’à activation explicite",
  },
  {
    en: "That control is protected and cannot be activated remotely.",
    ar: "عنصر التحكم هذا محمي ولا يمكن تفعيله عن بُعد.",
    fr: "Cette commande est protégée et ne peut pas être activée à distance.",
  },
  {
    en: "Unable to enable mouse control.",
    ar: "تعذر تفعيل التحكم بالماوس.",
    fr: "Impossible d’activer le contrôle de la souris.",
  },
  {
    en: "Password confirmation failed.",
    ar: "فشل تأكيد كلمة المرور.",
    fr: "La confirmation du mot de passe a échoué.",
  },
  {
    en: "Mouse command failed.",
    ar: "فشل أمر الماوس.",
    fr: "La commande de souris a échoué.",
  },
  {
    en: "Remote mouse request failed.",
    ar: "فشل طلب الماوس البعيد.",
    fr: "La requête de souris distante a échoué.",
  },
  {
    en: "Frame payload is too large.",
    ar: "حجم بيانات الإطار كبير جدًا.",
    fr: "La charge utile de la trame est trop volumineuse.",
  },
  {
    en: "Frame producer is sending too quickly.",
    ar: "يتم إرسال الإطارات بسرعة كبيرة.",
    fr: "Les trames sont envoyées trop rapidement.",
  },
  {
    en: "Invalid watched user ID.",
    ar: "معرّف المستخدم المُراقَب غير صالح.",
    fr: "L’identifiant de l’utilisateur surveillé n’est pas valide.",
  },
  { en: "Executed", ar: "تم التنفيذ", fr: "Exécutée" },
  { en: "Blocked", ar: "محظور", fr: "Bloquée" },
  { en: "Ignored", ar: "تم التجاهل", fr: "Ignorée" },
  {
    en: "This controller does not own the session.",
    ar: "وحدة التحكم هذه لا تملك الجلسة.",
    fr: "Ce contrôleur ne possède pas la session.",
  },
  {
    en: "Mouse control is disabled.",
    ar: "التحكم بالماوس معطل.",
    fr: "Le contrôle de la souris est désactivé.",
  },
  {
    en: "This command channel is not bound to this ERP tab.",
    ar: "قناة الأوامر هذه غير مرتبطة بعلامة تبويب ERP هذه.",
    fr: "Ce canal de commande n’est pas lié à cet onglet ERP.",
  },
  {
    en: "Mouse commands are being sent too quickly.",
    ar: "يتم إرسال أوامر الماوس بسرعة كبيرة.",
    fr: "Les commandes de souris sont envoyées trop rapidement.",
  },
  {
    en: "Confirm your password before enabling mouse control.",
    ar: "أكد كلمة المرور قبل تفعيل التحكم بالماوس.",
    fr: "Confirmez votre mot de passe avant d’activer le contrôle de la souris.",
  },
  {
    en: "Unsupported mouse command.",
    ar: "أمر ماوس غير مدعوم.",
    fr: "Commande de souris non prise en charge.",
  },
  {
    en: "Mouse coordinates must be normalized.",
    ar: "يجب أن تكون إحداثيات الماوس مطبّعة.",
    fr: "Les coordonnées de la souris doivent être normalisées.",
  },
  {
    en: "A bounded scroll delta is required.",
    ar: "يلزم مقدار تمرير ضمن الحدود.",
    fr: "Un delta de défilement limité est requis.",
  },
  {
    en: "The employee ERP tab is not ready to receive mouse commands.",
    ar: "علامة تبويب ERP الخاصة بالموظف غير جاهزة لاستقبال أوامر الماوس.",
    fr: "L’onglet ERP de l’employé n’est pas prêt à recevoir les commandes de souris.",
  },
  {
    en: "Mouse command not found.",
    ar: "لم يتم العثور على أمر الماوس.",
    fr: "Commande de souris introuvable.",
  },
  {
    en: "Unsupported mouse command result.",
    ar: "نتيجة أمر الماوس غير مدعومة.",
    fr: "Résultat de commande de souris non pris en charge.",
  },
  {
    en: "A support session and browser tab are required.",
    ar: "يلزم وجود جلسة دعم وعلامة تبويب متصفح.",
    fr: "Une session d’assistance et un onglet de navigateur sont requis.",
  },
];

const translationByText = new Map<string, Phase7BackendMessagesEntry>();
for (const entry of remoteSupportPhase5Translations) {
  translationByText.set(entry.en, entry);
  translationByText.set(entry.ar, entry);
  translationByText.set(entry.fr, entry);
}

export function translateRemoteSupportPhase5Text(value: string, language: ApplicationLanguage): string {
  return translationByText.get(value)?.[language] ?? value;
}
