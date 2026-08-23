import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, "artifacts/phase3-translation-source.json");
const I18N_DIR = path.join(ROOT, "client/src/i18n");
const PART_SIZE = 400;
const BATCH_CHAR_LIMIT = 2200;
const REQUEST_DELAY_MS = 220;
const MAX_RETRIES = 7;
const GENERATED_PREFIX = "phase3RemainingTranslations.part";
const GOOGLE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";

const exactGlossary = new Map([
  ["Article", { ar: "صنف", fr: "Article" }],
  ["Worker", { ar: "عامل", fr: "Ouvrier" }],
  ["Employee", { ar: "موظف", fr: "Employé" }],
  ["Freight", { ar: "الشحن", fr: "Fret" }],
  ["Proforma", { ar: "فاتورة أولية", fr: "Proforma" }],
  ["Commission", { ar: "العمولة", fr: "Commission" }],
  ["Cost Price", { ar: "سعر التكلفة", fr: "Prix de revient" }],
  ["Product Name", { ar: "اسم المنتج", fr: "Nom du produit" }],
  ["Destination", { ar: "الوجهة", fr: "Destination" }],
  ["Supplier", { ar: "المورد", fr: "Fournisseur" }],
  ["Customer", { ar: "العميل", fr: "Client" }],
  ["Payment", { ar: "الدفع", fr: "Paiement" }],
  ["Receipt", { ar: "الإيصال", fr: "Reçu" }],
  ["Invoice", { ar: "الفاتورة", fr: "Facture" }],
  ["Voucher", { ar: "السند", fr: "Pièce comptable" }],
  ["Account", { ar: "الحساب", fr: "Compte" }],
  ["Stock", { ar: "المخزون", fr: "Stock" }],
  ["Inventory", { ar: "المخزون", fr: "Stock" }],
  ["Factory", { ar: "المصنع", fr: "Usine" }],
  ["Container", { ar: "الحاوية", fr: "Conteneur" }],
  ["Bale", { ar: "بالة", fr: "Balle" }],
  ["Location", { ar: "الموقع", fr: "Emplacement" }],
  ["Journal", { ar: "اليومية", fr: "Journal" }],
  ["Opening", { ar: "الافتتاحي", fr: "Ouverture" }],
  ["Closing", { ar: "الختامي", fr: "Clôture" }],
  ["Loaded", { ar: "محمّل", fr: "Chargé" }],
  ["Verified", { ar: "تم التحقق", fr: "Vérifié" }],
  ["Finalized", { ar: "مُعتمد نهائيًا", fr: "Finalisé" }],
  ["Sold", { ar: "مباع", fr: "Vendu" }],
  ["Open", { ar: "مفتوح", fr: "Ouvert" }],
  ["Reason", { ar: "السبب", fr: "Motif" }],
  ["Phone", { ar: "الهاتف", fr: "Téléphone" }],
  ["Username", { ar: "اسم المستخدم", fr: "Nom d’utilisateur" }],
  ["Grade", { ar: "الدرجة", fr: "Grade" }],
  ["Daily", { ar: "يومي", fr: "Quotidien" }],
  ["Monthly Salary", { ar: "الراتب الشهري", fr: "Salaire mensuel" }],
  ["High", { ar: "مرتفع", fr: "Élevé" }],
  ["Low", { ar: "منخفض", fr: "Faible" }],
  ["None", { ar: "لا يوجد", fr: "Aucun" }],
  ["Agent", { ar: "الوكيل", fr: "Agent" }],
  ["Source Location", { ar: "الموقع المصدر", fr: "Emplacement source" }],
  ["Destination Location", { ar: "الموقع الوجهة", fr: "Emplacement de destination" }],
  ["All Locations", { ar: "كل المواقع", fr: "Tous les emplacements" }],
  ["All Categories", { ar: "كل الفئات", fr: "Toutes les catégories" }],
  ["All Groups", { ar: "كل المجموعات", fr: "Tous les groupes" }],
  ["All Status", { ar: "كل الحالات", fr: "Tous les statuts" }],
  ["All statuses", { ar: "كل الحالات", fr: "Tous les statuts" }],
  ["In Stock", { ar: "متوفر في المخزون", fr: "En stock" }],
  ["Stock In", { ar: "إدخال مخزون", fr: "Entrée de stock" }],
  ["Stock Out", { ar: "إخراج مخزون", fr: "Sortie de stock" }],
  ["Optional notes", { ar: "ملاحظات اختيارية", fr: "Notes facultatives" }],
  ["Additional notes...", { ar: "ملاحظات إضافية...", fr: "Notes supplémentaires..." }],
  ["Unknown error", { ar: "خطأ غير معروف", fr: "Erreur inconnue" }],
  ["Not available offline", { ar: "غير متاح دون اتصال", fr: "Non disponible hors ligne" }],
  ["Save failed", { ar: "فشل الحفظ", fr: "Échec de l’enregistrement" }],
  ["Upload failed", { ar: "فشل الرفع", fr: "Échec du téléversement" }],
  ["Download failed", { ar: "فشل التنزيل", fr: "Échec du téléchargement" }],
  ["Export successful", { ar: "تم التصدير بنجاح", fr: "Exportation réussie" }],
  ["Import complete", { ar: "اكتمل الاستيراد", fr: "Importation terminée" }],
  ["Import error", { ar: "خطأ في الاستيراد", fr: "Erreur d’importation" }],
  ["Parse error", { ar: "خطأ في التحليل", fr: "Erreur d’analyse" }],
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: ROOT, stdio: "inherit", ...options });
}

