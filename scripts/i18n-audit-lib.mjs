import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DETECTOR_VERSION = 2;

const DEFAULT_EXTENSIONS = new Set([".ts", ".tsx"]);

function normalizePath(file) {
  return file.split(path.sep).join("/");
}

function compilePatterns(patterns = []) {
  return patterns.map((pattern) => new RegExp(pattern, "i"));
}

function stripInlineComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length - 1; index += 1) {
    const character = line[index];
    const next = line[index + 1];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "/" && next === "/") return line.slice(0, index);
  }
  return line;
}

function stripBlockComments(lines) {
  let inBlockComment = false;
  return lines.map((line) => {
    let output = "";
    let index = 0;
    let quote = null;
    let escaped = false;
    while (index < line.length) {
      const character = line[index];
      const next = line[index + 1];
      if (inBlockComment) {
        if (character === "*" && next === "/") {
          inBlockComment = false;
          index += 2;
        } else {
          index += 1;
        }
        continue;
      }
      if (escaped) {
        output += character;
        escaped = false;
        index += 1;
        continue;
      }
      if (character === "\\") {
        output += character;
        escaped = true;
        index += 1;
        continue;
      }
      if (quote) {
        output += character;
        if (character === quote) quote = null;
        index += 1;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
        output += character;
        index += 1;
        continue;
      }
      if (character === "/" && next === "*") {
        inBlockComment = true;
        index += 2;
        continue;
      }
      output += character;
      index += 1;
    }
    return stripInlineComment(output);
  });
}

