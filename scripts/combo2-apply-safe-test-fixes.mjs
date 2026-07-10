import { readFileSync, writeFileSync } from "node:fs";

// Temporary guarded helper for Combo 2; removed before merge.
function replaceOnce(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) {
    throw new Error(`Combo 2 replacement not found: ${label}`);
  }
  return next;
}

function executableLines(source) {
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

function updateExcelExportTests() {
  const path = "tests/excel-export.test.ts";
  let source = readFileSync(path, "utf8");
  const currentCode = executableLines(source);

  if (
    source.includes("Required SP export template missing") &&
    !/it\.skip\s*[.(]/.test(currentCode) &&
    !/(?:ctx|tCtx)\.skip\s*\(/.test(currentCode)
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
  expect(buf, "SP export buffer should be generated").toBeDefined();
  expect(wb, "SP export workbook should be loaded").toBeDefined();
  return wb;
}`,
    "excel workbook guard",
  );

  source = source.replace(/\s*if \(!buf\) \{ ctx\.skip\(\); return; \}\n/g, "\n");

  // The committed template and seeded Shoes row are required fixtures, not optional variants.
  source = source.replace(
    /if \(shoesRow === null\) \{\s*(?:ctx|tCtx)\.skip\(\);[^}]*return;\s*\}/g,
    `expect(shoesRow, 'Required "Shoes" row is missing from the SP export template').not.toBeNull();
    if (shoesRow === null) return;`,
  );

  source = source.replace(
    /\s*if \(!templateExists\) return;\s*/g,
    "\n    expect(templateExists, `Required SP export template missing: ${TEMPLATE_PATH}`).toBe(true);\n",
  );
  source = source.replace(
    /\s*if \(!mvt\) return;[^\n]*\n/g,
    `
    expect(mvt, "Required seeded Shoes stock movement is missing").toBeDefined();
    if (!mvt) throw new Error("Required seeded Shoes stock movement is missing");
`,
  );

  source = replaceOnce(
    source,
    /function rWb\(tCtx: \{ skip: \(\) => void \}\): ExcelJS\.Workbook \| null \{\s*if \(!rbuf \|\| !rwb\) \{ tCtx\.skip\(\); return null; \}\s*return rwb;\s*\}/,
    `function rWb(_tCtx?: { skip: () => void }): ExcelJS.Workbook {
    expect(rbuf, "Regression export buffer should be generated").toBeDefined();
    expect(rwb, "Regression export workbook should be loaded").toBeDefined();
    return rwb;
  }`,
    "regression workbook guard",
  );
  source = replaceOnce(
    source,
    /const rIt = templateExists \? it : it\.skip\.bind\(it, "template missing"\);/,
    "const rIt = it;",
    "regression conditional test alias",
  );
  source = source.replace(/\s*if \(!rbuf\) \{ tCtx\.skip\(\); return; \}\n/g, "\n");

  source = source.replace(
    /if \(!salesWs\) \{ tCtx\.skip\(\); return; \}/g,
    `expect(salesWs, 'Required "Sales" sheet is missing').toBeDefined();
    if (!salesWs) return;`,
  );
  source = source.replace(
    /if \(!templateExists\) \{ tCtx\.skip\(\); return; \}/g,
    `expect(templateExists, \`Required SP export template missing: \${TEMPLATE_PATH}\`).toBe(true);`,
  );

  source = source.replace(
    "// All inner tests use conditional `it` so they stay in the normal test runner\n// (skipped = todoish, no silent-pass, shows intent clearly).",
    "// All workbook checks run as normal tests. Missing required assets fail explicitly.",
  );
  source = source.replace(
    "// Returns the workbook if available, or calls ctx.skip() and returns null.",
    "// Returns the generated workbook; missing setup fails the test explicitly.",
  );
  source = source.replace(
    "// Helper: skip if the regression buffer wasn't generated",
    "// Helper: require the regression workbook to have been generated",
  );

  const updatedCode = executableLines(source);
  if (/it\.skip\s*[.(]/.test(updatedCode) || /(?:ctx|tCtx)\.skip\s*\(/.test(updatedCode)) {
    throw new Error("Excel export test still contains active skip guards");
  }

  writeFileSync(path, source);
}

function updateFactoryXlsxTests() {
  const path = "tests/xlsx-export.test.ts";
  let source = readFileSync(path, "utf8");
  const currentCode = executableLines(source);

  if (
    !/let baleAppearsInSessionCompany\s*=/.test(currentCode) &&
    !/if \(!baleAppearsInSessionCompany\)/.test(currentCode) &&
    !/t\.skip\s*\(\)/.test(currentCode)
  ) {
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

  source = source.replace(
    /\/\/ Error cases always run\.\s+Success-path cases[\s\S]*?session company and we can export it with a known date\.\n/,
    "// Error and success paths both run against the isolated CI database.\n",
  );
  source = source.replace(/\s*\/\/ Skip on shared DB:[^\n]*\n/g, "\n");

  const updatedCode = executableLines(source);
  if (
    /let baleAppearsInSessionCompany\s*=/.test(updatedCode) ||
    /if \(!baleAppearsInSessionCompany\)/.test(updatedCode) ||
    /t\.skip\s*\(\)/.test(updatedCode)
  ) {
    throw new Error("Factory XLSX test still contains active shared-database skip guards");
  }

  writeFileSync(path, source);
}

updateExcelExportTests();
updateFactoryXlsxTests();
