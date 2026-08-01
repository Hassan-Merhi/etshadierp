import path from "node:path";
import process from "node:process";
import ts from "typescript";

const [target, startText, endText, codeText] = process.argv.slice(2);
const startLine = Number(startText);
const endLine = Number(endText);
const diagnosticCode = codeText ? Number(codeText) : null;
const rootDir = process.cwd();
const host = {
  getCanonicalFileName: (fileName) => fileName,
  getCurrentDirectory: () => rootDir,
  getNewLine: () => ts.sys.newLine,
};

if (!target || !Number.isInteger(startLine) || !Number.isInteger(endLine)) {
  console.error("Usage: node scripts/phase4-typecheck-range.mjs <file> <start> <end> [code]");
  process.exit(2);
}

const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, "tsconfig.json");
if (!configPath) process.exit(2);
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
const diagnostics = ts.getPreEmitDiagnostics(program).filter((diagnostic) => {
  if (!diagnostic.file || diagnostic.start === undefined) return false;
  const relative = path.relative(rootDir, diagnostic.file.fileName).replaceAll(path.sep, "/");
  if (relative !== target) return false;
  const line = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1;
  if (line < startLine || line > endLine) return false;
  return diagnosticCode === null || diagnostic.code === diagnosticCode;
});

if (diagnostics.length > 0) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
  process.exit(1);
}
console.log(
  `No diagnostics${diagnosticCode === null ? "" : ` TS${diagnosticCode}`} in ${target}:${startLine}-${endLine}`
);
