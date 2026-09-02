import type { ApplicationLanguage } from "@shared/applicationLanguageContract";

const containerSyncButtonLabels: Record<ApplicationLanguage, string> = {
  en: "Repair / Sync Vouchers",
  ar: "إصلاح / مزامنة السندات",
  fr: "Réparer / synchroniser les pièces",
};

export function getContainerSyncButtonLabel(language: ApplicationLanguage): string {
  return containerSyncButtonLabels[language] ?? containerSyncButtonLabels.en;
}
