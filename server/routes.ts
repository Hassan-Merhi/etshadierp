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
  insertEmployeeGroupSchema,
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
  InsertPurchaseOrder,
  inventory,
  stockItems,
  stockGroups,
  vouchers,
  voucherEntries,
  locations,
  salesItems,
  employees,
  stockAdjustmentVouchers,
  stockAdjustmentItems,
  stockTransferVouchers,
  stockTransferItems,
  purchaseOrders,
  poLineItems,
} from "@shared/schema";
import { z } from "zod";
import { eq, and, inArray, sql } from "drizzle-orm";

const upload = multer({ storage: multer.memoryStorage() });

// Helper function to hash passwords
function hashPassword(password: string): string {
  return crypto.SHA256(password).toString();
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Database health check endpoint
  app.get("/api/health/db", async (_req, res) => {
    try {
      const result = await db.execute(sql`SELECT 1 as test`);
      res.json({ status: 'ok', message: 'Database connection successful' });
    } catch (error: any) {
      console.error('Database connection failed:', error);
      res.status(500).json({ status: 'error', message: error.message });
    }
  });

  // Authentication routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      console.log('Login attempt started for username:', req.body.username);
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      console.log('Fetching user from database...');
      const user = await Promise.race([
        storage.getUserByUsername(username),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Database query timeout')), 5000))
      ]) as any;
      console.log('User fetch complete:', user ? 'Found' : 'Not found');
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

  // Company Inventory - Get all inventory across all locations for current company
  app.get("/api/inventory", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const inventory = await storage.getCompanyInventory(req.session.currentCompanyId);
      res.json(inventory);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bulk import inventory for a location
  app.post("/api/locations/:locationId/import-inventory", requireAuth, async (req, res) => {
    try {
      const locationId = parseInt(req.params.locationId);
      if (isNaN(locationId)) {
        return res.status(400).json({ message: "Invalid location ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Validate location exists and belongs to current company
      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }

      if (location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied: Location belongs to a different company" });
      }

      const { items } = req.body;
      if (!Array.isArray(items)) {
        return res.status(400).json({ message: "Items must be an array" });
      }

      // Get all stock items and stock groups for code matching
      const allStockItems = await storage.getAllStockItems(req.session.currentCompanyId);
      const allStockGroups = await storage.getAllStockGroups(req.session.currentCompanyId);
      
      // Find or create "Uncategorized" stock group
      let uncategorizedGroup = await storage.getStockGroupByCode("UNCATEGORIZED", req.session.currentCompanyId);
      if (!uncategorizedGroup) {
        uncategorizedGroup = await storage.createStockGroup({
          companyId: req.session.currentCompanyId,
          code: "UNCATEGORIZED",
          name: "Uncategorized",
          active: true,
        });
      }
      
      const results = {
        created: [] as any[],
        updated: [] as any[],
        skipped: [] as any[],
        errors: [] as any[],
      };

      for (const item of items) {
        try {
          // Find stock item by Item_barcode (which maps to code field)
          let stockItem = allStockItems.find(si => 
            si.code.toLowerCase() === item.Item_barcode.toLowerCase()
          );

          // If stock item doesn't exist, create it
          if (!stockItem) {
            // Auto-detect stock group from item code prefix (first 2-3 uppercase letters)
            let stockGroupId = uncategorizedGroup.id;
            
            // Normalize and try to extract prefix from Item_barcode
            const normalizedCode = item.Item_barcode.trim().toUpperCase();
            
            // Try 3-letter prefix first, then 2-letter (e.g., "UN259" -> "UN", "GCC123" -> "GCC")
            const prefixes = [];
            if (normalizedCode.length >= 3) prefixes.push(normalizedCode.substring(0, 3));
            if (normalizedCode.length >= 2) prefixes.push(normalizedCode.substring(0, 2));
            
            for (const prefix of prefixes) {
              const stockGroup = allStockGroups.find(sg => 
                sg.code.toUpperCase() === prefix
              );
              if (stockGroup) {
                stockGroupId = stockGroup.id;
                break; // Found a match, stop searching
              }
            }
            
            // Fall back to stockGroupCode column if provided and prefix didn't match
            if (stockGroupId === uncategorizedGroup.id && item.stockGroupCode) {
              const stockGroup = allStockGroups.find(sg => 
                sg.code.toLowerCase() === item.stockGroupCode.toLowerCase()
              );
              if (stockGroup) {
                stockGroupId = stockGroup.id;
              }
            }

            // Create the stock item
            const newStockItem = await storage.createStockItem({
              companyId: req.session.currentCompanyId,
              code: item.Item_barcode,
              name: item.Item_barcode, // Use Item_barcode as name if not provided
              uom: "PCS", // Default unit
              stockGroupId: stockGroupId,
              active: true,
            });
            
            stockItem = newStockItem;
            allStockItems.push(newStockItem); // Add to cache for subsequent rows
          }

          const quantity = parseFloat(item.quantity || "0");
          const rate = parseFloat(item.rate || "0");
          const value = parseFloat(item.value || (quantity * rate).toString());

          // Check if inventory already exists for this item at this location
          const existingInventory = await storage.getLocationInventory(locationId);
          const existing = existingInventory.find(inv => inv.stockItemId === stockItem.id);

          if (existing) {
            // Update existing inventory - add to existing quantities
            const newQuantity = parseFloat(existing.quantity) + quantity;
            const newTotalValue = parseFloat(existing.totalValue) + value;
            const newAverageRate = newQuantity > 0 ? newTotalValue / newQuantity : 0;

            await storage.updateInventory(
              locationId,
              stockItem.id,
              newQuantity.toString(),
              newAverageRate.toString(),
              newTotalValue.toString()
            );

            results.updated.push({
              code: item.Item_barcode,
              itemName: stockItem.name,
              addedQuantity: quantity,
              newQuantity: newQuantity,
            });
          } else {
            // Create new inventory record
            await storage.updateInventory(
              locationId,
              stockItem.id,
              quantity.toString(),
              rate.toString(),
              value.toString()
            );

            results.created.push({
              code: item.Item_barcode,
              itemName: stockItem.name,
              quantity: quantity,
            });
          }
        } catch (error: any) {
          results.errors.push({
            code: item.code,
            error: error.message,
          });
        }
      }

      res.json({
        message: `Import completed: ${results.created.length} created, ${results.updated.length} updated, ${results.skipped.length} skipped, ${results.errors.length} errors`,
        results,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Ledger Accounts
  app.get("/api/ledger-accounts", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.query;
      const effectiveCompanyId = companyId ? parseInt(companyId as string) : req.session.currentCompanyId;
      
      if (!effectiveCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const accounts = await storage.getAllLedgerAccounts(effectiveCompanyId);
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/ledger-accounts", async (req, res) => {
    try {
      const parsed = insertLedgerAccountSchema.parse(req.body);
      
      // Auto-generate code from name if not provided
      if (!parsed.code) {
        // Generate code from name: take first 3 letters of each word, uppercase
        const words = parsed.name.trim().split(/\s+/).filter(w => w.length > 0);
        let baseCode = words.map(w => w.substring(0, 3)).join('').toUpperCase();
        
        // Fallback if baseCode is empty (shouldn't happen with validation, but be safe)
        if (!baseCode || baseCode.length === 0) {
          baseCode = "ACC";
        }
        
        // Ensure uniqueness by adding suffix if needed
        let code = baseCode;
        let suffix = 1;
        while (await storage.getLedgerAccountByCode(code)) {
          code = `${baseCode}${suffix}`;
          suffix++;
        }
        parsed.code = code;
      } else {
        // Check for duplicate code if manually provided
        const existing = await storage.getLedgerAccountByCode(parsed.code);
        if (existing) {
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
      
      // Auto-generate code from name if not provided
      if (!parsed.code) {
        // Generate code from name: first 3 letters of first name + first 3 letters of last name, uppercase
        const firstPart = parsed.firstName.trim().substring(0, 3).toUpperCase();
        const lastPart = parsed.lastName.trim().substring(0, 3).toUpperCase();
        let baseCode = firstPart + lastPart;
        
        // Fallback if baseCode is somehow empty (shouldn't happen with validation)
        if (!baseCode || baseCode.length === 0) {
          baseCode = "EMP";
        }
        
        // Ensure uniqueness by adding suffix if needed
        let code = baseCode;
        let suffix = 1;
        while (await storage.getEmployeeByCode(code)) {
          code = `${baseCode}${suffix}`;
          suffix++;
        }
        parsed.code = code;
      } else {
        // Check for duplicate code if manually provided
        const existing = await storage.getEmployeeByCode(parsed.code);
        if (existing) {
          return res.status(400).json({ message: "Employee code already exists" });
        }
      }

      const employee = await storage.createEmployee(parsed);
      res.status(201).json(employee);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Employee Groups
  app.get("/api/employee-groups", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const groups = await storage.getAllEmployeeGroups(req.session.currentCompanyId);
      res.json(groups);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/employee-groups/:id", requireAuth, async (req, res) => {
    try {
      const group = await storage.getEmployeeGroupById(parseInt(req.params.id));
      if (!group) {
        return res.status(404).json({ message: "Employee group not found" });
      }
      res.json(group);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/employee-groups", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const parsed = insertEmployeeGroupSchema.parse({
        ...req.body,
        companyId: req.session.currentCompanyId,
      });
      const group = await storage.createEmployeeGroup(parsed);
      res.status(201).json(group);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/employee-groups/:id", requireAuth, async (req, res) => {
    try {
      const group = await storage.updateEmployeeGroup(parseInt(req.params.id), req.body);
      res.json(group);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/employee-groups/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteEmployeeGroup(parseInt(req.params.id));
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/employee-groups/:id/members", requireAuth, async (req, res) => {
    try {
      const members = await storage.getEmployeeGroupMembers(parseInt(req.params.id));
      res.json(members);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/employee-groups/:groupId/members/:employeeId", requireAuth, async (req, res) => {
    try {
      await storage.addEmployeeToGroup(parseInt(req.params.groupId), parseInt(req.params.employeeId));
      res.status(201).send();
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/employee-groups/:groupId/members/:employeeId", requireAuth, async (req, res) => {
    try {
      await storage.removeEmployeeFromGroup(parseInt(req.params.groupId), parseInt(req.params.employeeId));
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Payroll - Employee Balance Deposit
  app.post("/api/payroll/deposit-employee", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { employeeId, amount, date, notes } = req.body;

      if (!employeeId || !amount || !date) {
        return res.status(400).json({ message: "Employee, amount, and date are required" });
      }

      const depositAmount = parseFloat(amount);
      if (isNaN(depositAmount) || depositAmount <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }

      // Get employee
      const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId));
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      // Get or create SALARY_EXPENSE ledger account
      const allAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);
      let salaryExpenseAccount = allAccounts.find((a: any) => a.code === "SALARY_EXPENSE");
      
      if (!salaryExpenseAccount) {
        salaryExpenseAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId,
          code: "SALARY_EXPENSE",
          name: "Salary Expense",
          accountType: "Expense",
          openingBalance: "0",
          active: true,
        });
      }

      // Get or create employee liability account
      const employeeAccountCode = `EMP-${employee.code}`;
      let employeeAccount = allAccounts.find((a: any) => a.code === employeeAccountCode);
      
      if (!employeeAccount) {
        employeeAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId,
          code: employeeAccountCode,
          name: `${employee.firstName} ${employee.lastName} - Salary Account`,
          accountType: "Liability",
          openingBalance: "0",
          active: true,
        });
      }

      // Create voucher
      const voucherNumber = `SAL-DEP-${Date.now()}`;
      const [voucher] = await db.insert(vouchers).values({
        companyId: req.session.currentCompanyId,
        voucherNumber,
        voucherType: "Journal",
        voucherDate: date,
        description: notes || `Salary deposit for ${employee.firstName} ${employee.lastName}`,
        totalAmount: depositAmount.toFixed(2),
        optional: false,
      }).returning();

      // Create voucher entries (double-entry)
      // Debit: Salary Expense
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: salaryExpenseAccount.id,
        debitAmount: depositAmount.toFixed(2),
        creditAmount: "0",
        narration: `Salary deposit - ${voucherNumber}`,
      });

      // Credit: Employee Liability Account
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: employeeAccount.id,
        debitAmount: "0",
        creditAmount: depositAmount.toFixed(2),
        narration: `Salary deposit - ${voucherNumber}`,
      });

      // Update employee balance
      const newBalance = parseFloat(employee.currentBalance) + depositAmount;
      const newTotalDeposits = parseFloat(employee.totalDeposits) + depositAmount;

      await db.update(employees)
        .set({
          currentBalance: newBalance.toFixed(2),
          totalDeposits: newTotalDeposits.toFixed(2),
        })
        .where(eq(employees.id, employeeId));

      res.json({
        voucher,
        employee: {
          ...employee,
          currentBalance: newBalance.toFixed(2),
          totalDeposits: newTotalDeposits.toFixed(2),
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Payroll - Employee Withdrawal
  app.post("/api/payroll/withdraw-employee", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { employeeId, amount, paymentAccountType, paymentAccountId, bankAccountId, date, notes } = req.body;

      // Support both old (bankAccountId) and new (paymentAccountType/paymentAccountId) parameters
      const accountType = paymentAccountType || "bank";
      const accountId = paymentAccountId || bankAccountId;

      if (!employeeId || !amount || !accountId || !date) {
        return res.status(400).json({ message: "Employee, amount, payment account, and date are required" });
      }

      const withdrawalAmount = parseFloat(amount);
      if (isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }

      // Get employee
      const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId));
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      const currentBalance = parseFloat(employee.currentBalance);
      if (withdrawalAmount > currentBalance) {
        return res.status(400).json({ message: `Insufficient balance. Current balance: ${currentBalance.toFixed(2)}` });
      }

      // Get employee liability account
      const employeeAccountCode = `EMP-${employee.code}`;
      const allAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);
      const employeeAccount = allAccounts.find((a: any) => a.code === employeeAccountCode);
      
      if (!employeeAccount) {
        return res.status(404).json({ message: "Employee account not found" });
      }

      // Create voucher
      const voucherNumber = `SAL-WD-${Date.now()}`;
      const [voucher] = await db.insert(vouchers).values({
        companyId: req.session.currentCompanyId,
        voucherNumber,
        voucherType: "Payment",
        voucherDate: date,
        description: notes || `Salary withdrawal for ${employee.firstName} ${employee.lastName}`,
        totalAmount: withdrawalAmount.toFixed(2),
        optional: false,
      }).returning();

      // Create voucher entries (double-entry)
      // Debit: Employee Liability Account
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: employeeAccount.id,
        debitAmount: withdrawalAmount.toFixed(2),
        creditAmount: "0",
        narration: `Salary withdrawal - ${voucherNumber}`,
      });

      // Credit: Bank/Cash Account
      const creditEntry: any = {
        voucherId: voucher.id,
        debitAmount: "0",
        creditAmount: withdrawalAmount.toFixed(2),
        narration: `Salary withdrawal - ${voucherNumber}`,
      };

      if (accountType === "cash") {
        creditEntry.ledgerAccountId = accountId;
      } else {
        creditEntry.bankAccountId = accountId;
      }

      await db.insert(voucherEntries).values(creditEntry);

      // Update employee balance
      const newBalance = currentBalance - withdrawalAmount;
      const newTotalWithdrawals = parseFloat(employee.totalWithdrawals) + withdrawalAmount;

      await db.update(employees)
        .set({
          currentBalance: newBalance.toFixed(2),
          totalWithdrawals: newTotalWithdrawals.toFixed(2),
        })
        .where(eq(employees.id, employeeId));

      res.json({
        voucher,
        employee: {
          ...employee,
          currentBalance: newBalance.toFixed(2),
          totalWithdrawals: newTotalWithdrawals.toFixed(2),
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Payroll - Worker Direct Payment
  app.post("/api/payroll/pay-worker", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { employeeId, amount, bankAccountId, date, notes } = req.body;

      if (!employeeId || !amount || !bankAccountId || !date) {
        return res.status(400).json({ message: "Employee, amount, bank account, and date are required" });
      }

      const paymentAmount = parseFloat(amount);
      if (isNaN(paymentAmount) || paymentAmount <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }

      // Get employee/worker
      const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId));
      if (!employee) {
        return res.status(404).json({ message: "Worker not found" });
      }

      // Get or create SALARY_EXPENSE ledger account
      const allAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);
      let salaryExpenseAccount = allAccounts.find((a: any) => a.code === "SALARY_EXPENSE");
      
      if (!salaryExpenseAccount) {
        salaryExpenseAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId,
          code: "SALARY_EXPENSE",
          name: "Salary Expense",
          accountType: "Expense",
          openingBalance: "0",
          active: true,
        });
      }

      // Create voucher
      const voucherNumber = `SAL-PAY-${Date.now()}`;
      const [voucher] = await db.insert(vouchers).values({
        companyId: req.session.currentCompanyId,
        voucherNumber,
        voucherType: "Payment",
        voucherDate: date,
        description: notes || `Salary payment for ${employee.firstName} ${employee.lastName}`,
        totalAmount: paymentAmount.toFixed(2),
        optional: false,
      }).returning();

      // Create voucher entries (double-entry)
      // Debit: Salary Expense
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: salaryExpenseAccount.id,
        debitAmount: paymentAmount.toFixed(2),
        creditAmount: "0",
        narration: `Salary payment - ${voucherNumber}`,
      });

      // Credit: Bank/Cash Account
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        bankAccountId,
        debitAmount: "0",
        creditAmount: paymentAmount.toFixed(2),
        narration: `Salary payment - ${voucherNumber}`,
      });

      res.json({
        voucher,
        employee,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Payroll - Bulk Worker Payment
  app.post("/api/payroll/bulk-pay-workers", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { payments, paymentAccountType, paymentAccountId, bankAccountId, date, notes } = req.body;

      // Support both old (bankAccountId) and new (paymentAccountType/paymentAccountId) parameters
      const accountType = paymentAccountType || "bank";
      const accountId = paymentAccountId || bankAccountId;

      if (!payments || !Array.isArray(payments) || payments.length === 0) {
        return res.status(400).json({ message: "No payments provided" });
      }

      if (!accountId || !date) {
        return res.status(400).json({ message: "Payment account and date are required" });
      }

      // Validate all payment amounts
      for (const payment of payments) {
        const amount = parseFloat(payment.amount);
        if (isNaN(amount) || amount <= 0) {
          return res.status(400).json({ message: "All payment amounts must be positive numbers" });
        }
      }

      // Get or create SALARY_EXPENSE ledger account
      const allAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);
      let salaryExpenseAccount = allAccounts.find((a: any) => a.code === "SALARY_EXPENSE");
      
      if (!salaryExpenseAccount) {
        salaryExpenseAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId,
          code: "SALARY_EXPENSE",
          name: "Salary Expense",
          accountType: "Expense",
          openingBalance: "0",
          active: true,
        });
      }

      // Calculate total amount
      const totalAmount = payments.reduce((sum: number, p: any) => sum + parseFloat(p.amount), 0);

      // Create single voucher for all payments
      const voucherNumber = `SAL-BULK-${Date.now()}`;
      const [voucher] = await db.insert(vouchers).values({
        companyId: req.session.currentCompanyId,
        voucherNumber,
        voucherType: "Payment",
        voucherDate: date,
        description: notes || `Bulk salary payment for ${payments.length} workers`,
        totalAmount: totalAmount.toFixed(2),
        optional: false,
      }).returning();

      // Create debit entry for total salary expense
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: salaryExpenseAccount.id,
        debitAmount: totalAmount.toFixed(2),
        creditAmount: "0",
        narration: `Bulk salary payment - ${payments.length} workers - ${voucherNumber}`,
      });

      // Create credit entry for bank/cash account
      const creditEntry: any = {
        voucherId: voucher.id,
        debitAmount: "0",
        creditAmount: totalAmount.toFixed(2),
        narration: `Bulk salary payment - ${payments.length} workers - ${voucherNumber}`,
      };

      if (accountType === "cash") {
        creditEntry.ledgerAccountId = parseInt(accountId);
      } else {
        creditEntry.bankAccountId = parseInt(accountId);
      }

      await db.insert(voucherEntries).values(creditEntry);

      res.json({
        voucher,
        paymentsProcessed: payments.length,
        totalAmount: totalAmount.toFixed(2),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get worker payment summary (total paid to each worker)
  app.get("/api/payroll/worker-payments-summary", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get all employees of type Worker for current company
      const allEmployees = await storage.getAllEmployees(req.session.currentCompanyId);
      const workers = allEmployees.filter((emp: any) => emp.employeeType === "Worker");

      // Get all ledger accounts for current company
      const allAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);

      // Calculate total paid per worker by checking their employee liability account
      const workerPayments = await Promise.all(workers.map(async (worker: any) => {
        // Find employee's liability account (code: EMP-{worker.code})
        const employeeAccountCode = `EMP-${worker.code}`;
        const employeeAccount = allAccounts.find((a: any) => a.code === employeeAccountCode);

        let totalPaid = 0;
        
        if (employeeAccount) {
          // Get all voucher entries that credit this employee account (withdrawals/payments)
          const entries = await db
            .select({
              creditAmount: voucherEntries.creditAmount,
            })
            .from(voucherEntries)
            .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
            .where(and(
              eq(vouchers.companyId, req.session.currentCompanyId!),
              eq(voucherEntries.ledgerAccountId, employeeAccount.id)
            ));

          // Sum all credits (payments to worker)
          totalPaid = entries.reduce((sum: number, entry: any) => 
            sum + parseFloat(entry.creditAmount || "0"), 0);
        }

        return {
          workerId: worker.id,
          workerCode: worker.code,
          workerName: `${worker.firstName} ${worker.lastName}`,
          totalPaid: totalPaid.toFixed(2),
        };
      }));

      // Calculate grand total
      const grandTotal = workerPayments.reduce((sum: number, wp: any) => 
        sum + parseFloat(wp.totalPaid), 0);

      res.json({
        workerPayments,
        grandTotal: grandTotal.toFixed(2),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
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

  // Get single stock item by ID
  app.get("/api/stock-items/:id", requireAuth, async (req, res) => {
    try {
      const stockItemId = parseInt(req.params.id);
      if (isNaN(stockItemId)) {
        return res.status(400).json({ message: "Invalid stock item ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const stockItem = await storage.getStockItemById(stockItemId);
      if (!stockItem) {
        return res.status(404).json({ message: "Stock item not found" });
      }

      if (stockItem.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied: Stock item belongs to a different company" });
      }

      res.json(stockItem);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bulk import stock items
  app.post("/api/stock-items/import", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { items } = req.body;
      if (!Array.isArray(items)) {
        return res.status(400).json({ message: "Items must be an array" });
      }

      // Find or create "Uncategorized" stock group for this company
      let uncategorizedGroup = await storage.getStockGroupByCode("UNCATEGORIZED", req.session.currentCompanyId);
      if (!uncategorizedGroup) {
        uncategorizedGroup = await storage.createStockGroup({
          companyId: req.session.currentCompanyId,
          code: "UNCATEGORIZED",
          name: "Uncategorized",
          active: true,
        });
      }

      // Fetch all valid stock groups for this company for validation
      const validStockGroups = await storage.getAllStockGroups(req.session.currentCompanyId);
      const validStockGroupIds = new Set(validStockGroups.map(sg => sg.id));

      const results = {
        created: [] as any[],
        skipped: [] as any[],
        errors: [] as any[],
      };

      for (const item of items) {
        try {
          // Ensure companyId matches session
          const itemWithCompany = {
            ...item,
            companyId: req.session.currentCompanyId,
          };

          // Validate and assign stock group:
          // - If no stockGroupId provided, assign to Uncategorized
          // - If stockGroupId is provided but invalid (doesn't exist), assign to Uncategorized
          if (!itemWithCompany.stockGroupId || !validStockGroupIds.has(itemWithCompany.stockGroupId)) {
            itemWithCompany.stockGroupId = uncategorizedGroup.id;
          }

          const parsed = insertStockItemSchema.parse(itemWithCompany);
          
          // Check for duplicate code
          const existing = await storage.getStockItemByCode(parsed.code, req.session.currentCompanyId);
          if (existing) {
            results.skipped.push({
              code: parsed.code,
              name: parsed.name,
              reason: "Code already exists",
            });
            continue;
          }

          const created = await storage.createStockItem(parsed);
          results.created.push(created);
        } catch (error: any) {
          results.errors.push({
            code: item.code,
            name: item.name,
            error: error.message,
          });
        }
      }

      res.json({
        message: `Import completed: ${results.created.length} created, ${results.skipped.length} skipped, ${results.errors.length} errors`,
        results,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update stock item
  app.patch("/api/stock-items/:id", requireAuth, async (req, res) => {
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
        return res.status(403).json({ message: "Access denied: Stock item belongs to a different company" });
      }

      // Trim and validate required fields
      const updates: any = {};
      
      if (req.body.code !== undefined) {
        const trimmedCode = String(req.body.code).trim();
        if (trimmedCode === "") {
          return res.status(400).json({ message: "Code is required" });
        }
        updates.code = trimmedCode;
      }
      
      if (req.body.name !== undefined) {
        const trimmedName = String(req.body.name).trim();
        if (trimmedName === "") {
          return res.status(400).json({ message: "Name is required" });
        }
        updates.name = trimmedName;
      }
      
      if (req.body.uom !== undefined) {
        const trimmedUom = String(req.body.uom).trim();
        if (trimmedUom === "") {
          return res.status(400).json({ message: "Unit of measure is required" });
        }
        updates.uom = trimmedUom;
      }
      
      if (req.body.barcode !== undefined) {
        updates.barcode = req.body.barcode ? String(req.body.barcode).trim() : null;
      }
      
      if (req.body.stockGroupId !== undefined) {
        updates.stockGroupId = req.body.stockGroupId;
      }
      
      if (req.body.active !== undefined) {
        updates.active = req.body.active;
      }

      // If updating code, check for duplicates
      if (updates.code && updates.code !== existingItem.code) {
        const duplicate = await storage.getStockItemByCode(updates.code, req.session.currentCompanyId);
        if (duplicate) {
          return res.status(400).json({ message: "Stock item code already exists" });
        }
      }

      const updated = await storage.updateStockItem(stockItemId, updates);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

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
        return res.status(403).json({ message: "Access denied: Stock item belongs to a different company" });
      }

      const { startDate, endDate } = req.query;
      const transactions = await storage.getStockItemTransactions(
        stockItemId,
        req.session.currentCompanyId,
        startDate as string | undefined,
        endDate as string | undefined
      );
      
      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
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
        return res.status(403).json({ message: "Access denied: Stock item belongs to a different company" });
      }

      // Get last purchase order, last sale, and current locations
      const [lastPurchase, lastSale, inventoryLocations] = await Promise.all([
        storage.getLastPurchaseOrderForItem(stockItemId, req.session.currentCompanyId),
        storage.getLastSaleForItem(stockItemId, req.session.currentCompanyId),
        storage.getInventoryLocationsByItem(stockItemId, req.session.currentCompanyId),
      ]);

      res.json({
        lastPurchase,
        lastSale,
        inventoryLocations,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update stock transfer item
  app.patch("/api/stock-transfer-items/:id", requireAuth, async (req, res) => {
    try {
      const itemId = parseInt(req.params.id);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Validate numeric fields if provided
      if (req.body.quantity !== undefined) {
        const qty = parseFloat(req.body.quantity);
        if (isNaN(qty)) {
          return res.status(400).json({ message: "Quantity must be a valid number" });
        }
      }
      if (req.body.rate !== undefined) {
        const rate = parseFloat(req.body.rate);
        if (isNaN(rate) || rate < 0) {
          return res.status(400).json({ message: "Rate must be a valid non-negative number" });
        }
      }
      if (req.body.stockItemId !== undefined) {
        const stockItemId = parseInt(req.body.stockItemId);
        if (isNaN(stockItemId)) {
          return res.status(400).json({ message: "Stock item ID must be a valid number" });
        }
      }

      const updated = await storage.updateStockTransferItem(itemId, req.body);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update stock adjustment item
  app.patch("/api/stock-adjustment-items/:id", requireAuth, async (req, res) => {
    try {
      const itemId = parseInt(req.params.id);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Validate numeric fields if provided
      if (req.body.quantity !== undefined) {
        const qty = parseFloat(req.body.quantity);
        if (isNaN(qty)) {
          return res.status(400).json({ message: "Quantity must be a valid number" });
        }
      }
      if (req.body.rate !== undefined) {
        const rate = parseFloat(req.body.rate);
        if (isNaN(rate) || rate < 0) {
          return res.status(400).json({ message: "Rate must be a valid non-negative number" });
        }
      }
      if (req.body.stockItemId !== undefined) {
        const stockItemId = parseInt(req.body.stockItemId);
        if (isNaN(stockItemId)) {
          return res.status(400).json({ message: "Stock item ID must be a valid number" });
        }
      }

      const updated = await storage.updateStockAdjustmentItem(itemId, req.body);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Query - Aggregated stock data across all locations
  app.get("/api/stock-query", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get all stock items for the company
      const allStockItems = await db
        .select({
          id: stockItems.id,
          code: stockItems.code,
          name: stockItems.name,
          uom: stockItems.uom,
          stockGroupId: stockItems.stockGroupId,
          stockGroupCode: stockGroups.code,
          stockGroupName: stockGroups.name,
          openingQty: stockItems.openingQty,
          openingRate: stockItems.openingRate,
          openingValue: stockItems.openingValue,
          sellingPrice: stockItems.sellingPrice,
          active: stockItems.active,
        })
        .from(stockItems)
        .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
        .where(eq(stockItems.companyId, req.session.currentCompanyId));

      // Get all inventory records for the company to calculate current qty and value
      const inventoryRecords = await db
        .select({
          stockItemId: inventory.stockItemId,
          quantity: inventory.quantity,
          totalValue: inventory.totalValue,
        })
        .from(inventory)
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .where(eq(locations.companyId, req.session.currentCompanyId));

      // Aggregate inventory by stock item
      const inventoryMap = new Map<number, { totalQty: number; totalValue: number }>();
      
      for (const record of inventoryRecords) {
        const existing = inventoryMap.get(record.stockItemId) || { totalQty: 0, totalValue: 0 };
        existing.totalQty += parseFloat(record.quantity || "0");
        existing.totalValue += parseFloat(record.totalValue || "0");
        inventoryMap.set(record.stockItemId, existing);
      }

      // Combine stock items with aggregated inventory
      const result = allStockItems.map((item) => {
        const inv = inventoryMap.get(item.id) || { totalQty: 0, totalValue: 0 };
        return {
          ...item,
          currentQty: inv.totalQty.toFixed(3),
          currentValue: inv.totalValue.toFixed(2),
        };
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
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
            stockItem = allStockItems.find(item => item.code === row.Item_Barcode);
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

          // Try to find stock item by code first, then by name
          let stockItem = null;
          if (item.barcode) {
            stockItem = allStockItems.find(si => si.code === item.barcode);
          }
          if (!stockItem && item.itemName) {
            stockItem = allStockItems.find(si => si.name === item.itemName);
          }

          if (!stockItem) {
            if (item.barcode) {
              errors.push(`Item not found: code ${item.barcode} (${item.itemName})`);
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

          // Try to find stock item by code first, then by name
          let stockItem = null;
          if (item.barcode) {
            stockItem = allStockItems.find(si => si.code === item.barcode);
          }
          if (!stockItem && item.itemName) {
            stockItem = allStockItems.find(si => si.name === item.itemName);
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
          optional: false,
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
          // Re-lookup stock item by code or name to get fresh ID (not stale preview data)
          let stockItemId = item.stockItemId;
          let stockItem = null;

          // Try code first, then fall back to name
          if (item.barcode) {
            stockItem = freshStockItems.find(si => si.code === item.barcode);
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
        officeChargesAccountId, 
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
        officeChargesAccountId,
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

  // Get a single purchase order by ID (Admin/Owner only)
  app.get("/api/purchase-orders/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }

      // Check role permissions - only Admin and Owner can view purchase orders
      const userRole = req.session.currentRole;
      if (!userRole || (userRole !== "Admin" && userRole !== "Owner")) {
        return res.status(403).json({ message: "Only Admin and Owner can view purchase orders" });
      }

      const po = await storage.getPurchaseOrderById(id);
      if (!po) {
        return res.status(404).json({ message: "Purchase order not found" });
      }

      // Verify purchase order belongs to current company
      if (po.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied: Purchase order belongs to a different company" });
      }

      // Get line items for this PO
      const lineItems = await storage.getLineItemsByPO(id);

      res.json({
        ...po,
        items: lineItems
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update a purchase order
  app.patch("/api/purchase-orders/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }

      const existingPO = await storage.getPurchaseOrderById(id);
      if (!existingPO) {
        return res.status(404).json({ message: "Purchase order not found" });
      }

      // Verify purchase order belongs to current company
      if (existingPO.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied: Purchase order belongs to a different company" });
      }

      // Check edit permissions based on role
      const userRole = req.session.currentRole;
      if (!userRole) {
        return res.status(403).json({ message: "User role not found" });
      }

      // Only Admin and Owner can edit purchase orders
      if (userRole !== "Admin" && userRole !== "Owner") {
        return res.status(403).json({ message: "Only Admin and Owner can edit purchase orders" });
      }

      // Only allow updating specific fields
      const allowedUpdates: Partial<InsertPurchaseOrder> = {};
      if (req.body.poNumber !== undefined) allowedUpdates.poNumber = req.body.poNumber;
      if (req.body.itemsTotal !== undefined) allowedUpdates.itemsTotal = req.body.itemsTotal;
      if (req.body.currency !== undefined) allowedUpdates.currency = req.body.currency;
      if (req.body.status !== undefined) allowedUpdates.status = req.body.status;

      const updated = await storage.updatePurchaseOrder(id, allowedUpdates);
      res.json(updated);
    } catch (error: any) {
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
          optional: false,
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

  // Get all suppliers with balances and container counts (global across all companies)
  app.get("/api/suppliers/with-stats", requireAuth, async (req, res) => {
    try {
      const suppliers = await storage.getAllSuppliers();
      
      const suppliersWithStats = await Promise.all(
        suppliers.map(async (supplier) => {
          // Aggregate container count across ALL companies (no filter)
          const containerCount = await storage.getContainerCountBySupplier(supplier.id);
          
          // Calculate balance from voucher entries across ALL companies
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

      // Filter to only show suppliers that have any activity (containers or balance)
      const activeSuppliersInCompany = suppliersWithStats.filter(
        s => s.containerCount > 0 || s.balance !== 0
      );

      res.json(activeSuppliersInCompany);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get unified ledger for a supplier across all companies
  app.get("/api/suppliers/:supplierId/unified-ledger", requireAuth, async (req, res) => {
    try {
      const supplierId = parseInt(req.params.supplierId);
      
      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }

      const { companyId, startDate, endDate } = req.query;
      const filterCompanyId = companyId ? parseInt(companyId as string) : undefined;

      // Get voucher entries (filtered by company if specified)
      const voucherEntries = await storage.getVoucherEntriesBySupplier(
        supplierId,
        filterCompanyId,
        startDate as string | undefined,
        endDate as string | undefined
      );

      // Get all companies to map IDs to names
      const companies = await storage.getAllCompanies();
      const companyMap = new Map(companies.map(c => [c.id, c]));

      // Get purchase orders (filtered by company if specified)
      const allPOs: any[] = [];
      if (filterCompanyId) {
        const pos = await storage.getPurchaseOrdersBySupplier(supplierId, filterCompanyId);
        allPOs.push(...pos.map(po => ({ ...po, companyId: filterCompanyId })));
      } else {
        // Get POs from all companies
        for (const company of companies) {
          const pos = await storage.getPurchaseOrdersBySupplier(supplierId, company.id);
          allPOs.push(...pos.map(po => ({ ...po, companyId: company.id })));
        }
      }

      // Combine all transactions with company information
      const transactions: any[] = [];

      // Add voucher entries
      for (const entry of voucherEntries) {
        const company = companyMap.get(entry.companyId);
        transactions.push({
          type: 'voucher',
          date: entry.voucherDate,
          companyId: entry.companyId,
          companyName: company?.name || 'Unknown',
          docNumber: entry.voucherNumber,
          description: entry.narration || entry.voucherDescription || '',
          voucherType: entry.voucherType,
          debit: parseFloat(entry.debitAmount || "0"),
          credit: parseFloat(entry.creditAmount || "0"),
        });
      }

      // Add purchase orders
      for (const po of allPOs) {
        const company = companyMap.get(po.companyId);
        const amount = parseFloat(po.itemsTotal || "0");
        transactions.push({
          type: 'purchase_order',
          date: po.createdAt,
          companyId: po.companyId,
          companyName: company?.name || 'Unknown',
          docNumber: po.poNumber,
          description: `Container ${po.containerNumber}`,
          voucherType: 'Purchase',
          debit: 0,
          credit: amount, // PO creates payable (credit)
        });
      }

      // Sort by date (newest first)
      transactions.sort((a, b) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        return dateB - dateA;
      });

      // Calculate running balance
      let balance = 0;
      const transactionsWithBalance = transactions.map(t => {
        balance += t.credit - t.debit;
        return {
          ...t,
          balance: balance,
        };
      });

      res.json(transactionsWithBalance.reverse()); // Return chronological order with running balance
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
      const filterCompanyId = companyId ? parseInt(companyId as string) : undefined;
      
      if (!filterCompanyId) {
        // If no company filter, get POs from all companies
        const companies = await storage.getAllCompanies();
        const allPOs: any[] = [];
        
        for (const company of companies) {
          const pos = await storage.getPurchaseOrdersBySupplier(supplierId, company.id);
          allPOs.push(...pos.map(po => ({ ...po, companyName: company.name })));
        }
        
        return res.json(allPOs);
      }

      const purchaseOrders = await storage.getPurchaseOrdersBySupplier(supplierId, filterCompanyId);
      const company = await storage.getCompanyById(filterCompanyId);
      const posWithCompanyName = purchaseOrders.map(po => ({ ...po, companyName: company?.name }));
      
      res.json(posWithCompanyName);
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

  // Create a voucher with entries in one transaction
  app.post("/api/vouchers/with-entries", requireAuth, async (req, res) => {
    try {
      const { voucher, entries } = req.body;
      
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Validate voucher data
      if (!voucher || !entries || !Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ message: "Voucher and entries are required" });
      }

      // Validate that debits equal credits (only for non-optional vouchers)
      const totalDebits = entries.reduce((sum: number, entry: any) => 
        sum + parseFloat(entry.debitAmount || "0"), 0);
      const totalCredits = entries.reduce((sum: number, entry: any) => 
        sum + parseFloat(entry.creditAmount || "0"), 0);
      
      // For active (non-optional) vouchers, enforce debit=credit balance
      if (!voucher.optional && Math.abs(totalDebits - totalCredits) >= 0.01) {
        return res.status(400).json({ message: "Total debits must equal total credits for active vouchers" });
      }

      // Create voucher with error handling
      let createdVoucher;
      let createdEntries = [];
      
      try {
        [createdVoucher] = await db.insert(vouchers).values({
          companyId: req.session.currentCompanyId!,
          locationId: voucher.locationId || null,
          voucherNumber: voucher.voucherNumber,
          voucherType: voucher.voucherType,
          voucherDate: voucher.voucherDate,
          description: voucher.description || null,
          totalAmount: Math.max(totalDebits, totalCredits).toFixed(2),
          optional: voucher.optional ?? false,
        }).returning();

        // Create voucher entries
        for (const entry of entries) {
          const [createdEntry] = await db.insert(voucherEntries).values({
            voucherId: createdVoucher.id,
            ledgerAccountId: entry.ledgerAccountId || null,
            bankAccountId: entry.bankAccountId || null,
            fixedAssetId: entry.fixedAssetId || null,
            supplierId: entry.supplierId || null,
            debitAmount: entry.debitAmount || "0",
            creditAmount: entry.creditAmount || "0",
            narration: entry.narration || null,
          }).returning();
          createdEntries.push(createdEntry);
        }
      } catch (error: any) {
        // Cleanup: Delete voucher and entries if anything failed
        if (createdVoucher?.id) {
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, createdVoucher.id)).catch(() => {});
          await db.delete(vouchers).where(eq(vouchers.id, createdVoucher.id)).catch(() => {});
        }
        throw error;
      }

      const result = { voucher: createdVoucher, entries: createdEntries };

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get a specific voucher with all entries and related data
  app.get("/api/vouchers/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      const voucher = await storage.getVoucherById(id);
      if (!voucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Verify voucher belongs to current company
      if (voucher.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied: Voucher belongs to a different company" });
      }

      const entries = await storage.getVoucherEntriesByVoucher(id);
      
      // If this is a Purchase voucher, also fetch the linked purchase order
      let purchaseOrder = null;
      if (voucher.voucherType === "Purchase") {
        const allPOs = await storage.getAllPurchaseOrders(voucher.companyId);
        const linkedPO = allPOs.find(po => po.voucherId === id);
        if (linkedPO) {
          const lineItems = await storage.getLineItemsByPO(linkedPO.id);
          purchaseOrder = {
            ...linkedPO,
            items: lineItems
          };
        }
      }
      
      // If this is a Sales voucher, also fetch the linked sales items
      let salesItemsList = null;
      if (voucher.voucherType === "Sales") {
        const items = await db
          .select()
          .from(salesItems)
          .where(eq(salesItems.voucherId, id));
        
        if (items.length > 0) {
          const itemsWithDetails = await Promise.all(
            items.map(async (item) => {
              const stockItem = await storage.getStockItemById(item.stockItemId);
              return {
                ...item,
                stockItemCode: stockItem?.code || "",
                stockItemName: stockItem?.name || "",
                stockItemUom: stockItem?.uom || "",
              };
            })
          );
          salesItemsList = itemsWithDetails;
        }
      }
      
      // If this is a Consumption or Mixed voucher, fetch adjustment details
      let adjustmentData = null;
      if (voucher.voucherType === "Consumption" || voucher.voucherType === "Mixed") {
        const adjustment = await db
          .select()
          .from(stockAdjustmentVouchers)
          .where(eq(stockAdjustmentVouchers.voucherId, id))
          .limit(1);
        
        if (adjustment.length > 0) {
          const items = await db
            .select()
            .from(stockAdjustmentItems)
            .where(eq(stockAdjustmentItems.adjustmentId, adjustment[0].id));
          
          const itemsWithDetails = await Promise.all(
            items.map(async (item) => {
              const stockItem = await storage.getStockItemById(item.stockItemId);
              return {
                ...item,
                stockItemCode: stockItem?.code || "",
                stockItemName: stockItem?.name || "",
                stockItemUom: stockItem?.uom || "",
              };
            })
          );
          
          const location = await storage.getLocationById(adjustment[0].locationId);
          
          adjustmentData = {
            ...adjustment[0],
            locationName: location?.name || "",
            items: itemsWithDetails,
          };
        } else {
          // No adjustment record exists - return empty structure so frontend can show form
          adjustmentData = {
            id: 0,
            voucherId: id,
            locationId: voucher.locationId || 1,
            locationName: "",
            adjustmentType: voucher.voucherType === "Consumption" ? "consumption" : "production",
            notes: voucher.description || "",
            items: [],
            createdAt: new Date(),
          };
        }
      }
      
      // If this is a Stock Transfer voucher, fetch transfer details
      let transferData = null;
      if (voucher.voucherType === "Stock Transfer") {
        const transfer = await db
          .select()
          .from(stockTransferVouchers)
          .where(eq(stockTransferVouchers.voucherId, id))
          .limit(1);
        
        if (transfer.length > 0) {
          const items = await db
            .select()
            .from(stockTransferItems)
            .where(eq(stockTransferItems.transferId, transfer[0].id));
          
          const itemsWithDetails = await Promise.all(
            items.map(async (item) => {
              const stockItem = await storage.getStockItemById(item.stockItemId);
              return {
                ...item,
                stockItemCode: stockItem?.code || "",
                stockItemName: stockItem?.name || "",
                stockItemUom: stockItem?.uom || "",
              };
            })
          );
          
          const sourceLocation = await storage.getLocationById(transfer[0].sourceLocationId);
          const destLocation = await storage.getLocationById(transfer[0].destinationLocationId);
          
          transferData = {
            ...transfer[0],
            sourceLocationName: sourceLocation?.name || "",
            destinationLocationName: destLocation?.name || "",
            items: itemsWithDetails,
          };
        }
      }
      
      res.json({
        ...voucher,
        entries,
        purchaseOrder,
        salesItems: salesItemsList,
        adjustmentData,
        transferData,
      });
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

  // Toggle optional status for a voucher
  app.patch("/api/vouchers/:id/optional", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      const { optional } = req.body;
      if (typeof optional !== "boolean") {
        return res.status(400).json({ message: "Optional must be a boolean value" });
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

      // Only Admin and Owner can toggle optional status
      const userRole = req.session.currentRole;
      if (userRole !== "Admin" && userRole !== "Owner") {
        return res.status(403).json({ message: "Only Admin and Owner can toggle optional status" });
      }

      // Update the optional field
      const updated = await db
        .update(vouchers)
        .set({ optional })
        .where(eq(vouchers.id, id))
        .returning();

      res.json(updated[0]);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update a sales voucher with line items
  app.patch("/api/vouchers/:id/sales", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      const { voucherDate, description, items } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      // Get the existing voucher to check company and permissions
      const existingVoucher = await storage.getVoucherById(id);
      if (!existingVoucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Verify this is a Sales voucher
      if (existingVoucher.voucherType !== "Sales") {
        return res.status(400).json({ message: "This endpoint only updates Sales vouchers" });
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
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          const voucherDate = new Date(existingVoucher.voucherDate);
          voucherDate.setHours(0, 0, 0, 0);
          
          if (voucherDate.getTime() !== today.getTime()) {
            return res.status(403).json({ message: "Managers can only edit today's vouchers" });
          }
        } else {
          // Other roles cannot edit
          return res.status(403).json({ message: "Insufficient permissions to edit vouchers" });
        }
      }

      // Fetch stock items to calculate cost prices
      const stockItemIds = items.map(item => item.stockItemId);
      const stockItemsData = await db
        .select()
        .from(stockItems)
        .where(inArray(stockItems.id, stockItemIds));

      const stockItemsMap = new Map(stockItemsData.map(item => [item.id, item]));

      // Calculate totals and prepare items data
      let totalSalesAmount = 0;
      const salesItemsData = items.map((item: any) => {
        const stockItem = stockItemsMap.get(item.stockItemId);
        if (!stockItem) {
          throw new Error(`Stock item ${item.stockItemId} not found`);
        }

        const quantity = parseFloat(item.quantity);
        const sellingPrice = parseFloat(item.sellingPrice);
        const costPrice = parseFloat(stockItem.openingRate || "0");

        const totalSales = quantity * sellingPrice;
        const totalCost = quantity * costPrice;
        const profit = totalSales - totalCost;

        totalSalesAmount += totalSales;

        return {
          voucherId: id,
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          sellingPrice: item.sellingPrice,
          costPrice: costPrice.toFixed(2),
          totalSales: totalSales.toFixed(2),
          totalCost: totalCost.toFixed(2),
          profit: profit.toFixed(2),
        };
      });

      // Delete existing sales items
      await db
        .delete(salesItems)
        .where(eq(salesItems.voucherId, id));

      // Insert new sales items
      await db.insert(salesItems).values(salesItemsData);

      // Update the voucher
      const voucherUpdates: any = {
        totalAmount: totalSalesAmount.toFixed(2),
      };
      if (voucherDate !== undefined) voucherUpdates.voucherDate = voucherDate;
      if (description !== undefined) voucherUpdates.description = description;

      const updated = await db
        .update(vouchers)
        .set(voucherUpdates)
        .where(eq(vouchers.id, id))
        .returning();

      res.json(updated[0]);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update a purchase voucher with line items
  app.patch("/api/vouchers/:id/purchase", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      const { voucherDate, description, items } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      // Get the existing voucher to check company and permissions
      const existingVoucher = await storage.getVoucherById(id);
      if (!existingVoucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Verify this is a Purchase voucher
      if (existingVoucher.voucherType !== "Purchase") {
        return res.status(400).json({ message: "This endpoint only updates Purchase vouchers" });
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
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          const voucherDate = new Date(existingVoucher.voucherDate);
          voucherDate.setHours(0, 0, 0, 0);
          
          if (voucherDate.getTime() !== today.getTime()) {
            return res.status(403).json({ message: "Managers can only edit today's vouchers" });
          }
        } else {
          // Other roles cannot edit
          return res.status(403).json({ message: "Insufficient permissions to edit vouchers" });
        }
      }

      // Find the associated purchase order
      const [po] = await db
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.voucherId, id))
        .limit(1);

      if (!po) {
        return res.status(404).json({ message: "Associated purchase order not found" });
      }

      // Calculate totals and prepare items data
      let totalAmount = 0;
      const poItemsData = items.map((item: any) => {
        const quantity = parseFloat(item.quantity);
        const rate = parseFloat(item.rate);
        const lineTotal = quantity * rate;

        totalAmount += lineTotal;

        return {
          poId: po.id,
          stockItemId: item.stockItemId || 0, // Default to 0 if not provided
          itemName: item.itemName,
          quantity: item.quantity,
          rate: item.rate,
          lineTotal: lineTotal.toFixed(2),
        };
      });

      // Delete existing PO line items
      await db
        .delete(poLineItems)
        .where(eq(poLineItems.poId, po.id));

      // Insert new PO line items
      await db.insert(poLineItems).values(poItemsData);

      // Update the purchase order total
      await db
        .update(purchaseOrders)
        .set({ itemsTotal: totalAmount.toFixed(2) })
        .where(eq(purchaseOrders.id, po.id));

      // Update the voucher
      const voucherUpdates: any = {
        totalAmount: totalAmount.toFixed(2),
      };
      if (voucherDate !== undefined) voucherUpdates.voucherDate = voucherDate;
      if (description !== undefined) voucherUpdates.description = description;

      const updated = await db
        .update(vouchers)
        .set(voucherUpdates)
        .where(eq(vouchers.id, id))
        .returning();

      res.json(updated[0]);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update an adjustment voucher (Consumption or Mixed) with line items
  app.patch("/api/vouchers/:id/adjustment", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      const { voucherDate, description, locationId, items } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      if (!locationId) {
        return res.status(400).json({ message: "Location ID is required" });
      }

      // Get the existing voucher to check company and permissions
      const existingVoucher = await storage.getVoucherById(id);
      if (!existingVoucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Verify this is a Consumption or Mixed voucher
      if (existingVoucher.voucherType !== "Consumption" && existingVoucher.voucherType !== "Mixed") {
        return res.status(400).json({ message: "This endpoint only updates Consumption or Mixed vouchers" });
      }

      // Verify voucher belongs to current company
      if (existingVoucher.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied: Voucher belongs to a different company" });
      }

      // Check edit permissions
      const userRole = req.session.currentRole;
      if (!userRole) {
        return res.status(403).json({ message: "User role not found" });
      }

      if (userRole !== "Admin" && userRole !== "Owner") {
        if (userRole === "Manager") {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          const voucherDate = new Date(existingVoucher.voucherDate);
          voucherDate.setHours(0, 0, 0, 0);
          
          if (voucherDate.getTime() !== today.getTime()) {
            return res.status(403).json({ message: "Managers can only edit today's vouchers" });
          }
        } else {
          return res.status(403).json({ message: "Insufficient permissions to edit vouchers" });
        }
      }

      // Find or create the associated adjustment voucher
      let adjustmentVoucher = await db
        .select()
        .from(stockAdjustmentVouchers)
        .where(eq(stockAdjustmentVouchers.voucherId, id))
        .limit(1)
        .then(rows => rows[0]);

      // If no adjustment voucher exists, create one
      if (!adjustmentVoucher) {
        const adjustmentType = existingVoucher.voucherType === "Consumption" ? "consumption" : "production";
        const [newAdjustment] = await db
          .insert(stockAdjustmentVouchers)
          .values({
            voucherId: id,
            locationId: parseInt(locationId),
            adjustmentType: adjustmentType,
            notes: description || "",
          })
          .returning();
        adjustmentVoucher = newAdjustment;
      }

      // Calculate totals and prepare items data
      let totalAmount = 0;
      const adjustmentItemsData = items.map((item: any) => {
        const quantity = parseFloat(item.quantity);
        const rate = parseFloat(item.rate);
        const itemTotal = quantity * rate;

        totalAmount += itemTotal;

        return {
          adjustmentId: adjustmentVoucher.id,
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          rate: item.rate,
          totalAmount: itemTotal.toFixed(2),
        };
      });

      // Delete existing adjustment items (if any)
      await db
        .delete(stockAdjustmentItems)
        .where(eq(stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));

      // Insert new adjustment items
      await db.insert(stockAdjustmentItems).values(adjustmentItemsData);

      // Update the adjustment voucher (location can be changed, but shouldn't affect old inventory)
      await db
        .update(stockAdjustmentVouchers)
        .set({ locationId: parseInt(locationId), notes: description || "" })
        .where(eq(stockAdjustmentVouchers.id, adjustmentVoucher.id));

      // Update the main voucher
      const voucherUpdates: any = {
        totalAmount: totalAmount.toFixed(2),
      };
      if (voucherDate !== undefined) voucherUpdates.voucherDate = voucherDate;
      if (description !== undefined) voucherUpdates.description = description;

      const updated = await db
        .update(vouchers)
        .set(voucherUpdates)
        .where(eq(vouchers.id, id))
        .returning();

      res.json(updated[0]);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update a stock transfer voucher with line items
  app.patch("/api/vouchers/:id/transfer", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      const { voucherDate, description, sourceLocationId, destinationLocationId, items } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      if (!sourceLocationId || !destinationLocationId) {
        return res.status(400).json({ message: "Source and destination locations are required" });
      }

      // Get the existing voucher to check company and permissions
      const existingVoucher = await storage.getVoucherById(id);
      if (!existingVoucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Verify this is a Stock Transfer voucher
      if (existingVoucher.voucherType !== "Stock Transfer") {
        return res.status(400).json({ message: "This endpoint only updates Stock Transfer vouchers" });
      }

      // Verify voucher belongs to current company
      if (existingVoucher.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied: Voucher belongs to a different company" });
      }

      // Check edit permissions
      const userRole = req.session.currentRole;
      if (!userRole) {
        return res.status(403).json({ message: "User role not found" });
      }

      if (userRole !== "Admin" && userRole !== "Owner") {
        if (userRole === "Manager") {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          const voucherDate = new Date(existingVoucher.voucherDate);
          voucherDate.setHours(0, 0, 0, 0);
          
          if (voucherDate.getTime() !== today.getTime()) {
            return res.status(403).json({ message: "Managers can only edit today's vouchers" });
          }
        } else {
          return res.status(403).json({ message: "Insufficient permissions to edit vouchers" });
        }
      }

      // Find or create the associated transfer voucher
      let transferVoucher = await db
        .select()
        .from(stockTransferVouchers)
        .where(eq(stockTransferVouchers.voucherId, id))
        .limit(1)
        .then(rows => rows[0]);

      // If no transfer voucher exists, create one
      if (!transferVoucher) {
        const [newTransfer] = await db
          .insert(stockTransferVouchers)
          .values({
            voucherId: id,
            sourceLocationId: parseInt(sourceLocationId),
            destinationLocationId: parseInt(destinationLocationId),
            notes: description || "",
          })
          .returning();
        transferVoucher = newTransfer;
      }

      // Calculate totals and prepare items data
      let totalAmount = 0;
      const transferItemsData = items.map((item: any) => {
        const quantity = parseFloat(item.quantity);
        const rate = parseFloat(item.rate);
        const itemTotal = quantity * rate;

        totalAmount += itemTotal;

        return {
          transferId: transferVoucher.id,
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          rate: item.rate,
          totalAmount: itemTotal.toFixed(2),
        };
      });

      // Delete existing transfer items (if any)
      await db
        .delete(stockTransferItems)
        .where(eq(stockTransferItems.transferId, transferVoucher.id));

      // Insert new transfer items
      await db.insert(stockTransferItems).values(transferItemsData);

      // Update the transfer voucher (locations can be changed, but shouldn't affect old inventory)
      await db
        .update(stockTransferVouchers)
        .set({
          sourceLocationId: parseInt(sourceLocationId),
          destinationLocationId: parseInt(destinationLocationId),
          notes: description || "",
        })
        .where(eq(stockTransferVouchers.id, transferVoucher.id));

      // Update the main voucher
      const voucherUpdates: any = {
        totalAmount: totalAmount.toFixed(2),
      };
      if (voucherDate !== undefined) voucherUpdates.voucherDate = voucherDate;
      if (description !== undefined) voucherUpdates.description = description;

      const updated = await db
        .update(vouchers)
        .set(voucherUpdates)
        .where(eq(vouchers.id, id))
        .returning();

      res.json(updated[0]);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update a voucher with all entries (completely replace entries)
  app.put("/api/vouchers/:id/with-entries", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      const { voucher, entries } = req.body;

      if (!voucher || !entries || !Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ message: "Voucher and entries are required" });
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

      // Validate that debits equal credits (only for non-optional vouchers)
      const totalDebits = entries.reduce((sum: number, entry: any) => 
        sum + parseFloat(entry.debitAmount || "0"), 0);
      const totalCredits = entries.reduce((sum: number, entry: any) => 
        sum + parseFloat(entry.creditAmount || "0"), 0);
      
      // For active (non-optional) vouchers, enforce debit=credit balance
      if (!voucher.optional && Math.abs(totalDebits - totalCredits) >= 0.01) {
        return res.status(400).json({ message: "Total debits must equal total credits for active vouchers" });
      }

      // Update voucher with error handling
      let updatedVoucher;
      let createdEntries = [];
      let oldEntries: any[] = [];
      
      try {
        // Backup old entries before deleting
        oldEntries = await db.select().from(voucherEntries).where(eq(voucherEntries.voucherId, id));

        // Update voucher metadata
        [updatedVoucher] = await db.update(vouchers)
          .set({
            voucherType: voucher.voucherType,
            voucherDate: voucher.voucherDate,
            description: voucher.description || null,
            optional: voucher.optional ?? false,
            totalAmount: Math.max(totalDebits, totalCredits).toFixed(2),
          })
          .where(eq(vouchers.id, id))
          .returning();

        // Delete all existing entries
        await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, id));

        // Create new entries
        for (const entry of entries) {
          const [createdEntry] = await db.insert(voucherEntries).values({
            voucherId: id,
            ledgerAccountId: entry.ledgerAccountId || null,
            bankAccountId: entry.bankAccountId || null,
            fixedAssetId: entry.fixedAssetId || null,
            supplierId: entry.supplierId || null,
            debitAmount: entry.debitAmount || "0",
            creditAmount: entry.creditAmount || "0",
            narration: entry.narration || null,
          }).returning();
          createdEntries.push(createdEntry);
        }
      } catch (error: any) {
        // Cleanup: Restore old entries if update failed after deletion
        if (oldEntries.length > 0 && createdEntries.length === 0) {
          for (const oldEntry of oldEntries) {
            await db.insert(voucherEntries).values({
              voucherId: oldEntry.voucherId,
              ledgerAccountId: oldEntry.ledgerAccountId,
              bankAccountId: oldEntry.bankAccountId,
              fixedAssetId: oldEntry.fixedAssetId,
              supplierId: oldEntry.supplierId,
              debitAmount: oldEntry.debitAmount,
              creditAmount: oldEntry.creditAmount,
              narration: oldEntry.narration,
            }).catch(() => {});
          }
        }
        throw error;
      }

      const result = { voucher: updatedVoucher, entries: createdEntries };

      res.json(result);
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

      // Verify voucher exists and belongs to current company
      const voucher = await storage.getVoucherById(id);
      if (!voucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      if (voucher.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied: Voucher belongs to a different company" });
      }

      const entries = await storage.getVoucherEntriesByVoucher(id);
      res.json(entries);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create a new voucher entry
  app.post("/api/voucher-entries", requireAuth, async (req, res) => {
    try {
      // Verify the voucher exists and belongs to current company
      if (!req.body.voucherId) {
        return res.status(400).json({ message: "Voucher ID is required" });
      }

      const voucher = await storage.getVoucherById(req.body.voucherId);
      if (!voucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Verify voucher belongs to current company
      if (voucher.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied: Voucher belongs to a different company" });
      }

      // Check permissions based on role (same logic as voucher edit)
      const userRole = req.session.currentRole;
      if (!userRole) {
        return res.status(403).json({ message: "User role not found" });
      }

      // Admin and Owner can create entries for all vouchers
      if (userRole !== "Admin" && userRole !== "Owner") {
        // Manager can only create entries for today's vouchers
        if (userRole === "Manager") {
          const voucherDate = new Date(voucher.voucherDate);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          voucherDate.setHours(0, 0, 0, 0);
          
          if (voucherDate.getTime() !== today.getTime()) {
            return res.status(403).json({ message: "Managers can only create entries for today's vouchers" });
          }
        } else {
          // Other roles cannot create entries
          return res.status(403).json({ message: "Insufficient permissions to create voucher entries" });
        }
      }

      const entry = await storage.createVoucherEntry(req.body);
      res.json(entry);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update a voucher entry
  app.patch("/api/voucher-entries/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher entry ID" });
      }

      // Get the existing entry to find its voucher
      const existingEntry = await db.query.voucherEntries.findFirst({
        where: eq(voucherEntries.id, id),
      });

      if (!existingEntry) {
        return res.status(404).json({ message: "Voucher entry not found" });
      }

      // Get the voucher to check company and permissions
      const voucher = await storage.getVoucherById(existingEntry.voucherId);
      if (!voucher) {
        return res.status(404).json({ message: "Associated voucher not found" });
      }

      // Verify voucher belongs to current company
      if (voucher.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied: Voucher belongs to a different company" });
      }

      // Check edit permissions based on role (same logic as voucher edit)
      const userRole = req.session.currentRole;
      if (!userRole) {
        return res.status(403).json({ message: "User role not found" });
      }

      // Admin and Owner can edit all vouchers
      if (userRole !== "Admin" && userRole !== "Owner") {
        // Manager can only edit today's vouchers
        if (userRole === "Manager") {
          const voucherDate = new Date(voucher.voucherDate);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          voucherDate.setHours(0, 0, 0, 0);
          
          if (voucherDate.getTime() !== today.getTime()) {
            return res.status(403).json({ message: "Managers can only edit today's vouchers" });
          }
        } else {
          // Other roles cannot edit
          return res.status(403).json({ message: "Insufficient permissions to edit voucher entries" });
        }
      }

      // Only allow updating debit/credit amounts and narration
      const allowedUpdates: Partial<any> = {};
      if (req.body.debitAmount !== undefined) allowedUpdates.debitAmount = req.body.debitAmount;
      if (req.body.creditAmount !== undefined) allowedUpdates.creditAmount = req.body.creditAmount;
      if (req.body.narration !== undefined) allowedUpdates.narration = req.body.narration;

      const updated = await storage.updateVoucherEntry(id, allowedUpdates);
      res.json(updated);
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
      
      const { locationId, cashAccountId, paymentAccountType, paymentAccountId, items, notes } = req.body;

      // Support both old (cashAccountId) and new (paymentAccountType/paymentAccountId) parameters
      const accountType = paymentAccountType || "bank";
      const accountId = paymentAccountId || cashAccountId;

      // Validate required fields
      if (!locationId) {
        return res.status(400).json({ message: "Location is required" });
      }
      if (!accountId) {
        return res.status(400).json({ message: "Payment account is required" });
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

      // STEP 1: Validate inventory availability
      const voucherNumber = `SALES-${Date.now()}`;
      const voucherDate = new Date().toISOString().split('T')[0];

      // STEP 1a: Validate inventory rows
      const inventoryValidation: Array<{
        item: any;
        inventoryRecord: any;
        currentQty: number;
        saleQty: number;
        newQty: number;
        currentRate: number;
      }> = [];

      for (const item of items) {
        const [inventoryRecord] = await db
          .select()
          .from(inventory)
          .where(and(
            eq(inventory.locationId, locationId),
            eq(inventory.stockItemId, item.stockItemId)
          ));

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
      let voucher;
      let saleItems = [];
      const updatedInventoryIds: number[] = [];
      
      try {
        [voucher] = await db.insert(vouchers).values({
          companyId: req.session.currentCompanyId!,
          locationId,
          voucherNumber,
          voucherType: "Sales",
          voucherDate,
          description: notes || `POS Sale at ${location.name}`,
          totalAmount: grandTotal.toFixed(2),
          optional: false,
        }).returning();

        // Create voucher entries (double-entry bookkeeping)
        // Debit: Cash/Bank Account (Asset increases)
        const debitEntry: any = {
          voucherId: voucher.id,
          debitAmount: grandTotal.toFixed(2),
          creditAmount: "0",
          narration: `POS Sale - ${voucherNumber}`,
        };

        if (accountType === "cash") {
          debitEntry.ledgerAccountId = accountId;
        } else {
          debitEntry.bankAccountId = accountId;
        }

        await db.insert(voucherEntries).values(debitEntry);

        // Credit: Sales Account (Revenue increases)
        await db.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: salesAccount.id,
          debitAmount: "0",
          creditAmount: grandTotal.toFixed(2),
          narration: `POS Sale - ${voucherNumber}`,
        });

        // Update inventory for each item
        for (const validatedItem of inventoryValidation) {
          const { item, newQty, currentRate, inventoryRecord, currentQty } = validatedItem;

          // Calculate new total value
          const newTotalValue = (newQty * currentRate).toFixed(2);

          // Update inventory
          await db
            .update(inventory)
            .set({
              quantity: newQty.toString(),
              averageRate: currentRate.toFixed(2),
              totalValue: newTotalValue,
              lastUpdated: new Date(),
            })
            .where(eq(inventory.id, inventoryRecord.id));

          // Track updated inventory for potential rollback
          updatedInventoryIds.push(inventoryRecord.id);

          // Get stock item details for response
          const [stockItem] = await db
            .select()
            .from(stockItems)
            .where(eq(stockItems.id, item.stockItemId));

          const qty = parseFloat(item.quantity);
          const sellingPrice = parseFloat(item.rate);
          const costPrice = currentRate;
          const totalSales = qty * sellingPrice;
          const totalCost = qty * costPrice;
          const profit = totalSales - totalCost;

          // Insert sales item record for reporting
          await db.insert(salesItems).values({
            voucherId: voucher.id,
            stockItemId: item.stockItemId,
            quantity: qty.toString(),
            sellingPrice: sellingPrice.toFixed(2),
            costPrice: costPrice.toFixed(2),
            totalSales: totalSales.toFixed(2),
            totalCost: totalCost.toFixed(2),
            profit: profit.toFixed(2),
          });

          saleItems.push({
            ...item,
            stockItemName: stockItem?.name || "",
            stockItemCode: stockItem?.code || "",
            amount: totalSales.toFixed(2),
          });
        }
      } catch (error: any) {
        // Comprehensive cleanup: rollback all changes
        if (voucher?.id) {
          // Delete sales items
          await db.delete(salesItems).where(eq(salesItems.voucherId, voucher.id)).catch(() => {});
          // Delete voucher entries
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucher.id)).catch(() => {});
          // Delete voucher
          await db.delete(vouchers).where(eq(vouchers.id, voucher.id)).catch(() => {});
        }
        
        // Restore inventory quantities
        for (let i = 0; i < updatedInventoryIds.length; i++) {
          const validatedItem = inventoryValidation[i];
          const originalQty = validatedItem.currentQty;
          const originalTotalValue = (originalQty * validatedItem.currentRate).toFixed(2);
          
          await db
            .update(inventory)
            .set({
              quantity: originalQty.toString(),
              totalValue: originalTotalValue,
              lastUpdated: new Date(),
            })
            .where(eq(inventory.id, updatedInventoryIds[i]))
            .catch(() => {});
        }
        
        throw error; // Re-throw to be caught by outer error handler
      }

      const result = { voucher, saleItems };

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

  // Get stock summary stats for Dashboard
  app.get("/api/stats/stock-summary", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get total stock items count
      const stockItems = await storage.getAllStockItems(companyId);
      const totalStockItems = stockItems.length;

      // Get all inventory for the company
      const inventory = await storage.getCompanyInventory(companyId);

      // Calculate low stock items (quantity < 20)
      const lowStockThreshold = 20;
      const lowStockItems = inventory
        .filter(item => parseFloat(item.quantity) < lowStockThreshold && parseFloat(item.quantity) > 0)
        .map(item => ({
          name: item.stockItemName,
          stock: parseFloat(item.quantity),
          location: item.locationName || "Unknown",
        }))
        .sort((a, b) => a.stock - b.stock) // Sort by lowest stock first
        .slice(0, 10); // Limit to top 10 low stock items

      // Count critical items (quantity < 5)
      const criticalThreshold = 5;
      const criticalCount = inventory.filter(item => 
        parseFloat(item.quantity) < criticalThreshold && parseFloat(item.quantity) > 0
      ).length;

      res.json({
        totalStockItems,
        lowStockCount: lowStockItems.length,
        criticalCount,
        lowStockItems,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Sales Report - gain/loss from POS transactions
  app.get("/api/sales-report", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate, locationId, stockItemId } = req.query;

      // Build query to join sales_items with vouchers, stock_items, and locations
      let query = db
        .select({
          id: salesItems.id,
          voucherId: salesItems.voucherId,
          voucherNumber: vouchers.voucherNumber,
          voucherDate: vouchers.voucherDate,
          locationId: vouchers.locationId,
          locationName: locations.name,
          stockItemId: salesItems.stockItemId,
          stockItemCode: stockItems.code,
          stockItemName: stockItems.name,
          quantity: salesItems.quantity,
          sellingPrice: salesItems.sellingPrice,
          costPrice: salesItems.costPrice,
          totalSales: salesItems.totalSales,
          totalCost: salesItems.totalCost,
          profit: salesItems.profit,
          createdAt: salesItems.createdAt,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .innerJoin(stockItems, eq(salesItems.stockItemId, stockItems.id))
        .leftJoin(locations, eq(vouchers.locationId, locations.id))
        .where(eq(vouchers.companyId, companyId));

      // Apply filters
      const conditions = [eq(vouchers.companyId, companyId)];

      if (startDate) {
        conditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
      }
      if (endDate) {
        conditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
      }
      if (locationId) {
        conditions.push(eq(vouchers.locationId, parseInt(locationId as string)));
      }
      if (stockItemId) {
        conditions.push(eq(salesItems.stockItemId, parseInt(stockItemId as string)));
      }

      const salesData = await db
        .select({
          id: salesItems.id,
          voucherId: salesItems.voucherId,
          voucherNumber: vouchers.voucherNumber,
          voucherDate: vouchers.voucherDate,
          locationId: vouchers.locationId,
          locationName: locations.name,
          stockItemId: salesItems.stockItemId,
          stockItemCode: stockItems.code,
          stockItemName: stockItems.name,
          quantity: salesItems.quantity,
          sellingPrice: salesItems.sellingPrice,
          costPrice: salesItems.costPrice,
          totalSales: salesItems.totalSales,
          totalCost: salesItems.totalCost,
          profit: salesItems.profit,
          createdAt: salesItems.createdAt,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .innerJoin(stockItems, eq(salesItems.stockItemId, stockItems.id))
        .leftJoin(locations, eq(vouchers.locationId, locations.id))
        .where(and(...conditions))
        .orderBy(vouchers.voucherDate);

      res.json(salesData);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Reports API Endpoints
  
  // Profit & Loss Report
  app.get("/api/reports/profit-loss", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate } = req.query;

      // Get all ledger accounts for this company
      const companyAccounts = await storage.getAllLedgerAccounts(companyId);
      
      const incomeAccounts = companyAccounts.filter(acc => acc.accountType === "Income");
      const expenseAccounts = companyAccounts.filter(acc => acc.accountType === "Expense");
      
      const incomeAccountIds = incomeAccounts.map(acc => acc.id);
      const expenseAccountIds = expenseAccounts.map(acc => acc.id);

      // Get voucher IDs for this company with date filter
      let companyVouchersQuery = db
        .select({ id: vouchers.id, voucherDate: vouchers.voucherDate })
        .from(vouchers)
        .where(eq(vouchers.companyId, companyId));

      const conditions = [eq(vouchers.companyId, companyId)];
      if (startDate) {
        conditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
      }
      if (endDate) {
        conditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
      }

      const companyVouchers = await db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(and(...conditions))
        .execute();
      
      const companyVoucherIds = companyVouchers.map(v => v.id);

      // Get voucher entries
      const companyEntries = companyVoucherIds.length > 0
        ? await db
            .select()
            .from(voucherEntries)
            .where(inArray(voucherEntries.voucherId, companyVoucherIds))
            .execute()
        : [];

      // Calculate balances for each account
      const accountBalances = new Map<number, number>();
      
      for (const entry of companyEntries) {
        if (entry.ledgerAccountId) {
          const debit = parseFloat(entry.debitAmount || "0");
          const credit = parseFloat(entry.creditAmount || "0");
          const currentBalance = accountBalances.get(entry.ledgerAccountId) || 0;
          accountBalances.set(entry.ledgerAccountId, currentBalance + credit - debit);
        }
      }

      // Build income statement
      const incomeItems = incomeAccounts.map(acc => ({
        id: acc.id,
        code: acc.code,
        name: acc.name,
        accountType: acc.accountType,
        balance: accountBalances.get(acc.id) || 0,
      })).filter(item => item.balance !== 0);

      const expenseItems = expenseAccounts.map(acc => ({
        id: acc.id,
        code: acc.code,
        name: acc.name,
        accountType: acc.accountType,
        balance: accountBalances.get(acc.id) || 0,
      })).filter(item => item.balance !== 0);

      const totalIncome = incomeItems.reduce((sum, item) => sum + item.balance, 0);
      const totalExpenses = expenseItems.reduce((sum, item) => sum + item.balance, 0);
      const netProfit = totalIncome - totalExpenses;

      res.json({
        incomeItems,
        expenseItems,
        totalIncome,
        totalExpenses,
        netProfit,
        startDate: startDate || null,
        endDate: endDate || null,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Balance Sheet Report
  app.get("/api/reports/balance-sheet", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { asOfDate } = req.query;

      // Get all accounts
      const ledgers = await storage.getAllLedgerAccounts(companyId);
      const banks = await storage.getAllBankAccounts(companyId);
      const assets = await storage.getAllFixedAssets(companyId);
      const suppliers = await storage.getAllSuppliers();

      // Get vouchers up to asOfDate
      const conditions = [eq(vouchers.companyId, companyId)];
      if (asOfDate) {
        conditions.push(sql`${vouchers.voucherDate} <= ${asOfDate}`);
      }

      const companyVouchers = await db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(and(...conditions))
        .execute();
      
      const companyVoucherIds = companyVouchers.map(v => v.id);

      const allEntries = companyVoucherIds.length > 0
        ? await db
            .select()
            .from(voucherEntries)
            .where(inArray(voucherEntries.voucherId, companyVoucherIds))
            .execute()
        : [];

      // Calculate balances
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

      // Categorize and calculate net balances
      const assetAccounts = ledgers.filter(l => l.accountType === "Asset").map(acc => {
        const bal = ledgerBalances.get(acc.id) || { debits: 0, credits: 0 };
        const openingBalance = parseFloat(acc.openingBalance || "0");
        return {
          id: acc.id,
          code: acc.code,
          name: acc.name,
          balance: openingBalance + bal.debits - bal.credits,
        };
      });

      const bankAccounts = banks.map(bank => {
        const bal = bankBalances.get(bank.id) || { debits: 0, credits: 0 };
        const openingBalance = parseFloat(bank.openingBalance || "0");
        return {
          id: bank.id,
          code: bank.accountNumber,
          name: bank.bankName,
          balance: openingBalance + bal.debits - bal.credits,
        };
      });

      const fixedAssetAccounts = assets.map(asset => {
        const bal = assetBalances.get(asset.id) || { debits: 0, credits: 0 };
        const purchaseValue = parseFloat(asset.purchaseValue || "0");
        return {
          id: asset.id,
          code: asset.assetCode,
          name: asset.assetName,
          balance: purchaseValue + bal.debits - bal.credits,
        };
      });

      const liabilityAccounts = ledgers.filter(l => l.accountType === "Liability").map(acc => {
        const bal = ledgerBalances.get(acc.id) || { debits: 0, credits: 0 };
        const openingBalance = parseFloat(acc.openingBalance || "0");
        return {
          id: acc.id,
          code: acc.code,
          name: acc.name,
          balance: openingBalance + bal.credits - bal.debits,
        };
      });

      const supplierAccounts = suppliers.map(supplier => {
        const bal = supplierBalances.get(supplier.id) || { debits: 0, credits: 0 };
        return {
          id: supplier.id,
          code: supplier.code,
          name: supplier.name,
          balance: bal.credits - bal.debits,
        };
      }).filter(s => s.balance !== 0);

      const equityAccounts = ledgers.filter(l => l.accountType === "Equity").map(acc => {
        const bal = ledgerBalances.get(acc.id) || { debits: 0, credits: 0 };
        const openingBalance = parseFloat(acc.openingBalance || "0");
        return {
          id: acc.id,
          code: acc.code,
          name: acc.name,
          balance: openingBalance + bal.credits - bal.debits,
        };
      });

      const totalAssets = [...assetAccounts, ...bankAccounts, ...fixedAssetAccounts]
        .reduce((sum, item) => sum + item.balance, 0);
      
      const totalLiabilities = [...liabilityAccounts, ...supplierAccounts]
        .reduce((sum, item) => sum + item.balance, 0);
      
      const totalEquity = equityAccounts.reduce((sum, item) => sum + item.balance, 0);

      res.json({
        assets: {
          ledgers: assetAccounts.filter(a => a.balance !== 0),
          banks: bankAccounts.filter(b => b.balance !== 0),
          fixedAssets: fixedAssetAccounts.filter(f => f.balance !== 0),
          total: totalAssets,
        },
        liabilities: {
          ledgers: liabilityAccounts.filter(l => l.balance !== 0),
          suppliers: supplierAccounts,
          total: totalLiabilities,
        },
        equity: {
          accounts: equityAccounts.filter(e => e.balance !== 0),
          total: totalEquity,
        },
        asOfDate: asOfDate || null,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Sales Report
  app.get("/api/reports/sales", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate, locationId, stockGroupId } = req.query;

      const conditions = [eq(vouchers.companyId, companyId)];

      if (startDate) {
        conditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
      }
      if (endDate) {
        conditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
      }
      if (locationId) {
        conditions.push(eq(vouchers.locationId, parseInt(locationId as string)));
      }

      let salesQuery = db
        .select({
          id: salesItems.id,
          voucherNumber: vouchers.voucherNumber,
          voucherDate: vouchers.voucherDate,
          locationName: locations.name,
          stockItemCode: stockItems.code,
          stockItemName: stockItems.name,
          stockGroupId: stockItems.stockGroupId,
          quantity: salesItems.quantity,
          sellingPrice: salesItems.sellingPrice,
          costPrice: salesItems.costPrice,
          totalSales: salesItems.totalSales,
          totalCost: salesItems.totalCost,
          profit: salesItems.profit,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .innerJoin(stockItems, eq(salesItems.stockItemId, stockItems.id))
        .leftJoin(locations, eq(vouchers.locationId, locations.id))
        .where(and(...conditions))
        .orderBy(vouchers.voucherDate);

      let salesData = await salesQuery.execute();

      // Filter by stock group if provided
      if (stockGroupId) {
        salesData = salesData.filter(s => s.stockGroupId === parseInt(stockGroupId as string));
      }

      const totalQuantity = salesData.reduce((sum, item) => sum + parseFloat(item.quantity), 0);
      const totalSales = salesData.reduce((sum, item) => sum + parseFloat(item.totalSales), 0);
      const totalCost = salesData.reduce((sum, item) => sum + parseFloat(item.totalCost), 0);
      const totalProfit = salesData.reduce((sum, item) => sum + parseFloat(item.profit), 0);

      res.json({
        items: salesData,
        summary: {
          totalQuantity,
          totalSales,
          totalCost,
          totalProfit,
          grossProfitMargin: totalSales > 0 ? (totalProfit / totalSales * 100) : 0,
        },
        filters: {
          startDate: startDate || null,
          endDate: endDate || null,
          locationId: locationId || null,
          stockGroupId: stockGroupId || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Movement Report
  app.get("/api/reports/stock-movement", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate, locationId, stockGroupId } = req.query;

      // Get all stock items for this company
      const allStockItems = await storage.getAllStockItems(companyId);
      
      // Filter by stock group if provided
      const stockItemsToReport = stockGroupId 
        ? allStockItems.filter(item => item.stockGroupId === parseInt(stockGroupId as string))
        : allStockItems;

      // Get all inventory records
      let inventoryQuery = db
        .select({
          stockItemId: inventory.stockItemId,
          locationId: inventory.locationId,
          locationName: locations.name,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
          totalValue: inventory.totalValue,
        })
        .from(inventory)
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .where(eq(locations.companyId, companyId));

      if (locationId) {
        inventoryQuery = inventoryQuery.where(and(
          eq(locations.companyId, companyId),
          eq(inventory.locationId, parseInt(locationId as string))
        ));
      }

      const inventoryRecords = await inventoryQuery.execute();

      // Build movement report
      const movementData = stockItemsToReport.map(item => {
        const itemInventory = inventoryRecords.filter(inv => inv.stockItemId === item.id);
        const totalQuantity = itemInventory.reduce((sum, inv) => sum + parseFloat(inv.quantity), 0);
        const totalValue = itemInventory.reduce((sum, inv) => sum + parseFloat(inv.totalValue), 0);

        return {
          stockItemId: item.id,
          stockItemCode: item.code,
          stockItemName: item.name,
          locations: itemInventory.map(inv => ({
            locationId: inv.locationId,
            locationName: inv.locationName,
            quantity: parseFloat(inv.quantity),
            averageRate: parseFloat(inv.averageRate),
            totalValue: parseFloat(inv.totalValue),
          })),
          totalQuantity,
          totalValue,
        };
      }).filter(item => item.totalQuantity > 0);

      const grandTotalQuantity = movementData.reduce((sum, item) => sum + item.totalQuantity, 0);
      const grandTotalValue = movementData.reduce((sum, item) => sum + item.totalValue, 0);

      res.json({
        items: movementData,
        summary: {
          totalItems: movementData.length,
          grandTotalQuantity,
          grandTotalValue,
        },
        filters: {
          startDate: startDate || null,
          endDate: endDate || null,
          locationId: locationId || null,
          stockGroupId: stockGroupId || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Container Report
  app.get("/api/reports/containers", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { status, supplierId, startDate, endDate } = req.query;

      const conditions = [eq(containers.companyId, companyId)];

      if (status) {
        conditions.push(eq(containers.status, status as string));
      }
      if (supplierId) {
        conditions.push(eq(containers.supplierId, parseInt(supplierId as string)));
      }
      if (startDate) {
        conditions.push(sql`${containers.importDate} >= ${startDate}`);
      }
      if (endDate) {
        conditions.push(sql`${containers.importDate} <= ${endDate}`);
      }

      const containerData = await db
        .select({
          id: containers.id,
          containerNumber: containers.containerNumber,
          supplierName: suppliers.name,
          status: containers.status,
          importDate: containers.importDate,
          itemsTotal: containers.itemsTotal,
          chargesTotal: containers.chargesTotal,
          grandTotal: containers.grandTotal,
        })
        .from(containers)
        .innerJoin(suppliers, eq(containers.supplierId, suppliers.id))
        .where(and(...conditions))
        .orderBy(containers.importDate);

      const totalItemsTotal = containerData.reduce((sum, c) => sum + parseFloat(c.itemsTotal || "0"), 0);
      const totalChargesTotal = containerData.reduce((sum, c) => sum + parseFloat(c.chargesTotal || "0"), 0);
      const totalGrandTotal = containerData.reduce((sum, c) => sum + parseFloat(c.grandTotal || "0"), 0);

      res.json({
        containers: containerData,
        summary: {
          totalContainers: containerData.length,
          totalItemsTotal,
          totalChargesTotal,
          totalGrandTotal,
        },
        filters: {
          status: status || null,
          supplierId: supplierId || null,
          startDate: startDate || null,
          endDate: endDate || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Ratio Analysis Report
  app.get("/api/reports/ratios", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate } = req.query;

      // Get all ledger accounts
      const companyAccounts = await storage.getAllLedgerAccounts(companyId);
      
      const incomeAccountIds = companyAccounts.filter(acc => acc.accountType === "Income").map(acc => acc.id);
      const expenseAccountIds = companyAccounts.filter(acc => acc.accountType === "Expense").map(acc => acc.id);
      const assetAccountIds = companyAccounts.filter(acc => acc.accountType === "Asset").map(acc => acc.id);
      const liabilityAccountIds = companyAccounts.filter(acc => acc.accountType === "Liability").map(acc => acc.id);

      // Get vouchers with date filter
      const conditions = [eq(vouchers.companyId, companyId)];
      if (startDate) {
        conditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
      }
      if (endDate) {
        conditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
      }

      const companyVouchers = await db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(and(...conditions))
        .execute();
      
      const companyVoucherIds = companyVouchers.map(v => v.id);

      const companyEntries = companyVoucherIds.length > 0
        ? await db
            .select()
            .from(voucherEntries)
            .where(inArray(voucherEntries.voucherId, companyVoucherIds))
            .execute()
        : [];

      // Calculate totals
      let totalIncome = 0;
      let totalExpenses = 0;
      let totalAssets = 0;
      let totalLiabilities = 0;

      for (const entry of companyEntries) {
        const debit = parseFloat(entry.debitAmount || "0");
        const credit = parseFloat(entry.creditAmount || "0");

        if (entry.ledgerAccountId) {
          if (incomeAccountIds.includes(entry.ledgerAccountId)) {
            totalIncome += credit - debit;
          }
          if (expenseAccountIds.includes(entry.ledgerAccountId)) {
            totalExpenses += debit - credit;
          }
          if (assetAccountIds.includes(entry.ledgerAccountId)) {
            totalAssets += debit - credit;
          }
          if (liabilityAccountIds.includes(entry.ledgerAccountId)) {
            totalLiabilities += credit - debit;
          }
        }
      }

      // Get sales data for gross profit calculation
      const salesConditions = [eq(vouchers.companyId, companyId)];
      if (startDate) {
        salesConditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
      }
      if (endDate) {
        salesConditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
      }

      const salesData = await db
        .select({
          totalSales: salesItems.totalSales,
          totalCost: salesItems.totalCost,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(...salesConditions))
        .execute();

      const totalSales = salesData.reduce((sum, s) => sum + parseFloat(s.totalSales), 0);
      const totalCost = salesData.reduce((sum, s) => sum + parseFloat(s.totalCost), 0);
      const grossProfit = totalSales - totalCost;

      // Calculate ratios
      const netProfit = totalIncome - totalExpenses;
      const grossProfitMargin = totalSales > 0 ? (grossProfit / totalSales * 100) : 0;
      const netProfitMargin = totalIncome > 0 ? (netProfit / totalIncome * 100) : 0;
      const currentRatio = totalLiabilities > 0 ? totalAssets / totalLiabilities : 0;
      const debtToEquity = (totalAssets - totalLiabilities) > 0 ? totalLiabilities / (totalAssets - totalLiabilities) : 0;

      res.json({
        ratios: {
          grossProfitMargin,
          netProfitMargin,
          currentRatio,
          debtToEquity,
        },
        underlying: {
          totalIncome,
          totalExpenses,
          totalSales,
          totalCost,
          grossProfit,
          netProfit,
          totalAssets,
          totalLiabilities,
          totalEquity: totalAssets - totalLiabilities,
        },
        filters: {
          startDate: startDate || null,
          endDate: endDate || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
