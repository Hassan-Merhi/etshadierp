import type { Express } from "express";
import { requireAuth, requireRole } from "../../../auth";
import {
  getRawStockRecalcPreview,
  applyRawStockRecalc,
  loadRecalcFingerprintInputs,
  computeRecalcFingerprint,
} from "../../../services/factory/rawStockRecalc";
import { logAudit } from "../../helpers/auditHelpers";
import {
  signRepairToken,
  verifyRepairToken,
  ExpiredRepairTokenError,
  RepairTokenConfigurationError,
  REPAIR_TOKEN_TTL_MS,
} from "../../../services/factory/repairToken";

const ADMIN_ROLES = ["Admin", "Developer"] as const;

interface RecalcTokenPayload {
  companyId: number;
  containerIds: number[];
  /** Deterministic fingerprint of EVERY approved calculation input per
   * container (see computeRecalcFingerprint) — container status/updatedAt,
   * received kg, rate, currency, FX rate/confirmed state, freight, duty,
   * commission, other charges, every additional-charge row, and the current
   * vs. expected cost. Re-derived from a fresh, row-locked read inside the
   * apply transaction and rejected as STALE_TOKEN on any mismatch. */
  fingerprintByContainer: Record<number, string>;
  userId: string;
  expiresAt: number;
  /** Bound into the token so a confirm request can never silently expand scope
   * beyond what the admin saw and approved at dry-run time. */
  includeCompletedBatches: boolean;
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
        const { containerIds, confirm, confirmationToken, includeCompletedBatches } = req.body;
        const wantsCompletedBatches = includeCompletedBatches === true;
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

        const preview = await getRawStockRecalcPreview(companyId);
        const previewByContainer = new Map(preview.map((r) => [r.containerId, r]));

        if (!confirm) {
          // Fingerprint EVERY approved calculation input per container (not just its
          // old cost) so the token is bound to the exact calculation the admin saw,
          // not merely the numeric outcome.
          const fingerprintByContainer: Record<number, string> = {};
          for (const id of parsedIds) {
            const inputs = await loadRecalcFingerprintInputs(companyId, id);
            if (inputs) fingerprintByContainer[id] = computeRecalcFingerprint(inputs);
          }
          const tokenPayload: RecalcTokenPayload = {
            companyId,
            containerIds: parsedIds,
            fingerprintByContainer,
            userId: req.session.userId,
            expiresAt: Date.now() + REPAIR_TOKEN_TTL_MS,
            includeCompletedBatches: wantsCompletedBatches,
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
        if (
          tokenPayload.companyId !== companyId ||
          !sameIds ||
          tokenPayload.userId !== req.session.userId ||
          tokenPayload.includeCompletedBatches !== wantsCompletedBatches
        ) {
          return res.status(400).json({
            code: "INVALID_TOKEN",
            message: "confirmationToken does not match this exact recalc request — re-run the dry-run preview first.",
          });
        }

        // The authoritative stale check is inside applyRawStockRecalc's row-locked
        // transaction (fingerprint recomputed from a fresh read there), so a change
        // that lands after this point but before that lock is still caught. This is
        // only a cheap early-exit for the common case.
        const EPS = 0.0005;
        for (const id of parsedIds) {
          const freshRow = previewByContainer.get(id);
          if (freshRow && freshRow.changed === false) continue;
          const inputs = await loadRecalcFingerprintInputs(companyId, id);
          const freshFingerprint = inputs ? computeRecalcFingerprint(inputs) : undefined;
          const tokenFingerprint = tokenPayload.fingerprintByContainer[id];
          if (tokenFingerprint && freshFingerprint !== tokenFingerprint) {
            return res.status(400).json({
              code: "STALE_TOKEN",
              message: `Container #${id} changed since the dry-run preview was issued — re-run the preview and try again.`,
            });
          }
        }

        const results = await applyRawStockRecalc(companyId, parsedIds, {
          expectedFingerprints: tokenPayload.fingerprintByContainer,
          includeCompletedBatches: wantsCompletedBatches,
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
                changes: { result: { new: { ...result, includeCompletedBatches: wantsCompletedBatches } } },
              },
              tx
            );
          },
        });

        const staleResult = results.find((r) => r.staleToken);
        if (staleResult) {
          return res.status(400).json({
            code: "STALE_TOKEN",
            message: `Container #${staleResult.containerId} changed since the dry-run preview was issued — re-run the preview and try again.`,
          });
        }

        res.json({ dryRun: false, results });
      } catch (err: any) {
        if (err instanceof RepairTokenConfigurationError) {
          console.error("Repair token configuration error (SESSION_SECRET missing/fallback in production):", err.message);
          return res.status(500).json({ message: err.message, code: "REPAIR_TOKEN_MISCONFIGURED" });
        }
        console.error("[raw-stock recalc apply] error:", err);
        res.status(500).json({ message: err.message || "Failed to apply recalculation" });
      }
    }
  );
}
