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
//      string) or PGSSLMODE=disable  → TLS off entirely (`ssl: false`).
//   2. PGSSLROOTCERT set             → verified TLS against that CA bundle.
//   3. PGSSL_REJECT_UNAUTHORIZED true → verified TLS against the system trust
//      store.
//   4. Otherwise                     → unverified TLS (`rejectUnauthorized:
//      false`), preserving the historical default, and a one-time startup
//      warning is emitted so operators know verification is off.
//
// The default is intentionally unchanged: enabling verification requires the CA
// that signs the deployment's certificate, and guessing wrong takes the
// database down at boot. Turning verification on is a one-line env change.

import { readFileSync } from "node:fs";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

let warned = false;

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
 * True when the connection should use TLS at all.
 * @param {string} [connectionString]
 * @returns {boolean}
 */
export function databaseRequiresSsl(connectionString = "") {
  const sslExplicitlyDisabled = process.env.PGSSLMODE === "disable";
  return !isLocalReplitDatabase(connectionString) && !sslExplicitlyDisabled;
}

/**
 * Resolve the `ssl` option for a `pg` Pool/Client.
 *
 * @param {string} [connectionString] Connection string, when the caller has
 *   one, so the `@helium:` heuristic works even if PGHOST is unset.
 * @returns {false | { ca?: string, rejectUnauthorized: boolean }}
 */
export function resolveDatabaseSsl(connectionString = "") {
  if (!databaseRequiresSsl(connectionString)) {
    return false;
  }

  const caPath = process.env.PGSSLROOTCERT;
  if (caPath && caPath.trim() !== "") {
    // Fail loudly rather than silently degrading to an unverified connection:
    // an operator who set PGSSLROOTCERT is explicitly asking for verification.
    const ca = readFileSync(caPath, "utf8");
    return { ca, rejectUnauthorized: true };
  }

  const rejectFlag = process.env.PGSSL_REJECT_UNAUTHORIZED;
  if (rejectFlag !== undefined && TRUTHY.has(rejectFlag.trim().toLowerCase())) {
    return { rejectUnauthorized: true };
  }

  if (!warned) {
    warned = true;
    console.warn(
      "[databaseSsl] Connecting to PostgreSQL with TLS certificate verification " +
        "DISABLED (rejectUnauthorized: false). This accepts any server certificate " +
        "and is vulnerable to man-in-the-middle interception. Set PGSSLROOTCERT to " +
        "your deployment's CA bundle to verify the certificate chain, or " +
        "PGSSL_REJECT_UNAUTHORIZED=true if the platform already provides a trusted chain."
    );
  }

  return { rejectUnauthorized: false };
}
