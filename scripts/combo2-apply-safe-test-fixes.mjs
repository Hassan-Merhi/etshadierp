import { readFileSync, writeFileSync } from "node:fs";

// Temporary guarded helper for Combo 2; removed before merge.
function replaceOnce(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) {
    throw new Error(`Combo 2 replacement not found: ${label}`);
  }
  return next;
}

function updateExcelExportTests() {
  const path = "tests/excel-export.test.ts";
  let source = readFileSync(path, "utf8");

  if (
    source.includes("Required SP export template missing") &&
    !source.includes("it.skip") &&
    !source.includes("ctx.skip()")
  ) {
    return;
  }

  source = replaceOnce(
    source,
    /  if \(!templateExists\) return;[^\n]*\n/,
    "  expect(templateExists, `Required SP export template missing: ${TEMPLATE_PATH}`).toBe(true);\n",
    "excel template guard",
  );

  source = replaceOnce(
    source,
    /const maybeIt = templateExists\s*\? it\s*:\s*it\.skip\.bind\(it, "template missing"\);/,
    "const maybeIt = it;",
    "excel conditional test alias",
  );

  source = replaceOnce(
    source,
    /function requireWb\(ctx: \{ skip: \(\) => void \}\): ExcelJS\.Workbook \| null \{\s*if \(!buf \|\| !wb\) \{ ctx\.skip\(\); return null; \}\s*return wb;\s*\}/,
    `function requireWb(_ctx?: { skip: () => void }): ExcelJS.Workbook {
  expect(buf).toBeDefined();
  expect(wb).toBeDefined();
  return wb;
}`,
    "excel workbook guard",
  );

  source = source.replace(/\s*if \(!buf\) \{ ctx\.skip\(\); return; \}\n/g, "\n");

  if (source.includes("it.skip") || source.includes("ctx.skip()")) {
    throw new Error("Excel export test still contains active skip guards");
  }

  writeFileSync(path, source);
}

function updateFactoryXlsxTests() {
  const path = "tests/xlsx-export.test.ts";
  let source = readFileSync(path, "utf8");

  if (!source.includes("baleAppearsInSessionCompany") && !source.includes("t.skip()")) {
    return;
  }

  source = source.replace(
    /\/\*\*\s*\* Set to true in the "seeded bale appears" check\.[\s\S]*?\*\/\s*let baleAppearsInSessionCompany = false;\s*/,
    `// CI uses an isolated PostgreSQL database, so the seeded bale must always be
// visible through the authenticated test company's export endpoints.
`,
  );

  source = replaceOnce(
    source,
    /it\("seeded bale reference number appears in the export \(sets baleAppearsInSessionCompany\)", async \(t\) => \{/,
    'it("seeded bale reference number appears in the export", async () => {',
    "XLSX seeded-bale test signature",
  );

  source = replaceOnce(
    source,
    /\s*baleAppearsInSessionCompany = refNumbers\.includes\(`\$\{TEST_PREFIX\}-REF-001`\);\s*if \(!baleAppearsInSessionCompany\) \{[\s\S]*?t\.skip\(\);\s*return;\s*\}\s*/,
    "\n",
    "XLSX seeded-bale conditional skip",
  );

  source = source.replace(
    'describe("XLSX Export — Bale Full Export (success path — requires isolated DB)", () => {',
    'describe("XLSX Export — Bale Full Export (success path)", () => {',
  );

  source = source.replaceAll("async (t) => {", "async () => {");
  source = source.replace(
    /\s*if \(!baleAppearsInSessionCompany\) \{\s*t\.skip\(\);[^\n]*\s*return;\s*\}\s*/g,
    "\n",
  );
  source = source.replace(
    /\s*if \(!baleAppearsInSessionCompany\) \{ t\.skip\(\); return; \}\s*/g,
    "\n",
  );

  if (source.includes("baleAppearsInSessionCompany") || source.includes("t.skip()")) {
    throw new Error("Factory XLSX test still contains shared-database skip guards");
  }

  writeFileSync(path, source);
}

updateExcelExportTests();
updateFactoryXlsxTests();
