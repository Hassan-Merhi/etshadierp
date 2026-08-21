#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import ts from "typescript";

const root = process.cwd();

const targets = [
  {
    path: "client/src/pages/factory/FactoryInvoiceDetail.tsx",
    hookPath: "client/src/pages/factory/factoryinvoicedetail/useFactoryInvoiceDetailModel.tsx",
    hookName: "useFactoryInvoiceDetailModel",
  },
  {
    path: "client/src/pages/factory/BalesHistory.tsx",
    hookPath: "client/src/pages/factory/baleshistory/useBalesHistoryModel.tsx",
    hookName: "useBalesHistoryModel",
  },
  {
    path: "client/src/pages/factory/FactoryPendingInvoiceVerify.tsx",
    hookPath: "client/src/pages/factory/factorypendinginvoiceverify/useFactoryPendingInvoiceVerifyModel.tsx",
    hookName: "useFactoryPendingInvoiceVerifyModel",
  },
];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function write(rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content.endsWith("\n") ? content : `${content}\n`);
}

function bindingNames(name, out) {
  if (ts.isIdentifier(name)) {
    out.push(name.text);
    return;
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      bindingNames(element.name, out);
    }
  }
}

function referenced(text, name) {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`).test(text);
}

function filterImports(sourceFile, source, bodyText) {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const kept = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause) {
      kept.push(statement);
      continue;
    }

    let defaultName;
    if (clause.name && referenced(bodyText, clause.name.text)) defaultName = clause.name;

    let namedBindings;
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        if (referenced(bodyText, clause.namedBindings.name.text)) namedBindings = clause.namedBindings;
      } else {
        const elements = clause.namedBindings.elements.filter((element) => referenced(bodyText, element.name.text));
        if (elements.length > 0) {
          namedBindings = ts.factory.updateNamedImports(clause.namedBindings, elements);
        }
      }
    }

    if (!defaultName && !namedBindings) continue;
    const nextClause = ts.factory.updateImportClause(clause, clause.isTypeOnly, defaultName, namedBindings);
    kept.push(
      ts.factory.updateImportDeclaration(
        statement,
        statement.modifiers,
        nextClause,
        statement.moduleSpecifier,
        statement.attributes
      )
    );
  }
  return kept.map((node) => printer.printNode(ts.EmitHint.Unspecified, node, sourceFile)).join("\n");
}

function componentFunction(sourceFile) {
  return sourceFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
  );
}

function splitTarget(target) {
  const source = read(target.path);
  const sourceFile = ts.createSourceFile(target.path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = componentFunction(sourceFile);
  if (!component?.body || !component.name) throw new Error(`Default component function not found in ${target.path}`);

  const bodyStatements = [...component.body.statements];
  const splitIndex = bodyStatements.findIndex((statement) => {
    if (!ts.isIfStatement(statement)) return false;
    return /\breturn\s*\(/.test(statement.getText(sourceFile));
  });
  if (splitIndex < 1) throw new Error(`Render guard split not found in ${target.path}`);

  const moved = bodyStatements.slice(0, splitIndex);
  const remaining = bodyStatements.slice(splitIndex);
  const movedStart = moved[0].getFullStart();
  const movedEnd = moved[moved.length - 1].end;
  const remainingStart = remaining[0].getFullStart();
  const movedText = source.slice(movedStart, movedEnd).trim();
  const remainingText = source.slice(remainingStart, component.body.end - 1).trim();

  const declared = [];
  for (const statement of moved) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) bindingNames(declaration.name, declared);
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      declared.push(statement.name.text);
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      declared.push(statement.name.text);
    }
  }
  const returned = [...new Set(declared)].filter((name) => referenced(remainingText, name));
  if (returned.length === 0) throw new Error(`No model bindings found for ${target.path}`);

  const hookImports = filterImports(sourceFile, source, movedText);
  const hookBody = `${movedText}\n\n  return {\n${returned.map((name) => `    ${name},`).join("\n")}\n  } as const;`;
  const hookSource = `${hookImports}\n\nexport function ${target.hookName}() {\n${hookBody}\n}\n`;
  write(target.hookPath, hookSource);

  const destructure = `  const {\n${returned.map((name) => `    ${name},`).join("\n")}\n  } = ${target.hookName}();`;
  const parentBody = `${destructure}\n\n  ${remainingText.replace(/\n/g, "\n  ")}\n`;
  const parentUsageText = parentBody;
  const parentImports = filterImports(sourceFile, source, parentUsageText);
  const relHook = `./${path.relative(path.dirname(target.path), target.hookPath).replaceAll(path.sep, "/").replace(/\.tsx$/, "")}`;
  const hookImport = `import { ${target.hookName} } from "${relHook}";`;

  const headerStart = component.getStart(sourceFile);
  const headerEnd = component.body.getStart(sourceFile) + 1;
  const header = source.slice(headerStart, headerEnd);
  const parentSource = `${parentImports}\n${hookImport}\n\n${header}\n${parentBody}}\n`;
  write(target.path, parentSource);

  console.log(
    `WAVE5_SPLIT ${target.path}: moved=${movedText.split("\n").length} bindings=${returned.length} hook=${target.hookPath}`
  );
}

function lineCount(rel) {
  return read(rel).split("\n").length - 1;
}

function gitShow(refPath) {
  return execFileSync("git", ["show", refPath], { encoding: "utf8" });
}

function changedSourcePaths() {
  const output = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMR", "origin/main", "--", "client/src", "server", "shared", "tests", "scripts"],
    { encoding: "utf8" }
  );
  return output
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(value));
}

function finalizeRatchets() {
  const branchConfig = JSON.parse(gitShow("HEAD:config/god-file-boundaries.json"));
  const godPath = "config/god-file-boundaries.json";
  const god = JSON.parse(read(godPath));
  const finalVersion = Math.max(Number(branchConfig.version) || 0, Number(god.version) || 0) + 1;
  const soft = god.repositoryScan.softMaxLines;
  const nextGrandfathered = {};
  for (const [rel, cap] of Object.entries(god.repositoryScan.grandfathered)) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const lines = lineCount(rel);
    if (lines > soft) nextGrandfathered[rel] = cap;
  }
  god.version = finalVersion;
  god.description = `Version ${finalVersion} reconciles the cumulative God Files branch with current main and completes cumulative Wave 5 by retiring FactoryInvoiceDetail.tsx, BalesHistory.tsx, and FactoryPendingInvoiceVerify.tsx through focused typed model-hook extraction while preserving the existing page render paths. ${god.description}`;
  god.repositoryScan.grandfathered = nextGrandfathered;
  write(godPath, JSON.stringify(god, null, 2));

  const remaining = Object.keys(nextGrandfathered);
  const excess = remaining.reduce((sum, rel) => sum + Math.max(0, lineCount(rel) - soft), 0);
  if (remaining.length !== 5) {
    throw new Error(`Expected 5 God Files after Wave 5, got ${remaining.length}: ${remaining.join(", ")}`);
  }
  for (const target of targets) {
    if (lineCount(target.path) > soft) throw new Error(`${target.path} is still ${lineCount(target.path)} lines`);
    if (lineCount(target.hookPath) > soft) throw new Error(`${target.hookPath} is ${lineCount(target.hookPath)} lines`);
  }

  const testPath = "tests/god-file-boundaries.test.ts";
  let test = read(testPath);
  test = test.replace(/expect\(report\.version\)\.toBe\(\d+\);/, `expect(report.version).toBe(${finalVersion});`);
  test = test.replace(
    /expect\(report\.summary\.grandfatheredFiles\)\.toBeLessThanOrEqual\(\d+\);/,
    `expect(report.summary.grandfatheredFiles).toBeLessThanOrEqual(${remaining.length});`
  );
  test = test.replace(
    /expect\(report\.summary\.grandfatheredExcessLines\)\.toBeLessThanOrEqual\(\d+\);/,
    `expect(report.summary.grandfatheredExcessLines).toBeLessThanOrEqual(${excess});`
  );
  write(testPath, test);

  const splitDocPath = "docs/god-file-split-program.md";
  let splitDoc = read(splitDocPath);
  splitDoc = splitDoc.replace(
    /\*\*Backlog: [\d,]+ files, [\d,]+ lines over the limit\*\*/,
    `**Backlog: ${remaining.length.toLocaleString()} files, ${excess.toLocaleString()} lines over the limit**`
  );
  write(splitDocPath, splitDoc);

  const typePath = "config/type-escape-boundaries.json";
  const typeConfig = JSON.parse(read(typePath));
  const mainCeiling = Number(typeConfig.totals?.typeEscapeCeiling ?? Number.MAX_SAFE_INTEGER);
  const audit = spawnSync(process.execPath, ["scripts/audit-type-escapes.mjs", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!audit.stdout) throw new Error(`Type-escape audit produced no JSON: ${audit.stderr}`);
  const report = JSON.parse(audit.stdout);
  const counts = new Map(report.files.map((file) => [file.path, file]));
  const changed = changedSourcePaths();
  for (const rel of changed) {
    const file = counts.get(rel);
    if (file && file.total > 0) {
      typeConfig.scan.baseline[rel] = [file.explicitAny, file.asAny, file.suppressions];
    } else {
      delete typeConfig.scan.baseline[rel];
    }
  }
  for (const rel of Object.keys(typeConfig.scan.baseline)) {
    if (!fs.existsSync(path.join(root, rel))) delete typeConfig.scan.baseline[rel];
  }
  const measured = Number(report.summary.typeEscapeTotal);
  if (measured > mainCeiling) {
    throw new Error(`Wave 5 would raise current-main type escapes ${mainCeiling} -> ${measured}`);
  }
  typeConfig.totals = { ...(typeConfig.totals ?? {}), typeEscapeCeiling: measured };
  write(typePath, JSON.stringify(typeConfig, null, 2));

  const qualityPath = "docs/system-quality-program.md";
  let quality = read(qualityPath);
  quality = quality.replace(
    /God-file backlog \| [\d,]+ files, [\d,]+ excess lines/,
    `God-file backlog | ${remaining.length.toLocaleString()} files, ${excess.toLocaleString()} excess lines`
  );
  quality = quality.replace(/Type escapes \(AST\) \| [\d,]+ total/, `Type escapes (AST) | ${measured.toLocaleString()} total`);
  write(qualityPath, quality);

  console.log(`WAVE5_RATCHETS version=${finalVersion} files=${remaining.length} excess=${excess} typeEscapes=${measured}`);
}

const mode = process.argv[2];
if (mode === "split") {
  for (const target of targets) splitTarget(target);
} else if (mode === "finalize") {
  finalizeRatchets();
} else {
  throw new Error("Usage: node scripts/tmp-god-files-wave5.mjs <split|finalize>");
}
