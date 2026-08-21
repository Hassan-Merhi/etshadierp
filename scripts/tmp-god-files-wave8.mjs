import fs from "node:fs";

const servicePath = "server/chatService.ts";
const earlyPath = "server/chat/earlyMultiSourceTransfer.ts";
const voucherPath = "server/chat/voucherAndStockDrafts.ts";
const lookupPath = "server/chat/lookupDrafts.ts";
const transferPath = "server/chat/stockTransferDrafts.ts";

let source = fs.readFileSync(servicePath, "utf8");
const cut = (start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`Missing Wave 8 markers: ${start} -> ${end}`);
  return { a, b, text: source.slice(a, b) };
};

// 1) Early deterministic multi-source route.
const early = cut("// ── Early hard-return route:", 'import { getCachedERPContext');
let earlyBody = early.text;
earlyBody = earlyBody.replace("async function tryBuildEarlyMultiSourceTargetTransfer(", "export async function tryBuildEarlyMultiSourceTargetTransfer(");
const earlyImports = `import { db } from "../db";\nimport * as schema from "@shared/schema";\nimport { and, eq, isNull } from "drizzle-orm";\nimport { deterministicParseMultiSourceTransfer, RE_MULTI_SOURCE_LOCATIONS, RE_STOCK_GROUP_FILTER_HINT, RE_STOCK_TRANSFER, RE_STOCK_TRANSFER_ANALYSIS_STRICT, RE_TARGET_QTY_HINT } from "./intent";\nimport { buildStockTransferByTargetQuantityContext, matchLocationByName } from "../services/stockTransferAnalysis";\n\n`;
fs.writeFileSync(earlyPath, earlyImports + earlyBody.trimStart());
source = source.slice(0, early.a) + 'import { tryBuildEarlyMultiSourceTargetTransfer } from "./chat/earlyMultiSourceTransfer";\n\n' + source.slice(early.b);

// Helper to extract a section inside chat() into a focused async module.
function extractSection({ start, end, path, fn, returns, args, imports, replacement }) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`Missing section markers: ${start} -> ${end}`);
  let body = source.slice(a, b);
  if (fn === "buildStockTransferDrafts") {
    body = body.replace(
      /\n\s*if \(stockTransferResponseOverride\) \{\s*finalResponse = stockTransferResponseOverride;\s*\}\s*$/s,
      "\n"
    );
  }
  body = body.replace(new RegExp(`^\\s*${start.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}`), start.trim());
  const module = `${imports}\nexport async function ${fn}(params: { ${args.join("; ")} }) {\n  const { ${args.map((x) => x.split(":")[0].trim()).join(", ")} } = params;\n${body}\n  return { ${returns.join(", ")} };\n}\n`;
  fs.writeFileSync(path, module);
  source = source.slice(0, a) + replacement + source.slice(b);
}

const commonImports = `import { db } from "../db";\nimport * as schema from "@shared/schema";\nimport { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";\nimport { callAIWithFallback, type AIProvider } from "./aiProviders";\nimport { RE_ACCOUNT_QUERY, RE_PRICE_UPDATE, RE_STOCK_ADJ, RE_STOCK_ITEM_CREATE, RE_VOUCHER, RE_VOUCHER_SEARCH } from "./intent";`;

extractSection({
  start: "    // ── Phase 5b: detect voucher creation intent",
  end: "    // ── Voucher search by description",
  path: voucherPath,
  fn: "buildVoucherAndStockDrafts",
  returns: ["voucherDraft", "stockAdjustmentDraft"],
  args: ["userMessage: string", "companyId: number", "selectedProvider: AIProvider", "intent: string"],
  imports: commonImports,
  replacement: `    const { voucherDraft, stockAdjustmentDraft } = await buildVoucherAndStockDrafts({ userMessage, companyId, selectedProvider, intent });\n\n`,
});

extractSection({
  start: "    // ── Voucher search by description",
  end: "    // ── Stock transfer detection",
  path: lookupPath,
  fn: "buildLookupDrafts",
  returns: ["voucherSearchResults", "stockItemDraft", "priceUpdateDraft", "accountQueryResult"],
  args: ["userMessage: string", "companyId: number", "selectedProvider: AIProvider"],
  imports: commonImports,
  replacement: `    const { voucherSearchResults, stockItemDraft, priceUpdateDraft, accountQueryResult } = await buildLookupDrafts({ userMessage, companyId, selectedProvider });\n\n`,
});

