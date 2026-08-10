#!/usr/bin/env node
/**
 * verify-startup-migrations.mjs
 *
 * Turns the startup-migration outcome into a gate.
 *
 * `.github/workflows/ci.yml` runs `node dist/index.js`, polls
 * `/api/health/db`, and gates the entire backend suite on that step
 * succeeding. The endpoint answered `{"status":"ok","message":"Database
 * ready"}` as soon as the migration pass *finished*, whether or not any
 * migration in it had failed — so a startup with fifteen failures passed the
 * gate and the suite ran against whatever schema survived.
 *
 * The endpoint now reports the failures (see server/startupMigrationReport.ts).
 * This script reads them and compares against
 * config/startup-migration-baseline.json, which is a one-way ratchet in the
 * same shape as the coverage floors and the type-escape baselines: the known
 * failures are frozen, the count may fall freely, and any failure that is not
 * already recorded fails CI.
 *
 * Why a baseline rather than "must be zero"
 * -----------------------------------------
 * A fresh database fails ~15 of these every run, and most are not defects in
 * the usual sense: nine are seed INSERTs whose company_id foreign keys cannot
 * resolve until companies exist, so they fail on an empty CI database and
 * succeed in production. Demanding zero would make the gate permanently red and
 * it would be switched off within a week. Freezing the known set makes the
 * signal real today — a sixteenth failure fails the build — and leaves the
 * backlog visible and drawable-down.
 *
 * Usage:
 *   node scripts/verify-startup-migrations.mjs [--url http://127.0.0.1:5000]
 *   UPDATE_STARTUP_MIGRATION_BASELINE=1 node scripts/verify-startup-migrations.mjs
 *
 * Exits non-zero on an unrecorded failure, on a count above the ceiling, or if
 * the migration pass never completed.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const ROOT = process.cwd();
const CONFIG_PATH = resolve(ROOT, "config/startup-migration-baseline.json");

const urlIndex = process.argv.indexOf("--url");
const BASE_URL = urlIndex === -1 ? (process.env.HEALTH_URL ?? "http://127.0.0.1:5000") : process.argv[urlIndex + 1];

/** Failures are matched on a normalised SQL prefix — the error text carries object IDs that differ per database. */
function fingerprint(failure) {
  return failure.sql.replace(/\s+/g, " ").trim().slice(0, 100);
}

const response = await fetch(`${BASE_URL}/api/health/db`);
if (!response.ok) {
  console.error(`GET ${BASE_URL}/api/health/db returned ${response.status}. Is the application running?`);
  process.exit(1);
}

const health = await response.json();
const migrations = health.migrations;

if (!migrations) {
  console.error(
    "/api/health/db did not report a migrations block. This build predates\n" +
      "server/startupMigrationReport.ts — the gate cannot verify anything."
  );
  process.exit(1);
}

if (!migrations.completed) {
  console.error("The startup migration pass never completed. Wait for /api/health/db to report status \"ok\" first.");
  process.exit(1);
}

if (migrations.skipped) {
  console.log("Startup migrations were skipped (RUN_STARTUP_MIGRATIONS=false) — nothing to verify.");
  process.exit(0);
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

if (process.env.UPDATE_STARTUP_MIGRATION_BASELINE === "1") {
  config.knownFailures = migrations.failures.map((failure) => ({
    sql: fingerprint(failure),
    error: failure.error,
  }));
  config.totals = { ...(config.totals ?? {}), failureCeiling: migrations.failures.length };
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Baseline rewritten: ${config.knownFailures.length} known failure(s).`);
  process.exit(0);
}

const known = new Set(config.knownFailures.map((failure) => failure.sql));
const ceiling = config.totals.failureCeiling;

const unrecorded = migrations.failures.filter((failure) => !known.has(fingerprint(failure)));
const failures = [];

if (unrecorded.length > 0) {
  failures.push(`${unrecorded.length} startup migration(s) failed that are not in the baseline:`);
  for (const failure of unrecorded) {
    failures.push(`   SQL: ${failure.sql}`);
    failures.push(`   ERR: ${failure.error}`);
  }
}

if (migrations.failureCount > ceiling) {
  failures.push(
    `${migrations.failureCount} startup migration failure(s) exceeds the ceiling of ${ceiling}. ` +
      `The ceiling may only fall — fix the migration rather than raising it.`
  );
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(
    "\nA migration that fails at startup leaves the schema partly applied, and every\n" +
      "backend test after this point runs against whatever survived."
  );
  process.exit(1);
}

console.log(
  `Startup migrations verified: ${migrations.failureCount} failure(s), all recorded, ceiling ${ceiling}.`
);
if (migrations.failureCount < ceiling) {
  console.log(
    `${ceiling - migrations.failureCount} fewer than the ceiling — lower totals.failureCeiling in ` +
      `config/startup-migration-baseline.json to lock the gain in.`
  );
}
