import type { Phase7BackendMessagesEntry } from "./backendMessagesPhase7TranslationTypes";

export const backendMessagesPhase7TranslationsPart9: readonly Phase7BackendMessagesEntry[] = [
  {
    en: "start",
    ar: "البداية",
    fr: "début",
  },
  {
    en: "today",
    ar: "اليوم",
    fr: "aujourd’hui",
  },
  {
    en: "(full history)",
    ar: "(السجل الكامل)",
    fr: "(historique complet)",
  },
  {
    en: '(${fromDate || "start"} → ${toDate || "today"})',
    ar: "({0} → {1})",
    fr: "({0} → {1})",
  },
  {
    en: "(${skipped.length} skipped)",
    ar: "(تم تخطي {0})",
    fr: "({0} ignorée(s))",
  },
];
