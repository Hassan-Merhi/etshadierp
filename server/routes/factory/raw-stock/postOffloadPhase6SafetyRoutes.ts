import type { Express } from "express";
import { requireAuth, requireRole } from "../../../auth";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import {
  applyPostOffloadPhase6Repair,
  inspectPostOffloadPhase6Readiness,
  phase6ErrorStatus,
  preparePostOffloadPhase6Repair,
} from "../../../services/factory/postOffloadPhase6Safety";

const ADMIN_ROLES = ["Admin", "Developer"] as const;
const READINESS_PATH = "/api/factory/raw-stock/post-offload/readiness";
const REPAIR_PATH = "/api/factory/raw-stock/post-offload/repair";

function requestContext(req: any): {
  companyId: number;
  userId: string;
  username: string | null;
} | null {
  const companyId = Number(req.session?.factoryCompanyId || req.session?.currentCompanyId || 0);
  const userId = String(req.session?.userId || req.user?.id || "");
  if (!Number.isInteger(companyId) || companyId <= 0 || !userId) return null;
  return {
    companyId,
    userId,
    username: req.session?.username || req.user?.username || null,
  };
}

/**
 * Final post-offload safety boundary.
 *
 * GET diagnoses the selected company without writing. POST without a token is
 * also read-only and returns a signed exact repair plan. POST with the token
 * applies only the reviewed scope through the existing serializable,
 * advisory-locked, one-use historical replay engine.
 */
export function registerPostOffloadPhase6SafetyRoutes(app: Express): void {
  app.get(READINESS_PATH, requireAuth, requireRole(...ADMIN_ROLES), async (req: any, res: any) => {
    const context = requestContext(req);
    if (!context) {
      return res.status(400).json({
        message: "Post-offload Phase 6 readiness requires a selected company and authenticated user.",
        code: "POST_OFFLOAD_PHASE6_CONTEXT_MISSING",
      });
    }

    try {
      const readiness = await inspectPostOffloadPhase6Readiness({
        companyId: context.companyId,
        supplierIds: req.query?.supplierIds
          ? String(req.query.supplierIds)
              .split(",")
              .map((value) => Number(value.trim()))
          : undefined,
      });
      logger.info("Post-offload Phase 6 readiness inspected", {
        companyId: context.companyId,
        userId: context.userId,
        status: readiness.status,
        integrityIssueCount: readiness.integrity.issueCount,
        writableRows: readiness.scope.totalWritableRows,
        blockerCount: readiness.blockers.length,
      });
      return res.json(readiness);
    } catch (error: unknown) {
      logger.error("Post-offload Phase 6 readiness failed", {
        error,
        companyId: context.companyId,
        userId: context.userId,
      });
      return res.status(phase6ErrorStatus(error)).json({
        message: getErrorMessage(error) || "Failed to inspect post-offload Phase 6 readiness.",
        code: (error as { code?: string }).code || "POST_OFFLOAD_PHASE6_READINESS_FAILED",
      });
    }
  });

  app.post(REPAIR_PATH, requireAuth, requireRole(...ADMIN_ROLES), async (req: any, res: any) => {
    const context = requestContext(req);
    if (!context) {
      return res.status(400).json({
        message: "Post-offload Phase 6 repair requires a selected company and authenticated user.",
        code: "POST_OFFLOAD_PHASE6_CONTEXT_MISSING",
      });
    }

    const confirmationToken = req.body?.confirmationToken;
    const isDryRun = req.body?.dryRun === true || !confirmationToken;

    try {
      if (isDryRun) {
        const prepared = await preparePostOffloadPhase6Repair({
          companyId: context.companyId,
          userId: context.userId,
          supplierIds: req.body?.supplierIds,
        });
        logger.info("Post-offload Phase 6 repair preview generated", {
          companyId: context.companyId,
          userId: context.userId,
          status: prepared.status,
          confirmationIssued: Boolean(prepared.confirmationToken),
          stateFingerprint: prepared.readiness.stateFingerprint,
          scopeFingerprint: prepared.readiness.fingerprint,
          writableRows: prepared.readiness.scope.totalWritableRows,
          blockerCount: prepared.readiness.blockers.length,
        });
        return res.json(prepared);
      }

      const result = await applyPostOffloadPhase6Repair({
        companyId: context.companyId,
        userId: context.userId,
        username: context.username,
        confirmationToken,
      });
      logger.info("Post-offload Phase 6 repair applied and verified", {
        companyId: context.companyId,
        userId: context.userId,
        undoLogId: result.undoLogId,
        status: result.status,
        applied: result.applied,
      });
      return res.json(result);
    } catch (error: unknown) {
      const status = phase6ErrorStatus(error);
      logger.error("Post-offload Phase 6 repair rejected or failed", {
        error,
        companyId: context.companyId,
        userId: context.userId,
        status,
        dryRun: isDryRun,
      });
      return res.status(status).json({
        success: false,
        repairRolledBack: status >= 500 || status === 409,
        message: getErrorMessage(error) || "Post-offload Phase 6 repair failed.",
        code: (error as { code?: string }).code || "POST_OFFLOAD_PHASE6_REPAIR_FAILED",
      });
    }
  });
}
