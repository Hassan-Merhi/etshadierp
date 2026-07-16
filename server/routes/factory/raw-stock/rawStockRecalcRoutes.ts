import type { Express } from "express";
import { requireAuth, requireRole } from "../../../auth";
import {
  getRawStockRecalcPreview,
  applyRawStockRecalc,
  loadRecalcFingerprintInputs,
  computeRecalcFingerprint,
  getAffectedMixBatchesPreview,
  getZeroCostMixBatchSourcesPreview,
  getMixBatchSourceCostMismatchPreview,
  applyZeroCostMixBatchSourcesFix,
  getFullAuditScan,
  computeApplyAllDryRun,
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
  /** Whether to allow CLOSED/COMPLETED containers — bound in token so scope can't expand at confirm. */
  includeHistoricalContainers: boolean;
}

interface ApplyAllSafeTokenPayload {
  companyId: number;
  safeContainerIds: number[];
  userId: string;
  expiresAt: number;
  includeHistoricalContainers: boolean;
  includeCompletedBatches: boolean;
}

interface ZeroCostSourceTokenPayload {
  companyId: number;
  sourceIds: number[];
  manualRates: Record<number, number>;
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

  // Read-only preview of every mix batch (and bale count) that would be touched
  // by applying the given containers' corrected cost — the same batch-selection
  // and weighted-average math cascadeContainerCostChange uses, but never writes
  // anything. Lets the admin see the downstream blast radius before clicking Apply.
  app.post(
    "/api/factory/raw-stock/recalc/mix-batches-preview",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const { containerIds, includeCompletedBatches } = req.body;
        if (!Array.isArray(containerIds) || containerIds.length === 0) {
          return res.json([]);
        }
        const parsedIds = containerIds.map((id: any) => parseInt(id)).filter((id: number) => !isNaN(id));
        const rows = await getAffectedMixBatchesPreview(companyId, parsedIds, includeCompletedBatches === true);
        res.json(rows);
      } catch (err: any) {
        console.error("[raw-stock recalc mix-batches-preview] error:", err);
        res.status(500).json({ message: err.message || "Failed to compute affected mix batches preview" });
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
        const { containerIds, confirm, confirmationToken, includeCompletedBatches, includeHistoricalContainers } = req.body;
        const wantsCompletedBatches = includeCompletedBatches === true;
        const wantsHistorical = includeHistoricalContainers === true;
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
            includeHistoricalContainers: wantsHistorical,
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
          tokenPayload.includeCompletedBatches !== wantsCompletedBatches ||
          (tokenPayload.includeHistoricalContainers ?? false) !== wantsHistorical
        ) {
          return res.status(400).json({
            code: "INVALID_TOKEN",
            message: "confirmationToken does not match this exact recalc request — re-run the dry-run preview first.",
          });
        }

        // The authoritative stale check is inside applyRawStockRecalc's row-locked
        // transaction (fingerprint recomputed from a fresh read there), so any change
        // that lands after this point but before that lock is still caught. This is a
        // cheap early-exit for the common case — no EPS tolerance; 6dp exact match.
        for (const id of parsedIds) {
          const inputs = await loadRecalcFingerprintInputs(companyId, id);
          const freshFingerprint = inputs ? computeRecalcFingerprint(inputs) : undefined;
          const tokenFingerprint = tokenPayload.fingerprintByContainer[id];
          if (tokenFingerprint && freshFingerprint && freshFingerprint !== tokenFingerprint) {
            return res.status(400).json({
              code: "STALE_TOKEN",
              message: `Container #${id} changed since the dry-run preview was issued — re-run the preview and try again.`,
            });
          }
        }

        const results = await applyRawStockRecalc(companyId, parsedIds, {
          expectedFingerprints: tokenPayload.fingerprintByContainer,
          includeCompletedBatches: wantsCompletedBatches,
          includeHistoricalContainers: wantsHistorical,
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

  // Read-only scan for mix-batch-source rows recorded with cost 0 despite real
  // weight — a different bug from the container-level drift above: the parent
  // container's own cost can already be correct (so it never shows up as a
  // "changed" row and is never selectable there), yet its downstream batches
  // are still dragged toward zero. Independent of container selection.
  app.get(
    "/api/factory/raw-stock/recalc/zero-cost-sources",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const rows = await getZeroCostMixBatchSourcesPreview(companyId);
        res.json(rows);
      } catch (err: any) {
        console.error("[raw-stock recalc zero-cost-sources] error:", err);
        res.status(500).json({ message: err.message || "Failed to compute zero-cost mix-batch-source preview" });
      }
    }
  );

