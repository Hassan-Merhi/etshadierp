import type { ApplicationLanguage } from "@shared/applicationLanguageContract";
import type { Phase7BackendMessagesEntry } from "./backendMessagesPhase7TranslationTypes";

export const remoteSupportPhase5Translations: readonly Phase7BackendMessagesEntry[] = [
  { en: "Mouse control", ar: "التحكم بالماوس", fr: "Contrôle de la souris" },
  {
    en: "Safe viewing and navigation",
    ar: "عرض وتنقل آمنان",
    fr: "Consultation et navigation sécurisées",
  },
  { en: "Keyboard disabled", ar: "لوحة المفاتيح معطلة", fr: "Clavier désactivé" },
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
  { en: "Mouse command failed.", ar: "فشل أمر الماوس.", fr: "La commande de souris a échoué." },
  { en: "Executed", ar: "تم التنفيذ", fr: "Exécutée" },
  { en: "Blocked", ar: "محظور", fr: "Bloquée" },
  { en: "Ignored", ar: "تم التجاهل", fr: "Ignorée" },
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
