#!/usr/bin/env node
/**
 * audit-doc-index.mjs
 *
 * Two jobs, both narrow on purpose.
 *
 * 1. Classification completeness. Every file under docs/ is either a
 *    **reference** (describes how the system behaves now, must stay accurate)
 *    or a **record** (describes work that finished, correct as history). A new
 *    doc with no entry fails, so the choice is made when the doc is written
 *    rather than inferred by the next person to read it.
 *
 * 2. Figure agreement. Documentation rots in one way that a script can actually
 *    catch: a doc states a number that a config file or an audit also states,
 *    and the two drift apart. `docs/god-file-split-program.md` opened with
 *    "139 files, 74,858 lines over the limit" while the config said 64 and
 *    33,432 — a doc whose entire purpose is tracking a number, wrong by more
 *    than a factor of two, in the same repository as the number.
 *
 *    So documented figures are *bound* to their live source here. A binding is
 *    explicit — nobody's prose is scanned for stray digits — and when the
 *    source moves, the doc fails until it is updated.
 *
 * What this cannot do is detect prose that is merely out of date. That is a
 * judgment call, which is why classification is data for review rather than
 * something the audit pretends to verify.
 *
 * Usage:
 *   npm run audit:doc-index
 *   node scripts/audit-doc-index.mjs --json
 *   UPDATE_DOC_INDEX=1 node scripts/audit-doc-index.mjs   # seed/refresh classification
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(projectRoot, "config/doc-index.json");

const VALID_CLASSES = new Set(["reference", "record"]);

function normalizeRelativePath(absolutePath) {
  return path.relative(projectRoot, absolutePath).split(path.sep).join("/");
}

function collectDocs(root, scanConfig, output) {
  const absoluteRoot = path.join(projectRoot, root);
  if (!fs.existsSync(absoluteRoot)) return;

  for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && scanConfig.excludeDirectories.includes(entry.name)) continue;

    const absolutePath = path.join(absoluteRoot, entry.name);
    if (entry.isDirectory()) {
      collectDocs(normalizeRelativePath(absolutePath), scanConfig, output);
      continue;
    }
    if (!scanConfig.extensions.includes(path.extname(entry.name))) continue;
    output.push(normalizeRelativePath(absolutePath));
  }
}

/**
 * Heuristic used only to seed the classification. A doc named for a phase or
 * carrying a completion word is almost always a record of finished work. It is
 * a starting point for the Phase 3a review, never an assertion.
 */
function guessClassification(relativePath) {
  const name = path.basename(relativePath).toLowerCase();
  const looksLikeRecord =
    /(^|[-_])phases?[-_ ]?\d/.test(name) ||
    /phase-?\d/.test(name) ||
    /(complete|completed|checkpoint|summary|status|audit-report|reconciliation|release-gate)/.test(name);
  return looksLikeRecord ? "record" : "reference";
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function resolveJsonPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => (current == null ? current : current[key]), value);
}

/** Resolves a figure's live value from whichever source it is bound to. */
async function resolveFigureSource(source) {
  if (source.kind === "jsonValue") {
    const value = resolveJsonPath(readJson(source.file), source.path);
    if (value === undefined) throw new Error(`${source.file} has no value at ${source.path}`);
    return { value, description: `${source.file} → ${source.path}` };
  }

  if (source.kind === "auditSummary") {
    const modules = {
      "god-files": "./audit-god-file-boundaries.mjs",
      "type-escapes": "./audit-type-escapes.mjs",
    };
    const specifier = modules[source.audit];
    if (!specifier) throw new Error(`Unknown audit "${source.audit}"`);

    const module = await import(specifier);
    const runner = source.audit === "god-files" ? module.auditGodFileBoundaries : module.auditTypeEscapes;
    const summary = runner().summary;
    const value = resolveJsonPath(summary, source.field);
    if (value === undefined) throw new Error(`Audit "${source.audit}" has no summary field ${source.field}`);
    return { value, description: `npm run audit:${source.audit} → summary.${source.field}` };
  }

  throw new Error(`Unknown figure source kind "${source.kind}"`);
}

