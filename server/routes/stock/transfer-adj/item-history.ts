/**
 * stockTransferAdjRoutes: StockItemHistory endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { storage } from "../../../storage";
import { requireAuth } from "../../../auth";
import {} from "@shared/schema";
import {} from "drizzle-orm";

export function registerStockItemHistoryRoutes(app: Express) {
  // Get stock item transactions (transfers and adjustments)
  app.get("/api/stock-items/:id/transactions", requireAuth, async (req, res) => {
    try {
      const stockItemId = parseInt(req.params.id);
      if (isNaN(stockItemId)) {
        return res.status(400).json({ message: "Invalid stock item ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Verify stock item exists and belongs to current company
      const existingItem = await storage.getStockItemById(stockItemId);
      if (!existingItem) {
        return res.status(404).json({ message: "Stock item not found" });
      }

      if (existingItem.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({
          message: "Access denied: Stock item belongs to a different company",
        });
      }

      const { startDate, endDate } = req.query;
      const transactions = await storage.getStockItemTransactions(
        stockItemId,
        req.session.currentCompanyId,
        startDate as string | undefined,
        endDate as string | undefined
      );

      res.json(transactions);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Get stock item details (last purchase, last sale, inventory locations)
  app.get("/api/stock-items/:id/details", requireAuth, async (req, res) => {
    try {
      const stockItemId = parseInt(req.params.id);
      if (isNaN(stockItemId)) {
        return res.status(400).json({ message: "Invalid stock item ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Verify stock item exists and belongs to current company
      const existingItem = await storage.getStockItemById(stockItemId);
      if (!existingItem) {
        return res.status(404).json({ message: "Stock item not found" });
      }

      if (existingItem.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({
          message: "Access denied: Stock item belongs to a different company",
        });
      }

      const fromDate = typeof req.query.from === "string" ? req.query.from : undefined;
      const toDate = typeof req.query.to === "string" ? req.query.to : undefined;

      // Get all purchases, all sales, and current locations
      const [purchases, sales, inventoryLocations] = await Promise.all([
        storage.getAllPurchasesForItem(stockItemId, req.session.currentCompanyId, fromDate, toDate),
        storage.getAllSalesForItem(stockItemId, req.session.currentCompanyId, fromDate, toDate),
        storage.getInventoryLocationsByItem(stockItemId, req.session.currentCompanyId),
      ]);

      res.json({
        purchases,
        sales,
        inventoryLocations,
      });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Get voucher history for a stock item (all transactions - sales, transfers, consumption, production)
  app.get("/api/stock-items/:id/voucher-history", requireAuth, async (req, res) => {
    try {
      const stockItemId = parseInt(req.params.id);
      if (isNaN(stockItemId)) {
        return res.status(400).json({ message: "Invalid stock item ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Verify stock item exists and belongs to current company
      const existingItem = await storage.getStockItemById(stockItemId);
      if (!existingItem) {
        return res.status(404).json({ message: "Stock item not found" });
      }

      if (existingItem.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({
          message: "Access denied: Stock item belongs to a different company",
        });
      }

      // Get all voucher transactions for this item
      const voucherHistory = await storage.getVoucherHistoryForItem(stockItemId, req.session.currentCompanyId);

      res.json(voucherHistory);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
