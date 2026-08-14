import type { Express, NextFunction, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { logger } from "../../lib/logger";
import { ensureCutoverSchema, getCompanyCutoverLock } from "./spMigrationCutoverState";

const installedApps = new WeakSet<object>();

export async function ensureCutoverHardening(): Promise<void> {
  await ensureCutoverSchema();
  await db.execute(
    sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS sp_migration_cutovers_one_live_source
    ON sp_migration_cutovers(source_company_id)
    WHERE status IN ('prepared', 'active')
  `)
  );
  await db.execute(
    sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS sp_migration_cutovers_one_live_target
    ON sp_migration_cutovers(target_company_id)
    WHERE status IN ('prepared', 'active')
  `)
  );
}

function collectExplicitCompanyIds(req: Request): number[] {
  const values = [
    req.body?.companyId,
    req.body?.sourceCompanyId,
    req.body?.targetCompanyId,
    req.query?.companyId,
    req.params?.companyId,
  ];
  return Array.from(
    new Set(
      values
        .map((value) => Number.parseInt(String(value ?? ""), 10))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );
}

async function explicitCompanyWriteGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const method = req.method.toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return next();
    if (!req.path.startsWith("/api")) return next();
    if (req.path.startsWith("/api/sp/migration/") || req.path.startsWith("/api/auth/")) return next();

    const sessionCompanyId = Number(req.session?.currentCompanyId ?? 0);
    const candidates = Array.from(new Set([sessionCompanyId, ...collectExplicitCompanyIds(req)].filter(Boolean)));
    for (const companyId of candidates) {
      const lock = await getCompanyCutoverLock(companyId);
      if (!lock) continue;
      const sourceLocked = lock.sourceCompanyId === companyId;
      const targetLocked = lock.status === "prepared" && lock.targetCompanyId === companyId;
      if (!sourceLocked && !targetLocked) continue;
      return void res.status(423).json({
        message: sourceLocked
          ? "The requested source ERP company is read-only after Supplier Partner cutover preparation."
          : "The requested Supplier Partner company is locked for final synchronization.",
        code: sourceLocked ? "SP_SOURCE_READ_ONLY" : "SP_TARGET_CUTOVER_LOCKED",
        cutoverId: lock.id,
        sourceCompanyId: lock.sourceCompanyId,
        targetCompanyId: lock.targetCompanyId,
        status: lock.status,
      });
    }
    next();
  } catch (error) {
    logger.error("[SP Cutover Explicit Guard] Failed to evaluate request company IDs", { error });
    res.status(503).json({
      message: "Cutover safety status could not be verified. Write request blocked.",
      code: "SP_CUTOVER_GUARD_UNAVAILABLE",
    });
  }
}

export function installExplicitCompanyWriteGuard(app: Express): void {
  if (installedApps.has(app)) return;
  installedApps.add(app);
  app.use(explicitCompanyWriteGuard);

  const stack = app?._router?.stack as any[] | undefined;
  if (!stack?.length) return;
  const layer = stack.pop();
  const firstRouteIndex = stack.findIndex((entry) => Boolean(entry.route));
  if (!layer || firstRouteIndex < 0) {
    if (layer) stack.push(layer);
    return;
  }
  stack.splice(firstRouteIndex, 0, layer);
}
