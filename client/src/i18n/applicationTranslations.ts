import type { ApplicationLanguage } from "@shared/applicationLanguageContract";

export const applicationTranslations = {
  "language.label": {
    en: "Language",
    ar: "اللغة",
    fr: "Langue",
  },
  "language.english": {
    en: "English",
    ar: "الإنجليزية",
    fr: "Anglais",
  },
  "language.arabic": {
    en: "Arabic",
    ar: "العربية",
    fr: "Arabe",
  },
  "language.french": {
    en: "French",
    ar: "الفرنسية",
    fr: "Français",
  },
  "language.saving": {
    en: "Saving language…",
    ar: "جارٍ حفظ اللغة…",
    fr: "Enregistrement de la langue…",
  },
  "language.saveFailed": {
    en: "The language changed on this device, but the account preference could not be saved.",
    ar: "تم تغيير اللغة على هذا الجهاز، لكن تعذر حفظ تفضيل الحساب.",
    fr: "La langue a été modifiée sur cet appareil, mais la préférence du compte n’a pas pu être enregistrée.",
  },
  "user.menu": {
    en: "Account menu",
    ar: "قائمة الحساب",
    fr: "Menu du compte",
  },
  "common.logout": {
    en: "Log out",
    ar: "تسجيل الخروج",
    fr: "Se déconnecter",
  },
  "common.refresh": {
    en: "Refresh",
    ar: "تحديث",
    fr: "Actualiser",
  },
  "common.updateAvailable": {
    en: "Update available",
    ar: "يتوفر تحديث",
    fr: "Mise à jour disponible",
  },
  "common.updateDescription": {
    en: "A new version of the app is ready.",
    ar: "نسخة جديدة من التطبيق جاهزة.",
    fr: "Une nouvelle version de l’application est prête.",
  },
} as const satisfies Record<string, Record<ApplicationLanguage, string>>;

export type ApplicationTranslationKey = keyof typeof applicationTranslations;

export function translateApplicationText(key: ApplicationTranslationKey, language: ApplicationLanguage): string {
  const entry = applicationTranslations[key];
  return entry[language] || entry.en || key;
}
