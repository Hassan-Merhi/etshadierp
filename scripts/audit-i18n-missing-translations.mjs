import fs from "node:fs";
import path from "node:path";

/**
 * Counts module catalog entries that still lack French or Arabic.
 *
 * The Phase 14 literal audit falls as pages are converted to t() calls. That
 * alone would let the rollout look complete while every converted string still
 * rendered English, so this second gate tracks the translation debt the
 * conversion creates. Both ratchets are one-way.
 */
const CATALOG_DIR = "client/src/i18n/modules";
const BASELINE_PATH = "config/i18n-missing-translations-baseline.json";

const perModule = [];
let missing = 0;
let entries = 0;

/** Catalogs are chunked into a directory per module, so walk recursively. */
function catalogFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...catalogFiles(full));
    else if (entry.name.endsWith(".ts")) found.push(full);
  }
  return found;
}

if (fs.existsSync(CATALOG_DIR)) {
  const files = catalogFiles(CATALOG_DIR);
  if (!files.length) {
    console.error(`No catalog files found under ${CATALOG_DIR}; the audit would pass vacuously.`);
    process.exit(1);
  }
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    // Each entry is a single object literal: { en: "...", fr: "...", ar: "..." }
    const found = source.match(/\{\s*en:\s*"(?:[^"\\]|\\.)*"[^}]*\}/g) ?? [];
    let moduleMissing = 0;
    for (const entry of found) {
      entries += 1;
      if (!/\bfr:\s*"(?:[^"\\]|\\.)+"/.test(entry)) moduleMissing += 1;
      if (!/\bar:\s*"(?:[^"\\]|\\.)+"/.test(entry)) moduleMissing += 1;
    }
    missing += moduleMissing;
    perModule.push([path.relative(CATALOG_DIR, file), found.length, moduleMissing]);
  }
}

const baseline = fs.existsSync(BASELINE_PATH)
  ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"))
  : { maxMissing: missing };

console.log(`Module catalog entries: ${entries}`);
console.log(`Missing fr/ar values:   ${missing} (ceiling ${baseline.maxMissing})`);
for (const [file, count, moduleMissing] of perModule.sort((a, b) => b[2] - a[2])) {
  console.log(`  ${String(moduleMissing).padStart(5)} missing of ${String(count * 2).padStart(5)}  ${file}`);
}

if (missing > baseline.maxMissing) {
  console.error(
    `\nUntranslated module entries rose above the baseline ${baseline.maxMissing}.\n` +
      `Fill in fr/ar for the new entries, or raise the baseline only alongside a reviewed conversion.`
  );
  process.exit(1);
}
