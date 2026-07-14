import type { Express } from "express";
import { requireAuth, requireRole } from "../../../auth";
import { getRawStockRecalcPreview, applyRawStockRecalc } from "../../../services/factory/rawStockRecalc";
import { logAudit } from "../../helpers/auditHelpers";
import {
  signRepairToken,
  verifyRepairToken,
  ExpiredRepairTokenError,
  REPAIR_TOKEN_TTL_MS,
} from "../../../services/factory/repairToken";

const ADMIN_ROLES = ["Admin", "Developer"] as const;

interface RecalcTokenPayload {
  companyId: number;
  containerIds: number[];
  /** Each requested container's old costPerKgUsd at preview time, so a stale
   * token (row changed since preview) can be detected before apply. */
  oldCostPerKgUsdByContainer: Record<number, number>;
  userId: string;
  expiresAt: number;
}

export function registerRawStockRecalcRoutes(app: Express) {
  // Read-only diff preview — never writes anything. Admin/Developer-only: this
  // surfaces exact stored vs. corrected landed-cost figures for every container.
  app.get(
    "/api/factory/raw-stock/recalc/preview",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const rows = await getRawStockRecalcPreview(companyId);
        res.json(rows);
      } catch (err: any) {
        console.error("[raw-stock recalc preview] error:", err);
        res.status(500).json({ message: err.message || "Failed to compute recalculation preview" });
      }
    }
  );

  // Apply the corrected cost for the containers the admin approved, cascading to
  // mix batches/bales. Admin/Developer-only, dry-run by default (returns a signed,
  // expiring confirmationToken bound to companyId/containerIds/their old costs/the
  // requesting user); the actual write only happens when the caller re-submits with
  // { confirm: true, confirmationToken } and the token still matches the containers'
  // CURRENT stored cost (rejecting a stale token if anything changed since preview).
  // Refuses CLOSED/COMPLETED containers (reported, not silently skipped). Each
  // container is applied in its own transaction with a row lock, and its audit-log
  // entry is written atomically with it — see rawStockRecalc.ts.
  app.post(
    "/api/factory/raw-stock/recalc/apply",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const { containerIds, confirm, confirmationToken } = req.body;
        if (!Array.isArray(containerIds) || containerIds.length === 0) {
          return res.status(400).json({ message: "containerIds must be a non-empty array" });
        }
        const parsedIds = containerIds
          .map((id: any) => parseInt(id))
          .filter((id: number) => !isNaN(id))
          .sort((a: number, b: number) => a - b);
        if (parsedIds.length === 0) {
          return res.status(400).json({ message: "containerIds must contain at least one valid id" });
        }

        // Snapshot each requested container's CURRENT stored costPerKgUsd — used both
        // to build the token (dry-run) and to detect staleness (apply).
        const preview = await getRawStockRecalcPreview(companyId);
        const previewByContainer = new Map(preview.map((r) => [r.containerId, r]));
        const oldCostPerKgUsdByContainer: Record<number, number> = {};
        for (const id of parsedIds) {
          oldCostPerKgUsdByContainer[id] = previewByContainer.get(id)?.old.costPerKgUsd ?? 0;
        }

        if (!confirm) {
          const tokenPayload: RecalcTokenPayload = {
            companyId,
            containerIds: parsedIds,
            oldCostPerKgUsdByContainer,
            userId: req.session.userId,
            expiresAt: Date.now() + REPAIR_TOKEN_TTL_MS,
          };
          const token = signRepairToken(tokenPayload);
          return res.json({
            dryRun: true,
            rows: parsedIds.map((id: number) => previewByContainer.get(id)).filter(Boolean),
            confirmationToken: token,
          });
        }

        let tokenPayload: RecalcTokenPayload;
        try {
          tokenPayload = verifyRepairToken<RecalcTokenPayload>(confirmationToken);
        } catch (err: any) {
          if (err instanceof ExpiredRepairTokenError) {
            return res.status(400).json({ code: "TOKEN_EXPIRED", message: err.message });
          }
          return res.status(400).json({
            code: "INVALID_TOKEN",
            message: "confirmationToken does not match this exact recalc request — re-run the dry-run preview first.",
          });
        }

        const sameIds =
          tokenPayload.containerIds.length === parsedIds.length &&
          tokenPayload.containerIds.every((id, i) => id === parsedIds[i]);
        if (tokenPayload.companyId !== companyId || !sameIds || tokenPayload.userId !== req.session.userId) {
          return res.status(400).json({
            code: "INVALID_TOKEN",
            message: "confirmationToken does not match this exact recalc request — re-run the dry-run preview first.",
          });
        }

        // Stale-token detection: compare the CURRENT stored cost against what the token
        // captured at preview time. Exception: if the container is already sitting at
        // its corrected value (changed === false — e.g. a previous apply of this same
        // token already succeeded), that's a safe idempotent replay, not staleness; let
        // it fall through to applyRawStockRecalc, which will correctly report
        // applied:false without writing anything again.
        const EPS = 0.0005;
        for (const id of parsedIds) {
          const freshRow = previewByContainer.get(id);
          if (freshRow && freshRow.changed === false) continue;
          const currentOld = freshRow?.old.costPerKgUsd ?? 0;
          const tokenOld = tokenPayload.oldCostPerKgUsdByContainer[id] ?? 0;
          if (Math.abs(currentOld - tokenOld) > EPS) {
            return res.status(400).json({
              code: "STALE_TOKEN",
              message: `Container #${id} changed since the dry-run preview was issued — re-run the preview and try again.`,
            });
          }
        }

        const results = await applyRawStockRecalc(companyId, parsedIds, {
          onAudit: async (tx, result) => {
            await logAudit(
              {
                userId: req.session.userId,
                username: req.session.username || req.session.userId,
                companyId,
                action: "update",
                tableName: "factory_raw_stock",
                recordId: result.containerId,
                recordIdentifier: `recalc/apply — container ${result.containerNumber}`,
                changes: { result: { new: result } },
              },
              tx
            );
          },
        });

        res.json({ dryRun: false, results });
      } catch (err: any) {
        console.error("[raw-stock recalc apply] error:", err);
        res.status(500).json({ message: err.message || "Failed to apply recalculation" });
      }
    }
  );
}
