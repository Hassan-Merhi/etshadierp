#!/usr/bin/env node
/**
 * audit-doc-index.mjs
 *
 * Documentation has two states in this repository:
 *
 * - **reference** — describes how the system behaves now and belongs under
 *   docs/ outside docs/archive/;
 * - **record** — describes completed work and belongs under docs/archive/.
 *
 * This audit enforces that state model rather than relying on naming habits.
 * It also binds selected numerical claims to live sources and requires every
 * current reference document to be discoverable from docs/README.md.
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
const ARCHIVE_ROOT = "docs/archive";
const DOCS_README = "docs/README.md";

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
 * Heuristic used only to seed a missing classification. It is never used by the
 * audit to decide whether a reviewed file is current or historical.
 */
function guessClassification(relativePath) {
  if (relativePath.startsWith(`${ARCHIVE_ROOT}/`)) return "record";
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

function localMarkdownTargets(fromDoc, text) {
  const targets = [];
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;

  for (const match of text.matchAll(linkPattern)) {
    let raw = String(match[1] ?? "").trim();
    if (!raw) continue;

    // Strip the optional <...> wrapper used for paths containing spaces.
    if (raw.startsWith("<") && raw.includes(">")) raw = raw.slice(1, raw.indexOf(">"));
    else raw = raw.split(/\s+["']/)[0];

    if (/^(?:https?:|mailto:|tel:|#)/i.test(raw)) continue;
    const withoutFragment = raw.split("#")[0].split("?")[0];
    if (!withoutFragment.toLowerCase().endsWith(".md")) continue;

    const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromDoc), withoutFragment));
    targets.push(target);
  }

  return targets;
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
  const known = new Set(docs);

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

  // A stale row is not harmless metadata. It makes the index claim that a
  // document still exists and can hide a rename/move that was never reviewed.
  const staleEntries = Object.keys(classification).filter((doc) => !known.has(doc));
  for (const doc of staleEntries) {
    failures.push(`${doc} is classified but no longer exists. Remove the stale row or classify the renamed file.`);
  }

  // Classification and location must agree. A historical record outside the
  // archive looks current to a reader; a live reference inside it is hidden.
  const misplaced = [];
  for (const doc of docs) {
    const value = classification[doc];
    if (value === undefined) continue;
    const archived = doc.startsWith(`${ARCHIVE_ROOT}/`);
    if (value === "record" && !archived) {
      misplaced.push(`${doc} is a record but sits outside ${ARCHIVE_ROOT}/. Move it there.`);
    }
    if (value === "reference" && archived) {
      misplaced.push(
        `${doc} is under ${ARCHIVE_ROOT}/ but classified "reference". Either move it out, or reclassify it.`
      );
    }
  }
  failures.push(...misplaced);

  // Every live reference must be discoverable from the landing page. This is
  // intentionally exact: adding a current doc without putting it in the index
  // is equivalent to shipping a feature without a navigation path to it.
  const readmePath = path.join(projectRoot, DOCS_README);
  const readmeTargets = fs.existsSync(readmePath)
    ? localMarkdownTargets(DOCS_README, fs.readFileSync(readmePath, "utf8"))
    : [];
  const readmeTargetSet = new Set(readmeTargets);
  const referenceDocs = docs.filter((doc) => classification[doc] === "reference" && doc !== DOCS_README);
  const readmeMissingReferences = referenceDocs.filter((doc) => !readmeTargetSet.has(doc));
  for (const doc of readmeMissingReferences) {
    failures.push(`${doc} is a current reference but is not linked from ${DOCS_README}.`);
  }

  // The current-doc landing page must not send readers straight into a completed
  // phase record as if it described current behaviour.
  const readmeRecordLinks = [...new Set(readmeTargets.filter((doc) => classification[doc] === "record"))];
  for (const doc of readmeRecordLinks) {
    failures.push(`${DOCS_README} links directly to archived record ${doc} as documentation navigation.`);
  }

  // A local .md link in the landing page that does not resolve is a broken
  // navigation entry. Limit this check to the landing page; prose elsewhere can
  // legitimately link to repository files outside docs/ and is a separate lint
  // concern.
  const readmeBrokenLinks = [...new Set(readmeTargets.filter((doc) => doc.startsWith("docs/") && !known.has(doc)))];
  for (const doc of readmeBrokenLinks) {
    failures.push(`${DOCS_README} links to ${doc}, but that Markdown document does not exist.`);
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
    misplaced,
    readmeMissingReferences,
    readmeRecordLinks,
    readmeBrokenLinks,
    figureResults,
    summary: {
      totalDocs: docs.length,
      reference: counts.reference,
      record: counts.record,
      unclassified: unclassified.length,
      staleEntries: staleEntries.length,
      misplaced: misplaced.length,
      archived: docs.filter((doc) => doc.startsWith(`${ARCHIVE_ROOT}/`)).length,
      readmeMissingReferences: readmeMissingReferences.length,
      readmeRecordLinks: readmeRecordLinks.length,
      readmeBrokenLinks: readmeBrokenLinks.length,
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
    // Never overwrite a reviewed decision; only fill in what is missing. By
    // rebuilding from the actual tree, this also removes stale rows.
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
      `Doc index verified: ${summary.totalDocs} docs — ${summary.reference} current references, ` +
        `${summary.archived} archived records, every current reference is linked from ${DOCS_README}, ` +
        `and ${summary.figuresChecked} documented figures agree with their source.`
    );
  }
}
