#!/usr/bin/env node
/**
 * audit-write-route-coverage.mjs
 *
 * The smoke sweep deliberately excludes mutating endpoints — calling them in a
 * sweep is unsafe — which is correct, and leaves every write route in the
 * repository covered by nothing but whatever hand-written test happens to
 * mention it. This audit measures that gap and ranks it by blast radius.
 *
 * A write route is **sensitive** when the file registering it also writes to
 * one of the tables where a silent regression costs money rather than
 * convenience: vouchers, voucher_entries, inventory, sales_items, and the
 * factory raw-stock/bale equivalents. Those are the ledger and the stock
 * ledger; everything else is recoverable by editing a row.
 *
 * A route counts as **referenced** when some test mentions its path. That is a
 * deliberately weak definition — a mention is not an assertion — but it is
 * exact and unarguable, and the routes it reports have no test that so much as
 * names them. Strengthening the definition would mean guessing at intent.
 *
 * Usage:
 *   npm run audit:write-routes
 *   node scripts/audit-write-route-coverage.mjs --json
 *   UPDATE_WRITE_ROUTE_BASELINE=1 node scripts/audit-write-route-coverage.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(projectRoot, "config/route-manifest.json");
const configPath = path.join(projectRoot, "config/write-route-coverage.json");

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The sweep that covers the whole sensitive write surface with one assertion. */
const GUARD_SWEEP_TEST = "tests/write-route-guard-sweep.test.ts";

/** Tables whose corruption is expensive and hard to notice. */
const SENSITIVE_TABLES = [
  "vouchers",
  "voucher_entries",
  "voucherEntries",
  "inventory",
  "sales_items",
  "salesItems",
  "factory_raw_stock",
  "factoryRawStock",
  "factory_bales",
  "factoryBales",
  "ledger_accounts",
  "ledgerAccounts",
];

/** Ways this codebase writes: drizzle builders and raw SQL alike. */
function writesSensitiveTable(source) {
  for (const table of SENSITIVE_TABLES) {
    const patterns = [
      new RegExp(`\\.insert\\(\\s*${table}\\b`),
      new RegExp(`\\.update\\(\\s*${table}\\b`),
      new RegExp(`\\.delete\\(\\s*${table}\\b`),
      new RegExp(`INSERT\\s+INTO\\s+${table}\\b`, "i"),
      new RegExp(`UPDATE\\s+${table}\\b`, "i"),
      new RegExp(`DELETE\\s+FROM\\s+${table}\\b`, "i"),
    ];
    if (patterns.some((pattern) => pattern.test(source))) return table;
  }
  return null;
}

function walk(dir, extensions, out = []) {
  const absolute = path.join(projectRoot, dir);
  if (!fs.existsSync(absolute)) return out;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const relative = path.join(dir, entry.name).split(path.sep).join("/");
    if (entry.isDirectory()) walk(relative, extensions, out);
    else if (extensions.some((extension) => relative.endsWith(extension))) out.push(relative);
  }
  return out;
}

