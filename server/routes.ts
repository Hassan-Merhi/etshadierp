import type { Express } from "express";
import { createServer, type Server } from "http";
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
} from "@shared/schema";

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

  const httpServer = createServer(app);

  return httpServer;
}
