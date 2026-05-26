import { getClientDate } from "../lib/dateUtils";
import type { Express } from "express";
import { sendTransferWhatsApp } from "../helpers/sendTransferWhatsApp";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory } from "./_helpers";
import {
  inventory, stockItems, stockGroups,
  stockTransferVouchers, stockTransferItems,
  stockAdjustmentVouchers, stockAdjustmentItems,
  containers, containerOffloads, containerOffloadItems,
  bankAccounts, fixedAssets, ledgerAccounts, insertLedgerAccountSchema,
  insertStockGroupSchema, insertStockItemSchema, insertContainerSchema,
  insertStockTransferVoucherSchema, insertStockAdjustmentVoucherSchema,
  updateStockTransferSchema, updateStockAdjustmentSchema,
  vouchers, voucherEntries, salesItems, suppliers, customers, customerBalances,
  employees, locations, userLocations, userCompanyRoles, companies,
  auditLog, users, FEATURE_KEYS, companySettings,
  intercompanyPosConfigs,
  purchaseOrders, poLineItems, interCompanyTransfers,
  insertInterCompanyTransferSchema, insertContainerSaleSchema, containerSales,
  insertUserPreferencesSchema, userPreferences,
  insertDraftPosSaleSchema, InsertDraftPosSale,
  insertSalaryAdvanceSchema, insertSalaryAdvanceDeductionSchema,
  salaryAdvances, salaryAdvanceDeductions,
  fiscalPeriodClosures, wasteDispatches, wasteDispatchItems,
  dashboardCashAccounts, dashboardPayableAccounts, dashboardAccountSelections,
  insertDashboardCashAccountSchema, insertDashboardPayableAccountSchema,
  insertDashboardAccountSelectionSchema,
  creditNoteItems, pendingBarcodes, insertPendingBarcodeSchema,
  bales, baleProducts, baleProductCategories, storedFiles,
  stockItemLocationPrices,
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../inventoryHelper";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../netPositionHelper";


export function registerImportRoutes(app: Express) {
  app.post("/api/po-import/validate", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { containerNumber, supplierId, preview, freightPaidBy, freightParentAccountId } = req.body;

      if (!containerNumber || !supplierId || !preview) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const errors: string[] = [];

      // Validate supplier exists
      const allSuppliers = await storage.getAllSuppliers();
      const supplier = allSuppliers.find((s) => s.id === supplierId);
      if (!supplier) {
        errors.push("Selected supplier not found");
      }

      // Get all stock items for validation
      const allStockItems = await storage.getAllStockItems(
        req.session.currentCompanyId!,
      );

      // Validate all items in the preview
      const containerPreview = preview.find(
        (p: any) => p.containerNumber === containerNumber,
      );
      if (!containerPreview) {
        errors.push("Container data not found in preview");
      } else {
        const seenBarcodes = new Set<string>();

        for (const item of containerPreview.items) {
          // Check for duplicate barcodes in the import
          if (item.barcode && seenBarcodes.has(item.barcode)) {
            errors.push(`Duplicate barcode in import: ${item.barcode}`);
          } else if (item.barcode) {
            seenBarcodes.add(item.barcode);
          }

          // Try to find stock item by code/alias first, then by name
          let stockItem = null;
          if (item.barcode) {
            stockItem = await storage.getStockItemByCodeOrAlias(
              item.barcode,
              req.session.currentCompanyId!,
            );
          }
          if (!stockItem && item.itemName) {
            stockItem = allStockItems.find((si) => si.name === item.itemName);
          }

          if (!stockItem) {
            if (item.barcode) {
              errors.push(
                `Item not found: code ${item.barcode} (${item.itemName})`,
              );
            } else {
              errors.push(`Item not found by name: ${item.itemName}`);
            }
          }
        }

        // Validate parent freight account when freight is present and paid by parent
        const containerFreight = containerPreview.charges?.freight || 0;
        if (freightPaidBy === "parent" && containerFreight > 0 && !freightParentAccountId) {
          errors.push("A parent company freight account must be selected when freight is paid by parent company");
        }
      }

      res.json({
        valid: errors.length === 0,
        errors,
      });
    } catch (error: any) {
      console.error("PO Import validation error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // PO Import - Import data
  app.post("/api/po-import/import", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const {
        fileHash,
        fileName,
        containerNumber,
        supplierId,
        importDate,
        preview,
        freightPaidBy,
        freightParentAccountId,
      } = req.body;

      const resolvedFreightPaidBy: string = freightPaidBy || "supplier";
      const resolvedFreightParentAccountId: number | null = freightParentAccountId ? Number(freightParentAccountId) : null;

      if (
        !fileHash ||
        !containerNumber ||
        !supplierId ||
        !importDate ||
        !preview
      ) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      // Validate parent freight account when freightPaidBy=parent
      if (resolvedFreightPaidBy === "parent" && !resolvedFreightParentAccountId) {
        return res.status(400).json({ message: "A parent freight account must be selected when freight is paid by parent company" });
      }

      // SERVER-SIDE VALIDATION - Mandatory before import
      const validationErrors: string[] = [];

      // Validate supplier exists
      const allSuppliers = await storage.getAllSuppliers();
      const supplier = allSuppliers.find((s) => s.id === supplierId);
      if (!supplier) {
        validationErrors.push("Selected supplier not found");
      }

      // Get all stock items for validation
      const allStockItems = await storage.getAllStockItems(
        req.session.currentCompanyId!,
      );

      // Validate all items in the preview
      const containerPreview = preview.find(
        (p: any) => p.containerNumber === containerNumber,
      );
      if (!containerPreview) {
        validationErrors.push("Container data not found in preview");
      } else {
        const seenBarcodes = new Set<string>();

        for (const item of containerPreview.items) {
          // Check for duplicate barcodes in the import
          if (item.barcode && seenBarcodes.has(item.barcode)) {
            validationErrors.push(
              `Duplicate barcode in import: ${item.barcode}`,
            );
          } else if (item.barcode) {
            seenBarcodes.add(item.barcode);
          }

          // Try to find stock item by code/alias first, then by name
          let stockItem = null;
          if (item.barcode) {
            stockItem = await storage.getStockItemByCodeOrAlias(
              item.barcode,
              req.session.currentCompanyId!,
            );
          }
          if (!stockItem && item.itemName) {
            stockItem = allStockItems.find((si) => si.name === item.itemName);
          }

          if (!stockItem) {
            if (item.barcode) {
              validationErrors.push(
                `Item not found: code ${item.barcode} (${item.itemName})`,
              );
            } else {
              validationErrors.push(`Item not found by name: ${item.itemName}`);
            }
          }
        }
      }

      // Reject import if validation fails
      if (validationErrors.length > 0) {
        return res.status(400).json({
          message: "Validation failed",
          errors: validationErrors,
        });
      }

      // Check idempotency
      const existingImport = await storage.getImportLogByHash(fileHash);
      if (existingImport) {
        return res
          .status(400)
          .json({ message: "This file has already been imported" });
      }

      // Check if container already exists (after validation)
      let container = await storage.getContainerByNumber(containerNumber);

      // containerPreview is already defined in validation section above
      // No need to re-check since we just validated it

      if (!container) {
        // Create new container
        container = await storage.createContainer({
          companyId: req.session.currentCompanyId!,
          containerNumber,
          supplierId,
          status: "OTW",
          importDate,
          itemsTotal: containerPreview.itemsTotal.toString(),
          chargesTotal: containerPreview.chargesTotal.toString(),
          grandTotal: containerPreview.grandTotal.toString(),
        });
      } else {
        // Update existing container totals
        await storage.updateContainer(container.id, {
          itemsTotal: (
            parseFloat(container.itemsTotal || "0") +
            containerPreview.itemsTotal
          ).toString(),
          chargesTotal: (
            parseFloat(container.chargesTotal || "0") +
            containerPreview.chargesTotal
          ).toString(),
          grandTotal: (
            parseFloat(container.grandTotal || "0") +
            containerPreview.grandTotal
          ).toString(),
        });
      }

      // Group items by PO
      const poGroups = containerPreview.items.reduce((acc: any, item: any) => {
        if (!acc[item.poNumber]) {
          acc[item.poNumber] = [];
        }
        acc[item.poNumber].push(item);
        return acc;
      }, {});

      // Auto-generate a PO number if the Excel PO Number column was blank
      if (poGroups[""]) {
        const year = new Date().getFullYear();
        const prefix = `PO-${year}-`;
        const companyId = req.session.currentCompanyId!;
        const existingPoRows = await db
          .select({ poNumber: purchaseOrders.poNumber })
          .from(purchaseOrders)
          .where(and(
            eq(purchaseOrders.companyId, companyId),
            like(purchaseOrders.poNumber, `${prefix}%`),
          ));
        let maxSeq = 0;
        for (const { poNumber: pn } of existingPoRows) {
          const n = parseInt(pn.slice(prefix.length), 10);
          if (!isNaN(n) && n > maxSeq) maxSeq = n;
        }
        const generatedPoNumber = `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
        poGroups[generatedPoNumber] = poGroups[""];
        delete poGroups[""];
      }

      // Get fresh stock items data for barcode lookup during import
      const freshStockItems = await storage.getAllStockItems(
        req.session.currentCompanyId!,
      );

      // Get or create "Purchases" ledger account for double-entry bookkeeping
      let purchasesAccount = await storage.getLedgerAccountByCode("PURCHASES", req.session.currentCompanyId!);
      if (!purchasesAccount) {
        // Create default Purchases account if it doesn't exist
        purchasesAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId!,
          code: "PURCHASES",
          name: "Purchases",
          accountType: "Expense",
          openingBalance: "0",
          openingBalanceSide: "Dr",
          active: true,
        });
      }

      // Get or create "Import Charges" ledger account for container charges
      let importChargesAccount =
        await storage.getLedgerAccountByCode("IMPORT_CHARGES", req.session.currentCompanyId!);
      if (!importChargesAccount) {
        importChargesAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId!,
          code: "IMPORT_CHARGES",
          name: "Import Charges",
          accountType: "Expense",
          openingBalance: "0",
          openingBalanceSide: "Dr",
          active: true,
        });
      }

      // Get charges for this container
      const charges = containerPreview.charges;
      
      // Container-level charges
      const containerFreight = charges.freight || 0;
      const containerSurcharge = charges.surcharge || 0;
      const containerFumigation = charges.fumigation || 0;
      const containerDocumentCharges = charges.documentCharges || 0;
      const containerDiscount = charges.discount || 0;
      const containerOtherCharges = charges.otherCharges || 0;
      const hasAnyCharges = containerFreight > 0 || containerSurcharge > 0 || containerFumigation > 0 || 
                            containerDocumentCharges > 0 || containerDiscount > 0 || containerOtherCharges > 0;
      
      // Calculate total items value across all POs for pro-rating charges
      const totalAllItemsValue = Object.values(poGroups).reduce((sum: number, items: any) => {
        return sum + (items as any[]).reduce((s, item) => s + item.lineTotal, 0);
      }, 0);
      
      // Track allocated charges for remainder reconciliation
      let allocatedFreight = 0, allocatedSurcharge = 0, allocatedFumigation = 0;
      let allocatedDocCharges = 0, allocatedDiscount = 0, allocatedOtherCharges = 0;
      const poEntries = Object.entries(poGroups);
      
      // Create POs and line items
      for (let poIndex = 0; poIndex < poEntries.length; poIndex++) {
        const [poNumber, items] = poEntries[poIndex];
        const isLastPO = poIndex === poEntries.length - 1;
        const poItems = items as any[];
        const poItemsTotal = poItems.reduce((sum, item) => sum + item.lineTotal, 0);
        
        // Pro-rate charges based on this PO's items proportion of total
        const proportion = totalAllItemsValue > 0 ? poItemsTotal / totalAllItemsValue : 0;
        
        // For last PO, assign remainder to ensure totals match exactly
        let poFreight, poSurcharge, poFumigation, poDocumentCharges, poDiscount, poOtherCharges;
        if (isLastPO) {
          poFreight = Math.round((containerFreight - allocatedFreight) * 100) / 100;
          poSurcharge = Math.round((containerSurcharge - allocatedSurcharge) * 100) / 100;
          poFumigation = Math.round((containerFumigation - allocatedFumigation) * 100) / 100;
          poDocumentCharges = Math.round((containerDocumentCharges - allocatedDocCharges) * 100) / 100;
          poDiscount = Math.round((containerDiscount - allocatedDiscount) * 100) / 100;
          poOtherCharges = Math.round((containerOtherCharges - allocatedOtherCharges) * 100) / 100;
        } else {
          poFreight = Math.round(containerFreight * proportion * 100) / 100;
          poSurcharge = Math.round(containerSurcharge * proportion * 100) / 100;
          poFumigation = Math.round(containerFumigation * proportion * 100) / 100;
          poDocumentCharges = Math.round(containerDocumentCharges * proportion * 100) / 100;
          poDiscount = Math.round(containerDiscount * proportion * 100) / 100;
          poOtherCharges = Math.round(containerOtherCharges * proportion * 100) / 100;
          // Track allocated amounts
          allocatedFreight += poFreight;
          allocatedSurcharge += poSurcharge;
          allocatedFumigation += poFumigation;
          allocatedDocCharges += poDocumentCharges;
          allocatedDiscount += poDiscount;
          allocatedOtherCharges += poOtherCharges;
        }
        
        // Calculate grand total (items + all charges - discount)
        const poChargesTotal = poFreight + poSurcharge + poFumigation + poDocumentCharges - poDiscount + poOtherCharges;
        const poGrandTotal = poItemsTotal + poChargesTotal;

        // When freight is paid by parent, exclude freight from the subsidiary's supplier balance
        const poIntercoTotal = (resolvedFreightPaidBy === "parent") && poFreight > 0
          ? poItemsTotal + poSurcharge + poFumigation + poDocumentCharges - poDiscount + poOtherCharges
          : poGrandTotal;

        // Create voucher for this PO
        // If subsidiary with parent credit account: entries created here at import time
        // Otherwise: entries created at container offload time per Tally conventions
        const voucher = await storage.createVoucher({
          companyId: req.session.currentCompanyId!,
          currency: "USD",
          voucherNumber: `PO-${poNumber}-${Date.now()}`,
          voucherType: "Purchase",
          voucherDate: importDate,
          description: `${containerNumber} ${supplier?.legalName || 'Unknown'}`,
          totalAmount: (resolvedFreightPaidBy === "parent" ? poGrandTotal : poIntercoTotal).toString(),
          optional: false,
          sourceModule: "ERP",
        });

        // === INTER-COMPANY CREDIT SYSTEM ===
        // Check if this is a subsidiary company with a parent credit account configured
        const parentCompanyId = await storage.getParentCompanyId();
        const currentCompanyId = req.session.currentCompanyId!;
        const isSubsidiary = parentCompanyId && parentCompanyId !== currentCompanyId;

        // ── SP Company: DR Goods OTW / CR OTW Clearing ───────────────────────
        const companyRow = await db.execute(
          sql`SELECT company_type FROM companies WHERE id = ${currentCompanyId} LIMIT 1`
        );
        const companyType = (companyRow as any).rows?.[0]?.company_type ?? (companyRow as any)[0]?.company_type;
        const isSpCompany = companyType === "supplier_partner";

        if (isSpCompany) {
          const [otwAcct] = await db
            .select()
            .from(ledgerAccounts)
            .where(
              and(
                eq(ledgerAccounts.companyId, currentCompanyId),
                eq(ledgerAccounts.subType, "sp_goods_otw"),
                isNull(ledgerAccounts.deletedAt)
              )
            );

          const [otwClrAcct] = await db
            .select()
            .from(ledgerAccounts)
            .where(
              and(
                eq(ledgerAccounts.companyId, currentCompanyId),
                eq(ledgerAccounts.subType, "sp_otw_clearing"),
                isNull(ledgerAccounts.deletedAt)
              )
            );

          if (!otwAcct || !otwClrAcct) {
            return res.status(400).json({
              message: "SP accounts not configured. Please run SP Setup first at /sp/setup.",
            });
          }

          // DR Goods OTW (Asset increases — goods are on the way)
          await storage.createVoucherEntry({
            voucherId: voucher.id,
            ledgerAccountId: otwAcct.id,
            debitAmount: poGrandTotal.toFixed(2),
            creditAmount: "0",
            narration: `PO ${poNumber} - Container ${containerNumber}`,
          });

          // CR OTW Clearing (Liability — we owe for goods in transit)
          await storage.createVoucherEntry({
            voucherId: voucher.id,
            ledgerAccountId: otwClrAcct.id,
            debitAmount: "0",
            creditAmount: poGrandTotal.toFixed(2),
            narration: `PO ${poNumber} - Container ${containerNumber}`,
          });

        } else if (isSubsidiary) {
          // Get the subsidiary's company settings for parent credit account
          const companySettings = await storage.getCompanySettings(currentCompanyId);
          let parentCreditAccountId = companySettings?.parentCreditAccountId;
          
          // Get the current company name for the parent company's receivable account
          const currentCompany = await storage.getCompanyById(currentCompanyId);
          const subsidiaryName = currentCompany?.name || `Company ${currentCompanyId}`;
          
          // Auto-create Parent Credit Account if it doesn't exist
          if (!parentCreditAccountId) {
            // Get parent company name for the account
            const parentCompany = await storage.getCompanyById(parentCompanyId);
            const parentName = parentCompany?.name || "Parent Company";
            const creditAccountName = `${parentName} Credit`;
            
            // Try to find or create the account (with retry for concurrent requests)
            for (let attempt = 0; attempt < 3 && !parentCreditAccountId; attempt++) {
              try {
                // Always fetch first - handles concurrent creation
                let existingAccount = await storage.getLedgerAccountByName(creditAccountName, currentCompanyId);
                
                if (!existingAccount && attempt < 2) {
                  // Auto-generate unique code
                  let code = parentName.substring(0, 3).toUpperCase() + "CRD";
                  let suffix = 1;
                  while (await storage.getLedgerAccountByCode(code, currentCompanyId)) {
                    code = parentName.substring(0, 3).toUpperCase() + "CRD" + suffix;
                    suffix++;
                  }
                  existingAccount = await storage.createLedgerAccount({
                    companyId: currentCompanyId,
                    name: creditAccountName,
                    code,
                    accountType: "Liability",
                    subType: "Current Liability",
                  });
                }
                
                if (existingAccount?.id) {
                  parentCreditAccountId = existingAccount.id;
                  
                  // Save to company settings for future use
                  await storage.upsertCompanySettings({
                    companyId: currentCompanyId,
                    parentCreditAccountId: parentCreditAccountId,
                  });
                  console.log(`Auto-created Parent Credit Account: ${creditAccountName} (ID: ${parentCreditAccountId})`);
                }
              } catch (err: any) {
                console.log(`Parent Credit Account creation attempt ${attempt + 1} failed, will retry fetch:`, err?.message);
                // On any error, loop will retry with fetch-first approach
              }
            }
          }
          
          if (parentCreditAccountId) {
            
            // Find or create a Purchases account for the subsidiary
            let purchasesAccount = await storage.getLedgerAccountByName("Purchases", currentCompanyId);
            if (!purchasesAccount) {
              purchasesAccount = await storage.createLedgerAccount({
                companyId: currentCompanyId,
                name: "Purchases",
                code: "PURCHASES",
                accountType: "Expense",
                subType: "Direct Expense",
              });
            }
            
            // Create voucher entries in SUBSIDIARY: DR Purchases, CR Parent Credit Account
            // When freight is parent-paid, the full grossTotal (including freight) is credited
            // to the parent account — the parent will settle freight with the freight company.
            const subsidiaryVoucherAmount = (resolvedFreightPaidBy === "parent" && poFreight > 0)
              ? poGrandTotal
              : poIntercoTotal;
            await storage.createVoucherEntry({
              voucherId: voucher.id,
              ledgerAccountId: purchasesAccount.id,
              debitAmount: subsidiaryVoucherAmount.toFixed(2),
              creditAmount: "0",
              narration: `PO ${poNumber} - Container ${containerNumber}`,
            });
            
            await storage.createVoucherEntry({
              voucherId: voucher.id,
              ledgerAccountId: parentCreditAccountId,
              debitAmount: "0",
              creditAmount: subsidiaryVoucherAmount.toFixed(2),
              narration: `PO ${poNumber} - Credit from ${subsidiaryName}`,
            });
            
            // === CREATE MATCHING VOUCHER IN PARENT COMPANY ===
            // Find or create "[Subsidiary Name] Credit" account in parent (Asset - receivable)
            const subsidiaryAccountName = `${subsidiaryName} Credit`;
            let subsidiaryReceivableAccount = await storage.getLedgerAccountByName(subsidiaryAccountName, parentCompanyId);
            if (!subsidiaryReceivableAccount) {
              // Auto-generate unique code
              let code = subsidiaryName.substring(0, 3).toUpperCase() + "CRD";
              let suffix = 1;
              while (await storage.getLedgerAccountByCode(code, parentCompanyId)) {
                code = subsidiaryName.substring(0, 3).toUpperCase() + "CRD" + suffix;
                suffix++;
              }
              subsidiaryReceivableAccount = await storage.createLedgerAccount({
                companyId: parentCompanyId,
                name: subsidiaryAccountName,
                code,
                accountType: "Asset",
                subType: "Current Asset",
              });
            }
            
            // Create matching INTERCO-PARENT voucher in PARENT:
            //   DR Subsidiary Receivable (grossTotal)
            //   CR Supplier (intercoTotal — goods only)
            //   CR FreightParentAccount (freight — when parent-paid)
            const intercoParentTotal = (resolvedFreightPaidBy === "parent" && poFreight > 0)
              ? poGrandTotal
              : poIntercoTotal;
            const parentVoucher = await storage.createVoucher({
              companyId: parentCompanyId,
              currency: "USD",
              voucherNumber: `IC-${poNumber}-${Date.now()}`,
              voucherType: "Journal",
              voucherDate: importDate,
              description: `${containerNumber} ${supplier?.legalName || 'Unknown'}`,
              totalAmount: intercoParentTotal.toString(),
              optional: false,
              sourceModule: "ERP",
            });
            
            // DR: Subsidiary receivable (Asset increases - they owe us the full amount)
            await storage.createVoucherEntry({
              voucherId: parentVoucher.id,
              ledgerAccountId: subsidiaryReceivableAccount.id,
              debitAmount: intercoParentTotal.toFixed(2),
              creditAmount: "0",
              narration: `${subsidiaryName} PO ${poNumber} - Container ${containerNumber}`,
            });
            
            // CR: Supplier account (Liability increases - we owe supplier for goods only)
            await storage.createVoucherEntry({
              voucherId: parentVoucher.id,
              supplierId: supplierId,
              debitAmount: "0",
              creditAmount: poIntercoTotal.toFixed(2),
              narration: `${subsidiaryName} PO ${poNumber} - Container ${containerNumber}`,
            });

            // CR: Freight account (when freight is parent-paid — we owe freight company)
            if (resolvedFreightPaidBy === "parent" && resolvedFreightParentAccountId && poFreight > 0) {
              await storage.createVoucherEntry({
                voucherId: parentVoucher.id,
                ledgerAccountId: resolvedFreightParentAccountId,
                debitAmount: "0",
                creditAmount: poFreight.toFixed(2),
                narration: `Freight - ${subsidiaryName} PO ${poNumber} - Container ${containerNumber}`,
              });
            }
          }
        } else {
          // === PARENT COMPANY: Create direct supplier entry ===
          // When importing to the parent company, create standard voucher entries:
          // DR Purchases (expense), CR Supplier (liability)
          
          // Find or create a Purchases account for the parent company
          let purchasesAccount = await storage.getLedgerAccountByName("Purchases", currentCompanyId);
          if (!purchasesAccount) {
            purchasesAccount = await storage.getLedgerAccountByCode("PURCHASES", currentCompanyId);
          }
          if (!purchasesAccount) {
            purchasesAccount = await storage.createLedgerAccount({
              companyId: currentCompanyId,
              name: "Purchases",
              code: "PURCHASES",
              accountType: "Expense",
              subType: "Direct Expense",
            });
          }
          
          // When freight is parent-paid, split the voucher:
          //   DR Purchases (intercoTotal)  CR Supplier (intercoTotal)   ← goods
          //   DR Purchases (freight)       CR FreightAccount (freight)  ← freight payable
          // Otherwise use grandTotal for both legs (supplier carries freight in their price).
          const hasParentFreight = resolvedFreightPaidBy === "parent" &&
            resolvedFreightParentAccountId && poFreight > 0;
          const goodsAmount = hasParentFreight ? poIntercoTotal : poGrandTotal;

          // DR Purchases — goods portion
          await storage.createVoucherEntry({
            voucherId: voucher.id,
            ledgerAccountId: purchasesAccount.id,
            debitAmount: goodsAmount.toFixed(2),
            creditAmount: "0",
            narration: `PO ${poNumber} - Container ${containerNumber}`,
          });
          
          // CR Supplier — goods payable
          if (supplierId) {
            await storage.createVoucherEntry({
              voucherId: voucher.id,
              supplierId: supplierId,
              debitAmount: "0",
              creditAmount: goodsAmount.toFixed(2),
              narration: `PO ${poNumber} - Container ${containerNumber}`,
            });
          }

          // When freight is parent-paid: add freight entries to this same purchase voucher
          if (hasParentFreight) {
            // DR Purchases — freight portion (same account as goods debit)
            await storage.createVoucherEntry({
              voucherId: voucher.id,
              ledgerAccountId: purchasesAccount.id,
              debitAmount: poFreight.toFixed(2),
              creditAmount: "0",
              narration: `Freight - PO ${poNumber} - Container ${containerNumber}`,
            });
            // CR FreightParentAccount — we owe money to the freight company
            await storage.createVoucherEntry({
              voucherId: voucher.id,
              ledgerAccountId: resolvedFreightParentAccountId!,
              debitAmount: "0",
              creditAmount: poFreight.toFixed(2),
              narration: `Freight - PO ${poNumber} - Container ${containerNumber}`,
            });
          }
        }

        const po = await storage.createPurchaseOrder({
          companyId: req.session.currentCompanyId!,
          poNumber,
          containerId: container.id,
          supplierId,
          voucherId: voucher.id,
          currency: poItems[0].currency,
          itemsTotal: poItemsTotal.toString(),
          freight: poFreight.toString(),
          surcharge: poSurcharge.toString(),
          fumigation: poFumigation.toString(),
          documentCharges: poDocumentCharges.toString(),
          discount: poDiscount.toString(),
          otherCharges: poOtherCharges.toString(),
          chargesEdited: hasAnyCharges,
          freightPaidBy: resolvedFreightPaidBy,
          freightParentAccountId: resolvedFreightPaidBy === "parent" ? resolvedFreightParentAccountId : null,
        } as any, getClientDate(req));

        for (const item of poItems) {
          // Re-lookup stock item by code/alias or name to get fresh ID (not stale preview data)
          let stockItemId = item.stockItemId;
          let stockItem = null;

          // Try code/alias first, then fall back to name
          if (item.barcode) {
            stockItem = await storage.getStockItemByCodeOrAlias(
              item.barcode,
              req.session.currentCompanyId!,
            );
          }
          if (!stockItem && item.itemName) {
            stockItem = freshStockItems.find((si) => si.name === item.itemName);
          }

          if (stockItem) {
            stockItemId = stockItem.id;
          }

          if (!stockItemId) {
            return res.status(400).json({
              message: `Stock item not found: ${item.barcode || item.itemName}. Please ensure all items exist before importing.`,
            });
          }

          await storage.createPOLineItem({
            poId: po.id,
            stockItemId: stockItemId,
            itemName: item.itemName,
            quantity: item.quantity.toString(),
            rate: item.rate.toString(),
            lineTotal: item.lineTotal.toString(),
          });
        }
      }

      // Create container charges records (for display in Container Extra Charges section)
      // Note: Charges are now consolidated into the main PO voucher, no separate vouchers needed
      const chargeTypesForContainer = [
        { type: "Freight", amount: charges.freight, isNegative: false },
        { type: "Surcharge", amount: charges.surcharge, isNegative: false },
        { type: "Fumigation", amount: charges.fumigation, isNegative: false },
        { type: "Discount", amount: charges.discount, isNegative: true },
        { type: "Document Charges", amount: charges.documentCharges, isNegative: false },
        { type: "Other Charges", amount: charges.otherCharges, isNegative: false },
      ];

      for (const charge of chargeTypesForContainer) {
        if (charge.amount > 0) {
          const actualAmount = charge.isNegative ? -charge.amount : charge.amount;
          
          // Create container charge record (for display only - charges are in PO voucher)
          await storage.createContainerCharge({
            containerId: container.id,
            chargeType: charge.type,
            amount: actualAmount.toString(),
          });
        }
      }

      // Create import log
      await storage.createImportLog({
        fileName,
        fileHash,
        rowCount: containerPreview.items.length,
        containerId: container.id,
        status: "Success",
      });

      res.json({
        success: true,
        containerId: container.id,
        containerNumber: container.containerNumber,
        itemsCount: containerPreview.itemsCount,
        grandTotal: containerPreview.grandTotal,
      });
    } catch (error: any) {
      console.error("PO Import error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Download sample PO import template
  app.get("/api/po-import/template", async (_req, res) => {
    try {
      // Sample data for the template
      const sampleData = [
        {
          PO_Number: "PO-2024-001",
          Container_Number: "CONT-2024-001",
          Supplier_Code: "SUP-001",
          Item_Barcode: "BC001",
          Item_Name: "Men's Jeans Mix - Grade A",
          Quantity: 100,
          Rate: 5.5,
          Currency: "USD",
          Freight: 500,
          Surcharge: 50,
          Fumigation: 100,
          Discount: 0,
          Document_Charges: 75,
        },
        {
          PO_Number: "PO-2024-001",
          Container_Number: "CONT-2024-001",
          Supplier_Code: "SUP-001",
          Item_Barcode: "BC002",
          Item_Name: "Women's Tops Mix - Grade A",
          Quantity: 150,
          Rate: 4.25,
          Currency: "USD",
          Freight: 0,
          Surcharge: 0,
          Fumigation: 0,
          Discount: 0,
          Document_Charges: 0,
        },
        {
          PO_Number: "PO-2024-001",
          Container_Number: "CONT-2024-001",
          Supplier_Code: "SUP-001",
          Item_Barcode: "BC003",
          Item_Name: "Kids Clothing Mix - Grade B",
          Quantity: 80,
          Rate: 3.75,
          Currency: "USD",
          Freight: 0,
          Surcharge: 0,
          Fumigation: 0,
          Discount: 0,
          Document_Charges: 0,
        },
        {
          PO_Number: "PO-2024-002",
          Container_Number: "CONT-2024-001",
          Supplier_Code: "SUP-001",
          Item_Barcode: "BC004",
          Item_Name: "Men's Shirts Mix - Premium",
          Quantity: 120,
          Rate: 6.0,
          Currency: "USD",
          Freight: 0,
          Surcharge: 0,
          Fumigation: 0,
          Discount: 0,
          Document_Charges: 0,
        },
        {
          PO_Number: "PO-2024-002",
          Container_Number: "CONT-2024-001",
          Supplier_Code: "SUP-001",
          Item_Barcode: "BC005",
          Item_Name: "Women's Dresses Mix - Grade A",
          Quantity: 90,
          Rate: 7.5,
          Currency: "USD",
          Freight: 0,
          Surcharge: 0,
          Fumigation: 0,
          Discount: 50,
          Document_Charges: 0,
        },
      ];

      // Create workbook and worksheet
      const workbook = createWorkbook();
      jsonToSheet(workbook, sampleData, "PO Import");
      const buffer = await writeWorkbook(workbook);

      // Set headers for download
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=PO_Import_Template.xlsx",
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.send(buffer);
    } catch (error: any) {
      console.error("Template generation error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POS Import - Parse and Preview Excel
  app.post(
    "/api/pos-import/parse",
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

        // Parse rows
        const rows = rawData as any[];
        const items: any[] = [];
        let totalValue = 0;

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const rowNum = i + 2;

          // Expected columns: Barcode, Quantity, Rate
          const barcode = row.Barcode || row.barcode || row.Code || row.code;
          const quantity = parseFloat(
            row.Quantity || row.quantity || row.Qty || row.qty || "0",
          );
          const rate = parseFloat(
            row.Rate || row.rate || row.Price || row.price || "0",
          );

          if (!barcode) {
            continue; // Skip rows without barcode
          }

          if (quantity <= 0 || rate <= 0) {
            continue; // Skip invalid quantities/rates
          }

          const itemValue = quantity * rate;
          totalValue += itemValue;

          items.push({
            rowNum,
            barcode: barcode.toString().trim(),
            quantity,
            rate,
            value: itemValue,
          });
        }

        res.json({
          items,
          totalValue,
          fileName: req.file.originalname,
        });
      } catch (error: any) {
        console.error("POS Import parse error:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // POS Import - Validate data before import
  app.post("/api/pos-import/validate", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { locationId, items } = req.body;

      if (!locationId || !items || !Array.isArray(items)) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const errors: string[] = [];
      const warnings: string[] = [];
      const validatedItems: any[] = [];

      // Validate location exists
      const location = await storage.getLocationById(locationId);
      if (!location) {
        errors.push("Selected location not found");
        return res.json({ errors, warnings, validatedItems });
      }

      // Get all stock items for validation
      const allStockItems = await storage.getAllStockItems(
        req.session.currentCompanyId!,
      );

      // Validate each item
      for (const item of items) {
        const validatedItem: any = { ...item };

        // Find stock item by barcode (code or alias)
        let stockItem = await storage.getStockItemByCodeOrAlias(
          item.barcode,
          req.session.currentCompanyId!,
        );

        if (!stockItem) {
          validatedItem.error = `Barcode '${item.barcode}' not found in stock items`;
          errors.push(
            `Row ${item.rowNum}: Barcode '${item.barcode}' not found`,
          );
        } else {
          validatedItem.stockItemId = stockItem.id;
          validatedItem.stockItemName = stockItem.name;
          validatedItem.stockItemUom = stockItem.uom;

          // Check if location has this item in inventory for cost price calculation
          const inventoryItem = await db
            .select()
            .from(inventory)
            .where(
              and(
                eq(inventory.stockItemId, stockItem.id),
                eq(inventory.locationId, locationId),
              ),
            )
            .limit(1);

          // Get cost price for profit calculation and check inventory levels
          if (inventoryItem.length > 0) {
            validatedItem.costPrice = parseFloat(
              inventoryItem[0].averageRate || "0",
            );
            const currentQty = parseFloat(inventoryItem[0].quantity || "0");
            const saleQty = parseFloat(item.quantity);
            const remainingQty = currentQty - saleQty;
            
            validatedItem.currentStock = currentQty;
            validatedItem.remainingStock = remainingQty;

            // Add warnings for low or negative stock
            if (remainingQty < 0) {
              validatedItem.warning = `Stock will go negative (${remainingQty.toFixed(2)} ${stockItem.uom})`;
              warnings.push(
                `${stockItem.name}: Stock will go negative (Current: ${currentQty.toFixed(2)}, Selling: ${saleQty.toFixed(2)}, Remaining: ${remainingQty.toFixed(2)} ${stockItem.uom})`
              );
            } else if (remainingQty === 0) {
              validatedItem.warning = `Stock will reach zero`;
              warnings.push(
                `${stockItem.name}: Stock will reach zero (Current: ${currentQty.toFixed(2)}, Selling: ${saleQty.toFixed(2)} ${stockItem.uom})`
              );
            }
          } else {
            // No inventory at this location
            validatedItem.currentStock = 0;
            validatedItem.remainingStock = -parseFloat(item.quantity);
            validatedItem.warning = `No stock at this location, will go negative`;
            warnings.push(
              `${stockItem.name}: No stock at this location (Selling: ${item.quantity} ${stockItem.uom})`
            );
          }
        }

        validatedItems.push(validatedItem);
      }

      res.json({
        errors,
        warnings,
        validatedItems,
      });
    } catch (error: any) {
      console.error("POS Import validation error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POS Import - Import sales transactions
  app.post("/api/pos-import/import", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { locationId, saleDate, items, cashAccountId } = req.body;

      if (!locationId || !saleDate || !items || !Array.isArray(items) || !cashAccountId) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      // Validate location
      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(400).json({ message: "Location not found" });
      }

      // Validate cash account
      const cashAccount = await storage.getLedgerAccountById(cashAccountId);
      if (!cashAccount || cashAccount.companyId !== req.session.currentCompanyId) {
        return res.status(400).json({ message: "Invalid cash account" });
      }

      // Get or create "Sales Revenue" ledger account
      let salesRevenueAccount = await storage.getLedgerAccountByCode("SALES_REV", req.session.currentCompanyId!);
      if (!salesRevenueAccount) {
        salesRevenueAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId!,
          code: "SALES_REV",
          name: "Sales Revenue",
          accountType: "Income",
          subType: "Direct Income",
          openingBalance: "0",
          openingBalanceSide: "Cr",
          active: true,
        });
      }

      // Get or create "Cost of Goods Sold" ledger account
      let cogsAccount = await storage.getLedgerAccountByCode("COGS", req.session.currentCompanyId!);
      if (!cogsAccount) {
        cogsAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId!,
          code: "COGS",
          name: "Cost of Goods Sold",
          accountType: "Expense",
          subType: "Direct Expense",
          openingBalance: "0",
          openingBalanceSide: "Dr",
          active: true,
        });
      }

      let totalSales = 0;
      let createdVoucher: any = null;

      await db.transaction(async (tx) => {
        // Create sales voucher
        const voucherNumber = `SALES-${Date.now()}`;

        const [voucher] = await tx
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId!,
            locationId,
            locationName: location.name,
            voucherNumber,
            voucherType: "Sales",
            voucherDate: saleDate,
            description: `POS Import - ${items.length} items`,
            totalAmount: "0", // Will be updated with actual total
          })
          .returning();

        // Create sales items and update inventory
        for (const item of items) {
          // Get stock item
          const stockItem = await storage.getStockItemByCodeOrAlias(
            item.barcode,
            req.session.currentCompanyId!,
          );
          if (!stockItem) {
            throw new Error(
              `Stock item not found for barcode: ${item.barcode}`,
            );
          }

          // Get current inventory (allow negative stock for historical sales import)
          const [inventoryRecord] = await tx
            .select()
            .from(inventory)
            .where(
              and(
                eq(inventory.stockItemId, stockItem.id),
                eq(inventory.locationId, locationId),
              ),
            )
            .limit(1);

          // Get cost price and current quantity (allow imports with zero/negative stock)
          let costPrice = 0;
          let currentQty = 0;
          
          if (inventoryRecord) {
            costPrice = parseFloat(inventoryRecord.averageRate || "0");
            currentQty = parseFloat(inventoryRecord.quantity);
          }

          const itemSales = item.quantity * item.rate;
          const itemCost = item.quantity * costPrice;
          const profit = itemSales - itemCost;

          totalSales += itemSales;

          // Look up configured price for this item/location
          const [importCashLocPrice] = await tx
            .select()
            .from(stockItemLocationPrices)
            .where(
              and(
                eq(stockItemLocationPrices.stockItemId, stockItem.id),
                eq(stockItemLocationPrices.locationId, locationId)
              )
            )
            .limit(1);
          const importCashConfiguredPrice = parseFloat(importCashLocPrice?.sellingPrice || stockItem.sellingPrice || "0");

          // Create sales item record
          await tx.insert(salesItems).values({
            voucherId: voucher.id,
            stockItemId: stockItem.id,
            quantity: item.quantity.toString(),
            sellingPrice: item.rate.toString(),
            costPrice: costPrice.toString(),
            totalSales: itemSales.toString(),
            totalCost: itemCost.toString(),
            profit: profit.toString(),
            configuredPrice: importCashConfiguredPrice > 0 ? importCashConfiguredPrice.toFixed(6) : null,
          });
          
          // Note: COGS is tracked in sales_items table but not posted to ledger
          // because this system uses purchase-date expense recognition (not COGS method)

          // Update or create inventory record - allow negative stock
          await adjustInventory(tx, locationId, stockItem.id, -item.quantity, req.session.currentCompanyId!);
        }

        // Create BALANCED voucher entries for double-entry bookkeeping
        // Periodic inventory system: Purchases are expensed when purchased
        // Sales recognize revenue immediately; COGS calculated at period-end
        
        // Entry 1: Debit Cash Account (Asset increases with debit)
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: cashAccountId,
          debitAmount: totalSales.toString(),
          creditAmount: "0",
          narration: `Cash from POS Sales - ${items.length} items`,
        });

        // Entry 2: Credit Sales Revenue (Income increases with credit)
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: salesRevenueAccount.id,
          debitAmount: "0",
          creditAmount: totalSales.toString(),
          narration: `Sales Revenue - ${items.length} items`,
        });

        // Update voucher with total amount
        await tx
          .update(vouchers)
          .set({
            totalAmount: totalSales.toString(),
          })
          .where(eq(vouchers.id, voucher.id));

        createdVoucher = voucher;
      });

      res.json({
        success: true,
        voucher: createdVoucher,
        itemsCount: items.length,
        totalSales: totalSales.toFixed(2),
      });
    } catch (error: any) {
      console.error("POS Import error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Download sample POS import template
  app.get("/api/pos-import/template", async (_req, res) => {
    try {
      const sampleData = [
        {
          Barcode: "BC001",
          Quantity: 5,
          Rate: 25.0,
        },
        {
          Barcode: "BC002",
          Quantity: 3,
          Rate: 35.5,
        },
        {
          Barcode: "BC003",
          Quantity: 10,
          Rate: 15.75,
        },
      ];

      const workbook = createWorkbook();
      jsonToSheet(workbook, sampleData, "POS Import");

      const buffer = await writeWorkbook(workbook);

      res.setHeader(
        "Content-Disposition",
        "attachment; filename=POS_Import_Template.xlsx",
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.send(buffer);
    } catch (error: any) {
      console.error("Template generation error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============= Credit Sales Import Endpoints =============

  // Credit Sales Import - Parse and Preview Excel (same as POS but for credit sales)
  app.post(
    "/api/credit-sales-import/parse",
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

        const rows = rawData as any[];
        const items: any[] = [];
        let totalValue = 0;

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const rowNum = i + 2;

          const barcode = row.Barcode || row.barcode || row.Code || row.code;
          const quantity = parseFloat(
            row.Quantity || row.quantity || row.Qty || row.qty || "0",
          );
          const rate = parseFloat(
            row.Rate || row.rate || row.Price || row.price || "0",
          );

          if (!barcode) {
            continue;
          }

          if (quantity <= 0 || rate <= 0) {
            continue;
          }

          const itemValue = quantity * rate;
          totalValue += itemValue;

          items.push({
            rowNum,
            barcode: barcode.toString().trim(),
            quantity,
            rate,
            value: itemValue,
          });
        }

        res.json({
          items,
          totalValue,
          fileName: req.file.originalname,
        });
      } catch (error: any) {
        console.error("Credit Sales Import parse error:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Credit Sales Import - Validate data before import
  app.post("/api/credit-sales-import/validate", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { locationId, items } = req.body;

      if (!locationId || !items || !Array.isArray(items)) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const errors: string[] = [];
      const warnings: string[] = [];
      const validatedItems: any[] = [];

      const location = await storage.getLocationById(locationId);
      if (!location) {
        errors.push("Selected location not found");
        return res.json({ errors, warnings, validatedItems });
      }

      for (const item of items) {
        const validatedItem: any = { ...item };

        let stockItem = await storage.getStockItemByCodeOrAlias(
          item.barcode,
          req.session.currentCompanyId!,
        );

        if (!stockItem) {
          validatedItem.error = `Barcode '${item.barcode}' not found in stock items`;
          errors.push(
            `Row ${item.rowNum}: Barcode '${item.barcode}' not found`,
          );
        } else {
          validatedItem.stockItemId = stockItem.id;
          validatedItem.stockItemName = stockItem.name;
          validatedItem.stockItemUom = stockItem.uom;

          const inventoryItem = await db
            .select()
            .from(inventory)
            .where(
              and(
                eq(inventory.stockItemId, stockItem.id),
                eq(inventory.locationId, locationId),
              ),
            )
            .limit(1);

          if (inventoryItem.length > 0) {
            validatedItem.costPrice = parseFloat(
              inventoryItem[0].averageRate || "0",
            );
            const currentQty = parseFloat(inventoryItem[0].quantity || "0");
            const saleQty = parseFloat(item.quantity);
            const remainingQty = currentQty - saleQty;
            
            validatedItem.currentStock = currentQty;
            validatedItem.remainingStock = remainingQty;

            if (remainingQty < 0) {
              validatedItem.warning = `Stock will go negative (${remainingQty.toFixed(2)} ${stockItem.uom})`;
              warnings.push(
                `${stockItem.name}: Stock will go negative (Current: ${currentQty.toFixed(2)}, Selling: ${saleQty.toFixed(2)}, Remaining: ${remainingQty.toFixed(2)} ${stockItem.uom})`
              );
            } else if (remainingQty === 0) {
              validatedItem.warning = `Stock will reach zero`;
              warnings.push(
                `${stockItem.name}: Stock will reach zero (Current: ${currentQty.toFixed(2)}, Selling: ${saleQty.toFixed(2)} ${stockItem.uom})`
              );
            }
          } else {
            validatedItem.currentStock = 0;
            validatedItem.remainingStock = -parseFloat(item.quantity);
            validatedItem.warning = `No stock at this location, will go negative`;
            warnings.push(
              `${stockItem.name}: No stock at this location (Selling: ${item.quantity} ${stockItem.uom})`
            );
          }
        }

        validatedItems.push(validatedItem);
      }

      res.json({
        errors,
        warnings,
        validatedItems,
      });
    } catch (error: any) {
      console.error("Credit Sales Import validation error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Credit Sales Import - Import credit sales transactions
  app.post("/api/credit-sales-import/import", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { locationId, saleDate, items, customerId } = req.body;

      if (!locationId || !saleDate || !items || !Array.isArray(items) || !customerId) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(400).json({ message: "Location not found" });
      }

      let customer = await storage.getCustomerById(customerId);
      if (!customer || customer.companyId !== req.session.currentCompanyId) {
        return res.status(400).json({ message: "Invalid customer" });
      }

      let salesRevenueAccount = await storage.getLedgerAccountByCode("SALES_REV", req.session.currentCompanyId!);
      if (!salesRevenueAccount) {
        salesRevenueAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId!,
          code: "SALES_REV",
          name: "Sales Revenue",
          accountType: "Income",
          subType: "Direct Income",
          openingBalance: "0",
          openingBalanceSide: "Cr",
          active: true,
        });
      }

      // Get or create the customer's linked ledger account for receivables
      let customerLedgerAccountId = customer.ledgerAccountId;
      if (!customerLedgerAccountId) {
        // Create a ledger account for this customer
        const customerLedgerCode = `CUST_${customer.code}`;
        let customerLedgerAccount = await storage.getLedgerAccountByCode(customerLedgerCode, req.session.currentCompanyId!);
        if (!customerLedgerAccount) {
          customerLedgerAccount = await storage.createLedgerAccount({
            companyId: req.session.currentCompanyId!,
            code: customerLedgerCode,
            name: `${customer.legalName} - Receivable`,
            accountType: "Asset",
            subType: "Sundry Debtors",
            openingBalance: "0",
            openingBalanceSide: "Dr",
            active: true,
          });
        }
        // Update customer with the linked ledger account
        customer = await storage.updateCustomer(customer.id, { ledgerAccountId: customerLedgerAccount.id });
        customerLedgerAccountId = customerLedgerAccount.id;
      }

      let totalSales = 0;
      let createdVoucher: any = null;

      await db.transaction(async (tx) => {
        const voucherNumber = `CREDIT-SALES-${Date.now()}`;

        const [voucher] = await tx
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId!,
            locationId,
            locationName: location.name,
            voucherNumber,
            voucherType: "Sales",
            voucherDate: saleDate,
            description: `Credit Sale Import - ${items.length} items - Customer: ${customer.legalName}`,
            totalAmount: "0",
            isCreditSale: true,
          })
          .returning();

        for (const item of items) {
          const stockItem = await storage.getStockItemByCodeOrAlias(
            item.barcode,
            req.session.currentCompanyId!,
          );
          if (!stockItem) {
            throw new Error(
              `Stock item not found for barcode: ${item.barcode}`,
            );
          }

          const [inventoryRecord] = await tx
            .select()
            .from(inventory)
            .where(
              and(
                eq(inventory.stockItemId, stockItem.id),
                eq(inventory.locationId, locationId),
              ),
            )
            .limit(1);

          let costPrice = 0;
          let currentQty = 0;
          
          if (inventoryRecord) {
            costPrice = parseFloat(inventoryRecord.averageRate || "0");
            currentQty = parseFloat(inventoryRecord.quantity);
          }

          const itemSales = item.quantity * item.rate;
          const itemCost = item.quantity * costPrice;
          const profit = itemSales - itemCost;

          totalSales += itemSales;

          // Look up configured price for this item/location
          const [importCreditLocPrice] = await tx
            .select()
            .from(stockItemLocationPrices)
            .where(
              and(
                eq(stockItemLocationPrices.stockItemId, stockItem.id),
                eq(stockItemLocationPrices.locationId, locationId)
              )
            )
            .limit(1);
          const importCreditConfiguredPrice = parseFloat(importCreditLocPrice?.sellingPrice || stockItem.sellingPrice || "0");

          await tx.insert(salesItems).values({
            voucherId: voucher.id,
            stockItemId: stockItem.id,
            quantity: item.quantity.toString(),
            sellingPrice: item.rate.toString(),
            costPrice: costPrice.toString(),
            totalSales: itemSales.toString(),
            totalCost: itemCost.toString(),
            profit: profit.toString(),
            configuredPrice: importCreditConfiguredPrice > 0 ? importCreditConfiguredPrice.toFixed(6) : null,
          });

          await adjustInventory(tx, locationId, stockItem.id, -item.quantity, req.session.currentCompanyId!);
        }

        // Create voucher entries for credit sale
        // Entry 1: Debit Customer's Ledger Account (Customer owes money)
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: customerLedgerAccountId!,
          debitAmount: totalSales.toString(),
          creditAmount: "0",
          narration: `Credit Sale to ${customer.legalName} - ${items.length} items`,
        });

        // Entry 2: Credit Sales Revenue (Income increases with credit)
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: salesRevenueAccount.id,
          debitAmount: "0",
          creditAmount: totalSales.toString(),
          narration: `Credit Sale Revenue - ${items.length} items`,
        });

        // Update voucher with total amount
        await tx
          .update(vouchers)
          .set({
            totalAmount: totalSales.toString(),
          })
          .where(eq(vouchers.id, voucher.id));

        createdVoucher = voucher;

        // Add customer balance transaction (credit sale = debit to customer = they owe us)
        // Get current running balance for this customer
        const [lastBalance] = await tx
          .select()
          .from(customerBalances)
          .where(
            and(
              eq(customerBalances.customerId, customerId),
              eq(customerBalances.companyId, req.session.currentCompanyId!),
            ),
          )
          .orderBy(desc(customerBalances.id))
          .limit(1);

        const previousBalance = lastBalance ? parseFloat(lastBalance.balance || "0") : 0;
        const newBalance = previousBalance + totalSales;

        await tx.insert(customerBalances).values({
          customerId,
          companyId: req.session.currentCompanyId!,
          transactionDate: saleDate,
          transactionType: "Credit Sale",
          referenceId: voucher.id,
          referenceType: "voucher",
          debitAmount: totalSales.toString(),
          creditAmount: "0",
          balance: newBalance.toString(),
          currency: "USD",
          description: `Credit Sale Import - ${items.length} items`,
        });
      });

      res.json({
        success: true,
        voucher: createdVoucher,
        itemsCount: items.length,
        totalSales: totalSales.toFixed(2),
        customerName: customer.legalName,
      });
    } catch (error: any) {
      console.error("Credit Sales Import error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Download sample Credit Sales import template
  app.get("/api/credit-sales-import/template", async (_req, res) => {
    try {
      const sampleData = [
        {
          Barcode: "BC001",
          Quantity: 5,
          Rate: 25.0,
        },
        {
          Barcode: "BC002",
          Quantity: 3,
          Rate: 35.5,
        },
        {
          Barcode: "BC003",
          Quantity: 10,
          Rate: 15.75,
        },
      ];

      const workbook = createWorkbook();
      jsonToSheet(workbook, sampleData, "Credit Sales Import");

      const buffer = await writeWorkbook(workbook);

      res.setHeader(
        "Content-Disposition",
        "attachment; filename=Credit_Sales_Import_Template.xlsx",
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.send(buffer);
    } catch (error: any) {
      console.error("Template generation error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============= Stock Transfer Import Endpoints =============

  // Stock Transfer Import - Parse and Preview Excel
  app.post(
    "/api/stock-transfer-import/parse",
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

        // Parse rows
        const rows = rawData as any[];
        const items: any[] = [];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const rowNum = i + 2;

          // Expected columns: Barcode, Quantity
          const barcode = row.Barcode || row.barcode || row.Code || row.code;
          const quantity = parseFloat(
            row.Quantity || row.quantity || row.Qty || row.qty || "0",
          );

          if (!barcode) {
            continue; // Skip rows without barcode
          }

          if (quantity <= 0) {
            continue; // Skip invalid quantities
          }

          items.push({
            rowNum,
            barcode: barcode.toString().trim(),
            quantity,
          });
        }

        res.json({
          items,
          totalItems: items.length,
          fileName: req.file.originalname,
        });
      } catch (error: any) {
        console.error("Stock Transfer Import parse error:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Stock Transfer Import - Validate data before import
  app.post("/api/stock-transfer-import/validate", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { sourceLocationId, destinationLocationId, items } = req.body;

      if (!sourceLocationId || !destinationLocationId || !items || !Array.isArray(items)) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      if (sourceLocationId && sourceLocationId === destinationLocationId) {
        return res.status(400).json({ message: "Source and destination must be different" });
      }

      const errors: string[] = [];
      const warnings: string[] = [];
      const validatedItems: any[] = [];

      // Validate locations exist
      const sourceLocation = await storage.getLocationById(sourceLocationId);
      const destLocation = await storage.getLocationById(destinationLocationId);
      
      if (!sourceLocation) {
        errors.push("Source location not found");
        return res.json({ errors, warnings, validatedItems });
      }
      
      if (!destLocation) {
        errors.push("Destination location not found");
        return res.json({ errors, warnings, validatedItems });
      }

      // Validate each item
      for (const item of items) {
        const validatedItem: any = { ...item };

        // Find stock item by barcode (code or alias)
        let stockItem = await storage.getStockItemByCodeOrAlias(
          item.barcode,
          req.session.currentCompanyId!,
        );

        if (!stockItem) {
          validatedItem.error = `Barcode '${item.barcode}' not found in stock items`;
          errors.push(
            `Row ${item.rowNum}: Barcode '${item.barcode}' not found`,
          );
        } else {
          validatedItem.stockItemId = stockItem.id;
          validatedItem.stockItemName = stockItem.name;
          validatedItem.stockItemUom = stockItem.uom;

          // Check source location inventory
          const [inventoryItem] = await db
            .select()
            .from(inventory)
            .where(
              and(
                eq(inventory.stockItemId, stockItem.id),
                eq(inventory.locationId, item.sourceLocationId || sourceLocationId),
              ),
            )
            .limit(1);

          if (inventoryItem) {
            const currentQty = parseFloat(inventoryItem.quantity || "0");
            const transferQty = parseFloat(item.quantity);
            const remainingQty = currentQty - transferQty;
            
            validatedItem.currentStock = currentQty;
            validatedItem.remainingStock = remainingQty;
            validatedItem.averageRate = inventoryItem.averageRate;

            if (remainingQty < 0) {
              validatedItem.warning = `Stock will go negative (Available: ${currentQty.toFixed(2)})`;
              warnings.push(
                `${stockItem.name}: Stock will go negative (Available: ${currentQty.toFixed(2)}, Requested: ${transferQty.toFixed(2)})`
              );
            }
          } else {
            validatedItem.currentStock = 0;
            validatedItem.remainingStock = -parseFloat(item.quantity);
            validatedItem.averageRate = "0";
            validatedItem.warning = `No stock at source location, will go negative`;
            warnings.push(
              `${stockItem.name}: No stock at source location`
            );
          }
        }

        validatedItems.push(validatedItem);
      }

      res.json({
        errors,
        warnings,
        validatedItems,
      });
    } catch (error: any) {
      console.error("Stock Transfer Import validation error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Transfer Import - Create stock transfer
  app.post("/api/stock-transfer-import/import", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { sourceLocationId, destinationLocationId, transferDate, items, notes } = req.body;

      if (!sourceLocationId || !destinationLocationId || !transferDate || !items || !Array.isArray(items)) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      // Validate locations
      const sourceLocation = await storage.getLocationById(sourceLocationId);
      const destLocation = await storage.getLocationById(destinationLocationId);
      
      if (!sourceLocation) {
        return res.status(400).json({ message: "Source location not found" });
      }
      
      if (!destLocation) {
        return res.status(400).json({ message: "Destination location not found" });
      }

      let totalValue = 0;
      const transferItems: Array<{ stockItemId: number; quantity: string; rate: string }> = [];

      // Prepare items with rates from inventory
      for (const item of items) {
        const stockItem = await storage.getStockItemByCodeOrAlias(
          item.barcode,
          req.session.currentCompanyId!,
        );
        
        if (!stockItem) {
          return res.status(400).json({ message: `Stock item not found: ${item.barcode}` });
        }

        // Get rate from source inventory
        const [inventoryItem] = await db
          .select()
          .from(inventory)
          .where(
            and(
              eq(inventory.stockItemId, stockItem.id),
              eq(inventory.locationId, item.sourceLocationId || sourceLocationId),
            ),
          )
          .limit(1);

        // Use inventory rate if available, otherwise use stock item's selling price as fallback
        const rate = inventoryItem 
          ? parseFloat(inventoryItem.averageRate || "0") 
          : parseFloat(stockItem.sellingPrice || "0");
        const quantity = parseFloat(item.quantity);
        
        totalValue += rate * quantity;

        transferItems.push({
          stockItemId: stockItem.id,
          quantity: quantity.toString(),
          rate: rate.toString(),
        });
      }

      const voucherNumber = `ST-${Date.now()}`;
      await db.transaction(async (tx) => {
        // Create stock transfer voucher

        const [voucher] = await tx
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId!,
            locationId: sourceLocationId,
            locationName: sourceLocation.name,
            voucherNumber,
            voucherType: "Stock Transfer",
            voucherDate: transferDate,
            description: notes || `Excel Import - ${items.length} items from ${sourceLocation.name} to ${destLocation.name}`,
            totalAmount: totalValue.toString(),
          })
          .returning();

        // Create stock transfer record
        const [transferRecord] = await tx.insert(stockTransferVouchers).values({
          voucherId: voucher.id,
          sourceLocationId: sourceLocationId,
          destinationLocationId,
        }).returning();

        // Process each item
        for (const item of transferItems) {
          const itemTotal = parseFloat(item.quantity) * parseFloat(item.rate);
          
          // Create stock transfer item
          await tx.insert(stockTransferItems).values({
            transferId: transferRecord.id,
            stockItemId: item.stockItemId,
            quantity: item.quantity,
            rate: item.rate,
            totalAmount: itemTotal.toString(),
          });

          // Reduce source inventory
          await adjustInventory(tx, (item as any).sourceLocationId || sourceLocationId, item.stockItemId, -parseFloat(item.quantity), req.session.currentCompanyId!);

          // Add to destination inventory
          await adjustInventory(tx, destinationLocationId, item.stockItemId, parseFloat(item.quantity), req.session.currentCompanyId!, parseFloat(item.rate));
        }
      });

      res.json({
        success: true,
        itemsCount: items.length,
        totalValue: totalValue.toFixed(2),
      });

      // Fire-and-forget: send transfer image to destination WA group
      const waItems = transferItems.map((i) => ({
        stockItemId: i.stockItemId,
        quantity: parseFloat(i.quantity),
      }));
      const waVoucher = voucherNumber;
      const waSrcName = sourceLocation.name;
      const waDstName = destLocation.name;
      const waDstId   = destinationLocationId;
      const waDate    = transferDate;
      setImmediate(async () => {
        try {
          await sendTransferWhatsApp({
            destinationLocationId: waDstId,
            sourceLocationName: waSrcName,
            destLocationName: waDstName,
            items: waItems,
            voucherNumber: waVoucher,
            voucherDate: waDate,
          });
        } catch (e: any) {
          console.error("[TransferWA] Failed to send:", e.message);
        }
      });
    } catch (error: any) {
      console.error("Stock Transfer Import error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Download sample Stock Transfer import template
  app.get("/api/stock-transfer-import/template", async (_req, res) => {
    try {
      const sampleData = [
        {
          Barcode: "BC001",
          Quantity: 5,
        },
        {
          Barcode: "BC002",
          Quantity: 10,
        },
        {
          Barcode: "BC003",
          Quantity: 15,
        },
      ];

      const workbook = createWorkbook();
      jsonToSheet(workbook, sampleData, "Stock Transfer");

      const buffer = await writeWorkbook(workbook);

      res.setHeader(
        "Content-Disposition",
        "attachment; filename=Stock_Transfer_Import_Template.xlsx",
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.send(buffer);
    } catch (error: any) {
      console.error("Template generation error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Multi-source Stock Transfer Import - Template
  app.get("/api/stock-transfer-import/template-multi-source", async (_req, res) => {
    try {
      const sampleData = [
        {
          "Source Location": "Warehouse A",
          Barcode: "BC001",
          Quantity: 5,
        },
        {
          "Source Location": "Warehouse B",
          Barcode: "BC002",
          Quantity: 10,
        },
        {
          "Source Location": "Warehouse A",
          Barcode: "BC003",
          Quantity: 15,
        },
      ];

      const workbook = createWorkbook();
      jsonToSheet(workbook, sampleData, "Stock Transfer");

      const buffer = await writeWorkbook(workbook);

      res.setHeader(
        "Content-Disposition",
        "attachment; filename=Stock_Transfer_Multi_Source_Template.xlsx",
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.send(buffer);
    } catch (error: any) {
      console.error("Template generation error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Multi-source Stock Transfer Import - Parse Excel
  app.post(
    "/api/stock-transfer-import/parse-multi-source",
    requireAuth,
    requireNonPOS,
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

        const rows = rawData as any[];
        const items: any[] = [];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const rowNum = i + 2;

          // Expected columns: Source Location, Barcode, Quantity
          const sourceLocation = row["Source Location"] || row.SourceLocation || row.sourceLocation || row.source || "";
          const barcode = row.Barcode || row.barcode || row.Code || row.code;
          const quantity = parseFloat(
            row.Quantity || row.quantity || row.Qty || row.qty || "0",
          );

          if (!barcode) {
            continue; // Skip rows without barcode
          }

          if (quantity <= 0) {
            continue; // Skip invalid quantities
          }

          items.push({
            rowNum,
            sourceLocation: sourceLocation.toString().trim(),
            barcode: barcode.toString().trim(),
            quantity,
          });
        }

        if (items.length === 0) {
          return res.status(400).json({
            message: "No valid items found in Excel file. Expected columns: Source Location, Barcode, Quantity",
          });
        }

        res.json({
          success: true,
          items,
        });
      } catch (error: any) {
        console.error("Stock Transfer Parse error:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Multi-source Stock Transfer Import - Validate
  app.post("/api/stock-transfer-import/validate-multi-source", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { destinationLocationId, items } = req.body;

      if (!destinationLocationId || !items || !Array.isArray(items)) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const errors: string[] = [];
      const warnings: string[] = [];
      const validatedItems: any[] = [];

      // Validate destination location exists
      const destLocation = await storage.getLocationById(destinationLocationId);
      if (!destLocation) {
        errors.push("Destination location not found");
        return res.json({ errors, warnings, validatedItems });
      }

      // Get all locations for name lookup
      const allLocations = await storage.getAllLocations(req.session.currentCompanyId!);
      const locationsByName: Record<string, number> = {};
      allLocations.forEach(loc => {
        locationsByName[(loc.name || "").toLowerCase().trim()] = loc.id;
      });

      // Validate each item
      for (const item of items) {
        const validatedItem: any = { ...item };

        // Find source location by name
        const sourceLocationName = item.sourceLocation?.toLowerCase().trim();
        if (!sourceLocationName) {
          validatedItem.error = "Source location is required";
          errors.push(`Row ${item.rowNum}: Source location is required`);
          validatedItems.push(validatedItem);
          continue;
        }

        const sourceLocationId = locationsByName[sourceLocationName];
        if (!sourceLocationId) {
          validatedItem.error = `Source location '${item.sourceLocation}' not found`;
          errors.push(`Row ${item.rowNum}: Source location '${item.sourceLocation}' not found`);
          validatedItems.push(validatedItem);
          continue;
        }

        if (sourceLocationId && sourceLocationId === destinationLocationId) {
          validatedItem.error = "Source and destination cannot be the same";
          errors.push(`Row ${item.rowNum}: Source and destination cannot be the same`);
          validatedItems.push(validatedItem);
          continue;
        }

        validatedItem.sourceLocationId = sourceLocationId;

        // Find stock item by barcode (code or alias)
        let stockItem = await storage.getStockItemByCodeOrAlias(
          item.barcode,
          req.session.currentCompanyId!,
        );

        if (!stockItem) {
          validatedItem.error = `Barcode '${item.barcode}' not found in stock items`;
          errors.push(`Row ${item.rowNum}: Barcode '${item.barcode}' not found`);
        } else {
          validatedItem.stockItemId = stockItem.id;
          validatedItem.stockItemName = stockItem.name;

          // Check inventory at source location
          const inventoryResult = await db
            .select()
            .from(inventory)
            .where(
              and(
                eq(inventory.companyId, req.session.currentCompanyId!),
                eq(inventory.locationId, item.sourceLocationId || sourceLocationId),
                eq(inventory.stockItemId, stockItem.id),
              ),
            )
            .limit(1);

          const invRecord = inventoryResult[0];
          if (!invRecord) {
            validatedItem.warning = `No inventory at source location '${item.sourceLocation}', will go negative`;
            validatedItem.currentStock = 0;
            validatedItem.rate = "0";
            warnings.push(
              `Row ${item.rowNum}: '${stockItem.name}' has no inventory at '${item.sourceLocation}'`,
            );
          } else {
            const currentQty = parseFloat(invRecord.quantity);
            validatedItem.currentStock = currentQty;
            validatedItem.rate = invRecord.averageRate;

            if (item.quantity > currentQty) {
              validatedItem.warning = `Stock will go negative (available: ${currentQty.toFixed(2)})`;
              warnings.push(
                `Row ${item.rowNum}: '${stockItem.name}' - requested ${item.quantity}, available ${currentQty.toFixed(2)}`,
              );
            }
          }
        }

        validatedItems.push(validatedItem);
      }

      res.json({
        success: errors.length === 0,
        errors,
        warnings,
        validatedItems,
      });
    } catch (error: any) {
      console.error("Stock Transfer Validate error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Multi-source Stock Transfer Import - Execute Import
  app.post("/api/stock-transfer-import/import-multi-source", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { destinationLocationId, transferDate, notes, items } = req.body;

      if (!destinationLocationId || !items || !Array.isArray(items)) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      // Validate all items have required fields
      for (const item of items) {
        if (!item.stockItemId || !item.sourceLocationId || !item.quantity || item.error) {
          return res.status(400).json({
            message: "Some items have validation errors. Please validate and fix before importing.",
          });
        }
      }

      // Get destination location for the name - verify it belongs to this company
      const destLocation = await storage.getLocationById(destinationLocationId);
      if (!destLocation || destLocation.companyId !== req.session.currentCompanyId) {
        return res.status(400).json({ message: "Destination location not found or access denied" });
      }

      // Get all locations for this company for name lookup and validation
      const allLocations = await storage.getAllLocations(req.session.currentCompanyId!);
      const locationsById: Record<number, string> = {};
      const validLocationIds = new Set<number>();
      allLocations.forEach(loc => {
        locationsById[loc.id] = loc.name;
        validLocationIds.add(loc.id);
      });

      // Re-validate items server-side and derive rates from inventory (don't trust client)
      const processedItems: Array<{
        stockItemId: number;
        sourceLocationId: number;
        quantity: number;
        rate: number;
      }> = [];

      for (const item of items) {
        // Validate source location belongs to this company
        if (!validLocationIds.has(item.sourceLocationId)) {
          return res.status(400).json({
            message: `Source location ${item.sourceLocationId} not found or access denied`,
          });
        }

        // Validate stock item exists and belongs to this company
        const stockItem = await storage.getStockItemById(item.stockItemId);
        if (!stockItem || stockItem.companyId !== req.session.currentCompanyId) {
          return res.status(400).json({
            message: `Stock item ${item.stockItemId} not found or access denied`,
          });
        }

        // Validate source != destination
        if (item.sourceLocationId === destinationLocationId) {
          return res.status(400).json({
            message: "Source and destination locations cannot be the same",
          });
        }

        // Get inventory at source location to derive rate (don't trust client rate)
        const sourceInv = await db
          .select()
          .from(inventory)
          .where(
            and(
              eq(inventory.companyId, req.session.currentCompanyId!),
              eq(inventory.locationId, item.sourceLocationId),
              eq(inventory.stockItemId, item.stockItemId),
            ),
          )
          .limit(1);

        // Use server-derived rate from inventory, or stock item's selling price as fallback
        const serverRate = sourceInv[0] 
          ? parseFloat(sourceInv[0].averageRate || "0") 
          : parseFloat(stockItem.sellingPrice || "0");
        const requestedQty = parseFloat(item.quantity);

        processedItems.push({
          stockItemId: item.stockItemId,
          sourceLocationId: item.sourceLocationId,
          quantity: requestedQty,
          rate: serverRate,
        });
      }

      // Calculate total value using server-derived rates
      let totalValue = 0;
      for (const item of processedItems) {
        totalValue += item.rate * item.quantity;
      }

      // Create voucher and update inventory in a transaction
      let multiSourceVoucherNumber = "";
      await db.transaction(async (tx) => {
        // Get next voucher number
        const existingVouchers = await tx
          .select({ voucherNumber: vouchers.voucherNumber })
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, req.session.currentCompanyId!),
              eq(vouchers.voucherType, "Stock Transfer"),
            ),
          )
          .orderBy(desc(vouchers.id))
          .limit(1);

        let nextNumber = 1;
        if (existingVouchers.length > 0) {
          const lastNum = existingVouchers[0].voucherNumber;
          const numMatch = lastNum.match(/(\d+)$/);
          if (numMatch) {
            nextNumber = parseInt(numMatch[1]) + 1;
          }
        }
        multiSourceVoucherNumber = `STI-${String(nextNumber).padStart(4, "0")}`;
        const voucherNumber = multiSourceVoucherNumber;

        // Create the voucher
        const [voucher] = await tx
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId!,
            voucherType: "Stock Transfer",
            voucherNumber,
            voucherDate: transferDate || getClientDate(req),
            description: notes || `Multi-source Stock Transfer Import (${processedItems.length} items)`,
            totalAmount: totalValue.toString(),
            locationId: destinationLocationId,
            locationName: destLocation.name,
          })
          .returning();

        // Create stock transfer record (use first source location for the main record)
        const firstSourceId = processedItems[0]?.sourceLocationId || 0;
        const [transferRecord] = await tx.insert(stockTransferVouchers).values({
          voucherId: voucher.id,
          sourceLocationId: firstSourceId,
          destinationLocationId,
        }).returning();

        // Process each item - re-fetch inventory inside transaction and update
        for (const item of processedItems) {
          const sourceLocationId = item.sourceLocationId;
          const qty = item.quantity;
          const rate = item.rate;
          const itemTotal = qty * rate;

          // Create stock transfer item with individual sourceLocationId
          await tx.insert(stockTransferItems).values({
            transferId: transferRecord.id,
            stockItemId: item.stockItemId,
            sourceLocationId: item.sourceLocationId || sourceLocationId,
            quantity: qty.toString(),
            rate: rate.toString(),
            totalAmount: itemTotal.toString(),
          });

          // Reduce source inventory
          await adjustInventory(tx, item.sourceLocationId || sourceLocationId, item.stockItemId, -qty, req.session.currentCompanyId!);

          // Add to destination inventory
          await adjustInventory(tx, destinationLocationId, item.stockItemId, qty, req.session.currentCompanyId!, rate);
        }
      });

      res.json({
        success: true,
        itemsCount: processedItems.length,
        totalValue: totalValue.toFixed(2),
      });

      // Fire-and-forget: send transfer image to destination WA group
      if (multiSourceVoucherNumber) {
        const waItemsMs = processedItems.map((i) => ({
          stockItemId: i.stockItemId,
          quantity: i.quantity,
        }));
        const waVoucherMs = multiSourceVoucherNumber;
        const waDstNameMs = destLocation.name;
        const waDstIdMs   = destinationLocationId;
        const waDateMs    = transferDate || getClientDate(req);
        setImmediate(async () => {
          try {
            await sendTransferWhatsApp({
              destinationLocationId: waDstIdMs,
              sourceLocationName: "Multiple Sources",
              destLocationName: waDstNameMs,
              items: waItemsMs,
              voucherNumber: waVoucherMs,
              voucherDate: waDateMs,
            });
          } catch (e: any) {
            console.error("[TransferWA] Failed to send:", e.message);
          }
        });
      }
    } catch (error: any) {
      console.error("Stock Transfer Import error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============= Silent Inventory Transfer (no daybook entry) =============

  // Template download
  app.get("/api/inventory/silent-transfer/template", requireAuth, requireNonPOS, async (_req, res) => {
    try {
      const sampleData = [
        { Barcode: "BC001", Quantity: 10 },
        { Barcode: "BC002", Quantity: 5 },
        { Barcode: "BC003", Quantity: 20 },
      ];
      const workbook = createWorkbook();
      jsonToSheet(workbook, sampleData, "Transfer");
      const buffer = await writeWorkbook(workbook);
      res.setHeader("Content-Disposition", "attachment; filename=Silent_Transfer_Template.xlsx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Parse + validate uploaded Excel — returns structured validation results
  app.post(
    "/api/inventory/silent-transfer/parse",
    requireAuth,
    requireNonPOS,
    upload.single("file"),
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        const { sourceLocationId, destinationLocationId } = req.body;
        if (!sourceLocationId || !destinationLocationId) {
          return res.status(400).json({ message: "Source and destination locations are required" });
        }

        const srcId = parseInt(sourceLocationId);
        const dstId = parseInt(destinationLocationId);
        if (srcId === dstId) return res.status(400).json({ message: "Source and destination must be different" });

        const sourceLocation = await storage.getLocationById(srcId);
        const destLocation = await storage.getLocationById(dstId);
        if (!sourceLocation) return res.status(400).json({ message: "Source location not found" });
        if (!destLocation) return res.status(400).json({ message: "Destination location not found" });

        const workbook = await readExcel(req.file.buffer);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawData = sheetToJson(worksheet) as any[];

        if (rawData.length === 0) return res.status(400).json({ message: "Excel file is empty" });

        // Three output buckets
        const errorLines: Array<{ rowNum: number; barcode: string; reason: string }> = [];
        const validItems: any[] = [];
        const warnItems: any[] = [];   // insufficient stock but can still be applied

        // Track barcodes already seen to detect duplicates in the file
        const seenBarcodes = new Map<string, number>(); // barcode → first rowNum

        for (let i = 0; i < rawData.length; i++) {
          const row = rawData[i];
          const rowNum = i + 2;
          const barcode = (row.Barcode || row.barcode || row.Code || row.code || "").toString().trim();
          const quantityRaw = row.Quantity ?? row.quantity ?? row.Qty ?? row.qty;
          const quantity = parseFloat(quantityRaw ?? "0");

          if (!barcode) continue; // blank row — silently skip

          // Duplicate barcode in same file
          if (seenBarcodes.has(barcode)) {
            errorLines.push({ rowNum, barcode, reason: `Duplicate — already listed at row ${seenBarcodes.get(barcode)}` });
            continue;
          }
          seenBarcodes.set(barcode, rowNum);

          // Invalid quantity
          if (isNaN(quantity) || quantity <= 0) {
            errorLines.push({ rowNum, barcode, reason: "Quantity must be a positive number" });
            continue;
          }

          // Look up stock item
          const stockItem = await storage.getStockItemByCodeOrAlias(barcode, companyId);
          if (!stockItem) {
            errorLines.push({ rowNum, barcode, reason: "Barcode / code not found in stock items" });
            continue;
          }

          // Check inventory at source
          const [srcInv] = await db.select().from(inventory)
            .where(and(eq(inventory.stockItemId, stockItem.id), eq(inventory.locationId, srcId))).limit(1);

          const currentStock = srcInv ? parseFloat(srcInv.quantity || "0") : 0;
          const averageRate  = srcInv ? parseFloat(srcInv.averageRate  || "0") : 0;
          const afterTransfer = currentStock - quantity;

          const item = {
            rowNum,
            barcode,
            stockItemId: stockItem.id,
            stockItemName: stockItem.name,
            uom: stockItem.uom || "",
            quantity,
            currentStock,
            averageRate,
            afterTransfer,
          };

          if (currentStock <= 0 && quantity > 0) {
            // No stock at all at this source
            warnItems.push({ ...item, warnReason: `No stock at source (available: 0)` });
          } else if (afterTransfer < 0) {
            // Partial stock — will go negative
            warnItems.push({ ...item, warnReason: `Insufficient stock (available: ${currentStock.toFixed(2)}, short by: ${Math.abs(afterTransfer).toFixed(2)})` });
          } else {
            validItems.push(item);
          }
        }

        res.json({
          validItems,
          warnItems,
          errorLines,
          sourceLocation: sourceLocation.name,
          destLocation: destLocation.name,
          totalRows: rawData.filter((r: any) => (r.Barcode || r.barcode || r.Code || r.code || "").toString().trim()).length,
        });
      } catch (err: any) {
        console.error("Silent transfer parse error:", err);
        res.status(500).json({ message: err.message });
      }
    },
  );

  // Apply the silent transfer — directly updates inventory, no voucher created
  app.post("/api/inventory/silent-transfer/apply", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { sourceLocationId, destinationLocationId, items } = req.body;
      if (!sourceLocationId || !destinationLocationId || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const srcId = parseInt(sourceLocationId);
      const dstId = parseInt(destinationLocationId);
      if (srcId === dstId) return res.status(400).json({ message: "Source and destination must be different" });

      await db.transaction(async (tx) => {
        for (const item of items) {
          const qty = parseFloat(item.quantity);
          const rate = parseFloat(item.averageRate || "0");
          if (qty <= 0) continue;
          await adjustInventory(tx, srcId, item.stockItemId, -qty, companyId);
          await adjustInventory(tx, dstId, item.stockItemId, qty, companyId, rate);
        }
      });

      res.json({ success: true, itemsTransferred: items.length });
    } catch (err: any) {
      console.error("Silent transfer apply error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/inventory/silent-production — Developer-only silent production/consumption adjustment
  app.post("/api/inventory/silent-production", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if ((req as any).user?.role !== "Developer") {
        return res.status(403).json({ message: "Developer access required" });
      }
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { locationId, type, items } = req.body;
      if (!locationId || !type || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "locationId, type, and items are required" });
      }
      if (type !== "Production" && type !== "Consumption") {
        return res.status(400).json({ message: "type must be Production or Consumption" });
      }

      const locId = parseInt(locationId);
      let applied = 0;

      await db.transaction(async (tx) => {
        for (const item of items) {
          const qty = parseFloat(item.quantity);
          const rate = parseFloat(item.rate || "0");
          if (!qty || !item.stockItemId) continue;
          const delta = type === "Production" ? Math.abs(qty) : -Math.abs(qty);
          await adjustInventory(tx, locId, parseInt(item.stockItemId), delta, companyId, type === "Production" ? rate : undefined);
          applied++;
        }
      });

      res.json({ success: true, applied, type });
    } catch (err: any) {
      console.error("Silent production/consumption error:", err);
      res.status(500).json({ message: err.message });
    }
  });

}
