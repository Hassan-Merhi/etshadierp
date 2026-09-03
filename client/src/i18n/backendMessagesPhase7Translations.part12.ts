import type { Phase7BackendMessagesEntry } from "./backendMessagesPhase7TranslationTypes";

/** Tenant-scope and parent-accounting messages added after the Phase 7 inventory. */
export const backendMessagesPhase7TranslationsPart12: readonly Phase7BackendMessagesEntry[] =
  [
    {
      en: "PO Import company scope does not match the active company.",
      ar: "نطاق شركة استيراد أمر الشراء لا يطابق الشركة النشطة.",
      fr: "Le périmètre de société de l’import du bon de commande ne correspond pas à la société active.",
    },
    {
      en: "Upload company scope does not match the active company.",
      ar: "نطاق شركة الرفع لا يطابق الشركة النشطة.",
      fr: "Le périmètre de société du téléversement ne correspond pas à la société active.",
    },
    {
      en: "The selected parent freight account does not belong to the linked parent company",
      ar: "حساب الشحن الخاص بالشركة الأم المحدد لا ينتمي إلى الشركة الأم المرتبطة",
      fr: "Le compte de fret de la société mère sélectionné n’appartient pas à la société mère liée",
    },
    {
      en: "Configured intercompany credit account ${configuredAccountId} is missing, inactive, or belongs to another company",
      ar: "حساب الائتمان بين الشركات المُكوّن ${configuredAccountId} مفقود أو غير نشط أو ينتمي إلى شركة أخرى",
      fr: "Le compte de crédit intersociétés configuré ${configuredAccountId} est introuvable, inactif ou appartient à une autre société",
    },
  ];
