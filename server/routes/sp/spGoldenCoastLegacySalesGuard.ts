import type { Express, NextFunction, Request, Response } from "express";
import { requireAuth } from "../../auth";
import { db } from "../../db";
import { releaseDebtEnglish } from "../../i18n/finalCloseoutEnglish";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { isGoldenCoastCompany } from "./spGoldenCoastPhase4CutoverFifoRoutes";
import { requireSpCompany } from "./spHelpers";

/**
 * Old SP POS clients still know `/api/sp/sales`. Once a Supplier Partner company
 * has Golden Coast accounting configured, allowing that mutation would bypass
 * Phase 6 FIFO/revenue/COGS and its atomic automatic HADI collection. Refuse it
 * before the generic SP sales registrar gets a chance to handle the request.
 */
export function registerSpGoldenCoastLegacySalesGuard(app: Express): void {
  app.post("/api/sp/sales", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;
      if (!(await isGoldenCoastCompany(db, companyId))) {
        next();
        return;
      }

      res.status(409).json({
        code: "GC_PHASE6_CANONICAL_POS_REQUIRED",
        message: releaseDebtEnglish(
          "Golden Coast sales must use the Phase 6 POS route so sale accounting and automatic HADI cash routing remain atomic."
        ),
      });
    } catch (error) {
      logger.error("Golden Coast legacy SP sales guard failed", { error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
