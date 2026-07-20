import type { Express } from "express";

const APPLY_PATH = "/api/factory/raw-stock/recalc/historical-replay/apply";

function parsePositiveIntegerIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.map((entry) => Number(entry));
  if (ids.some((entry) => !Number.isInteger(entry) || entry <= 0)) return null;
  return [...new Set(ids)].sort((left, right) => left - right);
}

/**
 * Fail closed before the exact replay route. Empty selection never means “all”,
 * and a token-backed request cannot be reinterpreted as a new dry run.
 */
export function registerHistoricalReplayPhase6GuardRoutes(app: Express): void {
  app.post(APPLY_PATH, (req: any, res: any, next: any) => {
    const hasToken = typeof req.body?.confirmationToken === "string"
      && req.body.confirmationToken.length > 0;
    if (hasToken) {
      if (req.body?.dryRun === true) {
        return res.status(400).json({
          message: "A confirmation token can only be used for apply. Re-run Prepare without a token.",
          code: "HISTORICAL_REPLAY_CONFLICTING_MODE",
        });
      }
      return next();
    }

    const supplierIds = parsePositiveIntegerIds(req.body?.supplierIds);
    if (!supplierIds || supplierIds.length === 0) {
      return res.status(400).json({
        message: "Select at least one safe supplier before preparing Historical Replay.",
        code: "HISTORICAL_REPLAY_EMPTY_SCOPE",
      });
    }

    req.body.supplierIds = supplierIds;
    return next();
  });
}
