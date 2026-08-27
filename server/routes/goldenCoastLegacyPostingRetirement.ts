import type { Express, Request, Response } from "express";
import { requireAuth, requireNonPOS } from "../auth";
import { releaseDebtEnglish } from "../i18n/finalCloseoutEnglish";
import { privilegedMutationRateLimit } from "../middleware/privilegedEndpointSecurity";

function retired(_req: Request, res: Response): void {
  res.status(410).json({
    code: "GC_PHASE1_POSTING_RETIRED",
    message: releaseDebtEnglish(
      "Golden Coast Phase 1 mutation posting is retired. The September 1, 2026 cutover and canonical Supplier Partner accounting flows are the only supported posting model."
    ),
  });
}

export function registerGoldenCoastLegacyPostingRetirement(app: Express): void {
  // Keep read-only previews/history available, but make every superseded Phase 1
  // mutation unreachable before later Golden Coast production flows are enabled.
  app.post(
    "/api/golden-coast/accounting/phase1/setup-accounts",
    privilegedMutationRateLimit,
    requireAuth,
    requireNonPOS,
    retired
  );
  app.post(
    "/api/golden-coast/accounting/phase1/post",
    privilegedMutationRateLimit,
    requireAuth,
    requireNonPOS,
    retired
  );
}
