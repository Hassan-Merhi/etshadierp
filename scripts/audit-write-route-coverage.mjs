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
  const testText = testFiles
    .map((file) => fs.readFileSync(path.join(projectRoot, file), "utf8"))
    .join("\n");

  const routes = [];
  // The manifest is an ordered list and contains genuine duplicate
  // registrations; for coverage purposes a route is one method+path pair.
  const seen = new Set();
  for (const entry of manifest.routes) {
    const [method, routePath] = entry.split(" ");
    if (!WRITE_METHODS.has(method) || !routePath?.startsWith("/api/")) continue;
    if (seen.has(`${method} ${routePath}`)) continue;
    seen.add(`${method} ${routePath}`);

    // The file that registers this route is the one containing its path literal.
    let owner = null;
    for (const [file, source] of sources) {
      if (source.includes(`"${routePath}"`)) {
        owner = file;
        break;
      }
    }

    const sensitiveTable = owner ? writesSensitiveTable(sources.get(owner)) : null;
    const referenced = testText.includes(routePath);
    routes.push({ method, path: routePath, owner, sensitiveTable, referenced });
  }

  const sensitive = routes.filter((route) => route.sensitiveTable);
  const uncoveredSensitive = sensitive.filter((route) => !route.referenced);

  const failures = [];
  const ceiling = config.uncoveredSensitiveCeiling;
  if (ceiling !== undefined && uncoveredSensitive.length > ceiling) {
    failures.push(
      `${uncoveredSensitive.length} write routes touching money or stock tables have no test that references them; ` +
        `the ceiling is ${ceiling}. This number may only fall. Add a test, or explain the exception in ` +
        `config/write-route-coverage.json.`
    );
  }

  return {
    version: config.version,
    failures,
    routes,
    uncoveredSensitive,
    summary: {
      writeRoutes: routes.length,
      sensitiveRoutes: sensitive.length,
      sensitiveReferenced: sensitive.length - uncoveredSensitive.length,
      uncoveredSensitive: uncoveredSensitive.length,
      ceiling: ceiling ?? null,
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
