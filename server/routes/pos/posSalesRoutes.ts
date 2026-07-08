import { type Express } from "express";
import { getClientDate } from "../../lib/dateUtils";
import { logger } from "../../lib/logger";
import { db } from "../../db";
import { requireAuth, canModifyDate } from "../../auth";
import { companies } from "@shared/schema";
import { eq } from "drizzle-orm";
import { createPosSale } from "../../services/pos/createSaleService";

export function registerPosSalesRoutes(app: Express): void {
  app.post("/api/pos/sales", requireAuth, canModifyDate("voucherDate"), async (req, res) => {
    const _t = Date.now();
    const _uid = (req as any).user?.id;
    const _cid = req.session.currentCompanyId;
    logger.info("POS sale create started", { module: "pos", action: "createSale", userId: _uid, companyId: _cid });
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      // Detect supplier_partner company — uses split accounting (Cr Payable + Cr Profit) instead of Cr Sales
      const [currentCoRow] = await db
        .select({ companyType: companies.companyType })
        .from(companies)
        .where(eq(companies.id, req.session.currentCompanyId!))
        .limit(1);
      const isSpCompany = currentCoRow?.companyType === "supplier_partner";

      const result = await createPosSale(
        {
          currentCompanyId: req.session.currentCompanyId!,
          userId: req.user!.id,
          username: (req.session as any).username || "unknown",
          userRole: req.user?.role,
          canSellNegativeStock: req.user?.canSellNegativeStock || false,
          sessionCashAccountId: req.session.cashAccountId,
          voucherDateFallback: getClientDate(req),
          body: req.body,
        },
        { isSpCompany }
      );

      if (result.status === 200) {
        logger.info("POS sale create succeeded", {
          module: "pos",
          action: "createSale",
          userId: _uid,
          companyId: _cid,
          voucherId: result.body?.voucher?.id,
          durationMs: Date.now() - _t,
        });
      }
      res.status(result.status).json(result.body);
    } catch (error: any) {
      logger.error("POS sale create failed", { module: "pos", action: "createSale", userId: _uid, companyId: _cid, durationMs: Date.now() - _t, error });
      // Return appropriate status codes for different error types
      if (error.message.includes("Inventory not found")) {
        return res.status(404).json({ message: error.message });
      }
      if (error.message.includes("Insufficient stock") || error.message.includes("Not enough stock")) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: error.message });
    }
  });
}
