import type { Express } from "express";
import { createHash } from "crypto";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate } from "./_helpers";
import {
  inventory, stockItems, stockGroups, stockItemCodeAliases,
  stockItemLocationPrices, stockTransferVouchers, stockTransferItems,
  stockAdjustmentVouchers, stockAdjustmentItems,
  containers, containerOffloads, containerOffloadItems, containerSales,
  containerCharges, containerTrackingImportRowSchema, updateContainerTrackingSchema,
  bankAccounts, fixedAssets, insertBankAccountSchema, insertFixedAssetSchema,
  insertStockGroupSchema, insertStockItemSchema, insertStockItemCodeAliasSchema,
  insertContainerSchema, offloadRequestSchema,
  purchaseOrders, poLineItems, insertContainerSaleSchema,
  vouchers, voucherEntries, salesItems, suppliers, customers,
  locations, employees, userLocations, auditLog, interCompanyTransfers,
  insertInterCompanyTransferSchema, FEATURE_KEYS,
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory } from "../inventoryHelper";

export function registerBankAssetRoutes(app: Express) {
  app.get("/api/bank-accounts", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const accounts = await storage.getAllBankAccounts(
        req.session.currentCompanyId,
      );
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/bank-accounts", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const parsed = insertBankAccountSchema.parse(req.body);

      // Check for duplicate code
      const existing = await storage.getBankAccountByCode(parsed.code);
      if (existing) {
        return res
          .status(400)
          .json({ message: "Bank account code already exists" });
      }

      // Validate opening balance amount and side must both be present or both absent
      const hasBalance =
        parsed.openingBalance && parseFloat(parsed.openingBalance) !== 0;
      const hasSide =
        parsed.openingBalanceSide &&
        parsed.openingBalanceSide !== "";

      if (hasBalance && !hasSide) {
        return res
          .status(400)
          .json({ message: "Opening balance requires Dr/Cr side" });
      }

      if (!hasBalance && hasSide) {
        return res
          .status(400)
          .json({ message: "Dr/Cr side requires opening balance amount" });
      }

      // Validate linked ledger is Bank or Cash type
      if (parsed.linkedLedgerId) {
        const allLedgers = await storage.getAllLedgerAccounts(
          req.session.currentCompanyId!,
        );
        const linkedLedger = allLedgers.find(
          (l) => l.id === parsed.linkedLedgerId,
        );

        if (!linkedLedger) {
          return res
            .status(400)
            .json({ message: "Linked ledger account not found" });
        }

        if (
          linkedLedger.accountType !== "Bank" &&
          linkedLedger.accountType !== "Cash"
        ) {
          return res.status(400).json({
            message: `Linked ledger must be Bank or Cash type. Found: ${linkedLedger.accountType}`,
          });
        }
      }

      const account = await storage.createBankAccount(parsed);
      res.status(201).json(account);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/bank-accounts/:id", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const id = parseInt(req.params.id);
      const parsed = insertBankAccountSchema.partial().parse(req.body);

      // Validate opening balance amount and side must both be present or both absent
      const hasBalance =
        parsed.openingBalance && parseFloat(parsed.openingBalance) !== 0;
      const hasSide =
        parsed.openingBalanceSide &&
        parsed.openingBalanceSide !== "";

      if (hasBalance && !hasSide) {
        return res
          .status(400)
          .json({ message: "Opening balance requires Dr/Cr side" });
      }

      if (!hasBalance && hasSide) {
        return res
          .status(400)
          .json({ message: "Dr/Cr side requires opening balance amount" });
      }

      const account = await storage.updateBankAccount(id, parsed, req.session.currentCompanyId);
      res.json(account);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/bank-accounts/:id", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const id = parseInt(req.params.id);
      await storage.deleteBankAccount(id, req.session.currentCompanyId);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Fixed Assets
  app.get("/api/fixed-assets", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const assets = await storage.getAllFixedAssets(
        req.session.currentCompanyId,
      );
      // Transform to match frontend expectations (assetCode, assetName)
      const transformedAssets = assets.map(asset => ({
        ...asset,
        assetCode: asset.code,
        assetName: asset.name,
      }));
      res.json(transformedAssets);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/fixed-assets", requireAuth, async (req, res) => {
    try {
      const parsed = insertFixedAssetSchema.parse(req.body);

      // Check for duplicate code
      const existing = await storage.getFixedAssetByCode(parsed.code);
      if (existing) {
        return res
          .status(400)
          .json({ message: "Fixed asset code already exists" });
      }

      // Validate useful life is required when depreciation method is not "None"
      if (
        parsed.depreciationMethod !== "None" &&
        (!parsed.usefulLife || parsed.usefulLife <= 0)
      ) {
        return res.status(400).json({
          message:
            "Useful life (years) is required and must be greater than 0 when depreciation method is not 'None'",
        });
      }

      const asset = await storage.createFixedAsset(parsed);
      res.status(201).json(asset);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/fixed-assets/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid asset ID" });

      // Check for linked voucher entries
      const entryCheck = await db.execute(sql`SELECT COUNT(*) as cnt FROM voucher_entries WHERE fixed_asset_id = ${id}`);
      const entryCount = parseInt((entryCheck.rows[0] as any)?.cnt || "0");
      if (entryCount > 0) {
        return res.status(400).json({ message: `Cannot delete: this asset has ${entryCount} voucher entry/entries. Remove related transactions first.` });
      }

      const [deleted] = await db.delete(fixedAssets)
        .where(and(eq(fixedAssets.id, id), eq(fixedAssets.companyId, companyId)))
        .returning({ id: fixedAssets.id });

      if (!deleted) return res.status(404).json({ message: "Fixed asset not found" });
      res.json({ message: "Fixed asset deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // PO Import - Parse and Preview Excel
  app.post(
    "/api/po-import/parse",
    requireAuth,
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        if (!req.file) {
          return res.status(400).json({ message: "No file uploaded" });
        }

        const workbook = await readExcel(req.file.buffer);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawData = sheetToJson(worksheet);

        if (rawData.length === 0) {
          return res.status(400).json({ message: "Excel file is empty" });
        }

        // Calculate file hash for idempotency
        const fileHash = createHash('md5')
          .update(req.file.buffer)
          .digest('hex');

        // Check if file already imported
        const existingImport = await storage.getImportLogByHash(fileHash);
        if (existingImport) {
          return res.status(400).json({
            message: "This file has already been imported",
            importedAt: existingImport.createdAt,
            containerId: existingImport.containerId,
          });
        }

        // Parse and structure the data
        const rows = rawData as any[];
        const errors: string[] = [];
        const itemRows: any[] = [];
        const chargeRows: any[] = [];

        // Get all stock items for barcode/name lookup
        const allStockItems = await storage.getAllStockItems(
          req.session.currentCompanyId!,
        );

        // Helper function to find column value with flexible naming
        const getColumnValue = (row: any, ...possibleNames: string[]): string | undefined => {
          for (const name of possibleNames) {
            if (row[name] !== undefined && row[name] !== null && row[name] !== "") {
              return row[name];
            }
          }
          return undefined;
        };

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const rowNum = i + 2;

          // Check if it's a charge row or item row
          const chargeType = getColumnValue(row, "Charge_Type", "Charge Type");
          const chargeAmount = getColumnValue(row, "Charge_Amount", "Charge Amount");
          if (chargeType && chargeAmount) {
            chargeRows.push({
              rowNum,
              chargeType,
              amount: parseFloat(chargeAmount),
              containerNumber: getColumnValue(row, "Container_Number", "Container Number") || "",
            });
          } else if (getColumnValue(row, "Item_Barcode", "Item Barcode") || getColumnValue(row, "Item_Name", "Item Name")) {
            let stockItem = null;
            const itemBarcode = getColumnValue(row, "Item_Barcode", "Item Barcode");
            const itemNameValue = getColumnValue(row, "Item_Name", "Item Name");
            let itemName = itemNameValue || "";

            // Try to find stock item by code/alias or name (for preview purposes only - validation happens in validate step)
            if (itemBarcode) {
              stockItem = await storage.getStockItemByCodeOrAlias(
                itemBarcode,
                req.session.currentCompanyId!,
              );
              if (stockItem) {
                itemName = stockItem.name;
              }
            } else if (itemNameValue) {
              stockItem = allStockItems.find(
                (item) => item.name === itemNameValue,
              );
            }

            const quantity = parseFloat(getColumnValue(row, "Quantity") || "0");
            const rate = parseFloat(getColumnValue(row, "Rate") || "0");

            if (quantity === 0 || isNaN(quantity)) {
              errors.push(`Row ${rowNum}: Quantity must be a non-zero number (negative quantities are allowed)`);
              continue;
            }

            if (rate === undefined || rate < 0) {
              errors.push(`Row ${rowNum}: Rate must be non-negative`);
              continue;
            }

            itemRows.push({
              rowNum,
              poNumber: getColumnValue(row, "PO_Number", "PO Number") || "",
              containerNumber: getColumnValue(row, "Container_Number", "Container Number") || "",
              supplierCode: getColumnValue(row, "Supplier_Code", "Supplier Code") || "",
              barcode: itemBarcode || null,
              stockItemId: stockItem?.id || null,
              itemName: itemName,
              quantity: quantity,
              rate: rate,
              lineTotal: quantity * rate,
              currency: getColumnValue(row, "Currency") || "USD",
              freight: parseFloat(getColumnValue(row, "Freight") || "0"),
              surcharge: parseFloat(getColumnValue(row, "Surcharge") || "0"),
              fumigation: parseFloat(getColumnValue(row, "Fumigation") || "0"),
              discount: parseFloat(getColumnValue(row, "Discount") || "0"),
              documentCharges: parseFloat(getColumnValue(row, "Document_Charges", "Document Charges") || "0"),
            });
          }
        }

        // Basic structural errors only (validation of item existence happens in validate step)
        if (errors.length > 0) {
          return res.status(400).json({ message: "Validation errors", errors });
        }

        if (itemRows.length === 0) {
          return res.status(400).json({ message: "No valid item rows found" });
        }

        // Group by container
        const containerGroups = itemRows.reduce(
          (acc, row) => {
            if (!acc[row.containerNumber]) {
              acc[row.containerNumber] = {
                containerNumber: row.containerNumber,
                supplierCode: row.supplierCode,
                items: [],
                pos: new Map(),
              };
            }

            const container = acc[row.containerNumber];
            container.items.push(row);

            if (!container.pos.has(row.poNumber)) {
              container.pos.set(row.poNumber, []);
            }
            container.pos.get(row.poNumber)!.push(row);

            return acc;
          },
          {} as Record<string, any>,
        );

        // Calculate container totals
        const preview = Object.values(containerGroups).map((container: any) => {
          const itemsTotal = container.items.reduce(
            (sum: number, item: any) => sum + item.lineTotal,
            0,
          );

          // Get charges from rows or aggregate from columns
          const charges = {
            freight: 0,
            surcharge: 0,
            fumigation: 0,
            discount: 0,
            documentCharges: 0,
          };

          // Check if charges are in separate rows
          const containerCharges = chargeRows.filter(
            (c) => c.containerNumber === container.containerNumber,
          );
          if (containerCharges.length > 0) {
            containerCharges.forEach((charge) => {
              const chargeType = (charge.chargeType || "")
                .toLowerCase()
                .replace(/[_\s]/g, "");
              if (chargeType === "freight") charges.freight = charge.amount;
              else if (chargeType === "surcharge")
                charges.surcharge = charge.amount;
              else if (chargeType === "fumigation")
                charges.fumigation = charge.amount;
              else if (chargeType === "discount")
                charges.discount = charge.amount;
              else if (chargeType.includes("document"))
                charges.documentCharges = charge.amount;
            });
          } else {
            // Aggregate from item row columns
            container.items.forEach((item: any) => {
              charges.freight += item.freight;
              charges.surcharge += item.surcharge;
              charges.fumigation += item.fumigation;
              charges.discount += item.discount;
              charges.documentCharges += item.documentCharges;
            });
          }

          const chargesTotal =
            charges.freight +
            charges.surcharge +
            charges.fumigation +
            charges.documentCharges -
            charges.discount;
          const grandTotal = itemsTotal + chargesTotal;

          return {
            containerNumber: container.containerNumber,
            supplierCode: container.supplierCode,
            itemsCount: container.items.length,
            posCount: container.pos.size,
            itemsTotal,
            charges,
            chargesTotal,
            grandTotal,
            items: container.items,
            pos: Array.from(container.pos.keys()),
          };
        });

        res.json({
          fileHash,
          fileName: req.file.originalname,
          rowCount: rows.length,
          preview,
        });
      } catch (error: any) {
        console.error("PO Import parse error:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // PO Import - Validate data before import
}