function lineNumberAt(source, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function addMatches({ candidates, source, file, kind, expression, textGroup = 1, nameGroup = 0 }) {
  for (const match of source.matchAll(expression)) {
    const text = (match[textGroup] ?? "").replace(/\\(["'`])/g, "$1").trim();
    if (!text) continue;
    candidates.push({
      file,
      line: lineNumberAt(source, match.index ?? 0),
      column: (match.index ?? 0) - source.lastIndexOf("\n", (match.index ?? 0) - 1),
      kind,
      name: nameGroup > 0 ? match[nameGroup] : null,
      text,
    });
  }
}

function looksLikeStandaloneJsxText(lines, index) {
  const text = lines[index].trim();
  if (!text || text.length > 160) return false;
  if (!/^[A-Za-z][A-Za-z0-9\s,.'!?&/():%+\-–—…]+$/.test(text)) return false;
  const previous = [...lines.slice(0, index)].reverse().find((line) => line.trim())?.trim() ?? "";
  const next = lines.slice(index + 1).find((line) => line.trim())?.trim() ?? "";
  return previous.endsWith(">") && !previous.endsWith("/>") && next.startsWith("<");
}

export function classifyText(text) {
  const value = text.trim();
  if (!/[A-Za-z]/.test(value)) return { status: "excluded", category: "non-linguistic" };
  if (/^[a-z][a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/.test(value)) {
    return { status: "excluded", category: "translation-key" };
  }
  if (/^(?:https?:\/\/|mailto:|tel:|\/api\/|api\/|ws:\/\/|wss:\/\/)/i.test(value)) {
    return { status: "excluded", category: "technical-route" };
  }
  if (/^(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+\//.test(value)) {
    return { status: "excluded", category: "technical-route" };
  }
  if (/^(?:application|text|image|audio|video)\/[a-z0-9.+-]+$/i.test(value)) {
    return { status: "excluded", category: "mime-type" };
  }
  if (/^(?:yyyy|yy|MM|MMM|dd|HH|hh|mm|ss|UTC|ISO|dd\/MM\/yyyy|MM\/dd\/yyyy)(?:[\s/:.-].*)?$/i.test(value)) {
    return { status: "excluded", category: "format-token" };
  }
  if (/^(?:#[0-9a-f]{3,8}|rgb\(|hsl\(|var\(--|\.|\[data-|[a-z-]+:[a-z-]+$)/i.test(value)) {
    return { status: "excluded", category: "style-token" };
  }
  if (/^[A-Z0-9][A-Z0-9_./:+-]{0,14}$/.test(value)) {
    return { status: "excluded", category: "acronym-or-code" };
  }
  if (/^[a-z][a-zA-Z0-9]*(?:Id|ID|Key|Code|Type|Status|At|Url|URL|Path)$/.test(value)) {
    return { status: "excluded", category: "technical-identifier" };
  }
  if (/^(?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|mjs|json|css|sql|pdf|xlsx?|csv|png|jpe?g|svg)$/i.test(value)) {
    return { status: "excluded", category: "file-path" };
  }
  if (/^(?:SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|WITH)\b/i.test(value)) {
    return { status: "excluded", category: "sql-or-code" };
  }
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(value) && !value.includes(" ")) {
    return { status: "excluded", category: "technical-identifier" };
  }
  if (/^\$\{[^}]+\}$/.test(value)) {
    return { status: "excluded", category: "template-only" };
  }
  return { status: "actionable", category: "user-facing-literal" };
}

export function resolveModule(file, moduleRules = []) {
  const normalized = normalizePath(file).toLowerCase();
  for (const rule of moduleRules) {
    if (compilePatterns(rule.patterns).some((pattern) => pattern.test(normalized))) return rule.module;
  }
  if (normalized.startsWith("server/")) return "backend-messages";
  if (normalized.startsWith("shared/")) return "shared-contracts";
  if (normalized.startsWith("client/src/components/")) return "shared-ui";
  if (normalized.startsWith("client/src/")) return "other-client";
  return "unmapped";
}

export function scanSource(file, rawSource, policy) {
  const normalizedFile = normalizePath(file);
  const protectedMarkers = policy.protectedMarkers ?? [];
  const rawLines = rawSource.split(/\r?\n/);
  const lines = stripBlockComments(rawLines);
  const source = lines.join("\n");
  const candidates = [];
  const isTsx = path.extname(file) === ".tsx";

  if (isTsx) {
    addMatches({
      candidates,
      source,
      file: normalizedFile,
      kind: "jsx-attribute",
      expression: /\b(title|placeholder|aria-label|alt)\s*=\s*(["'])(.*?)\2/g,
      textGroup: 3,
      nameGroup: 1,
    });
    addMatches({
      candidates,
      source,
      file: normalizedFile,
      kind: "jsx-text",
      expression: />([^<>{}\n][^<>{]{1,160})</g,
    });
    addMatches({
      candidates,
      source,
      file: normalizedFile,
      kind: "jsx-expression-text",
      expression: /\{\s*(["'`])([^"'`{}]{2,160})\1\s*\}/g,
      textGroup: 2,
    });
    lines.forEach((line, index) => {
      if (!looksLikeStandaloneJsxText(lines, index)) return;
      candidates.push({
        file: normalizedFile,
        line: index + 1,
        column: rawLines[index].indexOf(line.trim()) + 1,
        kind: "jsx-text-multiline",
        name: null,
        text: line.trim(),
      });
    });
  }

  addMatches({
    candidates,
    source,
    file: normalizedFile,
    kind: "ui-object-property",
    expression: /\b(title|description|message|error|warning|success|label|subject|filename|placeholder)\s*:\s*(["'`])((?:\\.|(?!\2).){2,240})\2/g,
    textGroup: 3,
    nameGroup: 1,
  });
  addMatches({
    candidates,
    source,
    file: normalizedFile,
    kind: "named-ui-constant",
    expression: /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:Label|Title|Description|Message|Placeholder|Subject)\w*\s*=\s*(["'`])((?:\\.|(?!\1).){2,240})\1/g,
    textGroup: 2,
  });
  addMatches({
    candidates,
    source,
    file: normalizedFile,
    kind: "error-constructor",
    expression: /\b(?:new\s+Error|Error|send|statusText)\s*\(\s*(["'`])((?:\\.|(?!\1).){2,240})\1/g,
    textGroup: 2,
  });

  const deduplicated = new Map();
  for (const candidate of candidates) {
    const originalLine = rawLines[candidate.line - 1] ?? "";
    if (protectedMarkers.some((marker) => originalLine.includes(marker))) continue;
    const classification = classifyText(candidate.text);
    const module = resolveModule(candidate.file, policy.moduleRules ?? []);
    const key = [candidate.file, candidate.line, candidate.kind, candidate.name ?? "", candidate.text].join("|");
    deduplicated.set(key, { ...candidate, module, ...classification });
  }
  return [...deduplicated.values()];
}

function shouldIgnorePath(file, policy) {
  const normalized = normalizePath(file);
  return (policy.ignoredPathRules ?? []).some((rule) => new RegExp(rule.pattern, "i").test(normalized));
}

function walk(directory, policy, files) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ((policy.ignoredDirectories ?? []).includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, policy, files);
    else if ((policy.extensions ?? [...DEFAULT_EXTENSIONS]).includes(path.extname(entry.name))) files.push(full);
  }
}

export function policyDigest(policy) {
  return crypto.createHash("sha256").update(JSON.stringify(policy)).digest("hex");
}

export function buildReport(policy, cwd = process.cwd()) {
  const files = [];
  for (const root of policy.roots ?? []) walk(path.join(cwd, root), policy, files);
  const findings = [];
  for (const absoluteFile of files.sort()) {
    const relativeFile = normalizePath(path.relative(cwd, absoluteFile));
    if (shouldIgnorePath(relativeFile, policy)) continue;
    const source = fs.readFileSync(absoluteFile, "utf8");
    findings.push(...scanSource(relativeFile, source, policy));
  }

  const modules = {};
  const excludedCategories = {};
  const filesByActionableCount = {};
  for (const finding of findings) {
    modules[finding.module] ??= { candidates: 0, actionable: 0, excluded: 0 };
    modules[finding.module].candidates += 1;
    modules[finding.module][finding.status] += 1;
    if (finding.status === "excluded") {
      excludedCategories[finding.category] = (excludedCategories[finding.category] ?? 0) + 1;
    } else {
      filesByActionableCount[finding.file] = (filesByActionableCount[finding.file] ?? 0) + 1;
    }
  }

  const actionable = findings.filter((finding) => finding.status === "actionable").length;
  const excluded = findings.length - actionable;
  return {
    schemaVersion: 2,
    detectorVersion: DETECTOR_VERSION,
    policyDigest: policyDigest(policy),
    totals: { candidates: findings.length, actionable, excluded, unclassified: 0 },
    modules: Object.fromEntries(Object.entries(modules).sort(([left], [right]) => left.localeCompare(right))),
    excludedCategories: Object.fromEntries(
      Object.entries(excludedCategories).sort(([, left], [, right]) => right - left)
    ),
    topActionableFiles: Object.entries(filesByActionableCount)
      .sort(([, left], [, right]) => right - left)
      .slice(0, 50)
      .map(([file, count]) => ({ file, count })),
    findings,
  };
}

export function createSuggestedBaseline(report, metadata = {}) {
  return {
    schemaVersion: 2,
    detectorVersion: report.detectorVersion,
    policyDigest: report.policyDigest,
    reviewedAt: metadata.reviewedAt ?? null,
    reviewedHead: metadata.reviewedHead ?? null,
    description:
      metadata.description ??
      "Reviewed untranslated-text ceiling. Actionable counts may only decrease unless the baseline is explicitly re-reviewed.",
    maxActionable: report.totals.actionable,
    modules: Object.fromEntries(
      Object.entries(report.modules).map(([module, counts]) => [module, { maxActionable: counts.actionable }])
    ),
    maxUnclassified: 0,
  };
}

export function enforceBaseline(report, baseline) {
  const errors = [];
  if (baseline.schemaVersion !== 2) errors.push("Baseline schemaVersion must be 2.");
  if (baseline.detectorVersion !== report.detectorVersion) {
    errors.push(`Detector version changed from ${baseline.detectorVersion} to ${report.detectorVersion}; re-review required.`);
  }
  if (baseline.policyDigest !== report.policyDigest) {
    errors.push("Audit policy changed; regenerate and review the module baseline before merging.");
  }
  if (report.totals.actionable > baseline.maxActionable) {
    errors.push(`Actionable literals increased from ${baseline.maxActionable} to ${report.totals.actionable}.`);
  }
  if (report.totals.unclassified > (baseline.maxUnclassified ?? 0)) {
    errors.push(`Unclassified literals increased to ${report.totals.unclassified}.`);
  }
  for (const [module, counts] of Object.entries(report.modules)) {
    const moduleBaseline = baseline.modules?.[module];
    if (!moduleBaseline && counts.actionable > 0) {
      errors.push(`New module ${module} has ${counts.actionable} actionable literals without a reviewed baseline.`);
      continue;
    }
    if (moduleBaseline && counts.actionable > moduleBaseline.maxActionable) {
      errors.push(`${module} actionable literals increased from ${moduleBaseline.maxActionable} to ${counts.actionable}.`);
    }
  }
  return errors;
}

export function renderMarkdown(report, baseline = null) {
  const lines = [
    "# Untranslated-text audit report",
    "",
    `- Detector version: ${report.detectorVersion}`,
    `- Candidate literals: ${report.totals.candidates}`,
    `- Actionable user-facing literals: ${report.totals.actionable}`,
    `- Reviewed exclusions: ${report.totals.excluded}`,
    `- Unclassified: ${report.totals.unclassified}`,
    baseline?.reviewedHead ? `- Reviewed baseline head: \`${baseline.reviewedHead}\`` : null,
    "",
    "## Counts by module",
    "",
    "| Module | Candidates | Actionable | Excluded | Baseline ceiling |",
    "|---|---:|---:|---:|---:|",
  ].filter(Boolean);
  for (const [module, counts] of Object.entries(report.modules)) {
    lines.push(
      `| ${module} | ${counts.candidates} | ${counts.actionable} | ${counts.excluded} | ${baseline?.modules?.[module]?.maxActionable ?? "Not reviewed"} |`
    );
  }
  lines.push("", "## Reviewed exclusion categories", "", "| Category | Count |", "|---|---:|");
  for (const [category, count] of Object.entries(report.excludedCategories)) lines.push(`| ${category} | ${count} |`);
  lines.push("", "## Highest-priority files", "", "| File | Actionable literals |", "|---|---:|");
  for (const item of report.topActionableFiles) lines.push(`| \`${item.file}\` | ${item.count} |`);
  lines.push(
    "",
    "Actionable counts are a migration backlog, not proof that each literal is incorrect. Every increase is blocked per module; reductions lower the ratchet after review."
  );
  return `${lines.join("\n")}\n`;
}
