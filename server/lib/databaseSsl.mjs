// Central resolver for the PostgreSQL TLS configuration.
//
// This is `.mjs` on purpose: the startup preload bridges (loaded via Node's
// `--import` flag before any TypeScript is transpiled) need it, and the
// TypeScript entrypoints (`server/db.ts`, `server/index.ts`) can import it just
// the same. Keeping it in one module means the SSL policy lives in exactly one
// place instead of being copy-pasted at every pool construction site.
//
// Behaviour, in order of precedence:
//   1. Local Replit database (PGHOST=helium or an `@helium:` connection
//      string), Render's same-region private Postgres hostname, or
//      PGSSLMODE=disable → TLS off entirely (`ssl: false`).
//   2. PGSSLROOTCERT set → verified TLS against that CA bundle.
//   3. Otherwise → verified TLS against the system trust store.
//
// Render recommends its internal Postgres URL for same-region services. That
// URL uses a single-label `dpg-*` hostname on Render's private network and does
// not require TLS. Detecting that case avoids unnecessary TLS there without
// weakening external database connections.

import { readFileSync } from "node:fs";

/**
 * Extract a connection hostname without throwing on malformed/unset input.
 * @param {string} [connectionString]
 * @returns {string}
 */
function connectionHostname(connectionString = "") {
  if (typeof connectionString === "string" && connectionString.trim() !== "") {
    try {
      return new URL(connectionString).hostname.toLowerCase();
    } catch {
      // Fall back to PGHOST below. The actual pg client will surface malformed
      // connection strings when it attempts to connect.
    }
  }
  return (process.env.PGHOST || "").trim().toLowerCase();
}

/**
 * True when the connection targets the local Replit database, which does not
 * speak TLS.
 * @param {string} [connectionString]
 * @returns {boolean}
 */
export function isLocalReplitDatabase(connectionString = "") {
  return (
    process.env.PGHOST === "helium" || (typeof connectionString === "string" && connectionString.includes("@helium:"))
  );
}

/**
 * True for Render's same-region private Postgres DNS name.
 *
 * Render sets RENDER=true at runtime. Internal Render Postgres URLs use a
 * single-label dpg-* hostname, while public/external Render database hosts are
 * fully-qualified names. Keep this deliberately narrow so unrelated hosts are
 * never reclassified as private.
 *
 * @param {string} [connectionString]
 * @returns {boolean}
 */
export function isRenderInternalDatabase(connectionString = "") {
  if (process.env.RENDER !== "true") return false;
  const hostname = connectionHostname(connectionString);
  return hostname.startsWith("dpg-") && !hostname.includes(".");
}

/**
 * True when the connection should use TLS at all.
 * @param {string} [connectionString]
 * @returns {boolean}
 */
export function databaseRequiresSsl(connectionString = "") {
  const sslMode = (process.env.PGSSLMODE || "").trim().toLowerCase();
  if (sslMode === "disable") return false;

  // An explicit non-disable SSL mode is an operator override. Otherwise use
  // Render's documented private-network behavior for its internal DB hostname.
  if (sslMode === "" && isRenderInternalDatabase(connectionString)) return false;

  return !isLocalReplitDatabase(connectionString);
}

/**
 * Resolve the `ssl` option for a `pg` Pool/Client.
 *
 * External TLS is fail-closed: certificate verification is always enabled.
 * Operators using a private CA can provide it with PGSSLROOTCERT.
 *
 * @param {string} [connectionString] Connection string, when the caller has
 *   one, so host heuristics work even if PGHOST is unset.
 * @returns {false | { ca?: string, rejectUnauthorized: true }}
 */
export function resolveDatabaseSsl(connectionString = "") {
  if (!databaseRequiresSsl(connectionString)) {
    return false;
  }

  const caPath = process.env.PGSSLROOTCERT;
  if (caPath && caPath.trim() !== "") {
    // Fail loudly rather than silently degrading verification when an operator
    // explicitly supplies a CA path.
    const ca = readFileSync(caPath, "utf8");
    return { ca, rejectUnauthorized: true };
  }

  return { rejectUnauthorized: true };
}
