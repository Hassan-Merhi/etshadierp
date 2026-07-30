import type { Express } from "express";
import { requireAuth, requireRole } from "../../../auth";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { persistPostOffloadPhase6Audit } from "../../../services/factory/postOffloadPhase6Audit";
import {
  applyPostOffloadPhase6Repair,
  inspectPostOffloadPhase6Readiness,
  phase6ErrorStatus,
  preparePostOffloadPhase6Repair,
} from "../../../services/factory/postOffloadPhase6Safety";

const ADMIN_ROLES = ["Admin", "Developer"] as const;
const READINESS_PATH = "/api/factory/raw-stock/post-offload/readiness";
const REPAIR_PATH = "/api/factory/raw-stock/post-offload/repair";

interface Phase6RequestContext {
  companyId: number;
  userId: string;
  username: string | null;
}

function requestContext(req: any): Phase6RequestContext | null {
  const companyId = Number(req.session?.factoryCompanyId || req.session?.currentCompanyId || 0);
  const userId = String(req.session?.userId || req.user?.id || "");
  if (!Number.isInteger(companyId) || companyId <= 0 || !userId) return null;
  return {
    companyId,
    userId,
    username: req.session?.username || req.user?.username || null,
  };
}

async function auditFailure(params: {
  context: Phase6RequestContext;
  error: unknown;
  httpStatus: number;
  dryRun: boolean;
}): Promise<void> {
  try {
    await persistPostOffloadPhase6Audit({
      action: "post_offload_phase6_failed",
      companyId: params.context.companyId,
      userId: params.context.userId,
      username: params.context.username,
      status: "failed",
      details: {
        dryRun: params.dryRun,
        httpStatus: params.httpStatus,
        code: (params.error as { code?: string })?.code ?? null,
        message: getErrorMessage(params.error) || "Post-offload Phase 6 operation failed.",
      },
    });
  } catch (auditError) {
    logger.error("Post-offload Phase 6 failure audit could not be persisted", {
      error: auditError,
      companyId: params.context.companyId,
      userId: params.context.userId,
    });
  }
}

/**
 * Final post-offload safety boundary.
 *
 * GET diagnoses the selected company without changing business data. POST
 * without a token also leaves business data unchanged and returns a signed
 * exact repair plan. POST with the token applies only the reviewed scope through
 * the existing serializable, advisory-locked, one-use historical replay engine.
 * Audit-log writes remain enabled for every lifecycle outcome.
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
      await persistPostOffloadPhase6Audit({
        action: "post_offload_phase6_readiness_inspected",
        companyId: context.companyId,
        userId: context.userId,
        username: context.username,
        status: readiness.status,
        details: {
          integrityIssueCount: readiness.integrity.issueCount,
          actualChangeRows: readiness.scope.actualChangeRows,
          exactScopeRows: readiness.scope.totalWritableRows,
          blockerCount: readiness.blockers.length,
          stateFingerprint: readiness.stateFingerprint,
          scopeFingerprint: readiness.fingerprint,
        },
      });
      logger.info("Post-offload Phase 6 readiness inspected", {
        companyId: context.companyId,
        userId: context.userId,
        status: readiness.status,
        integrityIssueCount: readiness.integrity.issueCount,
        actualChangeRows: readiness.scope.actualChangeRows,
        blockerCount: readiness.blockers.length,
      });
      return res.json(readiness);
    } catch (error: unknown) {
      const status = phase6ErrorStatus(error);
      await auditFailure({ context, error, httpStatus: status, dryRun: true });
      logger.error("Post-offload Phase 6 readiness failed", {
        error,
        companyId: context.companyId,
        userId: context.userId,
      });
      return res.status(status).json({
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
        await persistPostOffloadPhase6Audit({
          action:
            prepared.status === "blocked" ? "post_offload_phase6_blocked" : "post_offload_phase6_preview_generated",
          companyId: context.companyId,
          userId: context.userId,
          username: context.username,
          status: prepared.status,
          details: {
            confirmationIssued: Boolean(prepared.confirmationToken),
            expiresInMs: prepared.expiresInMs,
            selectedSupplierIds: prepared.readiness.selectedSupplierIds,
            actualChangeRows: prepared.readiness.scope.actualChangeRows,
            exactScopeRows: prepared.readiness.scope.totalWritableRows,
            finalizedBalesExcluded: prepared.readiness.scope.finalizedBalesExcluded,
            blockerCount: prepared.readiness.blockers.length,
            blockers: prepared.readiness.blockers,
            stateFingerprint: prepared.readiness.stateFingerprint,
            scopeFingerprint: prepared.readiness.fingerprint,
          },
        });
        logger.info("Post-offload Phase 6 repair preview generated", {
          companyId: context.companyId,
          userId: context.userId,
          status: prepared.status,
          confirmationIssued: Boolean(prepared.confirmationToken),
          stateFingerprint: prepared.readiness.stateFingerprint,
          scopeFingerprint: prepared.readiness.fingerprint,
          actualChangeRows: prepared.readiness.scope.actualChangeRows,
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
      await persistPostOffloadPhase6Audit({
        action: "post_offload_phase6_verified",
        companyId: context.companyId,
        userId: context.userId,
        username: context.username,
        status: result.status,
        details: {
          undoLogId: result.undoLogId,
          applied: result.applied,
          integrityIssueCount: result.readiness.integrity.issueCount,
          remainingActualChangeRows: result.readiness.scope.actualChangeRows,
          blockerCount: result.readiness.blockers.length,
          stateFingerprint: result.readiness.stateFingerprint,
          reportQueryKeys: result.reportQueryKeys,
        },
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
      await auditFailure({ context, error, httpStatus: status, dryRun: isDryRun });
      logger.error("Post-offload Phase 6 repair rejected or failed", {
        error,
        companyId: context.companyId,
        userId: context.userId,
        status,
        dryRun: isDryRun,
      });
      return res.status(status).json({
        success: false,
        repairCommitted: false,
        noPartialChanges: true,
        message: getErrorMessage(error) || "Post-offload Phase 6 repair failed.",
        code: (error as { code?: string }).code || "POST_OFFLOAD_PHASE6_REPAIR_FAILED",
      });
    }
  });
}
