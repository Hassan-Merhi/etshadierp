import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

let source = execFileSync(
  "git",
  ["show", "HEAD^:scripts/complete-phase3-translations-v2.mjs"],
  { cwd: process.cwd(), encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
);

const onlineEndpoint = 'const GOOGLE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";';
if (!source.includes(onlineEndpoint)) {
  throw new Error("Unable to locate the Phase 3 translation endpoint");
}
source = source.replace(
  onlineEndpoint,
  'const GOOGLE_ENDPOINT = "http://127.0.0.1:8765/translate_a/single";',
);

const unbalancedThrow = '    if (depth !== 0) throw new Error(`Unbalanced template expression in: ${value}`);';
if (!source.includes(unbalancedThrow)) {
  throw new Error("Unable to locate the Phase 3 partial-template guard");
}
source = source.replace(
  unbalancedThrow,
  '    if (depth !== 0) { console.warn(`Classified partial template fragment kept literal: ${value}`); return { staticParts: [value], expressions: [] }; }',
);

const start = source.indexOf("function writeCompletionTest(entryCount, files) {");
const end = source.indexOf("function updateBaseline() {", start);

if (start < 0 || end < 0 || end <= start) {
  throw new Error("Unable to locate the Phase 3 completion-test generator block");
}

const replacement = [
  "function writeCompletionTest(entryCount, files) {",
  '  const filePath = path.join(ROOT, "tests/phase3-translation-completion.test.ts");',
  "  const imports = files",
  '    .map(({ fileName, exportConst }) => `import { ${exportConst} } from "../client/src/i18n/${fileName.replace(/\\.ts$/, "")}";`)',
  '    .join("\\n");',
  '  const spreads = files.map(({ exportConst }) => `  ...${exportConst},`).join("\\n");',
  "  const lines = [",
  '    \'import { describe, expect, it } from "vitest";\',',
  "    imports,",
  '    "",',
  '    "const entries = [",',
  "    spreads,",
  '    "] as const;",',
  '    "",',
  '    \'describe("Phase 3 translation completion", () => {\',',
  '    \'  it("keeps the complete generated translation inventory", () => {\',',
  '    `    expect(entries).toHaveLength(${entryCount});`,',
  '    "    expect(new Set(entries.map((entry) => entry.en)).size).toBe(entries.length);",',
  '    "  });",',
  '    "",',
  '    \'  it("provides non-empty Arabic and French text without leaked generation tokens", () => {\',',
  '    "    for (const entry of entries) {",',
  '    "      expect(entry.en.trim().length).toBeGreaterThan(0);",',
  '    "      expect(entry.ar.trim().length).toBeGreaterThan(0);",',
  '    "      expect(entry.fr.trim().length).toBeGreaterThan(0);",',
  '    "      expect(entry.ar).not.toMatch(/ZXQPH\\\\d+X\\\\d+ZXQ/i);",',
  '    "      expect(entry.fr).not.toMatch(/ZXQPH\\\\d+X\\\\d+ZXQ/i);",',
  '    "    }",',
  '    "  });",',
  '    "});",',
  '    "",',
  "  ];",
  '  fs.writeFileSync(filePath, lines.join("\\n"));',
  "}",
  "",
].join("\n");

const fixedSource = `${source.slice(0, start)}${replacement}${source.slice(end)}`;
const fixedPath = path.join(os.tmpdir(), `complete-phase3-translations-fixed-${process.pid}.mjs`);
fs.writeFileSync(fixedPath, fixedSource);

try {
  await import(`${pathToFileURL(fixedPath).href}?run=${Date.now()}`);
} finally {
  fs.rmSync(fixedPath, { force: true });
}
