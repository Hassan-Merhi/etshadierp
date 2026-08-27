import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import { releaseDebtEnglish } from "../i18n/finalCloseoutEnglish";

/**
 * Phase 1 was an implementation scaffold, not the final Golden Coast accounting model.
 * Keep its read/preview surfaces available for historical diagnosis, but make the live
 * posting mutation unreachable before later Golden Coast production flows are enabled.
 */
export function registerGoldenCoastLegacyPostingGuard(app: Express): void {
  app.post(
    "/api/golden-coast/accounting/phase1/post",
    requireAuth,
    (_req: Request, res: Response) => {
      res.status(410).json({
        code: "GC_PHASE1_POSTING_RETIRED",
        message: releaseDebtEnglish(
          "Golden Coast Phase 1 posting is retired. Use the canonical Supplier Partner cutover and post-cutover accounting flows."
        ),
      });
    }
  );
}
