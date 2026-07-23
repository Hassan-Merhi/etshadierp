import { getClientDate } from "../lib/dateUtils";
import { logger } from "../lib/logger";
import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireNonPOS } from "../auth";
import { upload } from "./_helpers";
import {
  inventory,
  ledgerAccounts,
  purchaseOrders,
  type Container,
} from "@shared/schema";
import { eq, and, sql, isNull, like } from "drizzle-orm";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory } from "../inventoryHelper";
import { registerCreditSalesImportRoutes } from "./creditSalesImportRoutes";
import { registerPosImportRoutes } from "./posImportRoutes";
import { registerStockTransferImportRoutes } from "./stockTransferImportRoutes";

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

      // A container number that already exists is only a problem if it already has
      // real financial data attached (i.e. it was already imported/offloaded/sold before).
      // A container that was manually added on the tracking page (container number typed
      // in ahead of the invoice, still status OTW with no PO/charges/sale yet) is treated
      // as a placeholder — the import will attach its PO/line items to that existing
      // record instead of creating a duplicate. Must be in the same company to be eligible.
      const existingContainer = await storage.getContainerByNumber(containerNumber);
      if (existingContainer) {
        if (existingContainer.companyId !== req.session.currentCompanyId) {
          errors.push(`Container number "${containerNumber}" already exists — it cannot be imported again`);
        } else if (existingContainer.status !== "OTW") {
          errors.push(`Container number "${containerNumber}" already exists — it cannot be imported again`);
        } else {
          const [existingPOs, existingCharges, existingSale] = await Promise.all([
            storage.getPurchaseOrdersByContainer(existingContainer.id),
            storage.getChargesByContainer(existingContainer.id),
            storage.getContainerSaleByContainerId(existingContainer.id, existingContainer.companyId),
          ]);
          if (existingPOs.length > 0 || existingCharges.length > 0 || existingSale) {
            errors.push(`Container number "${containerNumber}" already exists — it cannot be imported again`);
          }
        }
      }

      // Get all stock items for validation
      const allStockItems = await storage.getAllStockItems(req.session.currentCompanyId!);

      // Validate all items in the preview
      const containerPreview = preview.find((p: any) => p.containerNumber === containerNumber);
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
            stockItem = await storage.getStockItemByCodeOrAlias(item.barcode, req.session.currentCompanyId!);
          }
          if (!stockItem && item.itemName) {
            stockItem = allStockItems.find((si) => si.name === item.itemName);
          }

          if (!stockItem) {
            if (item.barcode) {
              errors.push(`Item not found: code ${item.barcode} (${item.itemName})`);
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
      logger.error("PO Import validation error:", { error: error });
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
      const resolvedFreightParentAccountId: number | null = freightParentAccountId
        ? Number(freightParentAccountId)
        : null;

      if (!fileHash || !containerNumber || !supplierId || !importDate || !preview) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      // Validate parent freight account when freightPaidBy=parent
      if (resolvedFreightPaidBy === "parent" && !resolvedFreightParentAccountId) {
        return res
          .status(400)
          .json({ message: "A parent freight account must be selected when freight is paid by parent company" });
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
      const allStockItems = await storage.getAllStockItems(req.session.currentCompanyId!);

      // Validate all items in the preview
      const containerPreview = preview.find((p: any) => p.containerNumber === containerNumber);
      if (!containerPreview) {
        validationErrors.push("Container data not found in preview");
      } else {
        const seenBarcodes = new Set<string>();

        for (const item of containerPreview.items) {
          // Check for duplicate barcodes in the import
          if (item.barcode && seenBarcodes.has(item.barcode)) {
            validationErrors.push(`Duplicate barcode in import: ${item.barcode}`);
          } else if (item.barcode) {
            seenBarcodes.add(item.barcode);
          }

          // Try to find stock item by code/alias first, then by name
          let stockItem = null;
          if (item.barcode) {
            stockItem = await storage.getStockItemByCodeOrAlias(item.barcode, req.session.currentCompanyId!);
          }
          if (!stockItem && item.itemName) {
            stockItem = allStockItems.find((si) => si.name === item.itemName);
          }

          if (!stockItem) {
            if (item.barcode) {
              validationErrors.push(`Item not found: code ${item.barcode} (${item.itemName})`);
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
        return res.status(400).json({ message: "This file has already been imported" });
      }

      // A container number that already exists is only a hard block if it already has
      // real financial data attached (PO, charges, or a sale) or belongs to another
      // company, or has moved past OTW (offloaded/sold). A container manually typed in
      // on the tracking page ahead of the invoice (still OTW, no PO/charges/sale yet) is
      // a placeholder — merge the imported PO/line items into that existing record
      // instead of creating a duplicate or blocking.
      const existingContainerCheck = await storage.getContainerByNumber(containerNumber);
      let container: Container;
      if (existingContainerCheck) {
        const blockedMessage = {
          message: `Container "${containerNumber}" already exists in the system. Each container number can only be imported once.`,
        };
        if (existingContainerCheck.companyId !== req.session.currentCompanyId) {
          return res.status(400).json(blockedMessage);
        }
        if (existingContainerCheck.status !== "OTW") {
          return res.status(400).json(blockedMessage);
        }
        const [existingPOs, existingCharges, existingSale] = await Promise.all([
          storage.getPurchaseOrdersByContainer(existingContainerCheck.id),
          storage.getChargesByContainer(existingContainerCheck.id),
          storage.getContainerSaleByContainerId(existingContainerCheck.id, existingContainerCheck.companyId),
        ]);
        if (existingPOs.length > 0 || existingCharges.length > 0 || existingSale) {
          return res.status(400).json(blockedMessage);
        }
        // Merge into the existing placeholder container, preserving its tracking fields
        // (shopName, eta, transporter, etc.) that may have been filled in manually.
        container = await storage.updateContainer(existingContainerCheck.id, {
          supplierId,
          status: "OTW",
          importDate,
          itemsTotal: containerPreview.itemsTotal.toString(),
          chargesTotal: containerPreview.chargesTotal.toString(),
          grandTotal: containerPreview.grandTotal.toString(),
        });
      } else {
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
          .where(and(eq(purchaseOrders.companyId, companyId), like(purchaseOrders.poNumber, `${prefix}%`)));
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
      const freshStockItems = await storage.getAllStockItems(req.session.currentCompanyId!);

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
      let importChargesAccount = await storage.getLedgerAccountByCode("IMPORT_CHARGES", req.session.currentCompanyId!);
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
      const hasAnyCharges =
        containerFreight > 0 ||
        containerSurcharge > 0 ||
        containerFumigation > 0 ||
        containerDocumentCharges > 0 ||
        containerDiscount > 0 ||
        containerOtherCharges > 0;

      // Calculate total items value across all POs for pro-rating charges
      const totalAllItemsValue = Object.values(poGroups).reduce((sum: number, items: any) => {
        return sum + (items as any[]).reduce((s, item) => s + item.lineTotal, 0);
      }, 0);

      // Track allocated charges for remainder reconciliation
      let allocatedFreight = 0,
        allocatedSurcharge = 0,
        allocatedFumigation = 0;
      let allocatedDocCharges = 0,
        allocatedDiscount = 0,
        allocatedOtherCharges = 0;
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
        const poIntercoTotal =
          resolvedFreightPaidBy === "parent" && poFreight > 0
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
          description: `${containerNumber} ${supplier?.legalName || "Unknown"}`,
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
            supplierId: supplierId,
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
                  logger.info(
                    `Auto-created Parent Credit Account: ${creditAccountName} (ID: ${parentCreditAccountId})`
                  );
                }
              } catch (err: any) {
                logger.info(
                  `Parent Credit Account creation attempt ${attempt + 1} failed, will retry fetch:`,
                  err?.message
                );
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
            const subsidiaryVoucherAmount =
              resolvedFreightPaidBy === "parent" && poFreight > 0 ? poGrandTotal : poIntercoTotal;
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
            let subsidiaryReceivableAccount = await storage.getLedgerAccountByName(
              subsidiaryAccountName,
              parentCompanyId
            );
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
            const intercoParentTotal =
              resolvedFreightPaidBy === "parent" && poFreight > 0 ? poGrandTotal : poIntercoTotal;
            const parentVoucher = await storage.createVoucher({
              companyId: parentCompanyId,
              currency: "USD",
              voucherNumber: `IC-${poNumber}-${Date.now()}`,
              voucherType: "Journal",
              voucherDate: importDate,
              description: `${containerNumber} ${supplier?.legalName || "Unknown"}`,
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
          const hasParentFreight =
            resolvedFreightPaidBy === "parent" && resolvedFreightParentAccountId && poFreight > 0;
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

        const po = await storage.createPurchaseOrder(
          {
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
          } as any,
          getClientDate(req)
        );

        for (const item of poItems) {
          // Re-lookup stock item by code/alias or name to get fresh ID (not stale preview data)
          let stockItemId = item.stockItemId;
          let stockItem = null;

          // Try code/alias first, then fall back to name
          if (item.barcode) {
            stockItem = await storage.getStockItemByCodeOrAlias(item.barcode, req.session.currentCompanyId!);
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
      logger.error("PO Import error:", { error: error });
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
      res.setHeader("Content-Disposition", "attachment; filename=PO_Import_Template.xlsx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (error: any) {
      logger.error("Template generation error:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  registerPosImportRoutes(app);

  registerCreditSalesImportRoutes(app);

  registerStockTransferImportRoutes(app);


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
        const warnItems: any[] = []; // insufficient stock but can still be applied

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
            errorLines.push({
              rowNum,
              barcode,
              reason: `Duplicate — already listed at row ${seenBarcodes.get(barcode)}`,
            });
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
          const [srcInv] = await db
            .select()
            .from(inventory)
            .where(and(eq(inventory.stockItemId, stockItem.id), eq(inventory.locationId, srcId)))
            .limit(1);

          const currentStock = srcInv ? parseFloat(srcInv.quantity || "0") : 0;
          const averageRate = srcInv ? parseFloat(srcInv.averageRate || "0") : 0;
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
            warnItems.push({
              ...item,
              warnReason: `Insufficient stock (available: ${currentStock.toFixed(2)}, short by: ${Math.abs(afterTransfer).toFixed(2)})`,
            });
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
          totalRows: rawData.filter((r: any) => (r.Barcode || r.barcode || r.Code || r.code || "").toString().trim())
            .length,
        });
      } catch (err: any) {
        logger.error("Silent transfer parse error:", { error: err });
        res.status(500).json({ message: err.message });
      }
    }
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
      logger.error("Silent transfer apply error:", { error: err });
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
          await adjustInventory(
            tx,
            locId,
            parseInt(item.stockItemId),
            delta,
            companyId,
            type === "Production" ? rate : undefined
          );
          applied++;
        }
      });

      res.json({ success: true, applied, type });
    } catch (err: any) {
      logger.error("Silent production/consumption error:", { error: err });
      res.status(500).json({ message: err.message });
    }
  });
}
