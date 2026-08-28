import type { ApplicationLanguage } from "@shared/applicationLanguageContract";

type Translation = Record<ApplicationLanguage, string>;

const translations: Record<string, Translation> = {
  "This permanently deletes accounting history": {
    en: "This permanently deletes accounting history",
    ar: "هذا يحذف سجل المحاسبة نهائيًا",
    fr: "Cette action supprime définitivement l’historique comptable",
  },
  "to continue": { en: "to continue", ar: "للمتابعة", fr: "pour continuer" },
  "Insurance records cleared": {
    en: "Insurance records cleared",
    ar: "تم مسح سجلات التأمين",
    fr: "Enregistrements d’assurance effacés",
  },
  "${result.membersDeleted} member(s), ${result.vouchersDeleted} voucher(s), and ${result.ledgerAccountsArchived} Insurance account(s) removed.":
    {
      en: "${result.membersDeleted} member(s), ${result.vouchersDeleted} voucher(s), and ${result.ledgerAccountsArchived} Insurance account(s) removed.",
      ar: "تمت إزالة ${result.membersDeleted} عضو (أعضاء)، و${result.vouchersDeleted} سند (سندات)، و${result.ledgerAccountsArchived} حساب تأمين.",
      fr: "${result.membersDeleted} membre(s), ${result.vouchersDeleted} pièce(s) et ${result.ledgerAccountsArchived} compte(s) d’assurance supprimés.",
    },
  "Workbook format": { en: "Workbook format", ar: "تنسيق المصنف", fr: "Format du classeur" },
  "Optional columns: Start Date, Insurance Number, Nationality, Position, Date of Birth, Notes.": {
    en: "Optional columns: Start Date, Insurance Number, Nationality, Position, Date of Birth, Notes.",
    ar: "أعمدة اختيارية: تاريخ البدء، رقم التأمين، الجنسية، الوظيفة، تاريخ الميلاد، ملاحظات.",
    fr: "Colonnes facultatives : Date de début, Numéro d’assurance, Nationalité, Poste, Date de naissance, Notes.",
  },
  "Existing names are updated without replacing their saved personal details.": {
    en: "Existing names are updated without replacing their saved personal details.",
    ar: "يتم تحديث الأسماء الموجودة دون استبدال بياناتها الشخصية المحفوظة.",
    fr: "Les noms existants sont mis à jour sans remplacer leurs informations personnelles enregistrées.",
  },
  "Recognized months": { en: "Recognized months", ar: "الأشهر المتعرف عليها", fr: "Mois reconnus" },
  "Workbook errors": { en: "Workbook errors", ar: "أخطاء المصنف", fr: "Erreurs du classeur" },
  Warnings: { en: "Warnings", ar: "تحذيرات", fr: "Avertissements" },
  "Ready to import": { en: "Ready to import", ar: "جاهز للاستيراد", fr: "Prêt à importer" },
  "Workbook year": { en: "Workbook year", ar: "سنة المصنف", fr: "Année du classeur" },
  "The workbook is valid. Importing saves each amount for its worksheet month.": {
    en: "The workbook is valid. Importing saves each amount for its worksheet month.",
    ar: "المصنف صالح. الاستيراد يحفظ كل مبلغ للشهر الخاص بورقة العمل.",
    fr: "Le classeur est valide. L’importation enregistre chaque montant pour le mois de sa feuille.",
  },
  "Insurance workbook imported": {
    en: "Insurance workbook imported",
    ar: "تم استيراد مصنف التأمين",
    fr: "Classeur d’assurance importé",
  },
  "${result.createdMembers} member(s) created, ${result.updatedMembers} updated, ${result.monthlyAmountsUpserted} monthly amount(s) saved.":
    {
      en: "${result.createdMembers} member(s) created, ${result.updatedMembers} updated, ${result.monthlyAmountsUpserted} monthly amount(s) saved.",
      ar: "تم إنشاء ${result.createdMembers} عضو (أعضاء)، وتحديث ${result.updatedMembers}، وحفظ ${result.monthlyAmountsUpserted} مبلغ شهري.",
      fr: "${result.createdMembers} membre(s) créé(s), ${result.updatedMembers} mis à jour, ${result.monthlyAmountsUpserted} montant(s) mensuel(s) enregistré(s).",
    },
  "Fix workbook errors before importing": {
    en: "Fix workbook errors before importing",
    ar: "أصلح أخطاء المصنف قبل الاستيراد",
    fr: "Corrigez les erreurs du classeur avant d’importer",
  },
  "Fix Cost Prices": { en: "Fix Cost Prices", ar: "تصحيح أسعار التكلفة", fr: "Corriger les prix de revient" },
  "Only .xlsx workbooks are supported": {
    en: "Only .xlsx workbooks are supported",
    ar: "المصنفات بصيغة .xlsx فقط مدعومة",
    fr: "Seuls les classeurs .xlsx sont pris en charge",
  },
  "Choose a valid workbook year": {
    en: "Choose a valid workbook year",
    ar: "اختر سنة مصنف صالحة",
    fr: "Choisissez une année de classeur valide",
  },
  "Invalid import data": {
    en: "Invalid import data",
    ar: "بيانات استيراد غير صالحة",
    fr: "Données d’importation non valides",
  },
  "Duplicate member ${row.name} for ${row.monthStart}": {
    en: "Duplicate member ${row.name} for ${row.monthStart}",
    ar: "عضو مكرر ${row.name} في ${row.monthStart}",
    fr: "Membre en double ${row.name} pour ${row.monthStart}",
  },
  "Type ${CLEAR_CONFIRMATION} to confirm": {
    en: "Type ${CLEAR_CONFIRMATION} to confirm",
    ar: "اكتب ${CLEAR_CONFIRMATION} للتأكيد",
    fr: "Saisissez ${CLEAR_CONFIRMATION} pour confirmer",
  },
  "Could not allocate a ledger code for ${name}": {
    en: "Could not allocate a ledger code for ${name}",
    ar: "تعذر تخصيص رمز حساب لـ ${name}",
    fr: "Impossible d’attribuer un code de compte pour ${name}",
  },
  'Existing Insurance data has duplicate member name "${name}". Resolve it before importing.': {
    en: 'Existing Insurance data has duplicate member name "${name}". Resolve it before importing.',
    ar: 'بيانات التأمين الحالية تحتوي على اسم عضو مكرر "${name}". عالج ذلك قبل الاستيراد.',
    fr: "Les données d’assurance existantes contiennent un nom de membre en double « ${name} ». Corrigez-le avant d’importer.",
  },
  "Failed to create Insurance member ${firstRow.name}": {
    en: "Failed to create Insurance member ${firstRow.name}",
    ar: "تعذر إنشاء عضو التأمين ${firstRow.name}",
    fr: "Échec de la création du membre d’assurance ${firstRow.name}",
  },
  'Sheet name is not a recognized month. Use "January", "January 2026", or "2026-01".': {
    en: 'Sheet name is not a recognized month. Use "January", "January 2026", or "2026-01".',
    ar: 'اسم الورقة ليس شهرًا معروفًا. استخدم "January" أو "January 2026" أو "2026-01".',
    fr: "Le nom de la feuille n’est pas un mois reconnu. Utilisez « January », « January 2026 » ou « 2026-01 ».",
  },
  "Name is required.": { en: "Name is required.", ar: "الاسم مطلوب.", fr: "Le nom est obligatoire." },
  "Monthly Amount must be a non-negative number.": {
    en: "Monthly Amount must be a non-negative number.",
    ar: "يجب أن يكون المبلغ الشهري رقمًا غير سالب.",
    fr: "Le montant mensuel doit être un nombre positif ou nul.",
  },
  "Duplicate member for this month (first found on row ${firstRow}).": {
    en: "Duplicate member for this month (first found on row ${firstRow}).",
    ar: "عضو مكرر لهذا الشهر (وُجد أولًا في الصف ${firstRow}).",
    fr: "Membre en double pour ce mois (première occurrence à la ligne ${firstRow}).",
  },
  "Start Date is invalid.": {
    en: "Start Date is invalid.",
    ar: "تاريخ البدء غير صالح.",
    fr: "La date de début n’est pas valide.",
  },
  "Date of Birth is invalid.": {
    en: "Date of Birth is invalid.",
    ar: "تاريخ الميلاد غير صالح.",
    fr: "La date de naissance n’est pas valide.",
  },
  "Sheet has no data rows.": {
    en: "Sheet has no data rows.",
    ar: "الورقة لا تحتوي على صفوف بيانات.",
    fr: "La feuille ne contient aucune ligne de données.",
  },
  "No month-named worksheets were found.": {
    en: "No month-named worksheets were found.",
    ar: "لم يتم العثور على أوراق عمل بأسماء أشهر.",
    fr: "Aucune feuille nommée d’après un mois n’a été trouvée.",
  },
  "No importable member rows were found.": {
    en: "No importable member rows were found.",
    ar: "لم يتم العثور على صفوف أعضاء قابلة للاستيراد.",
    fr: "Aucune ligne de membre importable n’a été trouvée.",
  },
};

const PLACEHOLDER_PATTERN = /\$\{[^}]+\}/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface InterpolatedEntry {
  matcher: RegExp;
  translation: Translation;
}

const interpolatedEntries: InterpolatedEntry[] = Object.entries(translations)
  .filter(([source]) => source.includes("${"))
  .map(([source, translation]) => ({
    matcher: new RegExp(
      `^${source
        .split(PLACEHOLDER_PATTERN)
        .map((literal) => escapeRegExp(literal))
        .join("(.*?)")}$`,
      "s"
    ),
    translation,
  }));

function applyCaptures(template: string, captures: string[]): string {
  let index = 0;
  return template.replace(PLACEHOLDER_PATTERN, () => captures[index++] ?? "");
}

export function translateFactoryInsuranceText(value: string, language: ApplicationLanguage): string | null {
  const direct = translations[value]?.[language];
  if (direct) return direct;
  for (const entry of interpolatedEntries) {
    const match = entry.matcher.exec(value);
    if (match) return applyCaptures(entry.translation[language], match.slice(1));
  }
  return null;
}
