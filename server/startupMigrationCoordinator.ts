import { Client, type QueryConfig, type QueryResult, type QueryResultRow } from "pg";
import { logger } from "./lib/logger";

const STARTUP_LOCK_KEY = 741_220_260;
const DEFAULT_WAIT_MS = 90_000;
const DEFAULT_POLL_MS = 1_000;
const MIGRATION_SETUP_SQL = /^\s*SET\s+lock_timeout\s*=\s*['"]30s['"]\s*;?\s*$/i;
const PATCH_MARKER = Symbol.for("etshadierp.startupMigrationCoordinator.patched");

interface CoordinatedClient extends Client {
  [PATCH_MARKER]?: boolean;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export interface MigrationLockOptions {
  waitMs: number;
  pollMs: number;
  failOpen: boolean;
}

export function getMigrationLockOptions(env: NodeJS.ProcessEnv = process.env): MigrationLockOptions {
  return {
    waitMs: readPositiveInt(env.STARTUP_MIGRATION_LOCK_WAIT_MS, DEFAULT_WAIT_MS),
    pollMs: readPositiveInt(env.STARTUP_MIGRATION_LOCK_POLL_MS, DEFAULT_POLL_MS),
    failOpen: env.STARTUP_MIGRATION_LOCK_FAIL_OPEN === "true",
  };
}

export async function acquireStartupMigrationLock(
  client: Client,
  options: MigrationLockOptions = getMigrationLockOptions(),
): Promise<boolean> {
  const deadline = Date.now() + options.waitMs;
  let attempts = 0;

  while (Date.now() <= deadline) {
    attempts += 1;
    const result = await Client.prototype.query.call(
      client,
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [STARTUP_LOCK_KEY],
    );
    if (result.rows?.[0]?.acquired === true) {
      logger.info("Startup migration advisory lock acquired", {
        module: "startup-migrations",
        action: "lock-acquired",
        attempts,
        waitMs: options.waitMs,
      });
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, options.pollMs));
  }

  logger.error("Timed out waiting for startup migration advisory lock", {
    module: "startup-migrations",
    action: "lock-timeout",
    attempts,
    waitMs: options.waitMs,
    failOpen: options.failOpen,
  });
  return false;
}

export async function releaseStartupMigrationLock(client: Client): Promise<void> {
  try {
    await Client.prototype.query.call(client, "SELECT pg_advisory_unlock($1)", [STARTUP_LOCK_KEY]);
    logger.info("Startup migration advisory lock released", {
      module: "startup-migrations",
      action: "lock-released",
    });
  } catch (error) {
    logger.warn("Could not explicitly release startup migration advisory lock", {
      module: "startup-migrations",
      action: "lock-release-failed",
      error,
    });
  }
}

function sqlText(query: string | QueryConfig): string {
  return typeof query === "string" ? query : query.text;
}

export function installStartupMigrationCoordinator(): void {
  const prototype = Client.prototype as CoordinatedClient;
  if (prototype[PATCH_MARKER]) return;
  prototype[PATCH_MARKER] = true;

  const originalQuery = Client.prototype.query;
  const originalEnd = Client.prototype.end;
  const coordinatedClients = new WeakSet<Client>();
  const lockedClients = new WeakSet<Client>();

  Client.prototype.query = async function <R extends QueryResultRow = any, I = any[]>(
    query: string | QueryConfig<I>,
    values?: I,
  ): Promise<QueryResult<R>> {
    const result = await originalQuery.call(this, query as any, values as any);
    if (!coordinatedClients.has(this) && MIGRATION_SETUP_SQL.test(sqlText(query))) {
      coordinatedClients.add(this);
      const options = getMigrationLockOptions();
      const acquired = await acquireStartupMigrationLock(this, options);
      if (acquired) {
        lockedClients.add(this);
      } else if (!options.failOpen) {
        logger.error("Startup aborted because migration coordination could not be established", {
          module: "startup-migrations",
          action: "lock-fail-closed",
        });
        process.exit(1);
      } else {
        logger.warn("Continuing startup migrations without advisory lock", {
          module: "startup-migrations",
          action: "lock-fail-open",
        });
      }
    }
    return result as QueryResult<R>;
  } as typeof Client.prototype.query;

  Client.prototype.end = async function (): Promise<void> {
    if (lockedClients.has(this)) {
      lockedClients.delete(this);
      await releaseStartupMigrationLock(this);
    }
    await originalEnd.call(this);
  };
}

installStartupMigrationCoordinator();