export async function auditDocIndex() {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const failures = [];
  const warnings = [];

  const docs = [];
  collectDocs(config.scan.root, config.scan, docs);
  docs.sort();

  const classification = config.classification ?? {};

  const unclassified = docs.filter((doc) => classification[doc] === undefined);
  for (const doc of unclassified) {
    failures.push(
      `${doc} has no entry in config/doc-index.json. Classify it as "reference" (describes current behaviour) or "record" (describes finished work).`
    );
  }

  for (const [doc, value] of Object.entries(classification)) {
    if (!VALID_CLASSES.has(value)) {
      failures.push(`${doc} has classification "${value}"; expected "reference" or "record".`);
    }
  }

  const known = new Set(docs);
  const staleEntries = Object.keys(classification).filter((doc) => !known.has(doc));
  for (const doc of staleEntries) {
    warnings.push(`${doc} is classified but no longer exists; remove the entry`);
  }

  // --- Figure agreement ---
  const figureResults = [];
  for (const figure of config.figures ?? []) {
    let resolved;
    try {
      resolved = await resolveFigureSource(figure.source);
    } catch (error) {
      failures.push(`Figure "${figure.id}" could not be resolved: ${error.message}`);
      continue;
    }

    for (const claim of figure.claims) {
      const docPath = path.join(projectRoot, claim.doc);
      if (!fs.existsSync(docPath)) {
        failures.push(`Figure "${figure.id}" cites ${claim.doc}, which does not exist.`);
        continue;
      }

      const text = fs.readFileSync(docPath, "utf8");
      const matches = [...text.matchAll(new RegExp(claim.pattern, "g"))];

      if (matches.length === 0) {
        failures.push(
          `Figure "${figure.id}" expects ${claim.doc} to state it, but the pattern /${claim.pattern}/ matched nothing. ` +
            `If the sentence was reworded, update the pattern; if the claim was removed, drop it from config/doc-index.json.`
        );
        continue;
      }

      for (const match of matches) {
        const claimed = Number(String(match[1]).replace(/,/g, ""));
        const ok = claimed === Number(resolved.value);
        figureResults.push({ id: figure.id, doc: claim.doc, claimed, actual: Number(resolved.value), ok });
        if (!ok) {
          failures.push(
            `${claim.doc} states ${match[1]} for "${figure.id}", but the live value is ${resolved.value} ` +
              `(${resolved.description}). Update the doc — the source of truth is the config, not the prose.`
          );
        }
      }
    }
  }

  const counts = { reference: 0, record: 0 };
  for (const doc of docs) {
    const value = classification[doc];
    if (value === "reference") counts.reference += 1;
    if (value === "record") counts.record += 1;
  }

  return {
    version: config.version,
    failures,
    warnings,
    docs,
    unclassified,
    staleEntries,
    figureResults,
    summary: {
      totalDocs: docs.length,
      reference: counts.reference,
      record: counts.record,
      unclassified: unclassified.length,
      figuresChecked: figureResults.length,
      figureMismatches: figureResults.filter((result) => !result.ok).length,
    },
  };
}

function seedClassification() {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const docs = [];
  collectDocs(config.scan.root, config.scan, docs);
  docs.sort();

  const existing = config.classification ?? {};
  const classification = {};
  let added = 0;
  for (const doc of docs) {
    // Never overwrite a reviewed decision; only fill in what is missing.
    if (existing[doc] !== undefined) {
      classification[doc] = existing[doc];
      continue;
    }
    classification[doc] = guessClassification(doc);
    added += 1;
  }

  config.classification = classification;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { total: docs.length, added };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.UPDATE_DOC_INDEX === "1") {
    const { total, added } = seedClassification();
    console.log(`Doc index refreshed: ${total} docs indexed, ${added} newly classified (heuristic — review them).`);
    process.exit(0);
  }

  const report = await auditDocIndex();

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.failures.length > 0 ? 1 : 0);
  }

  for (const warning of report.warnings) console.warn(`WARNING: ${warning}`);

  if (report.failures.length > 0) {
    console.error(report.failures.join("\n"));
    process.exitCode = 1;
  } else {
    const { summary } = report;
    console.log(
      `Doc index verified: ${summary.totalDocs} docs (${summary.reference} reference, ${summary.record} record), ` +
        `${summary.figuresChecked} documented figures agree with their source.`
    );
  }
}
