import { type Express } from "express";
import { logger } from "../../lib/logger";
import { requireAuth, canModifyDate } from "../../auth";
import { updatePosSale } from "../../services/pos/edit/updateSaleService";
import { logAudit } from "../helpers/auditHelpers";

export function registerPosEditSaleRoutes(app: Express): void {
  // Update existing sales voucher
  app.put("/api/vouchers/:id/sales", requireAuth, canModifyDate("voucherDate"), async (req, res) => {
    const _t = Date.now();
    const _uid = req.session.userId;
    const _cid = req.session.currentCompanyId;
    try {
      logger.info("POS sale update started", { module: "pos", action: "updateSale", userId: _uid, companyId: _cid });
      const voucherId = parseInt(req.params.id);
      if (isNaN(voucherId)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const result = await updatePosSale({
        voucherId,
        currentCompanyId: req.session.currentCompanyId,
        userId: req.session.userId!,
        username: (req.session as any).username || "unknown",
        userRole: req.user?.role,
        canSellNegativeStock: req.user?.canSellNegativeStock || false,
        body: req.body,
      });

      if (result.status === 200) {
        logger.info("POS sale update succeeded", {
          module: "pos",
          action: "updateSale",
          userId: _uid,
          companyId: _cid,
          voucherId: result.body?.voucher?.id,
          durationMs: Date.now() - _t,
        });
        try {
          await logAudit({
            userId: req.session.userId!,
            username: (req.session as any).username || "unknown",
            companyId: req.session.currentCompanyId!,
            action: "update",
            tableName: "vouchers",
            recordId: voucherId,
            recordIdentifier: result.body?.voucher?.voucherNumber ?? null,
            changes: null,
          });
        } catch (auditErr) {
          logger.error("[POS edit audit] non-fatal:", { error: auditErr });
        }
      }
      res.status(result.status).json(result.body);
    } catch (error: any) {
      logger.error("POS sale update failed", { module: "pos", action: "updateSale", userId: _uid, companyId: _cid, durationMs: Date.now() - _t, error });
      if (error.message.includes("Inventory not found")) {
        return res.status(404).json({ message: error.message });
      }
      if (error.message.includes("Insufficient stock")) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: error.message });
    }
  });
}