function audit() {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  run("node", ["scripts/audit-i18n-phase14.mjs", "--no-enforce", "--json-out", REPORT_PATH]);
  return JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
}

function splitTemplateExpressions(value) {
  const staticParts = [];
  const expressions = [];
  let cursor = 0;
  let staticStart = 0;

  while (cursor < value.length) {
    if (!value.startsWith("${", cursor)) {
      cursor += 1;
      continue;
    }

    staticParts.push(value.slice(staticStart, cursor));
    const expressionStart = cursor;
    cursor += 2;
    let depth = 1;
    let quote = null;
    let escaped = false;

    while (cursor < value.length && depth > 0) {
      const char = value[cursor];
      if (quote !== null) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = null;
      } else if (char === '"' || char === "'" || char === "`") {
        quote = char;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
      }
      cursor += 1;
    }

    if (depth !== 0) throw new Error(`Unbalanced template expression in: ${value}`);
    expressions.push(value.slice(expressionStart, cursor));
    staticStart = cursor;
  }

  staticParts.push(value.slice(staticStart));
  return { staticParts, expressions };
}

function maskTemplateExpressions(value, entryId) {
  const { staticParts, expressions } = splitTemplateExpressions(value);
  const tokens = expressions.map((_, index) => `ZXQPH${entryId}X${index}ZXQ`);
  let masked = staticParts[0];
  for (let index = 0; index < expressions.length; index += 1) {
    masked += tokens[index] + staticParts[index + 1];
  }
  return { masked, expressions, tokens };
}

function restoreTranslationTokens(translated, masked) {
  let result = translated;
  for (let index = 0; index < masked.tokens.length; index += 1) {
    const token = masked.tokens[index];
    const placeholder = `{{${index}}}`;
    const flexible = token.split("").join("\\s*");
    const matcher = new RegExp(flexible, "gi");
    if (!matcher.test(result)) throw new Error(`Translation lost placeholder ${token}: ${translated}`);
    matcher.lastIndex = 0;
    result = result.replace(matcher, placeholder);
  }
  return result.trim();
}

