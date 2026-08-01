import path from "node:path";
import process from "node:process";
import ts from "typescript";

const rootDir = process.cwd();
const requestedPaths = process.argv.slice(2).map((entry) => entry.replaceAll("\\", "/"));

if (requestedPaths.length === 0) {
  console.error("Provide at least one repository-relative file or directory to inspect.");
  process.exit(2);
}

const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, "tsconfig.json");
if (!configPath) {
  console.error("Unable to locate tsconfig.json.");
  process.exit(2);
}

const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) {
  console.error(ts.formatDiagnosticsWithColorAndContext([configFile.error], diagnosticHost));
  process.exit(2);
}

const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
const program = ts.createProgram({
  rootNames: parsed.fileNames,
  options: parsed.options,
  projectReferences: parsed.projectReferences,
});
const diagnostics = ts.getPreEmitDiagnostics(program);
const relevantDiagnostics = diagnostics.filter((diagnostic) => {
  if (!diagnostic.file) return false;
  const relativePath = path.relative(rootDir, diagnostic.file.fileName).replaceAll(path.sep, "/");
  return requestedPaths.some(
    (requestedPath) =>
      relativePath === requestedPath || relativePath.startsWith(`${requestedPath.replace(/\/$/, "")}/`)
  );
});

if (relevantDiagnostics.length > 0) {
  console.error(ts.formatDiagnosticsWithColorAndContext(relevantDiagnostics, diagnosticHost));
  process.exit(1);
}

console.log(`No TypeScript diagnostics in: ${requestedPaths.join(", ")}`);

function diagnosticHost() {
  return {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => rootDir,
    getNewLine: () => ts.sys.newLine,
  };
}
