import type { Express } from "express";

import { getStartupMigrationReport } from "../startupMigrationReport";

/**
 * Registers `GET /api/health/db`.
 *
 * Lives here rather than inline in server/index.ts because that file is a
 * grandfathered god file frozen at 1,725 lines: it may shrink but never grow,
 * so a change that needs more than a line or two of it has to move out.
 *
 * The response stays 200 with `status: "ok"` once the migration pass finishes,
 * pass or fail. CI polls this to learn that startup is *done*, and Render's own
 * check is /api/health/ready, so readiness semantics are unchanged.
 *
 * What is new is the `migrations` block. Before it, a startup with eleven
 * failed migrations returned exactly `{"status":"ok","message":"Database
 * ready"}` — identical to a clean one — and .github/workflows/ci.yml gates the
 * entire backend suite on that step, so a broken migration reached the tests
 * and they ran against a partly applied schema.
 * scripts/verify-startup-migrations.mjs is what turns this report into a gate.
 */
export function registerDbHealthRoute(app: Express, migrationsDone: () => boolean): void {
  app.get("/api/health/db", (_req, res) => {
    const done = migrationsDone();
    const migrations = getStartupMigrationReport();
    res.json({
      status: done ? "ok" : "starting",
      message: done ? "Database ready" : "Running startup migrations, please wait...",
      migrations: {
        completed: migrations.completed,
        skipped: migrations.skipped,
        failureCount: migrations.failureCount,
        failures: migrations.failures,
      },
    });
  });
}
