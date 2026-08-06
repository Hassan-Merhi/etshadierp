// Type declarations for the JavaScript `databaseSsl.mjs` module, so the
// TypeScript entrypoints (`server/db.ts`, `server/index.ts`) can import it with
// full typing while the startup preload bridges load the same `.mjs` directly.

/** The `ssl` option accepted by a `pg` Pool/Client. */
export type DatabaseSslConfig = false | { ca?: string; rejectUnauthorized: boolean };

/** True when the connection targets the local Replit database (no TLS). */
export function isLocalReplitDatabase(connectionString?: string): boolean;

/** True when the connection should use TLS at all. */
export function databaseRequiresSsl(connectionString?: string): boolean;

/** Resolve the `ssl` option for a `pg` Pool/Client. */
export function resolveDatabaseSsl(connectionString?: string): DatabaseSslConfig;
