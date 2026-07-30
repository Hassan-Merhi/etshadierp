import type { NextFunction, Request, Response } from "express";
import { pool } from "../../../db";
import { logger } from "../../../lib/logger";
import {
  replayPostOffloadHistoricalCosts,
  type PostOffloadHistoricalReplayResult,
} from "../../../services/factory/postOffloadHistoricalReplay";

const POST_OFFLOAD_PATH = /\/api\/factory\/containers\/(\d+)\/post-offload-charges(?:\/|$)/;
const INTERCEPTED = Symbol.for("etshadierp.postOffloadHistoricalReplayIntercepted");

function resolveMutationAction(req: Request): "CREATE" | "EDIT" | "UNDO" | "LEGACY_REBUILD" | null {
  if (req.method === "POST") return "CREATE";
  if (req.method === "DELETE") return "UNDO";
  if (req.method === "PATCH" && req.originalUrl.includes("/legacy-rebuild")) return "LEGACY_REBUILD";
  if (req.method === "PATCH") return "EDIT";
  return null;
}

function fallbackFailure(
  containerId: number,
  supplierId: number | null,
  chargeId: number | null,
  error: unknown
): PostOffloadHistoricalReplayResult {
  return {
    status: "failed",
    containerId,
    supplierId,
    chargeId,
    reason: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Intercepts successful post-offload mutation responses and runs the protected
 * historical supplier replay after the mutation transaction has committed.
 *
 * The route response is held until replay completes, so the client always sees
 * whether historical production costs were applied, unchanged, blocked, or
 * require repair. The original financial mutation is never reported as a full
 * historical success when replay is blocked or fails.
 */
export function postOffloadHistoricalReplayMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const action = resolveMutationAction(req);
  const pathMatch = POST_OFFLOAD_PATH.exec(req.originalUrl);
  if (!action || !pathMatch) return next();

  if ((req as any)[INTERCEPTED]) return next();
  (req as any)[INTERCEPTED] = true;

  const containerId = Number.parseInt(pathMatch[1], 10);
  const originalJson = res.json.bind(res);
  let responseHandled = false;

  res.json = ((body: any) => {
    if (responseHandled) return originalJson(body);
    responseHandled = true;

    if (res.statusCode >= 400 || body?.alreadyUndone === true) {
      return originalJson(body);
    }

    void (async () => {
      const companyId = Number(
        (req.session as any)?.factoryCompanyId || (req.session as any)?.currentCompanyId || 0
      );
      const userId = String((req.session as any)?.userId || (req as any).user?.id || "system");
      const username = (req.session as any)?.username || null;
      const chargeId = Number.isInteger(Number(body?.chargeId)) ? Number(body.chargeId) : null;

      let supplierId: number | null = null;
      let historicalReplay: PostOffloadHistoricalReplayResult;

      try {
        if (!companyId || !Number.isInteger(containerId) || containerId <= 0) {
          throw new Error("Post-offload replay context is missing company or container identity.");
        }

        const supplierResult = await pool.query<{ supplier_id: number | null }>(
          `SELECT supplier_id
           FROM factory_containers
           WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
          [containerId, companyId]
        );
        supplierId = supplierResult.rows[0]?.supplier_id ?? null;

        historicalReplay = await replayPostOffloadHistoricalCosts({
          companyId,
          supplierId,
          containerId,
          chargeId,
          mutationAction: action,
          userId,
          username,
        });
      } catch (error) {
        logger.error("Post-offload historical replay orchestration failed", {
          error,
          companyId,
          containerId,
          chargeId,
          mutationAction: action,
        });
        historicalReplay = fallbackFailure(containerId, supplierId, chargeId, error);
      }

      const repairRequired = historicalReplay.status === "blocked" || historicalReplay.status === "failed";
      const responseBody = {
        ...body,
        historicalReplay,
        historicalCostsRecalculated: !repairRequired,
        historicalRepairRequired: repairRequired,
        message: repairRequired
          ? `${body?.message || "Post-offload charge saved"}. Historical supplier-priced production costs require repair.`
          : body?.message,
      };

      originalJson(responseBody);
    })();

    return res;
  }) as Response["json"];

  next();
}
