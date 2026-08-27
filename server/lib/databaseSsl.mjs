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
//   2. PGSSLROOTCERT set             → verified TLS against that CA bundle.
//   3. PGSSL_REJECT_UNAUTHORIZED true → verified TLS against the system trust
//      store.
//   4. Otherwise                     → unverified TLS (`rejectUnauthorized:
//      false`), preserving compatibility for external providers, and a one-time
//      startup warning is emitted so operators know verification is off.
//
// Render recommends its internal Postgres URL for same-region services. That
// URL uses a single-label `dpg-*` hostname on Render's private network and does
// not require TLS. Detecting that case removes the previous self-signed/unverified
// TLS configuration without weakening external database connections.

import { readFileSync } from "node:fs";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

let warned = false;

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
 * @param {string} [connectionString] Connection string, when the caller has
 *   one, so host heuristics work even if PGHOST is unset.
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
    const renderHint =
      process.env.RENDER === "true"
        ? " If this service and Render Postgres are in the same region, use the database's internal URL instead; the app will detect that private dpg-* hostname and disable TLS there."
        : "";
    console.warn(
      "[databaseSsl] Connecting to PostgreSQL with TLS certificate verification " +
        "DISABLED (rejectUnauthorized: false). This accepts any server certificate " +
        "and is vulnerable to man-in-the-middle interception. Set PGSSLROOTCERT to " +
        "your deployment's CA bundle to verify the certificate chain, or " +
        "PGSSL_REJECT_UNAUTHORIZED=true if the platform already provides a trusted chain." +
        renderHint
    );
  }

  return { rejectUnauthorized: false };
}
