import type { Express } from "express";
import { requireAuth } from "../../../auth";
import { getRawStockRecalcPreview, applyRawStockRecalc } from "../../../services/factory/rawStockRecalc";

export function registerRawStockRecalcRoutes(app: Express) {
  // Read-only diff preview — never writes anything.
  app.get("/api/factory/raw-stock/recalc/preview", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const rows = await getRawStockRecalcPreview(companyId);
      res.json(rows);
    } catch (err: any) {
      console.error("[raw-stock recalc preview] error:", err);
      res.status(500).json({ message: err.message || "Failed to compute recalculation preview" });
    }
  });

  // Apply the corrected cost for the containers the admin approved, cascading to
  // mix batches/bales. Only touches the ids explicitly passed in.
  app.post("/api/factory/raw-stock/recalc/apply", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { containerIds } = req.body;
      if (!Array.isArray(containerIds) || containerIds.length === 0) {
        return res.status(400).json({ message: "containerIds must be a non-empty array" });
      }
      const parsedIds = containerIds.map((id: any) => parseInt(id)).filter((id: number) => !isNaN(id));
      const results = await applyRawStockRecalc(companyId, parsedIds);
      res.json({ results });
    } catch (err: any) {
      console.error("[raw-stock recalc apply] error:", err);
      res.status(500).json({ message: err.message || "Failed to apply recalculation" });
    }
  });
}
