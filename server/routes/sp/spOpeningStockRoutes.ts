import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { sql } from "drizzle-orm";
import {
  GOLDEN_COAST_LEGACY_RETIRED_CODE,
  GOLDEN_COAST_LEGACY_RETIRED_MESSAGE,
} from "../../services/accounting/goldenCoastPhase4Cutover";
import { privilegedMutationRateLimit } from "../../middleware/privilegedEndpointSecurity";
import { requireSpCompany } from "./spHelpers";
import { resultRows } from "../../lib/queryResult";

// ── Opening Stock ─────────────────────────────────────────────────────────

export function registerSpOpeningStockRoutes(app: Express) {
  app.get("/api/sp/opening-stock", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;
      const rows = await db.execute(
        sql`SELECT * FROM sp_stock_movements WHERE company_id = ${companyId} AND source_type = 'opening' ORDER BY created_at DESC`
      );
      res.json(resultRows(rows));
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/sp/opening-stock", privilegedMutationRateLimit, requireAuth, (_req: Request, res: Response) =>
    res.status(410).json({
      code: GOLDEN_COAST_LEGACY_RETIRED_CODE,
      message: GOLDEN_COAST_LEGACY_RETIRED_MESSAGE,
    })
  );
}