export function auditWriteRouteCoverage() {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const serverFiles = walk("server", [".ts"]).filter((file) => !file.endsWith(".test.ts"));
  const sources = new Map(serverFiles.map((file) => [file, fs.readFileSync(path.join(projectRoot, file), "utf8")]));

  const testFiles = [...walk("tests", [".ts"]), ...serverFiles.filter((file) => file.endsWith(".test.ts"))];
  // Kept per file rather than concatenated, so a route can be told apart by
  // *which* test names it — see guardOnly below.
  const testSources = new Map(testFiles.map((file) => [file, fs.readFileSync(path.join(projectRoot, file), "utf8")]));
  const referencingTests = (routePath) =>
    [...testSources].filter(([, source]) => source.includes(routePath)).map(([file]) => file);

  const routes = [];
  // The manifest is an ordered list and contains genuine duplicate
  // registrations; for coverage purposes a route is one method+path pair.
  const seen = new Set();
  for (const entry of manifest.routes) {
    const [method, routePath] = entry.split(" ");
    if (!WRITE_METHODS.has(method) || !routePath?.startsWith("/api/")) continue;
    if (seen.has(`${method} ${routePath}`)) continue;
    seen.add(`${method} ${routePath}`);

    // The file that registers this route is the one that calls app.<method> on
    // its path. Matching the bare path literal instead finds any file that
    // merely *mentions* the path — a CSRF exemption list, a permission-boundary
    // table — and 34 of the write routes resolved to one of those, taking their
    // sensitivity from a file that does not contain the handler at all.
    // /api/user-presence/leave was the clearest case: owned by server/index.ts
    // because that file lists it as origin-guard-exempt, and classified as
    // touching voucher_entries on the strength of unrelated code in the same
    // file. The literal match stays as the fallback for routes assembled in a
    // way the registration pattern cannot see.
    let owner = null;
    let literalOwner = null;
    const registration = new RegExp(
      `\\.(get|post|put|patch|delete)\\(\\s*"${routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`
    );
    for (const [file, source] of sources) {
      if (!owner && registration.test(source)) owner = file;
      if (!literalOwner && source.includes(`"${routePath}"`)) literalOwner = file;
      if (owner && literalOwner) break;
    }
    owner = owner ?? literalOwner;

    const sensitiveTable = owner ? writesSensitiveTable(sources.get(owner)) : null;
    const referencedIn = referencingTests(routePath);
    const referenced = referencedIn.length > 0;
    // Covered by the guard sweep and nothing else. The sweep asserts one real
    // thing about every sensitive write route — that it refuses an
    // unauthenticated caller — which is worth having, but it says nothing about
    // whether the route computes the right numbers. Tracking it separately
    // keeps "referenced by a test" from quietly coming to mean "swept".
    const guardOnly = referenced && referencedIn.every((file) => file === GUARD_SWEEP_TEST);
    routes.push({ method, path: routePath, owner, sensitiveTable, referenced, guardOnly });
  }

  const sensitive = routes.filter((route) => route.sensitiveTable);
  const uncoveredSensitive = sensitive.filter((route) => !route.referenced);
  const guardOnlySensitive = sensitive.filter((route) => route.guardOnly);

  const failures = [];
  const ceiling = config.uncoveredSensitiveCeiling;
  if (ceiling !== undefined && uncoveredSensitive.length > ceiling) {
    failures.push(
      `${uncoveredSensitive.length} write routes touching money or stock tables have no test that references them; ` +
        `the ceiling is ${ceiling}. This number may only fall. Add a test, or explain the exception in ` +
        `config/write-route-coverage.json.`
    );
  }
  const guardOnlyCeiling = config.guardOnlySensitiveCeiling;
  if (guardOnlyCeiling !== undefined && guardOnlySensitive.length > guardOnlyCeiling) {
    failures.push(
      `${guardOnlySensitive.length} write routes touching money or stock tables are covered only by the guard ` +
        `sweep, which proves they reject an unauthenticated caller and nothing more; the ceiling is ` +
        `${guardOnlyCeiling}. This number may only fall. Give one of them a test that asserts what it writes.`
    );
  }

  return {
    version: config.version,
    failures,
    routes,
    uncoveredSensitive,
    guardOnlySensitive,
    summary: {
      writeRoutes: routes.length,
      sensitiveRoutes: sensitive.length,
      sensitiveReferenced: sensitive.length - uncoveredSensitive.length,
      uncoveredSensitive: uncoveredSensitive.length,
      guardOnlySensitive: guardOnlySensitive.length,
      behaviourallyCovered: sensitive.length - uncoveredSensitive.length - guardOnlySensitive.length,
      ceiling: ceiling ?? null,
      guardOnlyCeiling: guardOnlyCeiling ?? null,
      unownedRoutes: routes.filter((route) => !route.owner).length,
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = auditWriteRouteCoverage();

  if (process.env.UPDATE_WRITE_ROUTE_BASELINE === "1") {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.uncoveredSensitiveCeiling = report.summary.uncoveredSensitive;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`Ceiling set to ${report.summary.uncoveredSensitive}.`);
    process.exit(0);
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.failures.length > 0 ? 1 : 0);
  }

  const { summary } = report;
  console.log(
    `Write routes: ${summary.writeRoutes}. Touching money or stock tables: ${summary.sensitiveRoutes}, ` +
      `of which ${summary.sensitiveReferenced} are referenced by a test and ` +
      `${summary.uncoveredSensitive} are not (ceiling ${summary.ceiling}).`
  );

  if (process.argv.includes("--list")) {
    const byOwner = new Map();
    for (const route of report.uncoveredSensitive) {
      if (!byOwner.has(route.owner)) byOwner.set(route.owner, []);
      byOwner.get(route.owner).push(`${route.method} ${route.path}`);
    }
    for (const [owner, entries] of [...byOwner.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n${owner} (${entries.length})`);
      for (const entry of entries) console.log(`  ${entry}`);
    }
  }

  if (report.failures.length > 0) {
    console.error(report.failures.join("\n"));
    process.exitCode = 1;
  }
}
