import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import * as XLSX from "xlsx";
import crypto from "crypto-js";
import { storage } from "./storage";
import { db } from "./db";
import { requireAuth, requireRole, canDelete } from "./auth";
import {
  insertLocationSchema,
  insertLedgerAccountSchema,
  updateLedgerAccountSchema,
  insertEmployeeSchema,
  insertSupplierSchema,
  insertStockGroupSchema,
  insertStockItemSchema,
  insertBankAccountSchema,
  insertFixedAssetSchema,
  offloadRequestSchema,
  insertStockTransferVoucherSchema,
  insertStockAdjustmentVoucherSchema,
  insertUserSchema,
  insertUserCompanyRoleSchema,
  inventory,
  stockItems,
  vouchers,
  voucherEntries,
  locations,
} from "@shared/schema";
import { z } from "zod";
import { eq, and, inArray, sql } from "drizzle-orm";

const upload = multer({ storage: multer.memoryStorage() });

// Helper function to hash passwords
function hashPassword(password: string): string {
  return crypto.SHA256(password).toString();
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Authentication routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const hashedPassword = hashPassword(password);
      if (user.password !== hashedPassword) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      if (!user.active) {
        return res.status(403).json({ message: "Account is inactive" });
      }

      req.session.userId = user.id;
      
      // Auto-select first company
      const userCompanies = await storage.getUserCompaniesWithRoles(user.id);
      if (userCompanies.length > 0) {
        const firstCompany = userCompanies[0];
        req.session.currentCompanyId = firstCompany.companyId;
        req.session.currentRole = firstCompany.role;
        req.session.currentLocationId = firstCompany.assignedLocationId;
        req.session.currentPOSStation = firstCompany.posStation;
        req.session.cashAccountId = firstCompany.cashAccountId;
      }
      
      // Return user without password
      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const { password: _, ...userWithoutPassword } = req.user;
    res.json(userWithoutPassword);
  });

  // User management routes (Admin only)
  app.get("/api/users", requireAuth, requireRole("Admin"), async (_req, res) => {
    try {
      const users = await storage.getAllUsers();
      // Remove passwords from response
      const usersWithoutPasswords = users.map(({ password, ...user }) => user);
      res.json(usersWithoutPasswords);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/users", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const parsed = insertUserSchema.parse(req.body);
      
      // Check for duplicate username
      const existing = await storage.getUserByUsername(parsed.username);
      if (existing) {
        return res.status(400).json({ message: "Username already exists" });
      }

      // Hash the password
      const hashedPassword = hashPassword(parsed.password);
      const user = await storage.createUser({ ...parsed, password: hashedPassword });
      
      const { password: _, ...userWithoutPassword } = user;
      res.status(201).json(userWithoutPassword);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/users/:id", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      // If password is being updated, hash it
      if (updates.password) {
        updates.password = hashPassword(updates.password);
      }

      const user = await storage.updateUser(id, updates);
      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // User-Company-Role management routes
  app.get("/api/users/:userId/company-roles", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const { userId } = req.params;
      const roles = await storage.getUserCompaniesWithRoles(userId);
      res.json(roles);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/user-company-roles", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const parsed = insertUserCompanyRoleSchema.parse(req.body);
      
      // Validate POS roles have required fields
      if (parsed.role.startsWith("POS") && !parsed.assignedLocationId) {
        return res.status(400).json({ message: "POS roles require an assigned location" });
      }
      
      const role = await storage.createUserCompanyRole(parsed);
      res.status(201).json(role);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/user-company-roles/:id", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const { id } = req.params;
      const parsed = insertUserCompanyRoleSchema.partial().parse(req.body);
      
      // Validate POS roles have required fields if role is being updated
      if (parsed.role?.startsWith("POS") && !parsed.assignedLocationId) {
        return res.status(400).json({ message: "POS roles require an assigned location" });
      }
      
      const role = await storage.updateUserCompanyRole(parseInt(id), parsed);
      res.json(role);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/user-company-roles/:id", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteUserCompanyRole(parseInt(id));
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Company management routes
  app.get("/api/companies", requireAuth, async (req, res) => {
    try {
      const companies = await storage.getAllCompanies();
      res.json(companies);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/user/companies", requireAuth, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const userCompanies = await storage.getUserCompaniesWithRoles(req.user.id);
      // Join with companies to include company details
      const companiesWithRoles = await Promise.all(
        userCompanies.map(async (uc) => {
          const company = await storage.getCompanyById(uc.companyId);
          return {
            ...uc,
            companyCode: company?.code,
            companyName: company?.name,
            companyActive: company?.active,
          };
        })
      );
      res.json(companiesWithRoles);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/companies", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const company = await storage.createCompany(req.body);
      res.status(201).json(company);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Set current company in session
  app.post("/api/auth/set-company", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) {
        return res.status(400).json({ message: "Company ID is required" });
      }
      
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Verify user has access to this company
      const userRole = await storage.getUserCompanyRole(req.user.id, companyId);
      if (!userRole) {
        return res.status(403).json({ message: "You don't have access to this company" });
      }
      
      req.session.currentCompanyId = companyId;
      req.session.currentRole = userRole.role;
      req.session.currentLocationId = userRole.assignedLocationId;
      req.session.currentPOSStation = userRole.posStation;
      req.session.cashAccountId = userRole.cashAccountId;
      
      res.json({ message: "Company set successfully", companyId });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Locations
  app.get("/api/locations", requireAuth, async (req, res) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : req.session.currentCompanyId;
      
      if (!companyId) {
        return res.status(400).json({ message: "No company selected or specified" });
      }
      
      const locations = await storage.getAllLocations(companyId);
      res.json(locations);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/locations", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const parsed = insertLocationSchema.parse({
        ...req.body,
        companyId: req.session.currentCompanyId,
      });
      
      // Check for duplicate code within the current company
      const existing = await storage.getLocationByCode(parsed.code, req.session.currentCompanyId);
      if (existing) {
        return res.status(400).json({ message: "Location code already exists" });
      }

      const location = await storage.createLocation(parsed);
      res.status(201).json(location);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Get single location by ID
  app.get("/api/locations/:locationId", requireAuth, async (req, res) => {
    try {
      const locationId = parseInt(req.params.locationId);
      if (isNaN(locationId)) {
        return res.status(400).json({ message: "Invalid location ID" });
      }

      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }

      // Verify location belongs to current company
      if (location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied: Location belongs to a different company" });
      }

      res.json(location);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Location Inventory - Get inventory for a specific location
  app.get("/api/locations/:locationId/inventory", requireAuth, async (req, res) => {
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

      // Verify location belongs to current company
      if (location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied: Location belongs to a different company" });
      }

      const inventory = await storage.getLocationInventory(locationId);
      res.json(inventory);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Ledger Accounts
  app.get("/api/ledger-accounts", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const accounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);
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

  app.put("/api/ledger-accounts/:id", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const accountId = parseInt(req.params.id);
      if (isNaN(accountId)) {
        return res.status(400).json({ message: "Invalid account ID" });
      }

      // Verify account exists and belongs to current company
      const existingAccount = await storage.getLedgerAccountById(accountId);
      if (!existingAccount) {
        return res.status(404).json({ message: "Account not found" });
      }
      if (existingAccount.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied: Account belongs to a different company" });
      }

      const parsed = updateLedgerAccountSchema.parse({ ...req.body, id: accountId });

      // Check for duplicate code if code is being changed
      if (parsed.code && parsed.code !== existingAccount.code) {
        const duplicate = await storage.getLedgerAccountByCode(parsed.code);
        if (duplicate) {
          return res.status(400).json({ message: "Ledger account code already exists" });
        }
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

      // Validate subType based on accountType if accountType is being updated
      const accountType = parsed.accountType || existingAccount.accountType;
      const validSubTypes: Record<string, string[]> = {
        "Income": ["Direct Income", "Indirect Income"],
        "Expense": ["Direct Expense", "Indirect Expense"],
        "Liability": ["Current Liability", "Long-term Liability", "Loans Payable", "Output Tax", "Tax Payable"],
        "Asset": ["Current Asset", "Fixed Asset", "Input Tax", "Tax Receivable"],
      };

      if (parsed.subType && validSubTypes[accountType]) {
        if (!validSubTypes[accountType].includes(parsed.subType)) {
          return res.status(400).json({ 
            message: `Invalid subType "${parsed.subType}" for accountType "${accountType}". Valid options: ${validSubTypes[accountType].join(", ")}` 
          });
        }
      }

      const updatedAccount = await storage.updateLedgerAccount(parsed);
      res.json(updatedAccount);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Employees
  app.get("/api/employees", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const employees = await storage.getAllEmployees(req.session.currentCompanyId);
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
  app.get("/api/stock-groups", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const groups = await storage.getAllStockGroups(req.session.currentCompanyId);
      res.json(groups);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/stock-groups", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Inject companyId before schema validation
      const dataWithCompany = {
        ...req.body,
        companyId: req.session.currentCompanyId,
      };

      const parsed = insertStockGroupSchema.parse(dataWithCompany);
      
      // Check for duplicate code within the same company
      const existing = await storage.getStockGroupByCode(parsed.code, req.session.currentCompanyId);
      if (existing) {
        return res.status(400).json({ message: "Stock group code already exists in this company" });
      }

      const group = await storage.createStockGroup(parsed);
      res.status(201).json(group);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Stock Items
  app.get("/api/stock-items", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const items = await storage.getAllStockItems(req.session.currentCompanyId);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/stock-items", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Inject companyId before schema validation
      const dataWithCompany = {
        ...req.body,
        companyId: req.session.currentCompanyId,
      };

      const parsed = insertStockItemSchema.parse(dataWithCompany);
      
      // Check for duplicate code within the same company
      const existing = await storage.getStockItemByCode(parsed.code, req.session.currentCompanyId);
      if (existing) {
        return res.status(400).json({ message: "Stock item code already exists in this company" });
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
  app.get("/api/bank-accounts", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const accounts = await storage.getAllBankAccounts(req.session.currentCompanyId);
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
        const allLedgers = await storage.getAllLedgerAccounts(req.session.currentCompanyId!);
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
  app.get("/api/fixed-assets", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const assets = await storage.getAllFixedAssets(req.session.currentCompanyId);
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
  app.post("/api/po-import/parse", requireAuth, upload.single("file"), async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      
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
      const allStockItems = await storage.getAllStockItems(req.session.currentCompanyId!);

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
  app.post("/api/po-import/validate", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      
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
  app.post("/api/po-import/import", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      
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
      const freshStockItems = await storage.getAllStockItems(req.session.currentCompanyId!);

      // Get or create "Purchases" ledger account for double-entry bookkeeping
      let purchasesAccount = await storage.getLedgerAccountByCode("PURCHASES");
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

      // Create POs and line items
      for (const [poNumber, items] of Object.entries(poGroups)) {
        const poItems = items as any[];
        const poTotal = poItems.reduce((sum, item) => sum + item.lineTotal, 0);

        // Create voucher for this PO (Purchase voucher with double-entry)
        const voucher = await storage.createVoucher({
          companyId: req.session.currentCompanyId!,
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
          companyId: req.session.currentCompanyId!,
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
  app.get("/api/containers", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const containers = await storage.getAllContainers(req.session.currentCompanyId);
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

      const { 
        locationId, 
        duties, 
        dutiesAccountId,
        officeCharges, 
        transferCharges, 
        transportFees,
        transportAccountId,
        additionalCharges = []
      } = validation.data;

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
        dutiesAccountId,
        officeCharges,
        transferCharges,
        transportFees,
        transportAccountId,
        additionalCharges
      );

      res.json(offload);
    } catch (error: any) {
      console.error("Container offload error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Backfill voucher entries for existing POs
  app.post("/api/po-import/backfill", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      
      // Get all POs without voucher IDs
      const allPOs = await storage.getAllPurchaseOrders(req.session.currentCompanyId!);
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
          companyId: req.session.currentCompanyId!,
          code: "PURCHASES",
          name: "Purchases",
          accountType: "Expense",
          openingBalance: "0",
          openingBalanceSide: "Dr",
          active: true,
        });
      }

      // Get all containers to lookup import dates
      const allContainers = await storage.getAllContainers(req.session.currentCompanyId!);
      const containerMap = new Map(allContainers.map(c => [c.id, c]));

      let backfilledCount = 0;

      for (const po of posWithoutVouchers) {
        const container = containerMap.get(po.containerId);
        if (!container) continue;

        // Create voucher for this PO with double-entry bookkeeping
        const voucher = await storage.createVoucher({
          companyId: req.session.currentCompanyId!,
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
  app.get("/api/accounts/all", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      
      const companyId = req.session.currentCompanyId;
      
      const ledgers = await storage.getAllLedgerAccounts(companyId);
      const banks = await storage.getAllBankAccounts(companyId);
      const assets = await storage.getAllFixedAssets(companyId);
      const suppliers = await storage.getAllSuppliers();

      // Get all voucher entries for this company's vouchers
      const companyVouchers = await db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(eq(vouchers.companyId, companyId))
        .execute();
      
      const companyVoucherIds = companyVouchers.map(v => v.id);

      // Get all voucher entries for this company
      const allEntries = companyVoucherIds.length > 0
        ? await db
            .select()
            .from(voucherEntries)
            .where(inArray(voucherEntries.voucherId, companyVoucherIds))
            .execute()
        : [];

      // Group entries by account type and calculate balances
      const ledgerBalances = new Map<number, { debits: number; credits: number }>();
      const bankBalances = new Map<number, { debits: number; credits: number }>();
      const assetBalances = new Map<number, { debits: number; credits: number }>();
      const supplierBalances = new Map<number, { debits: number; credits: number }>();

      for (const entry of allEntries) {
        const debit = parseFloat(entry.debitAmount || "0");
        const credit = parseFloat(entry.creditAmount || "0");

        if (entry.ledgerAccountId) {
          const existing = ledgerBalances.get(entry.ledgerAccountId) || { debits: 0, credits: 0 };
          ledgerBalances.set(entry.ledgerAccountId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

        if (entry.bankAccountId) {
          const existing = bankBalances.get(entry.bankAccountId) || { debits: 0, credits: 0 };
          bankBalances.set(entry.bankAccountId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

        if (entry.fixedAssetId) {
          const existing = assetBalances.get(entry.fixedAssetId) || { debits: 0, credits: 0 };
          assetBalances.set(entry.fixedAssetId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

        if (entry.supplierId) {
          const existing = supplierBalances.get(entry.supplierId) || { debits: 0, credits: 0 };
          supplierBalances.set(entry.supplierId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }
      }

      // Helper function to calculate actual balance
      const calculateBalance = (
        openingBalance: string,
        openingBalanceSide: string | null,
        debits: number,
        credits: number
      ) => {
        let balance = parseFloat(openingBalance || "0");
        
        // If opening balance has a side, convert to signed number
        if (openingBalanceSide === "Cr") {
          balance = -balance;
        }
        
        // Add net change (debits increase, credits decrease)
        balance += (debits - credits);
        
        // Determine side based on final balance
        const balanceSide = balance >= 0 ? "Dr" : "Cr";
        const absoluteBalance = Math.abs(balance);
        
        return { balance: absoluteBalance, balanceSide };
      };

      const accounts = [
        ...ledgers.map((account) => {
          const movements = ledgerBalances.get(account.id) || { debits: 0, credits: 0 };
          const { balance, balanceSide } = calculateBalance(
            account.openingBalance || "0",
            account.openingBalanceSide,
            movements.debits,
            movements.credits
          );
          
          return {
            id: `ledger-${account.id}`,
            accountId: account.id,
            type: "Ledger",
            code: account.code,
            name: account.name,
            accountType: account.accountType,
            subType: account.subType,
            balance,
            balanceSide,
            active: account.active,
          };
        }),
        ...banks.map((account) => {
          const movements = bankBalances.get(account.id) || { debits: 0, credits: 0 };
          const { balance, balanceSide } = calculateBalance(
            account.openingBalance || "0",
            account.openingBalanceSide,
            movements.debits,
            movements.credits
          );
          
          return {
            id: `bank-${account.id}`,
            accountId: account.id,
            type: "Bank",
            code: account.code,
            name: `${account.name} (${account.bankName})`,
            balance,
            balanceSide,
            active: account.active,
          };
        }),
        ...assets.map((asset) => {
          const movements = assetBalances.get(asset.id) || { debits: 0, credits: 0 };
          const { balance, balanceSide } = calculateBalance(
            asset.openingBalance || "0",
            "Dr", // Fixed assets are always debit balance
            movements.debits,
            movements.credits
          );
          
          return {
            id: `asset-${asset.id}`,
            accountId: asset.id,
            type: "Fixed Asset",
            code: asset.code,
            name: asset.name,
            balance,
            balanceSide,
            active: asset.active,
          };
        }),
        ...suppliers.map((supplier) => {
          const movements = supplierBalances.get(supplier.id) || { debits: 0, credits: 0 };
          // Suppliers don't have opening balance, and are typically credit balance (payables)
          const { balance, balanceSide } = calculateBalance(
            "0",
            "Cr",
            movements.debits,
            movements.credits
          );
          
          return {
            id: `supplier-${supplier.id}`,
            accountId: supplier.id,
            type: "Supplier",
            code: supplier.code,
            name: supplier.legalName,
            balance,
            balanceSide,
            active: supplier.active,
          };
        }),
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
  app.get("/api/accounts/supplier/:id/transactions", requireAuth, async (req, res) => {
    try {
      const supplierId = parseInt(req.params.id);
      
      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }

      const { startDate, endDate, companyId } = req.query;
      
      // Use query param companyId or session companyId, or undefined for all companies
      const filterCompanyId = companyId ? parseInt(companyId as string) : req.session.currentCompanyId;

      const transactions = await storage.getVoucherEntriesBySupplier(
        supplierId,
        filterCompanyId,
        startDate as string | undefined,
        endDate as string | undefined
      );

      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get all vouchers with date filtering
  app.get("/api/vouchers", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const { startDate, endDate } = req.query;

      let vouchers;
      if (startDate && endDate) {
        vouchers = await storage.getVouchersByDateRange(
          startDate as string,
          endDate as string
        );
      } else {
        vouchers = await storage.getAllVouchers(req.session.currentCompanyId);
      }

      res.json(vouchers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get all suppliers with balances and container counts (filtered by company if provided)
  app.get("/api/suppliers/with-stats", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.query;
      const filterCompanyId = companyId ? parseInt(companyId as string) : req.session.currentCompanyId;
      
      if (!filterCompanyId) {
        return res.status(400).json({ message: "No company selected or specified" });
      }
      
      const suppliers = await storage.getAllSuppliers();
      
      const suppliersWithStats = await Promise.all(
        suppliers.map(async (supplier) => {
          // Filter container count and balance by company
          const containerCount = await storage.getContainerCountBySupplier(supplier.id, filterCompanyId);
          
          // Calculate balance from voucher entries filtered by company
          // For suppliers: Credit = increase in payable (we owe them), Debit = decrease (we paid)
          // Balance = Credits - Debits (positive means we owe them)
          const entries = await storage.getVoucherEntriesBySupplier(supplier.id, filterCompanyId);
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

      // Filter to only show suppliers that have activity in this company (containers or balance)
      const activeSuppliersInCompany = suppliersWithStats.filter(
        s => s.containerCount > 0 || s.balance !== 0
      );

      res.json(activeSuppliersInCompany);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get purchase orders for a specific supplier filtered by company
  app.get("/api/suppliers/:supplierId/purchase-orders", requireAuth, async (req, res) => {
    try {
      const supplierId = parseInt(req.params.supplierId);
      
      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }

      const { companyId } = req.query;
      const filterCompanyId = companyId ? parseInt(companyId as string) : req.session.currentCompanyId;
      
      if (!filterCompanyId) {
        return res.status(400).json({ message: "No company selected or specified" });
      }

      const purchaseOrders = await storage.getPurchaseOrdersBySupplier(supplierId, filterCompanyId);
      res.json(purchaseOrders);
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

  // Update a voucher (Admin, Owner, or Manager for today's vouchers)
  app.patch("/api/vouchers/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      // Get the existing voucher to check company and permissions
      const existingVoucher = await storage.getVoucherById(id);
      if (!existingVoucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Verify voucher belongs to current company
      if (existingVoucher.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied: Voucher belongs to a different company" });
      }

      // Check edit permissions based on role
      const userRole = req.session.currentRole;
      if (!userRole) {
        return res.status(403).json({ message: "User role not found" });
      }

      // Admin and Owner can edit all vouchers
      if (userRole !== "Admin" && userRole !== "Owner") {
        // Manager can only edit today's vouchers
        if (userRole === "Manager") {
          const voucherDate = new Date(existingVoucher.voucherDate);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          voucherDate.setHours(0, 0, 0, 0);
          
          if (voucherDate.getTime() !== today.getTime()) {
            return res.status(403).json({ message: "Managers can only edit today's vouchers" });
          }
        } else {
          // Other roles cannot edit
          return res.status(403).json({ message: "Insufficient permissions to edit vouchers" });
        }
      }

      // Only allow updating certain fields (not amount or company)
      const allowedUpdates: Partial<any> = {};
      if (req.body.voucherDate !== undefined) allowedUpdates.voucherDate = req.body.voucherDate;
      if (req.body.voucherType !== undefined) allowedUpdates.voucherType = req.body.voucherType;
      if (req.body.description !== undefined) allowedUpdates.description = req.body.description;

      const updated = await storage.updateVoucher(id, allowedUpdates);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get voucher entries for a specific voucher
  app.get("/api/vouchers/:id/entries", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      const entries = await storage.getVoucherEntriesByVoucher(id);
      res.json(entries);
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

  // Delete a voucher (Admin only)
  app.delete("/api/vouchers/:id", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      await storage.deleteVoucher(id);
      res.json({ message: "Voucher deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get POS sales grouped by location with optional date filtering
  app.get("/api/financial/sales", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate } = req.query;

      // Build query conditions
      const conditions = [
        eq(vouchers.companyId, req.session.currentCompanyId),
        eq(vouchers.voucherType, "Sales"),
      ];

      if (startDate) {
        conditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
      }

      if (endDate) {
        conditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
      }

      // Get all sales vouchers with location info
      const salesVouchers = await db
        .select({
          voucherId: vouchers.id,
          locationId: vouchers.locationId,
          locationName: locations.name,
          locationCode: locations.code,
          voucherDate: vouchers.voucherDate,
          totalAmount: vouchers.totalAmount,
        })
        .from(vouchers)
        .leftJoin(locations, eq(vouchers.locationId, locations.id))
        .where(and(...conditions));

      // Group by location
      const salesByLocation = new Map<number, {
        locationId: number;
        locationName: string;
        locationCode: string;
        totalSales: number;
        totalTransactions: number;
      }>();

      for (const sale of salesVouchers) {
        if (!sale.locationId) continue;

        const existing = salesByLocation.get(sale.locationId);
        const amount = parseFloat(sale.totalAmount || "0");

        if (existing) {
          existing.totalSales += amount;
          existing.totalTransactions += 1;
        } else {
          salesByLocation.set(sale.locationId, {
            locationId: sale.locationId,
            locationName: sale.locationName || "Unknown",
            locationCode: sale.locationCode || "",
            totalSales: amount,
            totalTransactions: 1,
          });
        }
      }

      res.json(Array.from(salesByLocation.values()));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get detailed sales info for a specific location
  app.get("/api/financial/sales/:locationId/details", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const locationId = parseInt(req.params.locationId);
      if (isNaN(locationId)) {
        return res.status(400).json({ message: "Invalid location ID" });
      }

      const { startDate, endDate } = req.query;

      // Build query conditions
      const conditions = [
        eq(vouchers.companyId, req.session.currentCompanyId),
        eq(vouchers.voucherType, "Sales"),
        eq(vouchers.locationId, locationId),
      ];

      if (startDate) {
        conditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
      }

      if (endDate) {
        conditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
      }

      // Get all sales vouchers for this location
      const salesVouchers = await db
        .select()
        .from(vouchers)
        .where(and(...conditions));

      // Get all voucher entries and inventory changes
      // We need to sum up quantities sold across all sales
      let totalQuantity = 0;
      let totalAmount = 0;

      for (const voucher of salesVouchers) {
        totalAmount += parseFloat(voucher.totalAmount || "0");
        
        // Get inventory items sold in this voucher
        // This requires getting stock items from inventory updates
        // For now, we'll just count transactions as the quantity metric
        totalQuantity += 1; // Each voucher is one transaction
      }

      res.json({
        locationId,
        totalQuantity,
        totalAmount,
        totalTransactions: salesVouchers.length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POS Sales
  app.post("/api/pos/sales", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      
      const { locationId, cashAccountId, items, notes } = req.body;

      // Validate required fields
      if (!locationId) {
        return res.status(400).json({ message: "Location is required" });
      }
      if (!cashAccountId) {
        return res.status(400).json({ message: "Cash account is required" });
      }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      // Validate and calculate total
      let grandTotal = 0;
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
        grandTotal += parseFloat(item.quantity) * parseFloat(item.rate);
      }

      // Get or create SALES revenue account (outside transaction for simplicity)
      const allAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId!);
      let salesAccount = allAccounts.find((a: any) => a.code === "SALES");
      
      if (!salesAccount) {
        salesAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId!,
          code: "SALES",
          name: "Sales Revenue",
          accountType: "Income",
          openingBalance: "0",
          active: true,
        });
      }

      // Get location details
      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }

      // STEP 1: Execute ALL operations in a transaction with row-level locking
      const voucherNumber = `SALES-${Date.now()}`;
      const voucherDate = new Date().toISOString().split('T')[0];

      const result = await db.transaction(async (tx) => {
        // STEP 1a: Validate and lock inventory rows (SELECT ... FOR UPDATE)
        const inventoryValidation: Array<{
          item: any;
          inventoryRecord: any;
          currentQty: number;
          saleQty: number;
          newQty: number;
          currentRate: number;
        }> = [];

        for (const item of items) {
          // Lock the inventory row to prevent concurrent modifications
          const [inventoryRecord] = await tx
            .select()
            .from(inventory)
            .where(and(
              eq(inventory.locationId, locationId),
              eq(inventory.stockItemId, item.stockItemId)
            ))
            .for('update');

          if (!inventoryRecord) {
            throw new Error(`Inventory not found for item ${item.stockItemId} at location ${locationId}`);
          }

          const currentQty = parseFloat(inventoryRecord.quantity);
          const saleQty = parseFloat(item.quantity);

          if (currentQty < saleQty) {
            throw new Error(`Insufficient stock for item ${item.stockItemId}. Available: ${currentQty}, Requested: ${saleQty}`);
          }

          inventoryValidation.push({
            item,
            inventoryRecord,
            currentQty,
            saleQty,
            newQty: currentQty - saleQty,
            currentRate: parseFloat(inventoryRecord.averageRate),
          });
        }

        // STEP 1b: Create accounting records (voucher and entries)
        // Create Sales voucher
        const [voucher] = await tx.insert(vouchers).values({
          companyId: req.session.currentCompanyId!,
          locationId,
          voucherNumber,
          voucherType: "Sales",
          voucherDate,
          description: notes || `POS Sale at ${location.name}`,
          totalAmount: grandTotal.toFixed(2),
        }).returning();

        // Create voucher entries (double-entry bookkeeping)
        // Debit: Cash/Bank Account (Asset increases)
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          bankAccountId: cashAccountId,
          debitAmount: grandTotal.toFixed(2),
          creditAmount: "0",
          narration: `POS Sale - ${voucherNumber}`,
        });

        // Credit: Sales Account (Revenue increases)
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: salesAccount.id,
          debitAmount: "0",
          creditAmount: grandTotal.toFixed(2),
          narration: `POS Sale - ${voucherNumber}`,
        });

        // Update inventory for each item
        const saleItems = [];
        for (const validatedItem of inventoryValidation) {
          const { item, newQty, currentRate, inventoryRecord } = validatedItem;

          // Calculate new total value
          const newTotalValue = (newQty * currentRate).toFixed(2);

          // Update inventory using transaction
          await tx
            .update(inventory)
            .set({
              quantity: newQty.toString(),
              averageRate: currentRate.toFixed(2),
              totalValue: newTotalValue,
              lastUpdated: new Date(),
            })
            .where(eq(inventory.id, inventoryRecord.id));

          // Get stock item details for response
          const [stockItem] = await tx
            .select()
            .from(stockItems)
            .where(eq(stockItems.id, item.stockItemId));

          saleItems.push({
            ...item,
            stockItemName: stockItem?.name || "",
            stockItemCode: stockItem?.code || "",
            amount: (parseFloat(item.quantity) * parseFloat(item.rate)).toFixed(2),
          });
        }

        return { voucher, saleItems };
      });

      // Return complete sale details
      res.json({
        voucher: result.voucher,
        location,
        items: result.saleItems,
        grandTotal: grandTotal.toFixed(2),
        voucherNumber,
        saleDate: voucherDate,
      });
    } catch (error: any) {
      // Return appropriate status codes for different error types
      if (error.message.includes("Inventory not found")) {
        return res.status(404).json({ message: error.message });
      }
      if (error.message.includes("Insufficient stock")) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Transfers
  app.post("/api/stock-transfers", async (req, res) => {
    try {
      const { voucherId, destinationLocationId, notes, items } = req.body;

      // Validate required fields
      if (!voucherId) {
        return res.status(400).json({ message: "Voucher ID is required" });
      }
      if (!destinationLocationId) {
        return res.status(400).json({ message: "Destination location is required" });
      }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Items are required" });
      }

      // Validate that destination location exists
      const destLocation = await storage.getLocationById(destinationLocationId);
      if (!destLocation) {
        return res.status(404).json({ message: "Destination location not found" });
      }

      // Validate that voucher exists
      const voucher = await storage.getVoucherById(voucherId);
      if (!voucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Validate items and their source locations
      for (const item of items) {
        if (!item.sourceLocationId) {
          return res.status(400).json({ message: "Source location is required for all items" });
        }
        if (!item.stockItemId) {
          return res.status(400).json({ message: "Stock item ID is required for all items" });
        }
        if (!item.quantity || parseFloat(item.quantity) <= 0) {
          return res.status(400).json({ message: "Quantity must be positive for all items" });
        }
        if (!item.rate || parseFloat(item.rate) < 0) {
          return res.status(400).json({ message: "Rate must be non-negative for all items" });
        }

        // Validate that source and destination are different for each item
        if (item.sourceLocationId === destinationLocationId) {
          return res.status(400).json({ message: "Source and destination locations must be different for each item" });
        }

        // Validate that source location exists
        const sourceLocation = await storage.getLocationById(item.sourceLocationId);
        if (!sourceLocation) {
          return res.status(404).json({ message: `Source location with ID ${item.sourceLocationId} not found` });
        }
      }

      const transfer = await storage.createStockTransfer(
        voucherId,
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

  // Financial Stats
  app.get("/api/stats/net-profit", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get all Income and Expense ledger accounts for this company
      const companyAccounts = await storage.getAllLedgerAccounts(companyId);
      
      const incomeAccountIds = companyAccounts
        .filter(acc => acc.accountType === "Income")
        .map(acc => acc.id);
      const expenseAccountIds = companyAccounts
        .filter(acc => acc.accountType === "Expense")
        .map(acc => acc.id);

      // Get voucher IDs for this company
      const companyVouchers = await db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(eq(vouchers.companyId, companyId))
        .execute();
      
      const companyVoucherIds = companyVouchers.map(v => v.id);

      // Get voucher entries only for this company's vouchers
      const companyEntries = companyVoucherIds.length > 0
        ? await db
            .select()
            .from(voucherEntries)
            .where(inArray(voucherEntries.voucherId, companyVoucherIds))
            .execute()
        : [];

      // Calculate total income (credits - debits for income accounts)
      let totalIncome = 0;
      for (const entry of companyEntries) {
        if (entry.ledgerAccountId && incomeAccountIds.includes(entry.ledgerAccountId)) {
          totalIncome += parseFloat(entry.creditAmount || "0") - parseFloat(entry.debitAmount || "0");
        }
      }

      // Calculate total expenses (debits - credits for expense accounts)
      let totalExpenses = 0;
      for (const entry of companyEntries) {
        if (entry.ledgerAccountId && expenseAccountIds.includes(entry.ledgerAccountId)) {
          totalExpenses += parseFloat(entry.debitAmount || "0") - parseFloat(entry.creditAmount || "0");
        }
      }

      // Calculate net profit
      const netProfit = totalIncome - totalExpenses;

      res.json({
        totalIncome,
        totalExpenses,
        netProfit,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get monthly sales and profit data for Dashboard charts
  app.get("/api/stats/monthly-data", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get all Sales vouchers for this company
      const salesVouchers = await db
        .select()
        .from(vouchers)
        .where(and(
          eq(vouchers.companyId, companyId),
          eq(vouchers.voucherType, "Sales")
        ))
        .execute();

      // Get all Income and Expense ledger accounts
      const companyAccounts = await storage.getAllLedgerAccounts(companyId);
      const incomeAccountIds = companyAccounts
        .filter(acc => acc.accountType === "Income")
        .map(acc => acc.id);
      const expenseAccountIds = companyAccounts
        .filter(acc => acc.accountType === "Expense")
        .map(acc => acc.id);

      // Get all voucher entries for this company
      const companyVouchers = await db
        .select({ id: vouchers.id, voucherDate: vouchers.voucherDate })
        .from(vouchers)
        .where(eq(vouchers.companyId, companyId))
        .execute();
      
      const companyVoucherIds = companyVouchers.map(v => v.id);
      const voucherDateMap = new Map(companyVouchers.map(v => [v.id, v.voucherDate]));

      const companyEntries = companyVoucherIds.length > 0
        ? await db
            .select()
            .from(voucherEntries)
            .where(inArray(voucherEntries.voucherId, companyVoucherIds))
            .execute()
        : [];

      // Group data by month (last 6 months)
      const monthlyData = new Map<string, { sales: number; profit: number }>();
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      
      // Initialize last 6 months
      const currentDate = new Date();
      for (let i = 5; i >= 0; i--) {
        const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
        const monthKey = monthNames[date.getMonth()];
        monthlyData.set(monthKey, { sales: 0, profit: 0 });
      }

      // Calculate sales by month
      for (const voucher of salesVouchers) {
        const voucherDate = new Date(voucher.voucherDate);
        const monthKey = monthNames[voucherDate.getMonth()];
        const amount = parseFloat(voucher.totalAmount || "0");
        
        if (monthlyData.has(monthKey)) {
          const data = monthlyData.get(monthKey)!;
          data.sales += amount;
        }
      }

      // Calculate profit by month (income - expenses)
      for (const entry of companyEntries) {
        const voucherDate = voucherDateMap.get(entry.voucherId);
        if (!voucherDate) continue;

        const date = new Date(voucherDate);
        const monthKey = monthNames[date.getMonth()];
        
        if (!monthlyData.has(monthKey)) continue;

        const data = monthlyData.get(monthKey)!;
        
        // Income accounts: credits increase profit, debits decrease it
        if (entry.ledgerAccountId && incomeAccountIds.includes(entry.ledgerAccountId)) {
          data.profit += parseFloat(entry.creditAmount || "0") - parseFloat(entry.debitAmount || "0");
        }
        
        // Expense accounts: debits decrease profit, credits increase it
        if (entry.ledgerAccountId && expenseAccountIds.includes(entry.ledgerAccountId)) {
          data.profit -= parseFloat(entry.debitAmount || "0") - parseFloat(entry.creditAmount || "0");
        }
      }

      // Convert map to array
      const result = Array.from(monthlyData.entries()).map(([month, data]) => ({
        month,
        sales: data.sales,
        profit: data.profit,
      }));

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