  // Apply the fix for the zero-cost mix-batch-source rows the admin approved.
  // Same dry-run → signed confirmationToken → confirm flow as recalc/apply
  // above. manualRates only ever applies to sources with no container link
  // (the service layer refuses to let a manual rate override a container-linked
  // source that already has a real cost on file).
  app.post(
    "/api/factory/raw-stock/recalc/zero-cost-sources/apply",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        const { sourceIds, manualRates, confirm, confirmationToken } = req.body;
        if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
          return res.status(400).json({ message: "sourceIds must be a non-empty array" });
        }
        const parsedIds = sourceIds
          .map((id: any) => parseInt(id))
          .filter((id: number) => !isNaN(id))
          .sort((a: number, b: number) => a - b);
        if (parsedIds.length === 0) {
          return res.status(400).json({ message: "sourceIds must contain at least one valid id" });
        }
        const parsedManualRates: Record<number, number> = {};
        if (manualRates && typeof manualRates === "object") {
          for (const [key, value] of Object.entries(manualRates)) {
            const id = parseInt(key);
            const rate = parseFloat(value as any);
            if (!isNaN(id) && !isNaN(rate) && rate > 0) parsedManualRates[id] = rate;
          }
        }

        if (!confirm) {
          const preview = await getZeroCostMixBatchSourcesPreview(companyId);
          const previewById = new Map(preview.map((r) => [r.sourceId, r]));
          const tokenPayload: ZeroCostSourceTokenPayload = {
            companyId,
            sourceIds: parsedIds,
            manualRates: parsedManualRates,
            userId: req.session.userId,
            expiresAt: Date.now() + REPAIR_TOKEN_TTL_MS,
          };
          const token = signRepairToken(tokenPayload);
          return res.json({
            dryRun: true,
            rows: parsedIds.map((id: number) => previewById.get(id)).filter(Boolean),
            confirmationToken: token,
          });
        }

        let tokenPayload: ZeroCostSourceTokenPayload;
        try {
          tokenPayload = verifyRepairToken<ZeroCostSourceTokenPayload>(confirmationToken);
        } catch (err: any) {
          if (err instanceof ExpiredRepairTokenError) {
            return res.status(400).json({ code: "TOKEN_EXPIRED", message: err.message });
          }
          return res.status(400).json({
            code: "INVALID_TOKEN",
            message: "confirmationToken does not match this exact request — re-run the dry-run preview first.",
          });
        }

        const sameIds =
          tokenPayload.sourceIds.length === parsedIds.length &&
          tokenPayload.sourceIds.every((id, i) => id === parsedIds[i]);
        const sameRates = JSON.stringify(tokenPayload.manualRates) === JSON.stringify(parsedManualRates);
        if (tokenPayload.companyId !== companyId || !sameIds || !sameRates || tokenPayload.userId !== req.session.userId) {
          return res.status(400).json({
            code: "INVALID_TOKEN",
            message: "confirmationToken does not match this exact request — re-run the dry-run preview first.",
          });
        }

        const results = await applyZeroCostMixBatchSourcesFix(companyId, parsedIds, {
          manualRates: parsedManualRates,
          onAudit: async (tx, result) => {
            await logAudit(
              {
                userId: req.session.userId,
                username: req.session.username || req.session.userId,
                companyId,
                action: "update",
                tableName: "factory_mix_batch_sources",
                recordId: result.sourceId,
                recordIdentifier: `zero-cost-source/apply — batch ${result.batchCode}`,
                changes: { result: { new: result } },
              },
              tx
            );
          },
        });

