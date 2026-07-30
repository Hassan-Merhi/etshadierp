import type { NextFunction, Request, Response } from "express";
import { logger } from "../../../lib/logger";
import {
  reconcilePostOffloadMutation,
  type PostOffloadReconciliationResult,
} from "../../../services/factory/postOffloadReconciliation";

const POST_OFFLOAD_PATH = /\/api\/factory\/containers\/(\d+)\/post-offload-charges(?:\/|$)/;
const INTERCEPTED = Symbol.for("etshadierp.postOffloadReconciliationIntercepted");

type MutationAction = "CREATE" | "EDIT" | "UNDO" | "LEGACY_REBUILD";

function resolveMutationAction(req: Request): MutationAction | null {
  if (req.originalUrl.includes("/post-offload-charges/preview")) return null;
  if (req.method === "POST") return "CREATE";
  if (req.method === "DELETE") return "UNDO";
  if (req.method === "PATCH" && req.originalUrl.includes("/legacy-rebuild")) {
    return "LEGACY_REBUILD";
  }
  if (req.method === "PATCH") return "EDIT";
  return null;
}

function failedResult(params: {
  companyId: number;
  containerId: number;
  chargeId: number | null;
  error: unknown;
}): PostOffloadReconciliationResult {
  const issue = params.error instanceof Error ? params.error.message : String(params.error);
  return {
    status: "failed",
    companyId: params.companyId,
    containerId: params.containerId,
    chargeId: params.chargeId,
    accounting: {
      chargesChecked: 0,
      activeVouchersChecked: 0,
      voucherEntriesNormalized: 0,
      daybookEntriesChecked: 0,
      reversalsChecked: 0,
      issues: [issue],
    },
    inventory: {
      rawStockRowsChecked: 0,
      containerCostPerKgUsd: null,
      issues: [],
    },
    reports: {
      serverReadCacheInvalidated: true,
      derivedFromLiveCostTables: true,
      queryKeys: [],
    },
    undo: {
      required: false,
      available: false,
      undoLogId: null,
      fingerprint: null,
      alreadyUndone: false,
      issues: [],
    },
    issues: [issue],
  };
}

/**
 * Outer response wrapper for the post-offload mutation pipeline.
 *
 * Register this before postOffloadHistoricalReplayMiddleware so the route first
 * completes the historical replay, then this boundary verifies accounting,
 * inventory, report refresh coverage, and exact undo availability before the
 * final JSON response is sent.
 */
export function postOffloadReconciliationMiddleware(req: Request, res: Response, next: NextFunction): void {
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
      const companyId = Number((req.session as any)?.factoryCompanyId || (req.session as any)?.currentCompanyId || 0);
      const userId = String((req.session as any)?.userId || (req as any).user?.id || "system");
      const username = (req.session as any)?.username || null;
      const chargeId = Number.isInteger(Number(body?.chargeId)) ? Number(body.chargeId) : null;

      let reconciliation: PostOffloadReconciliationResult;
      try {
        if (!companyId || !Number.isInteger(containerId) || containerId <= 0) {
          throw new Error("Post-offload reconciliation context is missing company or container identity.");
        }
        reconciliation = await reconcilePostOffloadMutation({
          companyId,
          containerId,
          chargeId,
          mutationAction: action,
          userId,
          username,
          historicalReplay: body?.historicalReplay ?? null,
        });
      } catch (error) {
        logger.error("Post-offload accounting and inventory reconciliation failed", {
          error,
          companyId,
          containerId,
          chargeId,
          mutationAction: action,
        });
        reconciliation = failedResult({ companyId, containerId, chargeId, error });
      }

      const repairRequired = reconciliation.status !== "reconciled";
      const existingMessage = String(body?.message || "Post-offload charge saved");
      const repairMessage =
        "Post-offload accounting, inventory, reporting, or exact undo reconciliation requires repair.";
      const responseBody = {
        ...body,
        postOffloadReconciliation: reconciliation,
        postOffloadFullyReconciled: !repairRequired,
        postOffloadRepairRequired: repairRequired,
        accountingReconciled: reconciliation.accounting.issues.length === 0,
        inventoryReconciled: reconciliation.inventory.issues.length === 0,
        reportsReconciled: reconciliation.status !== "failed",
        exactReplayUndoLogId: reconciliation.undo.undoLogId,
        historicalRepairRequired: Boolean(body?.historicalRepairRequired) || repairRequired,
        message:
          repairRequired && !existingMessage.includes(repairMessage)
            ? `${existingMessage}. ${repairMessage}`
            : existingMessage,
      };

      originalJson(responseBody);
    })();

    return res;
  }) as Response["json"];

  next();
}
