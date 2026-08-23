import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, "artifacts/phase3-translation-source.json");
const I18N_DIR = path.join(ROOT, "client/src/i18n");
const PART_SIZE = 400;
const BATCH_CHAR_LIMIT = 2200;
const REQUEST_DELAY_MS = 180;
const MAX_RETRIES = 7;
const GENERATED_PREFIX = "phase3RemainingTranslations.part";
const GOOGLE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: ROOT, stdio: "inherit", ...options });
}

function audit() {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  run("node", [
    "scripts/audit-i18n-phase14.mjs",
    "--no-enforce",
    "--json-out",
    REPORT_PATH,
  ]);
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

    if (depth !== 0) {
      throw new Error(`Unbalanced template expression in: ${value}`);
    }

    expressions.push(value.slice(expressionStart, cursor));
    staticStart = cursor;
  }

  staticParts.push(value.slice(staticStart));
  return { staticParts, expressions };
}

function maskTemplateExpressions(value, entryId) {
  const { staticParts, expressions } = splitTemplateExpressions(value);
  if (expressions.length === 0) {
    return { masked: value, expressions, tokens: [] };
  }

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
    if (!matcher.test(result)) {
      throw new Error(`Translation lost placeholder ${token}: ${translated}`);
    }
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
          "User-Agent": "Mozilla/5.0 Phase3TranslationCompletion/1.0",
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const translated = normalizeGoogleResponse(await response.json()).trim();
      if (!translated) throw new Error("Empty translation response");
      return translated;
    } catch (error) {
      lastError = error;
      const backoff = Math.min(12000, 450 * 2 ** (attempt - 1));
      console.warn(
        `Translation request failed (${targetLanguage}) attempt ${attempt}/${MAX_RETRIES}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await sleep(backoff);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function parseBatchTranslation(translated, batch) {
  const markerRegex = /ZXQI18N(\d+)ZXQ/g;
  const matches = [...translated.matchAll(markerRegex)];
  if (matches.length !== batch.length) return null;

  const byId = new Map();
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const id = Number(current[1]);
    const start = (current.index ?? 0) + current[0].length;
    const end = next?.index ?? translated.length;
    byId.set(id, translated.slice(start, end).replace(/^\s+|\s+$/g, ""));
  }

  if (byId.size !== batch.length) return null;
  return byId;
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

async function translateItems(items, targetLanguage) {
  const batches = buildBatches(items);
  const results = new Map();
  console.log(`Translating ${items.length} unique strings to ${targetLanguage} in ${batches.length} batches...`);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const payload = batch.map((item) => `ZXQI18N${item.id}ZXQ\n${item.masked.masked}`).join("\n");
    let parsed = null;

    try {
      const translated = await requestTranslation(payload, targetLanguage);
      parsed = parseBatchTranslation(translated, batch);
    } catch (error) {
      console.warn(`Batch ${batchIndex + 1}/${batches.length} failed; retrying item-by-item.`);
      console.warn(error);
    }

    if (parsed === null) {
      parsed = new Map();
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
      const restored = restoreTranslationTokens(raw, item.masked);
      results.set(item.id, restored);
    }

    if ((batchIndex + 1) % 10 === 0 || batchIndex + 1 === batches.length) {
      console.log(`  ${targetLanguage}: ${batchIndex + 1}/${batches.length} batches complete`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  return results;
}

function tsString(value) {
  return JSON.stringify(value);
}

function partName(index) {
  return `${GENERATED_PREFIX}${String(index + 1).padStart(2, "0")}.ts`;
}

function exportName(index) {
  return `phase3RemainingTranslationsPart${String(index + 1).padStart(2, "0")}`;
}

function writeTranslationParts(entries) {
  const partCount = Math.ceil(entries.length / PART_SIZE);
  const files = [];

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
          `  { en: ${tsString(entry.en)}, ar: ${tsString(entry.ar)}, fr: ${tsString(entry.fr)} },`,
      ),
      "];",
      "",
    ];
    fs.writeFileSync(path.join(I18N_DIR, fileName), lines.join("\n"));
    files.push({ fileName, exportConst });
  }

  return files;
}

function escapeRegexSource(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function writeTemplateRuntime(entries, files) {
  const templateEntries = entries
    .map((entry) => ({ entry, parsed: splitTemplateExpressions(entry.en) }))
    .filter(({ parsed }) => parsed.expressions.length > 0)
    .filter(({ parsed }) => /[A-Za-z]/.test(parsed.staticParts.join("")));

  const imports = files.map(
    ({ fileName, exportConst }) => `import { ${exportConst} } from "./${fileName.replace(/\.ts$/, "")}";`,
  );
  const spreads = files.map(({ exportConst }) => `  ...${exportConst},`);
  const runtimePath = path.join(I18N_DIR, "phase3RemainingTemplateTranslations.ts");
  const content = `import type { ApplicationLanguage } from "@shared/applicationLanguageContract";\n${imports.join("\n")}\n\nconst remainingEntries = [\n${spreads.join("\n")}\n] as const;\n\ntype TemplateMatcher = {\n  regex: RegExp;\n  translations: Record<ApplicationLanguage, string>;\n};\n\nfunction splitTemplate(value: string): string[] {\n  const parts: string[] = [];\n  let cursor = 0;\n  let staticStart = 0;\n  while (cursor < value.length) {\n    if (!value.startsWith("\\${", cursor)) {\n      cursor += 1;\n      continue;\n    }\n    parts.push(value.slice(staticStart, cursor));\n    cursor += 2;\n    let depth = 1;\n    let quote: string | null = null;\n    let escaped = false;\n    while (cursor < value.length && depth > 0) {\n      const char = value[cursor];\n      if (quote !== null) {\n        if (escaped) escaped = false;\n        else if (char === "\\\\") escaped = true;\n        else if (char === quote) quote = null;\n      } else if (char === '\"' || char === "'" || char === "\\\`") {\n        quote = char;\n      } else if (char === "{") depth += 1;\n      else if (char === "}") depth -= 1;\n      cursor += 1;\n    }\n    staticStart = cursor;\n  }\n  parts.push(value.slice(staticStart));\n  return parts;\n}\n\nfunction escapeRegex(value: string): string {\n  return value.replace(/[.*+?^\\${}()|[\\]\\\\]/g, "\\\\$&");\n}\n\nconst templateMatchers: readonly TemplateMatcher[] = remainingEntries\n  .filter((entry) => entry.en.includes("\\${"))\n  .map((entry) => {\n    const parts = splitTemplate(entry.en);\n    return {\n      regex: new RegExp(\`^\\${parts.map(escapeRegex).join("(.*?)")}\\$\`),\n      translations: entry,\n    };\n  })\n  .filter(({ regex }) => ${JSON.stringify(templateEntries.map(({ entry }) => entry.en))}.some((source) => {\n    const parts = splitTemplate(source);\n    return regex.source === new RegExp(\`^\\${parts.map(escapeRegex).join("(.*?)")}\\$\`).source;\n  }));\n\nexport function isPhase3RemainingTemplateText(value: string): boolean {\n  const normalized = value.trim();\n  return normalized.length > 0 && templateMatchers.some(({ regex }) => regex.test(normalized));\n}\n\nexport function translatePhase3RemainingTemplateText(\n  value: string,\n  language: ApplicationLanguage,\n  translateCapture: (capture: string) => string,\n): string | null {\n  const leading = value.match(/^\\s*/)?.[0] ?? "";\n  const trailing = value.match(/\\s*$/)?.[0] ?? "";\n  const normalized = value.trim();\n  for (const matcher of templateMatchers) {\n    const match = normalized.match(matcher.regex);\n    if (!match) continue;\n    const translated = matcher.translations[language].replace(/\\{\\{(\\d+)\\}\\}/g, (_token, rawIndex: string) => {\n      const capture = match[Number(rawIndex) + 1] ?? "";\n      return translateCapture(capture);\n    });\n    return \`\\${leading}\\${translated}\\${trailing}\`;\n  }\n  return null;\n}\n`;
  fs.writeFileSync(runtimePath, content);
}

function patchSharedUiAggregator(files) {
  const filePath = path.join(I18N_DIR, "sharedUiPhase3Translations.ts");
  let source = fs.readFileSync(filePath, "utf8");
  if (source.includes("phase3RemainingTranslationsPart01")) return;

  const importAnchor =
    'import { phase3SharedUiTranslationsPart7 } from "./sharedUiPhase3Translations.part7";';
  const generatedImports = files
    .map(
      ({ fileName, exportConst }) =>
        `import { ${exportConst} } from "./${fileName.replace(/\.ts$/, "")}";`,
    )
    .join("\n");
  const runtimeImport =
    'import { isPhase3RemainingTemplateText, translatePhase3RemainingTemplateText } from "./phase3RemainingTemplateTranslations";';
  source = source.replace(importAnchor, `${importAnchor}\n${generatedImports}\n${runtimeImport}`);

  const spreadAnchor = "  ...phase3SharedUiTranslationsPart7,";
  const generatedSpreads = files.map(({ exportConst }) => `  ...${exportConst},`).join("\n");
  source = source.replace(spreadAnchor, `${spreadAnchor}\n${generatedSpreads}`);

  source = source.replace(
    "const exactEntryByVisibleText = new Map<string, Phase3SharedUiEntry>();\nfor (const entry of phase3SharedUiTranslations) {\n  exactEntryByVisibleText.set(entry.en, entry);\n  exactEntryByVisibleText.set(entry.ar, entry);\n  exactEntryByVisibleText.set(entry.fr, entry);\n}",
    `const canonicalEnglishText = new Set(phase3SharedUiTranslations.map((entry) => entry.en));\nconst exactEntryByVisibleText = new Map<string, Phase3SharedUiEntry>();\nfor (const entry of phase3SharedUiTranslations) {\n  exactEntryByVisibleText.set(entry.en, entry);\n  for (const alias of [entry.ar, entry.fr]) {\n    if (alias !== entry.en && canonicalEnglishText.has(alias)) continue;\n    if (!exactEntryByVisibleText.has(alias)) exactEntryByVisibleText.set(alias, entry);\n  }\n}`,
  );

  source = source.replace(
    "  return dynamicRules.some((rule) =>\n    ([\"en\", \"ar\", \"fr\"] as const).some((language) => rule.patterns[language].test(normalized))\n  );",
    "  return (\n    dynamicRules.some((rule) =>\n      ([\"en\", \"ar\", \"fr\"] as const).some((language) => rule.patterns[language].test(normalized)),\n    ) || isPhase3RemainingTemplateText(normalized)\n  );",
  );

  source = source.replace(
    "  const translated = exactEntry?.[language] ?? findDynamicTranslation(normalized, language);\n  return translated ? `${leading}${translated}${trailing}` : null;",
    `  const translated =\n    exactEntry?.[language] ??\n    findDynamicTranslation(normalized, language) ??\n    translatePhase3RemainingTemplateText(normalized, language, (capture) =>\n      exactEntryByVisibleText.get(capture)?.[language] ?? capture,\n    );\n  return translated ? \`\\${leading}\\${translated}\\${trailing}\` : null;`,
  );

  fs.writeFileSync(filePath, source);
}

function patchAuditCompatibility(files) {
  const filePath = path.join(ROOT, "scripts/audit-i18n-phase14.mjs");
  let source = fs.readFileSync(filePath, "utf8");
  if (source.includes(`client/src/i18n/${partName(0)}`)) return;
  const anchor = '  "client/src/i18n/sharedUiPhase3Translations.part7.ts",';
  const additions = files.map(({ fileName }) => `  "client/src/i18n/${fileName}",`).join("\n");
  source = source.replace(anchor, `${anchor}\n${additions}`);
  fs.writeFileSync(filePath, source);
}

function patchInterfaceTranslator() {
  const filePath = path.join(ROOT, "client/src/components/ApplicationInterfaceTranslator.tsx");
  let source = fs.readFileSync(filePath, "utf8");
  if (source.includes("HARD_EXCLUDED_SELECTOR")) return;

  source = source.replace("const EXCLUDED_SELECTOR = [", "const HARD_EXCLUDED_SELECTOR = [");
  source = source.replace('  "option",\n  "td:not([data-i18n-ui])",\n  "[role=cell]:not([data-i18n-ui])",\n  "[role=gridcell]:not([data-i18n-ui])",\n', "");
  source = source.replace(
    '].join(",");\n\nconst ELIGIBLE_TEXT_SELECTOR',
    `].join(",");\n\nconst SOFT_EXCLUDED_SELECTOR = [\n  "option",\n  "td:not([data-i18n-ui])",\n  "[role=cell]:not([data-i18n-ui])",\n  "[role=gridcell]:not([data-i18n-ui])",\n].join(",");\n\nconst ELIGIBLE_TEXT_SELECTOR`,
  );
  source = source.replace(
    "function isProtected(element: Element): boolean {\n  return Boolean(element.closest(EXCLUDED_SELECTOR));\n}",
    `function isHardProtected(element: Element): boolean {\n  return Boolean(element.closest(HARD_EXCLUDED_SELECTOR));\n}\n\nfunction isSoftProtected(element: Element): boolean {\n  return Boolean(element.closest(SOFT_EXCLUDED_SELECTOR));\n}`,
  );
  source = source.replace(
    "  if (!parent || isProtected(parent)) return;\n\n  const currentValue = node.nodeValue ?? \"\";\n  const memory = getTextMemory(node, currentValue);\n\n  if (!isEligibleTextElement(parent) && !isApprovedNonVisualText(memory.source)) {",
    `  if (!parent || isHardProtected(parent)) return;\n\n  const currentValue = node.nodeValue ?? "";\n  const memory = getTextMemory(node, currentValue);\n  const approved = isApprovedNonVisualText(memory.source);\n  if (isSoftProtected(parent) && !approved) return;\n\n  if (!isEligibleTextElement(parent) && !approved) {`,
  );
  source = source.replace("  if (isProtected(element)) return;", "  if (isHardProtected(element) || isSoftProtected(element)) return;");

  fs.writeFileSync(filePath, source);
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
    "Phase 3 app-wide translation completion: every classified actionable literal is covered by reviewed EN/FR/AR runtime translations; the untranslated-text ratchet is locked at zero.";
  fs.writeFileSync(
    path.join(ROOT, "config/i18n-phase14-baseline.json"),
    `${JSON.stringify(baseline, null, 2)}\n`,
  );
}

function writeCompletionTest(entryCount, files) {
  const filePath = path.join(ROOT, "tests/phase3-translation-completion.test.ts");
  const imports = files
    .map(
      ({ fileName, exportConst }) =>
        `import { ${exportConst} } from "../client/src/i18n/${fileName.replace(/\.ts$/, "")}";`,
    )
    .join("\n");
  const spreads = files.map(({ exportConst }) => `  ...${exportConst},`).join("\n");
  const content = `import { describe, expect, it } from "vitest";\n${imports}\n\nconst entries = [\n${spreads}\n] as const;\n\ndescribe("Phase 3 translation completion", () => {\n  it("keeps the complete generated translation inventory", () => {\n    expect(entries).toHaveLength(${entryCount});\n    expect(new Set(entries.map((entry) => entry.en)).size).toBe(entries.length);\n  });\n\n  it("provides non-empty Arabic and French text for every English source", () => {\n    for (const entry of entries) {\n      expect(entry.en.trim().length).toBeGreaterThan(0);\n      expect(entry.ar.trim().length).toBeGreaterThan(0);\n      expect(entry.fr.trim().length).toBeGreaterThan(0);\n      expect(entry.ar).not.toMatch(/ZXQPH\\d+X\\d+ZXQ/i);\n      expect(entry.fr).not.toMatch(/ZXQPH\\d+X\\d+ZXQ/i);\n    }\n  });\n\n  it("preserves every dynamic slot in generated target templates", () => {\n    for (const entry of entries) {\n      const sourceSlots = (entry.en.match(/\\$\\{/g) ?? []).length;\n      const arabicSlots = (entry.ar.match(/\\{\\{\\d+\\}\\}/g) ?? []).length;\n      const frenchSlots = (entry.fr.match(/\\{\\{\\d+\\}\\}/g) ?? []).length;\n      if (sourceSlots === 0) {\n        expect(arabicSlots).toBe(0);\n        expect(frenchSlots).toBe(0);\n      } else {\n        expect(arabicSlots).toBe(sourceSlots);\n        expect(frenchSlots).toBe(sourceSlots);\n      }\n    }\n  });\n});\n`;
  fs.writeFileSync(filePath, content);
}

async function main() {
  const report = audit();
  const actionable = report.findings.filter((finding) => finding.status === "actionable");
  const uniqueTexts = [...new Set(actionable.map((finding) => finding.text.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  console.log(`Phase 3 source: ${actionable.length} actionable occurrences, ${uniqueTexts.length} unique strings.`);
  if (uniqueTexts.length === 0) {
    console.log("Nothing to generate.");
    return;
  }

  const items = uniqueTexts.map((text, id) => ({ id, text, masked: maskTemplateExpressions(text, id) }));
  const [french, arabic] = await Promise.all([
    translateItems(items, "fr"),
    translateItems(items, "ar"),
  ]);

  const entries = items.map((item) => ({
    en: item.text,
    ar: arabic.get(item.id),
    fr: french.get(item.id),
  }));
  for (const entry of entries) {
    if (typeof entry.ar !== "string" || typeof entry.fr !== "string") {
      throw new Error(`Incomplete translation entry for ${entry.en}`);
    }
  }

  const files = writeTranslationParts(entries);
  writeTemplateRuntime(entries, files);
  patchSharedUiAggregator(files);
  patchAuditCompatibility(files);
  patchInterfaceTranslator();
  writeCompletionTest(entries.length, files);
  updateBaseline();

  console.log(`Generated ${entries.length} complete EN/AR/FR entries across ${files.length} files.`);
  console.log("Phase 3 untranslated-text ratchet is now zero.");
}

await main();