const transferImports = `import { db } from "../db";\nimport * as schema from "@shared/schema";\nimport { and, eq, isNull, sql } from "drizzle-orm";\nimport { callAIWithFallback, type AIProvider } from "./aiProviders";\nimport { deterministicParseMultiSourceTransfer, RE_MULTI_SOURCE_LOCATIONS, RE_STOCK_GROUP_FILTER_HINT, RE_STOCK_TRANSFER, RE_STOCK_TRANSFER_ANALYSIS, RE_STOCK_TRANSFER_ANALYSIS_STRICT, RE_TARGET_QTY_HINT } from "./intent";\nimport { buildStockTransferByTargetQuantityContext, buildStockTransferSuggestionContext, matchLocationByName } from "../services/stockTransferAnalysis";`;

extractSection({
  start: "    // ── Stock transfer detection",
  end: "    // ── Verify Container Excel detection",
  path: transferPath,
  fn: "buildStockTransferDrafts",
  returns: ["stockTransferDraft", "stockTransferDrafts", "stockTransferResponseOverride"],
  args: ["userMessage: string", "companyId: number", "selectedProvider: AIProvider", "voucherDraft: unknown", "stockAdjustmentDraft: unknown"],
  imports: transferImports,
  replacement: `    const { stockTransferDraft, stockTransferDrafts, stockTransferResponseOverride } = await buildStockTransferDrafts({ userMessage, companyId, selectedProvider, voucherDraft, stockAdjustmentDraft });\n    if (stockTransferResponseOverride) finalResponse = stockTransferResponseOverride;\n\n`,
});

const importAnchor = 'import { runDataQuery } from "./chat/reports";';
if (!source.includes(importAnchor)) throw new Error("Missing chatService import anchor");
source = source.replace(importAnchor, `${importAnchor}\nimport { buildVoucherAndStockDrafts } from "./chat/voucherAndStockDrafts";\nimport { buildLookupDrafts } from "./chat/lookupDrafts";\nimport { buildStockTransferDrafts } from "./chat/stockTransferDrafts";`);
fs.writeFileSync(servicePath, source);

// Retire the final grandfathered God file.
const configPath = "config/god-file-boundaries.json";
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
if (config.version !== 32) throw new Error(`Expected boundary v32, found v${config.version}`);
if (!(servicePath in config.repositoryScan.grandfathered)) throw new Error("chatService is not grandfathered before Wave 8");
config.version = 33;
delete config.repositoryScan.grandfathered[servicePath];
config.description = "Version 33 completes cumulative Wave 8 by decomposing server/chatService.ts into focused deterministic-transfer, voucher/stock-draft, lookup, and stock-transfer modules, eliminating the final grandfathered God file while preserving the stable chatService public gateway. " + config.description;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

const testPath = "tests/god-file-boundaries.test.ts";
let test = fs.readFileSync(testPath, "utf8");
test = test.replace("expect(report.version).toBe(32);", "expect(report.version).toBe(33);");
test = test.replace("toBeLessThanOrEqual(1);", "toBeLessThanOrEqual(0);");
test = test.replace("toBeLessThanOrEqual(1076);", "toBeLessThanOrEqual(0);");
fs.writeFileSync(testPath, test);

for (const doc of ["docs/god-file-split-program.md", "docs/system-quality-program.md"]) {
  let text = fs.readFileSync(doc, "utf8");
  text = text.replace(/Backlog: 1 file, 1,076 lines over the limit/g, "Backlog: 0 files, 0 lines over the limit");
  text = text.replace(/God-file backlog \| 1 file, 1,076 excess lines/g, "God-file backlog | 0 files, 0 excess lines");
  text = text.replace(/1 file, 1,076 lines over the limit/g, "0 files, 0 lines over the limit");
  fs.writeFileSync(doc, text);
}

// Transfer type-escape ownership to the extracted modules without widening the total ceiling.
const typePath = "config/type-escape-boundaries.json";
const type = JSON.parse(fs.readFileSync(typePath, "utf8"));
if (type.totals.typeEscapeCeiling !== 3174) throw new Error(`Expected type ceiling 3174, found ${type.totals.typeEscapeCeiling}`);
const escapeCounts = (file) => {
  const s = fs.readFileSync(file, "utf8");
  const colonAny = (s.match(/:\s*any\b/g) || []).length;
  const asAny = (s.match(/\bas\s+any\b/g) || []).length;
  return [colonAny, asAny, 0];
};
for (const file of [servicePath, earlyPath, voucherPath, lookupPath, transferPath]) type.scan.baseline[file] = escapeCounts(file);
fs.writeFileSync(typePath, JSON.stringify(type, null, 2) + "\n");

const lines = (file) => fs.readFileSync(file, "utf8").split(/\r?\n/).length;
for (const file of [servicePath, earlyPath, voucherPath, lookupPath, transferPath]) console.log(`WAVE8_SIZE ${file}=${lines(file)}`);
console.log(`WAVE8_RATCHET version=${config.version} grandfathered=${Object.keys(config.repositoryScan.grandfathered).length} typeCeiling=${type.totals.typeEscapeCeiling}`);