function normalizeGoogleResponse(data) {
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error(`Unexpected Google Translate response: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data[0]
    .map((segment) => (Array.isArray(segment) && typeof segment[0] === "string" ? segment[0] : ""))
    .join("");
}

async function requestTranslation(text, targetLanguage) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const url = new URL(GOOGLE_ENDPOINT);
      url.searchParams.set("client", "gtx");
      url.searchParams.set("sl", "en");
      url.searchParams.set("tl", targetLanguage);
      url.searchParams.set("dt", "t");
      url.searchParams.set("q", text);
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 Phase3TranslationCompletion/2.0",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const translated = normalizeGoogleResponse(await response.json()).trim();
      if (!translated) throw new Error("Empty translation response");
      return translated;
    } catch (error) {
      lastError = error;
      const backoff = Math.min(15000, 600 * 2 ** (attempt - 1));
      console.warn(
        `Translation request failed (${targetLanguage}) attempt ${attempt}/${MAX_RETRIES}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await sleep(backoff);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function buildBatches(items) {
  const batches = [];
  let current = [];
  let size = 0;
  for (const item of items) {
    const encoded = `ZXQI18N${item.id}ZXQ\n${item.masked.masked}\n`;
    if (current.length > 0 && size + encoded.length > BATCH_CHAR_LIMIT) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += encoded.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function parseBatchTranslation(translated, batch) {
  const markerRegex = /ZXQI18N\s*(\d+)\s*ZXQ/gi;
  const matches = [...translated.matchAll(markerRegex)];
  if (matches.length !== batch.length) return null;
  const byId = new Map();
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const id = Number(current[1]);
    const start = (current.index ?? 0) + current[0].length;
    const end = next?.index ?? translated.length;
    byId.set(id, translated.slice(start, end).trim());
  }
  return byId.size === batch.length ? byId : null;
}

async function translateItems(items, targetLanguage) {
  const results = new Map();
  const pendingItems = [];

  for (const item of items) {
    const glossary = exactGlossary.get(item.text);
    const target = glossary?.[targetLanguage];
    if (target) results.set(item.id, target);
    else pendingItems.push(item);
  }

  const batches = buildBatches(pendingItems);
  console.log(`Translating ${pendingItems.length} strings to ${targetLanguage} in ${batches.length} batches...`);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const payload = batch.map((item) => `ZXQI18N${item.id}ZXQ\n${item.masked.masked}`).join("\n");
    let parsed = null;

    try {
      const translated = await requestTranslation(payload, targetLanguage);
      parsed = parseBatchTranslation(translated, batch);
    } catch (error) {
      console.warn(`Batch ${batchIndex + 1}/${batches.length} failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (parsed === null) {
      parsed = new Map();
      console.warn(`Batch ${batchIndex + 1} marker parsing failed; retrying ${batch.length} items individually.`);
      for (const item of batch) {
        const translated = await requestTranslation(item.masked.masked, targetLanguage);
        parsed.set(item.id, translated);
        await sleep(REQUEST_DELAY_MS);
      }
    }

    for (const item of batch) {
      const raw = parsed.get(item.id);
      if (typeof raw !== "string" || raw.trim() === "") {
        throw new Error(`Missing ${targetLanguage} translation for ${item.text}`);
      }
      results.set(item.id, restoreTranslationTokens(raw, item.masked));
    }

    if ((batchIndex + 1) % 10 === 0 || batchIndex + 1 === batches.length) {
      console.log(`  ${targetLanguage}: ${batchIndex + 1}/${batches.length} batches complete`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  return results;
}

function partName(index) {
  return `${GENERATED_PREFIX}${String(index + 1).padStart(2, "0")}.ts`;
}

function exportName(index) {
  return `phase3RemainingTranslationsPart${String(index + 1).padStart(2, "0")}`;
}

function writeTranslationParts(entries) {
  const files = [];
  const partCount = Math.ceil(entries.length / PART_SIZE);
  for (let index = 0; index < partCount; index += 1) {
    const fileName = partName(index);
    const exportConst = exportName(index);
    const chunk = entries.slice(index * PART_SIZE, (index + 1) * PART_SIZE);
    const lines = [
      'import type { Phase3SharedUiEntry } from "./sharedUiPhase3TranslationTypes";',
      "",
      `export const ${exportConst}: readonly Phase3SharedUiEntry[] = [`,
      ...chunk.map(
        (entry) =>
          `  { en: ${JSON.stringify(entry.en)}, ar: ${JSON.stringify(entry.ar)}, fr: ${JSON.stringify(entry.fr)} },`,
      ),
      "];",
      "",
    ];
    fs.writeFileSync(path.join(I18N_DIR, fileName), lines.join("\n"));
    files.push({ fileName, exportConst });
  }
  return files;
}

function replaceOrThrow(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`Unable to patch ${label}: anchor not found`);
  return source.replace(needle, replacement);
}

function patchSharedUiAggregator(files) {
  const filePath = path.join(I18N_DIR, "sharedUiPhase3Translations.ts");
  let source = fs.readFileSync(filePath, "utf8");
  if (source.includes("phase3RemainingTranslationsPart01")) return;

  const importAnchor = 'import { phase3SharedUiTranslationsPart7 } from "./sharedUiPhase3Translations.part7";';
  const generatedImports = files
    .map(({ fileName, exportConst }) => `import { ${exportConst} } from "./${fileName.replace(/\.ts$/, "")}";`)
    .join("\n");
  source = replaceOrThrow(
    source,
    importAnchor,
    `${importAnchor}\n${generatedImports}\nimport { createPhase3TemplateTranslator } from "./phase3TemplateTranslationRuntime";`,
    "shared UI imports",
  );

  const spreadAnchor = "  ...phase3SharedUiTranslationsPart7,";
  const generatedSpreads = files.map(({ exportConst }) => `  ...${exportConst},`).join("\n");
  source = replaceOrThrow(source, spreadAnchor, `${spreadAnchor}\n${generatedSpreads}`, "shared UI spreads");

  const mapAnchor = `const exactEntryByVisibleText = new Map<string, Phase3SharedUiEntry>();\nfor (const entry of phase3SharedUiTranslations) {\n  exactEntryByVisibleText.set(entry.en, entry);\n  exactEntryByVisibleText.set(entry.ar, entry);\n  exactEntryByVisibleText.set(entry.fr, entry);\n}`;
  const mapReplacement = `const canonicalEnglishText = new Set(phase3SharedUiTranslations.map((entry) => entry.en));\nconst exactEntryByVisibleText = new Map<string, Phase3SharedUiEntry>();\nfor (const entry of phase3SharedUiTranslations) {\n  exactEntryByVisibleText.set(entry.en, entry);\n  for (const alias of [entry.ar, entry.fr]) {\n    if (/\\{\\{\\d+\\}\\}/.test(alias)) continue;\n    if (alias !== entry.en && canonicalEnglishText.has(alias)) continue;\n    if (!exactEntryByVisibleText.has(alias)) exactEntryByVisibleText.set(alias, entry);\n  }\n}\n\nconst generatedTemplateTranslator = createPhase3TemplateTranslator(phase3SharedUiTranslations);`;
  source = replaceOrThrow(source, mapAnchor, mapReplacement, "shared UI exact map");

  const matchAnchor = `  return dynamicRules.some((rule) =>\n    (["en", "ar", "fr"] as const).some((language) => rule.patterns[language].test(normalized))\n  );`;
  const matchReplacement = `  return (\n    dynamicRules.some((rule) =>\n      (["en", "ar", "fr"] as const).some((language) => rule.patterns[language].test(normalized)),\n    ) || generatedTemplateTranslator.matches(normalized)\n  );`;
  source = replaceOrThrow(source, matchAnchor, matchReplacement, "shared UI template matching");

  const translateAnchor = `  const translated = exactEntry?.[language] ?? findDynamicTranslation(normalized, language);\n  return translated ? \`\${leading}\${translated}\${trailing}\` : null;`;
  const translateReplacement = `  const translated =\n    exactEntry?.[language] ??\n    findDynamicTranslation(normalized, language) ??\n    generatedTemplateTranslator.translate(normalized, language, (capture) =>\n      exactEntryByVisibleText.get(capture)?.[language] ?? capture,\n    );\n  return translated ? \`\${leading}\${translated}\${trailing}\` : null;`;
  source = replaceOrThrow(source, translateAnchor, translateReplacement, "shared UI template translation");

  fs.writeFileSync(filePath, source);
}

function patchAuditCompatibility(files) {
  const filePath = path.join(ROOT, "scripts/audit-i18n-phase14.mjs");
  let source = fs.readFileSync(filePath, "utf8");
  if (source.includes(`client/src/i18n/${partName(0)}`)) return;
  const anchor = '  "client/src/i18n/sharedUiPhase3Translations.part7.ts",';
  const additions = files.map(({ fileName }) => `  "client/src/i18n/${fileName}",`).join("\n");
  source = replaceOrThrow(source, anchor, `${anchor}\n${additions}`, "audit compatibility files");
  fs.writeFileSync(filePath, source);
}

function patchInterfaceTranslator() {
  const filePath = path.join(ROOT, "client/src/components/ApplicationInterfaceTranslator.tsx");
  let source = fs.readFileSync(filePath, "utf8");
  if (source.includes("HARD_EXCLUDED_SELECTOR")) return;

  source = replaceOrThrow(source, "const EXCLUDED_SELECTOR = [", "const HARD_EXCLUDED_SELECTOR = [", "interface hard exclusions");
  const softRows = '  "option",\n  "td:not([data-i18n-ui])",\n  "[role=cell]:not([data-i18n-ui])",\n  "[role=gridcell]:not([data-i18n-ui])",\n';
  source = replaceOrThrow(source, softRows, "", "interface soft exclusion extraction");

  const selectorAnchor = '].join(",");\n\nconst ELIGIBLE_TEXT_SELECTOR';
  const selectorReplacement = `].join(",");\n\nconst SOFT_EXCLUDED_SELECTOR = [\n  "option",\n  "td:not([data-i18n-ui])",\n  "[role=cell]:not([data-i18n-ui])",\n  "[role=gridcell]:not([data-i18n-ui])",\n].join(",");\n\nconst ELIGIBLE_TEXT_SELECTOR`;
  source = replaceOrThrow(source, selectorAnchor, selectorReplacement, "interface soft exclusions");

  const protectedAnchor = `function isProtected(element: Element): boolean {\n  return Boolean(element.closest(EXCLUDED_SELECTOR));\n}`;
  const protectedReplacement = `function isHardProtected(element: Element): boolean {\n  return Boolean(element.closest(HARD_EXCLUDED_SELECTOR));\n}\n\nfunction isSoftProtected(element: Element): boolean {\n  return Boolean(element.closest(SOFT_EXCLUDED_SELECTOR));\n}`;
  source = replaceOrThrow(source, protectedAnchor, protectedReplacement, "interface protection helpers");

  const textAnchor = `  if (!parent || isProtected(parent)) return;\n\n  const currentValue = node.nodeValue ?? "";\n  const memory = getTextMemory(node, currentValue);\n\n  if (!isEligibleTextElement(parent) && !isApprovedNonVisualText(memory.source)) {`;
  const textReplacement = `  if (!parent || isHardProtected(parent)) return;\n\n  const currentValue = node.nodeValue ?? "";\n  const memory = getTextMemory(node, currentValue);\n  const approved = isApprovedNonVisualText(memory.source);\n  if (isSoftProtected(parent) && !approved) return;\n\n  if (!isEligibleTextElement(parent) && !approved) {`;
  source = replaceOrThrow(source, textAnchor, textReplacement, "interface approved soft text");
  source = replaceOrThrow(
    source,
    "  if (isProtected(element)) return;",
    "  if (isHardProtected(element) || isSoftProtected(element)) return;",
    "interface attribute protection",
  );

  fs.writeFileSync(filePath, source);
}

function countTopLevelExpressions(value) {
  return splitTemplateExpressions(value).expressions.length;
}

function writeCompletionTest(entryCount, files) {
  const filePath = path.join(ROOT, "tests/phase3-translation-completion.test.ts");
  const imports = files
    .map(({ fileName, exportConst }) => `import { ${exportConst} } from "../client/src/i18n/${fileName.replace(/\.ts$/, "")}";`)
    .join("\n");
  const spreads = files.map(({ exportConst }) => `  ...${exportConst},`).join("\n");
  const content = `import { describe, expect, it } from "vitest";\n${imports}\n\nconst entries = [\n${spreads}\n] as const;\n\nfunction countTargetSlots(value: string): number {\n  return (value.match(/\\{\\{\\d+\\}\\}/g) ?? []).length;\n}\n\nfunction countSourceSlots(value: string): number {\n  let count = 0;\n  let cursor = 0;\n  while (cursor < value.length) {\n    if (!value.startsWith("\\${", cursor)) { cursor += 1; continue; }\n    count += 1;\n    cursor += 2;\n    let depth = 1;\n    let quote: string | null = null;\n    let escaped = false;\n    while (cursor < value.length && depth > 0) {\n      const char = value[cursor];\n      if (quote !== null) {\n        if (escaped) escaped = false;\n        else if (char === "\\\\") escaped = true;\n        else if (char === quote) quote = null;\n      } else if (char === '\"' || char === "'" || char === "\\\`") quote = char;\n      else if (char === "{") depth += 1;\n      else if (char === "}") depth -= 1;\n      cursor += 1;\n    }\n  }\n  return count;\n}\n\ndescribe("Phase 3 translation completion", () => {\n  it("keeps the complete generated translation inventory", () => {\n    expect(entries).toHaveLength(${entryCount});\n    expect(new Set(entries.map((entry) => entry.en)).size).toBe(entries.length);\n  });\n\n  it("provides non-empty Arabic and French text for every English source", () => {\n    for (const entry of entries) {\n      expect(entry.en.trim().length).toBeGreaterThan(0);\n      expect(entry.ar.trim().length).toBeGreaterThan(0);\n      expect(entry.fr.trim().length).toBeGreaterThan(0);\n      expect(entry.ar).not.toMatch(/ZXQPH\\d+X\\d+ZXQ/i);\n      expect(entry.fr).not.toMatch(/ZXQPH\\d+X\\d+ZXQ/i);\n    }\n  });\n\n  it("preserves every top-level interpolation slot", () => {\n    for (const entry of entries) {\n      const sourceSlots = countSourceSlots(entry.en);\n      expect(countTargetSlots(entry.ar)).toBe(sourceSlots);\n      expect(countTargetSlots(entry.fr)).toBe(sourceSlots);\n    }\n  });\n});\n`;
  fs.writeFileSync(filePath, content);
}

function updateBaseline() {
  const postReportPath = path.join(ROOT, "artifacts/phase3-translation-final.json");
  const suggestedPath = path.join(ROOT, "artifacts/phase3-translation-baseline.json");
  run("node", [
    "scripts/audit-i18n-phase14.mjs",
    "--no-enforce",
    "--json-out",
    postReportPath,
    "--suggested-baseline-out",
    suggestedPath,
  ]);
  const postReport = JSON.parse(fs.readFileSync(postReportPath, "utf8"));
  if (postReport.totals.actionable !== 0) {
    throw new Error(`Phase 3 audit still has ${postReport.totals.actionable} actionable literals`);
  }
  const baseline = JSON.parse(fs.readFileSync(suggestedPath, "utf8"));
  baseline.reviewedAt = new Date().toISOString().slice(0, 10);
  baseline.reviewedHead = "phase3-translation-ui-polish";
  baseline.description =
    "Phase 3 app-wide translation completion: every classified actionable literal is covered by EN/FR/AR runtime translations; the untranslated-text ratchet is locked at zero.";
  fs.writeFileSync(path.join(ROOT, "config/i18n-phase14-baseline.json"), `${JSON.stringify(baseline, null, 2)}\n`);
}

async function main() {
  const report = audit();
  const actionable = report.findings.filter((finding) => finding.status === "actionable");
  const uniqueTexts = [...new Set(actionable.map((finding) => finding.text.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  console.log(`Phase 3 source: ${actionable.length} actionable occurrences, ${uniqueTexts.length} unique strings.`);
  if (uniqueTexts.length === 0) return;

  const items = uniqueTexts.map((text, id) => ({ id, text, masked: maskTemplateExpressions(text, id) }));
  const french = await translateItems(items, "fr");
  const arabic = await translateItems(items, "ar");
  const entries = items.map((item) => ({ en: item.text, ar: arabic.get(item.id), fr: french.get(item.id) }));

  for (const entry of entries) {
    if (typeof entry.ar !== "string" || typeof entry.fr !== "string") {
      throw new Error(`Incomplete translation entry for ${entry.en}`);
    }
    const slots = countTopLevelExpressions(entry.en);
    if ((entry.ar.match(/\{\{\d+\}\}/g) ?? []).length !== slots) throw new Error(`Arabic slot mismatch: ${entry.en}`);
    if ((entry.fr.match(/\{\{\d+\}\}/g) ?? []).length !== slots) throw new Error(`French slot mismatch: ${entry.en}`);
  }

  const files = writeTranslationParts(entries);
  patchSharedUiAggregator(files);
  patchAuditCompatibility(files);
  patchInterfaceTranslator();
  writeCompletionTest(entries.length, files);
  updateBaseline();

  const unchangedArabic = entries.filter((entry) => entry.ar === entry.en).length;
  const unchangedFrench = entries.filter((entry) => entry.fr === entry.en).length;
  console.log(`Generated ${entries.length} EN/AR/FR entries across ${files.length} files.`);
  console.log(`Unchanged exact values after translation: ar=${unchangedArabic}, fr=${unchangedFrench}.`);
  console.log("Phase 3 untranslated-text ratchet is zero.");
}

await main();
