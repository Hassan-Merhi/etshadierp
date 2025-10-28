import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import * as XLSX from "xlsx";
import crypto from "crypto-js";
import { storage } from "./storage";
import {
  insertLocationSchema,
  insertLedgerAccountSchema,
  insertEmployeeSchema,
  insertSupplierSchema,
  insertStockGroupSchema,
  insertStockItemSchema,
  insertBankAccountSchema,
  insertFixedAssetSchema,
  offloadRequestSchema,
  insertStockTransferVoucherSchema,
  insertStockAdjustmentVoucherSchema,
} from "@shared/schema";

const upload = multer({ storage: multer.memoryStorage() });

export async function registerRoutes(app: Express): Promise<Server> {
  // Locations
  app.get("/api/locations", async (_req, res) => {
    try {
      const locations = await storage.getAllLocations();
      res.json(locations);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/locations", async (req, res) => {
    try {
      const parsed = insertLocationSchema.parse(req.body);
      
      // Check for duplicate code
      const existing = await storage.getLocationByCode(parsed.code);
      if (existing) {
        return res.status(400).json({ message: "Location code already exists" });
      }

      const location = await storage.createLocation(parsed);
      res.status(201).json(location);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Location Inventory - Get inventory for a specific location
  app.get("/api/locations/:locationId/inventory", async (req, res) => {
    try {
      const locationId = parseInt(req.params.locationId);
      if (isNaN(locationId)) {
        return res.status(400).json({ message: "Invalid location ID" });
      }

      // Validate location exists
      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }

      const inventory = await storage.getLocationInventory(locationId);
      res.json(inventory);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Ledger Accounts
  app.get("/api/ledger-accounts", async (_req, res) => {
    try {
      const accounts = await storage.getAllLedgerAccounts();
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/ledger-accounts", async (req, res) => {
    try {
      const parsed = insertLedgerAccountSchema.parse(req.body);
      
      // Check for duplicate code
      const existing = await storage.getLedgerAccountByCode(parsed.code);
      if (existing) {
        return res.status(400).json({ message: "Ledger account code already exists" });
      }

      // Validate opening balance amount and side must both be present or both absent
      const hasBalance = parsed.openingBalance && parseFloat(parsed.openingBalance) !== 0;
      const hasSide = parsed.openingBalanceSide !== undefined && parsed.openingBalanceSide !== null;
      
      if (hasBalance && !hasSide) {
        return res.status(400).json({ message: "Opening balance requires Dr/Cr side" });
      }
      
      if (!hasBalance && hasSide) {
        return res.status(400).json({ message: "Dr/Cr side requires opening balance amount" });
      }

      // Validate subType based on accountType
      const validSubTypes: Record<string, string[]> = {
        "Income": ["Direct Income", "Indirect Income"],
        "Expense": ["Direct Expense", "Indirect Expense"],
        "Liability": ["Current Liability", "Long-term Liability", "Loans Payable", "Output Tax", "Tax Payable"],
        "Asset": ["Current Asset", "Fixed Asset", "Input Tax", "Tax Receivable"],
      };

      if (parsed.subType && validSubTypes[parsed.accountType]) {
        if (!validSubTypes[parsed.accountType].includes(parsed.subType)) {
          return res.status(400).json({ 
            message: `Invalid subType "${parsed.subType}" for accountType "${parsed.accountType}". Valid options: ${validSubTypes[parsed.accountType].join(", ")}` 
          });
        }
      }

      const account = await storage.createLedgerAccount(parsed);
      res.status(201).json(account);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Employees
  app.get("/api/employees", async (_req, res) => {
    try {
      const employees = await storage.getAllEmployees();
      res.json(employees);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/employees", async (req, res) => {
    try {
      const parsed = insertEmployeeSchema.parse(req.body);
      
      // Check for duplicate code
      const existing = await storage.getEmployeeByCode(parsed.code);
      if (existing) {
        return res.status(400).json({ message: "Employee code already exists" });
      }

      const employee = await storage.createEmployee(parsed);
      res.status(201).json(employee);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Suppliers
  app.get("/api/suppliers", async (_req, res) => {
    try {
      const suppliers = await storage.getAllSuppliers();
      res.json(suppliers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/suppliers", async (req, res) => {
    try {
      const parsed = insertSupplierSchema.parse(req.body);
      
      // Check for duplicate code
      const existing = await storage.getSupplierByCode(parsed.code);
      if (existing) {
        return res.status(400).json({ message: "Supplier code already exists" });
      }

      const supplier = await storage.createSupplier(parsed);
      res.status(201).json(supplier);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Stock Groups
  app.get("/api/stock-groups", async (_req, res) => {
    try {
      const groups = await storage.getAllStockGroups();
      res.json(groups);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/stock-groups", async (req, res) => {
    try {
      const parsed = insertStockGroupSchema.parse(req.body);
      
      // Check for duplicate code
      const existing = await storage.getStockGroupByCode(parsed.code);
      if (existing) {
        return res.status(400).json({ message: "Stock group code already exists" });
      }

      const group = await storage.createStockGroup(parsed);
      res.status(201).json(group);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Stock Items
  app.get("/api/stock-items", async (_req, res) => {
    try {
      const items = await storage.getAllStockItems();
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/stock-items", async (req, res) => {
    try {
      const parsed = insertStockItemSchema.parse(req.body);
      
      // Check for duplicate code
      const existing = await storage.getStockItemByCode(parsed.code);
      if (existing) {
        return res.status(400).json({ message: "Stock item code already exists" });
      }

      // Calculate opening value if qty and rate provided
      if (parsed.openingQty && parsed.openingRate) {
        const qty = parseFloat(parsed.openingQty);
        const rate = parseFloat(parsed.openingRate);
        parsed.openingValue = (qty * rate).toFixed(2);
      }

      const item = await storage.createStockItem(parsed);
      res.status(201).json(item);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Bank Accounts
  app.get("/api/bank-accounts", async (_req, res) => {
    try {
      const accounts = await storage.getAllBankAccounts();
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/bank-accounts", async (req, res) => {
    try {
      const parsed = insertBankAccountSchema.parse(req.body);
      
      // Check for duplicate code
      const existing = await storage.getBankAccountByCode(parsed.code);
      if (existing) {
        return res.status(400).json({ message: "Bank account code already exists" });
      }

      // Validate opening balance amount and side must both be present or both absent
      const hasBalance = parsed.openingBalance && parseFloat(parsed.openingBalance) !== 0;
      const hasSide = parsed.openingBalanceSide !== undefined && parsed.openingBalanceSide !== null;
      
      if (hasBalance && !hasSide) {
        return res.status(400).json({ message: "Opening balance requires Dr/Cr side" });
      }
      
      if (!hasBalance && hasSide) {
        return res.status(400).json({ message: "Dr/Cr side requires opening balance amount" });
      }

      // Validate linked ledger is Bank or Cash type
      if (parsed.linkedLedgerId) {
        const allLedgers = await storage.getAllLedgerAccounts();
        const linkedLedger = allLedgers.find(l => l.id === parsed.linkedLedgerId);
        
        if (!linkedLedger) {
          return res.status(400).json({ message: "Linked ledger account not found" });
        }
        
        if (linkedLedger.accountType !== "Bank" && linkedLedger.accountType !== "Cash") {
          return res.status(400).json({ 
            message: `Linked ledger must be Bank or Cash type. Found: ${linkedLedger.accountType}` 
          });
        }
      }

      const account = await storage.createBankAccount(parsed);
      res.status(201).json(account);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Fixed Assets
  app.get("/api/fixed-assets", async (_req, res) => {
    try {
      const assets = await storage.getAllFixedAssets();
      res.json(assets);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/fixed-assets", async (req, res) => {
    try {
      const parsed = insertFixedAssetSchema.parse(req.body);
      
      // Check for duplicate code
      const existing = await storage.getFixedAssetByCode(parsed.code);
      if (existing) {
        return res.status(400).json({ message: "Fixed asset code already exists" });
      }

      // Validate useful life is required when depreciation method is not "None"
      if (parsed.depreciationMethod !== "None" && (!parsed.usefulLife || parsed.usefulLife <= 0)) {
        return res.status(400).json({ 
          message: "Useful life (years) is required and must be greater than 0 when depreciation method is not 'None'" 
        });
      }

      const asset = await storage.createFixedAsset(parsed);
      res.status(201).json(asset);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // PO Import - Parse and Preview Excel
  app.post("/api/po-import/parse", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json(worksheet);

      if (rawData.length === 0) {
        return res.status(400).json({ message: "Excel file is empty" });
      }

      // Calculate file hash for idempotency
      const fileHash = crypto.MD5(req.file.buffer.toString("base64")).toString();

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
      const allStockItems = await storage.getAllStockItems();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;

        // Check if it's a charge row or item row
        if (row.Charge_Type && row.Charge_Amount) {
          chargeRows.push({
            rowNum,
            chargeType: row.Charge_Type,
            amount: parseFloat(row.Charge_Amount),
            containerNumber: row.Container_Number,
          });
        } else if (row.Item_Barcode || row.Item_Name) {
          let stockItem = null;
          let itemName = row.Item_Name;

          // Try to find stock item (for preview purposes only - validation happens in validate step)
          if (row.Item_Barcode) {
            stockItem = allStockItems.find(item => item.barcode === row.Item_Barcode);
            if (stockItem) {
              itemName = stockItem.name;
            }
          } else if (row.Item_Name) {
            stockItem = allStockItems.find(item => item.name === row.Item_Name);
          }

          const quantity = parseFloat(row.Quantity);
          const rate = parseFloat(row.Rate);

          if (!quantity || quantity <= 0) {
            errors.push(`Row ${rowNum}: Quantity must be greater than 0`);
            continue;
          }

          if (rate === undefined || rate < 0) {
            errors.push(`Row ${rowNum}: Rate must be non-negative`);
            continue;
          }

          itemRows.push({
            rowNum,
            poNumber: row.PO_Number,
            containerNumber: row.Container_Number,
            supplierCode: row.Supplier_Code,
            barcode: row.Item_Barcode || null,
            stockItemId: stockItem?.id || null,
            itemName: itemName,
            quantity: quantity,
            rate: rate,
            lineTotal: quantity * rate,
            currency: row.Currency || "USD",
            freight: parseFloat(row.Freight || 0),
            surcharge: parseFloat(row.Surcharge || 0),
            fumigation: parseFloat(row.Fumigation || 0),
            discount: parseFloat(row.Discount || 0),
            documentCharges: parseFloat(row.Document_Charges || 0),
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
      const containerGroups = itemRows.reduce((acc, row) => {
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
      }, {} as Record<string, any>);

      // Calculate container totals
      const preview = Object.values(containerGroups).map((container: any) => {
        const itemsTotal = container.items.reduce((sum: number, item: any) => sum + item.lineTotal, 0);
        
        // Get charges from rows or aggregate from columns
        const charges = {
          freight: 0,
          surcharge: 0,
          fumigation: 0,
          discount: 0,
          documentCharges: 0,
        };

        // Check if charges are in separate rows
        const containerCharges = chargeRows.filter(c => c.containerNumber === container.containerNumber);
        if (containerCharges.length > 0) {
          containerCharges.forEach(charge => {
            const chargeType = charge.chargeType.toLowerCase().replace(/[_\s]/g, "");
            if (chargeType === "freight") charges.freight = charge.amount;
            else if (chargeType === "surcharge") charges.surcharge = charge.amount;
            else if (chargeType === "fumigation") charges.fumigation = charge.amount;
            else if (chargeType === "discount") charges.discount = charge.amount;
            else if (chargeType.includes("document")) charges.documentCharges = charge.amount;
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

        const chargesTotal = charges.freight + charges.surcharge + charges.fumigation + charges.documentCharges - charges.discount;
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
  });

  // PO Import - Validate data before import
  app.post("/api/po-import/validate", async (req, res) => {
    try {
      const { containerNumber, supplierId, preview } = req.body;

      if (!containerNumber || !supplierId || !preview) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const errors: string[] = [];

      // Validate supplier exists
      const allSuppliers = await storage.getAllSuppliers();
      const supplier = allSuppliers.find(s => s.id === supplierId);
      if (!supplier) {
        errors.push("Selected supplier not found");
      }

      // Get all stock items for validation
      const allStockItems = await storage.getAllStockItems();

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

          // Try to find stock item by barcode first, then by name
          let stockItem = null;
          if (item.barcode) {
            stockItem = allStockItems.find(si => si.barcode === item.barcode);
          }
          if (!stockItem && item.itemName) {
            stockItem = allStockItems.find(si => si.name === item.itemName);
          }

          if (!stockItem) {
            if (item.barcode) {
              errors.push(`Item not found: barcode ${item.barcode} (${item.itemName})`);
            } else {
              errors.push(`Item not found by name: ${item.itemName}`);
            }
          }
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
  app.post("/api/po-import/import", async (req, res) => {
    try {
      const { fileHash, fileName, containerNumber, supplierId, importDate, preview } = req.body;

      if (!fileHash || !containerNumber || !supplierId || !importDate || !preview) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      // SERVER-SIDE VALIDATION - Mandatory before import
      const validationErrors: string[] = [];

      // Validate supplier exists
      const allSuppliers = await storage.getAllSuppliers();
      const supplier = allSuppliers.find(s => s.id === supplierId);
      if (!supplier) {
        validationErrors.push("Selected supplier not found");
      }

      // Get all stock items for validation
      const allStockItems = await storage.getAllStockItems();

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

          // Try to find stock item by barcode first, then by name
          let stockItem = null;
          if (item.barcode) {
            stockItem = allStockItems.find(si => si.barcode === item.barcode);
          }
          if (!stockItem && item.itemName) {
            stockItem = allStockItems.find(si => si.name === item.itemName);
          }

          if (!stockItem) {
            if (item.barcode) {
              validationErrors.push(`Item not found: barcode ${item.barcode} (${item.itemName})`);
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
          errors: validationErrors 
        });
      }

      // Check idempotency
      const existingImport = await storage.getImportLogByHash(fileHash);
      if (existingImport) {
        return res.status(400).json({ message: "This file has already been imported" });
      }

      // Check if container already exists (after validation)
      let container = await storage.getContainerByNumber(containerNumber);
      
      // containerPreview is already defined in validation section above
      // No need to re-check since we just validated it

      if (!container) {
        // Create new container
        container = await storage.createContainer({
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
          itemsTotal: (parseFloat(container.itemsTotal || "0") + containerPreview.itemsTotal).toString(),
          chargesTotal: (parseFloat(container.chargesTotal || "0") + containerPreview.chargesTotal).toString(),
          grandTotal: (parseFloat(container.grandTotal || "0") + containerPreview.grandTotal).toString(),
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

      // Get fresh stock items data for barcode lookup during import
      const freshStockItems = await storage.getAllStockItems();

      // Get or create "Purchases" ledger account for double-entry bookkeeping
      let purchasesAccount = await storage.getLedgerAccountByCode("PURCHASES");
      if (!purchasesAccount) {
        // Create default Purchases account if it doesn't exist
        purchasesAccount = await storage.createLedgerAccount({
          code: "PURCHASES",
          name: "Purchases",
          accountType: "Expense",
          openingBalance: "0",
          openingBalanceSide: "Dr",
          active: true,
        });
      }

      // Create POs and line items
      for (const [poNumber, items] of Object.entries(poGroups)) {
        const poItems = items as any[];
        const poTotal = poItems.reduce((sum, item) => sum + item.lineTotal, 0);

        // Create voucher for this PO (Purchase voucher with double-entry)
        const voucher = await storage.createVoucher({
          voucherNumber: `PO-${poNumber}-${Date.now()}`,
          voucherType: "Purchase",
          voucherDate: importDate,
          description: `Purchase Order ${poNumber} - Container ${containerNumber}`,
          totalAmount: poTotal.toString(),
        });

        // Create voucher entries for double-entry bookkeeping
        // Debit: Purchases account (Expense increases)
        await storage.createVoucherEntry({
          voucherId: voucher.id,
          ledgerAccountId: purchasesAccount.id,
          debitAmount: poTotal.toString(),
          creditAmount: "0",
          narration: `PO ${poNumber} - Container ${containerNumber}`,
        });

        // Credit: Supplier account (Accounts Payable increases)
        await storage.createVoucherEntry({
          voucherId: voucher.id,
          supplierId: supplierId,
          debitAmount: "0",
          creditAmount: poTotal.toString(),
          narration: `PO ${poNumber} - Container ${containerNumber}`,
        });

        const po = await storage.createPurchaseOrder({
          poNumber,
          containerId: container.id,
          supplierId,
          voucherId: voucher.id,
          currency: poItems[0].currency,
          itemsTotal: poTotal.toString(),
        });

        for (const item of poItems) {
          // Re-lookup stock item by barcode or name to get fresh ID (not stale preview data)
          let stockItemId = item.stockItemId;
          let stockItem = null;

          // Try barcode first, then fall back to name
          if (item.barcode) {
            stockItem = freshStockItems.find(si => si.barcode === item.barcode);
          }
          if (!stockItem && item.itemName) {
            stockItem = freshStockItems.find(si => si.name === item.itemName);
          }

          if (stockItem) {
            stockItemId = stockItem.id;
          }

          if (!stockItemId) {
            return res.status(400).json({ 
              message: `Stock item not found: ${item.barcode || item.itemName}. Please ensure all items exist before importing.`
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

      // Create container charges
      const charges = containerPreview.charges;
      if (charges.freight > 0) {
        await storage.createContainerCharge({
          containerId: container.id,
          chargeType: "Freight",
          amount: charges.freight.toString(),
        });
      }
      if (charges.surcharge > 0) {
        await storage.createContainerCharge({
          containerId: container.id,
          chargeType: "Surcharge",
          amount: charges.surcharge.toString(),
        });
      }
      if (charges.fumigation > 0) {
        await storage.createContainerCharge({
          containerId: container.id,
          chargeType: "Fumigation",
          amount: charges.fumigation.toString(),
        });
      }
      if (charges.discount > 0) {
        await storage.createContainerCharge({
          containerId: container.id,
          chargeType: "Discount",
          amount: (-charges.discount).toString(),
        });
      }
      if (charges.documentCharges > 0) {
        await storage.createContainerCharge({
          containerId: container.id,
          chargeType: "Document Charges",
          amount: charges.documentCharges.toString(),
        });
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
  app.get("/api/po-import/template", (_req, res) => {
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
          Rate: 5.50,
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
          Rate: 6.00,
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
          Rate: 7.50,
          Currency: "USD",
          Freight: 0,
          Surcharge: 0,
          Fumigation: 0,
          Discount: 50,
          Document_Charges: 0,
        },
      ];

      // Create workbook and worksheet
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(sampleData);

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, "PO Import");

      // Generate buffer
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      // Set headers for download
      res.setHeader("Content-Disposition", "attachment; filename=PO_Import_Template.xlsx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (error: any) {
      console.error("Template generation error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get containers
  app.get("/api/containers", async (_req, res) => {
    try {
      const containers = await storage.getAllContainers();
      res.json(containers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get container details with POs, line items, and charges
  app.get("/api/containers/:id", async (req, res) => {
    try {
      const containerId = parseInt(req.params.id);
      const container = await storage.getContainerById(containerId);
      
      if (!container) {
        return res.status(404).json({ message: "Container not found" });
      }

      const pos = await storage.getPurchaseOrdersByContainer(containerId);
      const charges = await storage.getChargesByContainer(containerId);

      // Get line items for all POs
      const allLineItems = await Promise.all(
        pos.map(po => storage.getLineItemsByPO(po.id))
      );

      const posWithItems = pos.map((po, index) => ({
        ...po,
        items: allLineItems[index],
      }));

      res.json({
        container,
        pos: posWithItems,
        charges,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Offload container to location
  app.post("/api/containers/:id/offload", async (req, res) => {
    try {
      const containerId = parseInt(req.params.id);
      
      // Validate request body
      const validation = offloadRequestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: validation.error.errors 
        });
      }

      const { locationId, duties, officeCharges, transferCharges, transportFees } = validation.data;

      // Validate container exists and is not already offloaded
      const container = await storage.getContainerById(containerId);
      if (!container) {
        return res.status(404).json({ message: "Container not found" });
      }
      
      if (container.status === "OFFLOADED") {
        return res.status(400).json({ message: "Container is already offloaded" });
      }

      // Perform offload
      const offload = await storage.offloadContainer(
        containerId,
        locationId,
        duties,
        officeCharges,
        transferCharges,
        transportFees
      );

      res.json(offload);
    } catch (error: any) {
      console.error("Container offload error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Backfill voucher entries for existing POs
  app.post("/api/po-import/backfill", async (_req, res) => {
    try {
      // Get all POs without voucher IDs
      const allPOs = await storage.getAllPurchaseOrders();
      const posWithoutVouchers = allPOs.filter((po: any) => !po.voucherId);

      if (posWithoutVouchers.length === 0) {
        return res.json({ 
          message: "No POs need backfilling", 
          count: 0 
        });
      }

      // Get or create "Purchases" ledger account for double-entry bookkeeping
      let purchasesAccount = await storage.getLedgerAccountByCode("PURCHASES");
      if (!purchasesAccount) {
        purchasesAccount = await storage.createLedgerAccount({
          code: "PURCHASES",
          name: "Purchases",
          accountType: "Expense",
          openingBalance: "0",
          openingBalanceSide: "Dr",
          active: true,
        });
      }

      // Get all containers to lookup import dates
      const allContainers = await storage.getAllContainers();
      const containerMap = new Map(allContainers.map(c => [c.id, c]));

      let backfilledCount = 0;

      for (const po of posWithoutVouchers) {
        const container = containerMap.get(po.containerId);
        if (!container) continue;

        // Create voucher for this PO with double-entry bookkeeping
        const voucher = await storage.createVoucher({
          voucherNumber: `PO-${po.poNumber}-BACKFILL-${Date.now()}`,
          voucherType: "Purchase",
          voucherDate: container.importDate,
          description: `Purchase Order ${po.poNumber} - Container ${container.containerNumber} (Backfilled)`,
          totalAmount: po.itemsTotal || "0",
        });

        // Debit: Purchases account (Expense increases)
        await storage.createVoucherEntry({
          voucherId: voucher.id,
          ledgerAccountId: purchasesAccount.id,
          debitAmount: po.itemsTotal || "0",
          creditAmount: "0",
          narration: `PO ${po.poNumber} - Container ${container.containerNumber} (Backfilled)`,
        });

        // Credit: Supplier account (Accounts Payable increases)
        await storage.createVoucherEntry({
          voucherId: voucher.id,
          supplierId: po.supplierId,
          debitAmount: "0",
          creditAmount: po.itemsTotal || "0",
          narration: `PO ${po.poNumber} - Container ${container.containerNumber} (Backfilled)`,
        });

        // Update PO with voucher ID
        await storage.updatePurchaseOrder(po.id, {
          voucherId: voucher.id,
        });

        backfilledCount++;
      }

      res.json({ 
        message: "Backfill completed successfully", 
        count: backfilledCount 
      });
    } catch (error: any) {
      console.error("Backfill error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get all accounts (combined from ledgers, bank accounts, fixed assets, and suppliers)
  app.get("/api/accounts/all", async (_req, res) => {
    try {
      const ledgers = await storage.getAllLedgerAccounts();
      const banks = await storage.getAllBankAccounts();
      const assets = await storage.getAllFixedAssets();
      const suppliers = await storage.getAllSuppliers();

      const accounts = [
        ...ledgers.map((account) => ({
          id: `ledger-${account.id}`,
          accountId: account.id,
          type: "Ledger",
          code: account.code,
          name: account.name,
          balance: parseFloat(account.openingBalance || "0"),
          balanceSide: account.openingBalanceSide || null,
          active: account.active,
        })),
        ...banks.map((account) => ({
          id: `bank-${account.id}`,
          accountId: account.id,
          type: "Bank",
          code: account.code,
          name: `${account.name} (${account.bankName})`,
          balance: parseFloat(account.openingBalance || "0"),
          balanceSide: account.openingBalanceSide || null,
          active: account.active,
        })),
        ...assets.map((asset) => ({
          id: `asset-${asset.id}`,
          accountId: asset.id,
          type: "Fixed Asset",
          code: asset.code,
          name: asset.name,
          balance: parseFloat(asset.openingBalance || "0"),
          balanceSide: "Dr",
          active: asset.active,
        })),
        ...suppliers.map((supplier) => ({
          id: `supplier-${supplier.id}`,
          accountId: supplier.id,
          type: "Supplier",
          code: supplier.code,
          name: supplier.legalName,
          balance: 0,
          balanceSide: "Cr",
          active: supplier.active,
        })),
      ];

      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get transactions for a specific ledger account with optional date filtering
  app.get("/api/accounts/ledger/:id/transactions", async (req, res) => {
    try {
      const ledgerAccountId = parseInt(req.params.id);
      
      if (isNaN(ledgerAccountId)) {
        return res.status(400).json({ message: "Invalid ledger account ID" });
      }

      const { startDate, endDate } = req.query;

      const transactions = await storage.getVoucherEntriesByLedger(
        ledgerAccountId,
        startDate as string | undefined,
        endDate as string | undefined
      );

      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get transactions for a specific bank account with optional date filtering
  app.get("/api/accounts/bank/:id/transactions", async (req, res) => {
    try {
      const bankAccountId = parseInt(req.params.id);
      
      if (isNaN(bankAccountId)) {
        return res.status(400).json({ message: "Invalid bank account ID" });
      }

      const { startDate, endDate } = req.query;

      const transactions = await storage.getVoucherEntriesByBankAccount(
        bankAccountId,
        startDate as string | undefined,
        endDate as string | undefined
      );

      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get transactions for a specific fixed asset with optional date filtering
  app.get("/api/accounts/fixed-asset/:id/transactions", async (req, res) => {
    try {
      const fixedAssetId = parseInt(req.params.id);
      
      if (isNaN(fixedAssetId)) {
        return res.status(400).json({ message: "Invalid fixed asset ID" });
      }

      const { startDate, endDate } = req.query;

      const transactions = await storage.getVoucherEntriesByFixedAsset(
        fixedAssetId,
        startDate as string | undefined,
        endDate as string | undefined
      );

      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get transactions for a specific supplier with optional date filtering
  app.get("/api/accounts/supplier/:id/transactions", async (req, res) => {
    try {
      const supplierId = parseInt(req.params.id);
      
      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }

      const { startDate, endDate } = req.query;

      const transactions = await storage.getVoucherEntriesBySupplier(
        supplierId,
        startDate as string | undefined,
        endDate as string | undefined
      );

      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get all vouchers with date filtering
  app.get("/api/vouchers", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      let vouchers;
      if (startDate && endDate) {
        vouchers = await storage.getVouchersByDateRange(
          startDate as string,
          endDate as string
        );
      } else {
        vouchers = await storage.getAllVouchers();
      }

      res.json(vouchers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get all suppliers with balances and container counts
  app.get("/api/suppliers/with-stats", async (_req, res) => {
    try {
      const suppliers = await storage.getAllSuppliers();
      
      const suppliersWithStats = await Promise.all(
        suppliers.map(async (supplier) => {
          const containerCount = await storage.getContainerCountBySupplier(supplier.id);
          
          // Calculate balance from voucher entries
          // For suppliers: Credit = increase in payable (we owe them), Debit = decrease (we paid)
          // Balance = Credits - Debits (positive means we owe them)
          const entries = await storage.getVoucherEntriesBySupplier(supplier.id);
          const balance = entries.reduce((sum, entry) => {
            const credit = parseFloat(entry.creditAmount || "0");
            const debit = parseFloat(entry.debitAmount || "0");
            return sum + credit - debit;
          }, 0);
          
          return {
            ...supplier,
            containerCount,
            balance,
          };
        })
      );

      res.json(suppliersWithStats);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create a new voucher
  app.post("/api/vouchers", async (req, res) => {
    try {
      const voucher = await storage.createVoucher(req.body);
      res.json(voucher);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create a new voucher entry
  app.post("/api/voucher-entries", async (req, res) => {
    try {
      const entry = await storage.createVoucherEntry(req.body);
      res.json(entry);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Transfers
  app.post("/api/stock-transfers", async (req, res) => {
    try {
      const { voucherId, sourceLocationId, destinationLocationId, notes, items } = req.body;

      // Validate required fields
      if (!voucherId) {
        return res.status(400).json({ message: "Voucher ID is required" });
      }
      if (!sourceLocationId) {
        return res.status(400).json({ message: "Source location is required" });
      }
      if (!destinationLocationId) {
        return res.status(400).json({ message: "Destination location is required" });
      }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Items are required" });
      }

      // Validate that source and destination are different
      if (sourceLocationId === destinationLocationId) {
        return res.status(400).json({ message: "Source and destination locations must be different" });
      }

      // Validate that locations exist
      const sourceLocation = await storage.getLocationById(sourceLocationId);
      if (!sourceLocation) {
        return res.status(404).json({ message: "Source location not found" });
      }

      const destLocation = await storage.getLocationById(destinationLocationId);
      if (!destLocation) {
        return res.status(404).json({ message: "Destination location not found" });
      }

      // Validate that voucher exists
      const voucher = await storage.getVoucherById(voucherId);
      if (!voucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Validate items
      for (const item of items) {
        if (!item.stockItemId) {
          return res.status(400).json({ message: "Stock item ID is required for all items" });
        }
        if (!item.quantity || parseFloat(item.quantity) <= 0) {
          return res.status(400).json({ message: "Quantity must be positive for all items" });
        }
        if (!item.rate || parseFloat(item.rate) < 0) {
          return res.status(400).json({ message: "Rate must be non-negative for all items" });
        }
      }

      const transfer = await storage.createStockTransfer(
        voucherId,
        sourceLocationId,
        destinationLocationId,
        notes || "",
        items
      );

      res.status(201).json(transfer);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Adjustments
  app.post("/api/stock-adjustments", async (req, res) => {
    try {
      const { voucherId, locationId, adjustmentType, notes, items } = req.body;

      // Validate required fields
      if (!voucherId) {
        return res.status(400).json({ message: "Voucher ID is required" });
      }
      if (!locationId) {
        return res.status(400).json({ message: "Location is required" });
      }
      if (!adjustmentType) {
        return res.status(400).json({ message: "Adjustment type is required" });
      }
      if (adjustmentType !== "Production" && adjustmentType !== "Consumption") {
        return res.status(400).json({ message: "Adjustment type must be either 'Production' or 'Consumption'" });
      }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Items are required" });
      }

      // Validate that location exists
      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }

      // Validate that voucher exists
      const voucher = await storage.getVoucherById(voucherId);
      if (!voucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Validate items
      for (const item of items) {
        if (!item.stockItemId) {
          return res.status(400).json({ message: "Stock item ID is required for all items" });
        }
        if (!item.quantity || parseFloat(item.quantity) === 0) {
          return res.status(400).json({ message: "Quantity cannot be zero for any items" });
        }
        if (parseFloat(item.quantity) < 0) {
          return res.status(400).json({ message: "Quantity must be positive for all items" });
        }
        if (!item.rate || parseFloat(item.rate) < 0) {
          return res.status(400).json({ message: "Rate must be non-negative for all items" });
        }
      }

      const adjustment = await storage.createStockAdjustment(
        voucherId,
        locationId,
        adjustmentType,
        notes || "",
        items
      );

      res.status(201).json(adjustment);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
