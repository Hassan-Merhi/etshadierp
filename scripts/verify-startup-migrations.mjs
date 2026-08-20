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
 * Which boot is measured
 * ----------------------
 * This has to run against the FIRST boot on a fresh database. A second boot
 * sees a database the first boot already migrated, so any statement that fails
 * only on fresh schema has already been repaired by a later statement and
 * reports clean. CI once gated solely on such a second boot. Measured against a
 * database holding factory_raw_stock rows, three VALIDATE statements in part 007
 * failed on boot one and passed on boot two — a later part re-pointed their
 * constraint at the right parent table in between — and this gate reported
 * "0 failure(s) ... ceiling 0" while reading boot two alone.
 *
 * Both boots carry signal and CI checks both:
 *   - boot one, read from the saved report via --report, catches statements
 *     that fail against fresh schema;
 *   - boot two, read live via --url, catches statements that are not
 *     idempotent and fail only once the schema already exists.
 *
 * Usage:
 *   node scripts/verify-startup-migrations.mjs [--url http://127.0.0.1:5000]
 *   node scripts/verify-startup-migrations.mjs --report health-db-ci.json
 *   node scripts/verify-startup-migrations.mjs --url ... --label "second boot"
 *   UPDATE_STARTUP_MIGRATION_BASELINE=1 node scripts/verify-startup-migrations.mjs
 *
 * Exits non-zero on an unrecorded failure, on a count above the ceiling, or if
 * the migration pass never completed.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const ROOT = process.cwd();
const CONFIG_PATH = resolve(ROOT, "config/startup-migration-baseline.json");

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
}

const REPORT_PATH = argValue("--report", process.env.HEALTH_REPORT);
const BASE_URL = argValue("--url", process.env.HEALTH_URL ?? "http://127.0.0.1:5000");
/** Names the boot under test so a failure says which of the two produced it. */
const LABEL = argValue("--label", process.env.HEALTH_LABEL ?? (REPORT_PATH ? "saved report" : "live application"));

/** Failures are matched on a normalised SQL prefix — the error text carries object IDs that differ per database. */
function fingerprint(failure) {
  return failure.sql.replace(/\s+/g, " ").trim().slice(0, 100);
}

/**
 * Read the health payload from a saved file when --report is given, otherwise
 * from the running application. The file form exists so the FIRST boot can be
 * gated after its application has exited: CI already saves that boot's response
 * and would otherwise have nothing left to measure.
 */
async function readHealth() {
  if (REPORT_PATH) {
    let raw;
    try {
      raw = readFileSync(resolve(ROOT, REPORT_PATH), "utf8");
    } catch (error) {
      console.error(`Could not read the saved health report at ${REPORT_PATH}: ${error.message}`);
      process.exit(1);
    }
    if (!raw.trim()) {
      console.error(
        `The saved health report at ${REPORT_PATH} is empty. The step that writes it ` +
          "must capture a successful /api/health/db response before this gate runs."
      );
      process.exit(1);
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.error(`The saved health report at ${REPORT_PATH} is not valid JSON: ${error.message}`);
      process.exit(1);
    }
  }

  const response = await fetch(`${BASE_URL}/api/health/db`);
  if (!response.ok) {
    console.error(`GET ${BASE_URL}/api/health/db returned ${response.status}. Is the application running?`);
    process.exit(1);
  }
  return response.json();
}

const health = await readHealth();
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
  console.log(`Startup migrations were skipped on the ${LABEL} (RUN_STARTUP_MIGRATIONS=false) — nothing to verify.`);
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
  failures.push(`${unrecorded.length} startup migration(s) failed on the ${LABEL} that are not in the baseline:`);
  for (const failure of unrecorded) {
    failures.push(`   SQL: ${failure.sql}`);
    failures.push(`   ERR: ${failure.error}`);
  }
}

if (migrations.failureCount > ceiling) {
  failures.push(
    `${migrations.failureCount} startup migration failure(s) on the ${LABEL} exceeds the ceiling of ${ceiling}. ` +
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
  `Startup migrations verified on the ${LABEL}: ${migrations.failureCount} failure(s), all recorded, ceiling ${ceiling}.`
);
if (migrations.failureCount < ceiling) {
  console.log(
    `${ceiling - migrations.failureCount} fewer than the ceiling — lower totals.failureCeiling in ` +
      `config/startup-migration-baseline.json to lock the gain in.`
  );
}
