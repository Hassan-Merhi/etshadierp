import { readFileSync, writeFileSync } from "node:fs";

// Temporary guarded helper for Combo 2; removed before merge.
function replaceExact(source, oldText, newText, label) {
  if (!source.includes(oldText)) {
    throw new Error(`Combo 2 replacement not found: ${label}`);
  }
  return source.replace(oldText, newText);
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

  source = replaceExact(
    source,
    "  if (!templateExists) return; // skip generation; inner tests use it.skip\n",
    "  expect(templateExists, `Required SP export template missing: ${TEMPLATE_PATH}`).toBe(true);\n",
    "excel template guard",
  );

  source = replaceExact(
    source,
    `const maybeIt = templateExists
  ? it
  : it.skip.bind(it, "template missing");`,
    "const maybeIt = it;",
    "excel conditional test alias",
  );

  source = replaceExact(
    source,
    `function requireWb(ctx: { skip: () => void }): ExcelJS.Workbook | null {
  if (!buf || !wb) { ctx.skip(); return null; }
  return wb;
}`,
    `function requireWb(_ctx?: { skip: () => void }): ExcelJS.Workbook {
  expect(buf).toBeDefined();
  expect(wb).toBeDefined();
  return wb;
}`,
    "excel workbook guard",
  );

  const skipLine = "    if (!buf) { ctx.skip(); return; }\n";
  const skipCount = source.split(skipLine).length - 1;
  if (skipCount !== 2) {
    throw new Error(`Expected 2 Excel buffer skip guards, found ${skipCount}`);
  }
  source = source.split(skipLine).join("");

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

  source = replaceExact(
    source,
    `/**
 * Set to true in the "seeded bale appears" check.
 * export-full.xlsx success-path tests are skipped when false to avoid false
 * failures on shared DBs where the session company may contain production data.
 */
let baleAppearsInSessionCompany = false;
`,
    `// CI uses an isolated PostgreSQL database, so the seeded bale must always be
// visible through the authenticated test company's export endpoints.
`,
    "XLSX shared-database flag",
  );

  source = replaceExact(
    source,
    `  it("seeded bale reference number appears in the export (sets baleAppearsInSessionCompany)", async (t) => {`,
    `  it("seeded bale reference number appears in the export", async () => {`,
    "XLSX seeded-bale test signature",
  );

  source = replaceExact(
    source,
    `    baleAppearsInSessionCompany = refNumbers.includes(\`${"${TEST_PREFIX}"}-REF-001\`);

    if (!baleAppearsInSessionCompany) {
      // Shared DB environment: session company has production data, skip.
      // The structural tests above (headers, magic bytes, sheet names) still pass.
      console.info(
        \`[xlsx-export.test] Seeded bale not in export — session company likely \` +
          \`contains production data. Skipping bale-presence assertion.\`,
      );
      t.skip();
      return;
    }

`,
    "",
    "XLSX seeded-bale conditional skip",
  );

  source = source.replace(
    'describe("XLSX Export — Bale Full Export (success path — requires isolated DB)", () => {',
    'describe("XLSX Export — Bale Full Export (success path)", () => {',
  );

  source = source.replaceAll("async (t) => {", "async () => {");

  const multilineSkip = `    if (!baleAppearsInSessionCompany) {
      t.skip(); // shared DB: session company differs — see note at top of file
      return;
    }
`;
  source = source.split(multilineSkip).join("");
  source = source
    .split("    if (!baleAppearsInSessionCompany) { t.skip(); return; }\n")
    .join("");

  if (source.includes("baleAppearsInSessionCompany") || source.includes("t.skip()")) {
    throw new Error("Factory XLSX test still contains shared-database skip guards");
  }

  writeFileSync(path, source);
}

updateExcelExportTests();
updateFactoryXlsxTests();