        res.json({ dryRun: false, results });
      } catch (err: any) {
        if (err instanceof RepairTokenConfigurationError) {
          console.error("Repair token configuration error (SESSION_SECRET missing/fallback in production):", err.message);
          return res.status(500).json({ message: err.message, code: "REPAIR_TOKEN_MISCONFIGURED" });
        }
        console.error("[raw-stock recalc zero-cost-sources apply] error:", err);
        res.status(500).json({ message: err.message || "Failed to apply zero-cost source fix" });
      }
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Full audit scan — all containers, all layers, all issue codes
  // GET /api/factory/raw-stock/recalc/full-audit
  // ──────────────────────────────────────────────────────────────────────────
  app.get(
    "/api/factory/raw-stock/recalc/full-audit",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      try {
        const result = await getFullAuditScan(companyId);
        res.json(result);
      } catch (err: any) {
        console.error("[raw-stock recalc full-audit] error:", err);
        res.status(500).json({ message: err.message || "Failed to run full audit scan" });
      }
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Source cost mismatches — full scan (not just zero-cost)
  // GET /api/factory/raw-stock/recalc/source-cost-mismatches
  // ──────────────────────────────────────────────────────────────────────────
  app.get(
    "/api/factory/raw-stock/recalc/source-cost-mismatches",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      try {
        const result = await getMixBatchSourceCostMismatchPreview(companyId);
        res.json(result);
      } catch (err: any) {
        console.error("[raw-stock recalc source-cost-mismatches] error:", err);
        res.status(500).json({ message: err.message || "Failed to scan source cost mismatches" });
      }
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Apply all safe repairs — dry-run → token → confirm
  // POST /api/factory/raw-stock/recalc/apply-all-safe
  // Body (dry-run): { includeHistoricalContainers?, includeCompletedBatches? }
  // Body (confirm): { confirm: true, confirmationToken: "...", ... same flags }
  // ──────────────────────────────────────────────────────────────────────────
  app.post(
    "/api/factory/raw-stock/recalc/apply-all-safe",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { confirm, confirmationToken, includeHistoricalContainers, includeCompletedBatches } = req.body;
      const wantsHistorical = includeHistoricalContainers === true;
      const wantsCompletedBatches = includeCompletedBatches === true;

      try {
        if (!confirm) {
          // ── Dry-run: identify all safe containers, build token ──────────
          const dryRun = await computeApplyAllDryRun(companyId, { includeHistoricalContainers: wantsHistorical });
          if (dryRun.safeContainerIds.length === 0) {
            return res.json({ dryRun: true, safeCount: 0, confirmationToken: null, summary: dryRun });
          }

          // Build per-container fingerprints so we can reject stale tokens at confirm
          const fingerprintByContainer: Record<number, string> = {};
          for (const cid of dryRun.safeContainerIds) {
            const inputs = await loadRecalcFingerprintInputs(companyId, cid);
            if (inputs) fingerprintByContainer[cid] = computeRecalcFingerprint(inputs);
          }

          const tokenPayload: ApplyAllSafeTokenPayload = {
            companyId,
            safeContainerIds: dryRun.safeContainerIds,
            userId: req.session.userId,
            expiresAt: Date.now() + REPAIR_TOKEN_TTL_MS,
            includeHistoricalContainers: wantsHistorical,
            includeCompletedBatches: wantsCompletedBatches,
          };

          const token = signRepairToken(tokenPayload);
          return res.json({ dryRun: true, summary: dryRun, confirmationToken: token });
        }

        // ── Confirm: verify token, check staleness, apply ─────────────────
        if (!confirmationToken || typeof confirmationToken !== "string") {
          return res.status(400).json({ code: "MISSING_TOKEN", message: "confirmationToken is required for confirm=true" });
        }

        let tokenPayload: ApplyAllSafeTokenPayload;
        try {
          tokenPayload = verifyRepairToken<ApplyAllSafeTokenPayload>(confirmationToken);
        } catch (err: any) {
          if (err instanceof ExpiredRepairTokenError) {
            return res.status(400).json({ code: "EXPIRED_TOKEN", message: "Dry-run preview has expired — please re-run it." });
          }
          return res.status(400).json({ code: "INVALID_TOKEN", message: err.message });
        }

        if (
          tokenPayload.companyId !== companyId ||
          tokenPayload.userId !== req.session.userId ||
          (tokenPayload.includeHistoricalContainers ?? false) !== wantsHistorical ||
          (tokenPayload.includeCompletedBatches ?? false) !== wantsCompletedBatches
        ) {
          return res.status(400).json({ code: "INVALID_TOKEN", message: "Token does not match this request — re-run the dry-run." });
        }

        const { safeContainerIds } = tokenPayload;

        const results = await applyRawStockRecalc(companyId, safeContainerIds, {
          includeCompletedBatches: wantsCompletedBatches,
          includeHistoricalContainers: wantsHistorical,
          onAudit: async (tx, result) => {
            await logAudit(
              {
                userId: req.session.userId,
                username: req.session.username || req.session.userId,
                companyId,
                action: "update",
                tableName: "factory_raw_stock",
                recordId: result.containerId,
                recordIdentifier: `recalc/apply-all-safe — container ${result.containerNumber}`,
                changes: { result: { new: { ...result, includeHistoricalContainers: wantsHistorical } } },
              },
              tx
            );
          },
        });

        const staleResult = results.find((r) => r.staleToken);
        if (staleResult) {
          return res.status(400).json({
            code: "STALE_TOKEN",
            message: `Container #${staleResult.containerId} changed since the dry-run — re-run.`,
          });
        }

        res.json({ dryRun: false, results });
      } catch (err: any) {
        if (err instanceof RepairTokenConfigurationError) {
          console.error("Repair token configuration error:", err.message);
          return res.status(500).json({ message: err.message, code: "REPAIR_TOKEN_MISCONFIGURED" });
        }
        console.error("[raw-stock recalc apply-all-safe] error:", err);
        res.status(500).json({ message: err.message || "Failed to apply all safe repairs" });
      }
    }
  );
}
