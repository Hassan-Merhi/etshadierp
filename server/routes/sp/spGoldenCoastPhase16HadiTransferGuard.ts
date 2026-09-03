import type { Express, NextFunction, Request, Response } from "express";
import { requireAuth, requireNonPOS } from "../../auth";
import { releaseDebtEnglish } from "../../i18n/finalCloseoutEnglish";

export const GOLDEN_COAST_PHASE16_LEGACY_HADI_PATH = "/api/sp/golden-coast/phase7/sales-cash-transfer";
export const GOLDEN_COAST_PHASE16_LEGACY_HADI_RETIRED_CODE = "GC_PHASE16_LEGACY_HADI_TRANSFER_RETIRED";

export function goldenCoastPhase16LegacyHadiRetiredPayload() {
  return {
    code: GOLDEN_COAST_PHASE16_LEGACY_HADI_RETIRED_CODE,
    message: releaseDebtEnglish(
      "Manual Phase 7 HADI collection/remittance is retired. Golden Coast sales cash is credit-payable: use Pay Fresh Start from HADI for HADI-held sales proceeds, or the direct GC Sales Cash settlement workflow when Golden Coast itself pays Fresh Start."
    ),
  };
}

/**
 * Phase 16 preserves the old GET readiness probe because older clients use it
 * to discover the configured HADI parent. Only the legacy POST is fail-closed.
 * The canonical HADI settlement is /phase7/sales-cash-pay-fresh-start, whose
 * balanced pair debits GC Sales Cash and reduces the GC↔HADI asset/cash pair.
 */
export function registerSpGoldenCoastPhase16HadiTransferGuard(app: Express): void {
  app.use(
    GOLDEN_COAST_PHASE16_LEGACY_HADI_PATH,
    requireAuth,
    requireNonPOS,
    (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "POST") {
        next();
        return;
      }
      res.status(409).json(goldenCoastPhase16LegacyHadiRetiredPayload());
    }
  );
}
