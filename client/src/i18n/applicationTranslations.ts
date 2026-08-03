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
  "language.changed": {
    en: "Application language changed to English.",
    ar: "تم تغيير لغة التطبيق إلى العربية.",
    fr: "La langue de l’application est maintenant le français.",
  },
  "accessibility.skipToMainContent": {
    en: "Skip to main content",
    ar: "الانتقال إلى المحتوى الرئيسي",
    fr: "Aller au contenu principal",
  },
  "accessibility.openSearch": {
    en: "Open search",
    ar: "فتح البحث",
    fr: "Ouvrir la recherche",
  },
  "accessibility.openWorkspaceControls": {
    en: "Open account and display controls",
    ar: "فتح عناصر التحكم بالحساب والعرض",
    fr: "Ouvrir les commandes du compte et de l’affichage",
  },
  "accessibility.toggleSidebar": {
    en: "Toggle Sidebar",
    ar: "فتح أو إغلاق شريط التنقل الجانبي",
    fr: "Afficher ou masquer la barre de navigation",
  },
  "accessibility.sidebar": {
    en: "Sidebar",
    ar: "شريط التنقل الجانبي",
    fr: "Barre de navigation",
  },
  "accessibility.sidebarDescription": {
    en: "Displays the mobile sidebar.",
    ar: "يعرض شريط التنقل الجانبي على الهاتف.",
    fr: "Affiche la barre de navigation sur mobile.",
  },
  "accessibility.closeDialog": {
    en: "Close dialog",
    ar: "إغلاق مربع الحوار",
    fr: "Fermer la boîte de dialogue",
  },
  "accessibility.closePanel": {
    en: "Close panel",
    ar: "إغلاق اللوحة",
    fr: "Fermer le panneau",
  },
  "workspace.controls": {
    en: "Workspace controls",
    ar: "عناصر تحكم مساحة العمل",
    fr: "Commandes de l’espace de travail",
  },
  "workspace.controlsDescription": {
    en: "Account, display, synchronization, language, and search controls.",
    ar: "عناصر تحكم الحساب والعرض والمزامنة واللغة والبحث.",
    fr: "Commandes du compte, de l’affichage, de la synchronisation, de la langue et de la recherche.",
  },
  "workspace.search": {
    en: "Search the workspace",
    ar: "البحث في مساحة العمل",
    fr: "Rechercher dans l’espace de travail",
  },
  "workspace.statusDisplay": {
    en: "Status and display",
    ar: "الحالة والعرض",
    fr: "État et affichage",
  },
  "workspace.pendingSync": {
    en: "Pending synchronization",
    ar: "المزامنة المعلّقة",
    fr: "Synchronisation en attente",
  },
  "workspace.theme": {
    en: "Theme",
    ar: "المظهر",
    fr: "Thème",
  },
  "workspace.accountLanguage": {
    en: "Account and language",
    ar: "الحساب واللغة",
    fr: "Compte et langue",
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

export function translateApplicationLiteral(value: string, language: ApplicationLanguage): string | null {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const normalized = value.trim();
  if (!normalized) return null;

  const entries = Object.values(applicationTranslations) as readonly Record<ApplicationLanguage, string>[];
  for (const entry of entries) {
    if (entry.en === normalized || entry.ar === normalized || entry.fr === normalized) {
      return `${leading}${entry[language]}${trailing}`;
    }
  }

  return null;
}
