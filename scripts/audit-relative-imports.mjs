import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOTS = ["server", "client/src", "shared", "scripts", "tests"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const RESOLUTION_EXTENSIONS = [
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json",
  ".css", ".scss", ".sass", ".less", ".svg", ".png", ".jpg", ".jpeg",
  ".webp", ".gif", ".pdf", ".wasm", ".sql", ".md", ".html",
];
const EXCLUDED_DIRECTORIES = new Set(["node_modules", "dist", "build", "coverage", ".git", "migrations"]);
const RETIRED_MODULES = new Set([
  "server/routesLegacy.ts",
  "server/routes/reportsRoutesLegacy.ts",
  "server/routes/authRoutesLegacy.ts",
  "server/routes/customerRoutesLegacy.ts",
]);

function normalizeRelative(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function collectSourceFiles(root, relativeRoot, output) {
  const absoluteRoot = path.resolve(root, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return;

  for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = path.join(absoluteRoot, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(root, normalizeRelative(root, absolutePath), output);
      continue;
    }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) output.push(absolutePath);
  }
}

function scriptKindFor(filePath) {
  switch (path.extname(filePath)) {
    case ".tsx": return ts.ScriptKind.TSX;
    case ".jsx": return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs": return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}

function collectModuleSpecifiers(filePath, source) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
  const specifiers = [];

  const add = (node) => {
    if (node && ts.isStringLiteralLike(node)) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      specifiers.push({ specifier: node.text, line: position.line + 1 });
    }
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolutionCandidates(sourcePath, rawSpecifier) {
  const specifier = rawSpecifier.split(/[?#]/, 1)[0];
  const base = path.resolve(path.dirname(sourcePath), specifier);
  const candidates = [base];
  const requestedExtension = path.extname(base);

  if (!requestedExtension) {
    for (const extension of RESOLUTION_EXTENSIONS) candidates.push(`${base}${extension}`);
    for (const extension of RESOLUTION_EXTENSIONS) candidates.push(path.join(base, `index${extension}`));
  } else if ([".js", ".jsx", ".mjs", ".cjs"].includes(requestedExtension)) {
    const withoutExtension = base.slice(0, -requestedExtension.length);
    for (const extension of [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]) {
      candidates.push(`${withoutExtension}${extension}`);
    }
  }

  return [...new Set(candidates)];
}

function retiredTarget(root, candidates) {
  for (const candidate of candidates) {
    const relativePath = normalizeRelative(root, candidate);
    if (RETIRED_MODULES.has(relativePath)) return relativePath;
  }
  return null;
}

export function auditRelativeImports({ root = DEFAULT_ROOT } = {}) {
  const files = [];
  for (const sourceRoot of SOURCE_ROOTS) collectSourceFiles(root, sourceRoot, files);
  files.sort();

  const failures = [];
  let checkedImports = 0;

  for (const sourcePath of files) {
    const source = fs.readFileSync(sourcePath, "utf8");
    const sourceRelative = normalizeRelative(root, sourcePath);

    for (const { specifier, line } of collectModuleSpecifiers(sourcePath, source)) {
      if (!specifier.startsWith(".")) continue;
      checkedImports += 1;
      const candidates = resolutionCandidates(sourcePath, specifier);
      const retired = retiredTarget(root, candidates);
      if (retired) {
        failures.push(`${sourceRelative}:${line} imports retired module ${specifier} (${retired})`);
        continue;
      }
      if (!candidates.some(isFile)) {
        failures.push(`${sourceRelative}:${line} cannot resolve relative import ${specifier}`);
      }
    }
  }

  return {
    failures,
    scannedFiles: files.length,
    checkedImports,
    roots: [...SOURCE_ROOTS],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = auditRelativeImports();
  if (report.failures.length > 0) {
    console.error("Relative import audit failed:");
    for (const failure of report.failures) console.error(` - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`Relative imports verified across ${report.scannedFiles} source files (${report.checkedImports} relative imports).`);
  }
}
