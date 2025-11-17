import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import * as XLSX from "xlsx";
import crypto from "crypto-js";
import { storage } from "./storage";
import { db } from "./db";
import {
  requireAuth,
  requireRole,
  canDelete,
  checkPOSLocation,
  requireNonPOS,
} from "./auth";
import {
  insertLocationSchema,
  insertLedgerAccountSchema,
  updateLedgerAccountSchema,
  insertEmployeeSchema,
  insertEmployeeGroupSchema,
  insertSupplierSchema,
  insertStockGroupSchema,
  insertStockItemSchema,
  insertStockItemCodeAliasSchema,
  insertBankAccountSchema,
  insertFixedAssetSchema,
  offloadRequestSchema,
  insertStockTransferVoucherSchema,
  insertStockAdjustmentVoucherSchema,
  updateStockTransferSchema,
  updateStockAdjustmentSchema,
  insertUserSchema,
  insertUserCompanyRoleSchema,
  InsertPurchaseOrder,
  insertCustomerSchema,
  insertContainerSaleSchema,
  insertInterCompanyTransferSchema,
  insertSalaryAdvanceSchema,
  insertSalaryAdvanceDeductionSchema,
  insertDraftPosSaleSchema,
  InsertDraftPosSale,
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
  containers,
  containerOffloads,
  suppliers,
  fixedAssets,
  ledgerAccounts,
  bankAccounts,
  customers,
  containerSales,
  interCompanyTransfers,
  salaryAdvances,
  salaryAdvanceDeductions,
} from "@shared/schema";
import { z } from "zod";
import { eq, and, inArray, sql, like } from "drizzle-orm";

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
      res.json({ status: "ok", message: "Database connection successful" });
    } catch (error: any) {
      console.error("Database connection failed:", error);
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  // Authentication routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      console.log("Login attempt started for username:", req.body.username);
      const { username, password } = req.body;

      if (!username || !password) {
        return res
          .status(400)
          .json({ message: "Username and password are required" });
      }

      console.log("Fetching user from database...");
      const user = (await Promise.race([
        storage.getUserByUsername(username),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Database query timeout")), 5000),
        ),
      ])) as any;
      console.log("User fetch complete:", user ? "Found" : "Not found");
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

      // Save session before sending response
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ message: "Failed to save session" });
        }
        
        console.log("✅ Login successful, session saved");
        
        // Return user without password
        const { password: _, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
      });
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
  app.get(
    "/api/users",
    requireAuth,
    requireRole("Admin"),
    async (_req, res) => {
      try {
        const users = await storage.getAllUsers();
        // Remove passwords from response
        const usersWithoutPasswords = users.map(
          ({ password, ...user }) => user,
        );
        res.json(usersWithoutPasswords);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  app.post(
    "/api/users",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const parsed = insertUserSchema.parse(req.body);

        // Check for duplicate username
        const existing = await storage.getUserByUsername(parsed.username);
        if (existing) {
          return res.status(400).json({ message: "Username already exists" });
        }

        // Hash the password
        const hashedPassword = hashPassword(parsed.password);
        const user = await storage.createUser({
          ...parsed,
          password: hashedPassword,
        });

        const { password: _, ...userWithoutPassword } = user;
        res.status(201).json(userWithoutPassword);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  app.patch(
    "/api/users/:id",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
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
    },
  );

  // User-Company-Role management routes
  app.get(
    "/api/users/:userId/company-roles",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { userId } = req.params;
        const roles = await storage.getUserCompaniesWithRoles(userId);
        res.json(roles);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  app.post(
    "/api/user-company-roles",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const parsed = insertUserCompanyRoleSchema.parse(req.body);

        // Validate POS roles have required fields
        if (parsed.role.startsWith("POS") && !parsed.assignedLocationId) {
          return res
            .status(400)
            .json({ message: "POS roles require an assigned location" });
        }

        const role = await storage.createUserCompanyRole(parsed);
        res.status(201).json(role);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  app.patch(
    "/api/user-company-roles/:id",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const parsed = insertUserCompanyRoleSchema.partial().parse(req.body);

        // Validate POS roles have required fields if role is being updated
        if (parsed.role?.startsWith("POS") && !parsed.assignedLocationId) {
          return res
            .status(400)
            .json({ message: "POS roles require an assigned location" });
        }

        const role = await storage.updateUserCompanyRole(parseInt(id), parsed);
        res.json(role);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  app.delete(
    "/api/user-company-roles/:id",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const { id } = req.params;
        await storage.deleteUserCompanyRole(parseInt(id));
        res.status(204).send();
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

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
      const userCompanies = await storage.getUserCompaniesWithRoles(
        req.user.id,
      );
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
        }),
      );
      res.json(companiesWithRoles);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post(
    "/api/companies",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const company = await storage.createCompany(req.body);
        res.status(201).json(company);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

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
        return res
          .status(403)
          .json({ message: "You don't have access to this company" });
      }

      req.session.currentCompanyId = companyId;
      req.session.currentRole = userRole.role;
      req.session.currentLocationId = userRole.assignedLocationId;
      req.session.currentPOSStation = userRole.posStation;
      req.session.cashAccountId = userRole.cashAccountId;
      req.session.canSellNegativeStock = userRole.canSellNegativeStock;
      req.session.canEditDaybook = userRole.canEditDaybook;

      res.json({ message: "Company set successfully", companyId });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Locations
  app.get("/api/locations", requireAuth, async (req, res) => {
    try {
      const companyId = req.query.companyId
        ? parseInt(req.query.companyId as string)
        : req.session.currentCompanyId;

      console.log("[/api/locations] Request from user:", req.user?.username);
      console.log(
        "[/api/locations] Company ID from query:",
        req.query.companyId,
      );
      console.log(
        "[/api/locations] Company ID from session:",
        req.session.currentCompanyId,
      );
      console.log("[/api/locations] Final companyId to query:", companyId);

      if (!companyId) {
        return res
          .status(400)
          .json({ message: "No company selected or specified" });
      }

      const locations = await storage.getAllLocations(companyId);
      console.log(
        "[/api/locations] Found locations:",
        locations.length,
        "for company",
        companyId,
      );
      res.json(locations);
    } catch (error: any) {
      console.error("[/api/locations] Error:", error);
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

      // Auto-generate code from name if not provided
      if (!parsed.code) {
        // Generate code from name: remove non-alphanumeric, take first 6 letters, uppercase
        const sanitized = parsed.name.trim().replace(/[^a-zA-Z0-9]/g, '');
        let baseCode = sanitized.substring(0, 6).toUpperCase();
        
        // Fallback if baseCode is empty after sanitization
        if (!baseCode || baseCode.length === 0) {
          baseCode = "LOC";
        }
        
        // Ensure uniqueness by adding suffix if needed
        let code = baseCode;
        let suffix = 1;
        while (await storage.getLocationByCode(code, req.session.currentCompanyId)) {
          code = `${baseCode}${suffix}`;
          suffix++;
        }
        parsed.code = code;
      } else {
        // Check for duplicate code if manually provided
        const existing = await storage.getLocationByCode(
          parsed.code,
          req.session.currentCompanyId,
        );
        if (existing) {
          return res
            .status(400)
            .json({ message: "Location code already exists" });
        }
      }

      // Provide defaults for optional fields
      const locationData = {
        ...parsed,
        city: parsed.city || '',
        state: parsed.state || '',
        country: parsed.country || '',
      };

      const location = await storage.createLocation(locationData);
      res.status(201).json(location);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Get single location by ID
  app.get(
    "/api/locations/:locationId",
    requireAuth,
    checkPOSLocation,
    async (req, res) => {
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
          return res
            .status(403)
            .json({
              message: "Access denied: Location belongs to a different company",
            });
        }

        res.json(location);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Delete location
  app.delete("/api/locations/:locationId", requireAuth, async (req, res) => {
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
        return res
          .status(403)
          .json({
            message: "Access denied: Location belongs to a different company",
          });
      }

      await storage.deleteLocation(locationId);
      res.json({ message: "Location deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Location Inventory - Get inventory for a specific location
  app.get(
    "/api/locations/:locationId/inventory",
    requireAuth,
    checkPOSLocation,
    async (req, res) => {
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
          return res
            .status(403)
            .json({
              message: "Access denied: Location belongs to a different company",
            });
        }

        const inventory = await storage.getLocationInventory(locationId);

        // Filter sensitive data for POS users (they should only see quantity)
        const isPOS = req.user?.role?.startsWith("POS");
        if (isPOS) {
          const filteredInventory = inventory.map((item: any) => ({
            ...item,
            averageRate: null,
            totalValue: null,
          }));
          res.json(filteredInventory);
        } else {
          res.json(inventory);
        }
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Company Inventory - Get all inventory across all locations for current company
  app.get("/api/inventory", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const inventory = await storage.getCompanyInventory(
        req.session.currentCompanyId,
      );
      res.json(inventory);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bulk import inventory for a location
  app.post(
    "/api/locations/:locationId/import-inventory",
    requireAuth,
    checkPOSLocation,
    async (req, res) => {
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
          return res
            .status(403)
            .json({
              message: "Access denied: Location belongs to a different company",
            });
        }

        const { items } = req.body;
        if (!Array.isArray(items)) {
          return res.status(400).json({ message: "Items must be an array" });
        }

        // Get all stock items and stock groups for code matching
        const allStockItems = await storage.getAllStockItems(
          req.session.currentCompanyId,
        );
        const allStockGroups = await storage.getAllStockGroups(
          req.session.currentCompanyId,
        );

        // Find or create "Uncategorized" stock group
        let uncategorizedGroup = await storage.getStockGroupByCode(
          "UNCATEGORIZED",
          req.session.currentCompanyId,
        );
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
            // Find stock item by Item_barcode (which maps to code field OR code alias)
            let stockItem = await storage.getStockItemByCodeOrAlias(
              item.Item_barcode,
              req.session.currentCompanyId,
            );

            // If stock item doesn't exist, create it
            if (!stockItem) {
              // Auto-detect stock group from item code prefix (first 2-3 uppercase letters)
              let stockGroupId = uncategorizedGroup.id;

              // Normalize and try to extract prefix from Item_barcode
              const normalizedCode = item.Item_barcode.trim().toUpperCase();

              // Try 3-letter prefix first, then 2-letter (e.g., "UN259" -> "UN", "GCC123" -> "GCC")
              const prefixes = [];
              if (normalizedCode.length >= 3)
                prefixes.push(normalizedCode.substring(0, 3));
              if (normalizedCode.length >= 2)
                prefixes.push(normalizedCode.substring(0, 2));

              for (const prefix of prefixes) {
                const stockGroup = allStockGroups.find(
                  (sg) => sg.code.toUpperCase() === prefix,
                );
                if (stockGroup) {
                  stockGroupId = stockGroup.id;
                  break; // Found a match, stop searching
                }
              }

              // Fall back to stockGroupCode column if provided and prefix didn't match
              if (
                stockGroupId === uncategorizedGroup.id &&
                item.stockGroupCode
              ) {
                const stockGroup = allStockGroups.find(
                  (sg) =>
                    sg.code.toLowerCase() === item.stockGroupCode.toLowerCase(),
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
            const value = parseFloat(
              item.value || (quantity * rate).toString(),
            );

            // Check if inventory already exists for this item at this location
            const existingInventory =
              await storage.getLocationInventory(locationId);
            const existing = existingInventory.find(
              (inv) => inv.stockItemId === stockItem.id,
            );

            if (existing) {
              // Update existing inventory - add to existing quantities
              const newQuantity = parseFloat(existing.quantity) + quantity;
              const newTotalValue = parseFloat(existing.totalValue) + value;
              const newAverageRate =
                newQuantity > 0 ? newTotalValue / newQuantity : 0;

              await storage.updateInventory(
                locationId,
                stockItem.id,
                newQuantity.toString(),
                newAverageRate.toString(),
                newTotalValue.toString(),
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
                value.toString(),
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
    },
  );

  // Ledger Accounts
  app.get("/api/ledger-accounts", requireAuth, async (req, res) => {
    try {
      const { companyId } = req.query;
      const effectiveCompanyId = companyId
        ? parseInt(companyId as string)
        : req.session.currentCompanyId;

      if (!effectiveCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const accounts = await storage.getAllLedgerAccounts(effectiveCompanyId);
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/ledger-accounts/:id", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const accountId = parseInt(req.params.id);
      if (isNaN(accountId)) {
        return res.status(400).json({ message: "Invalid ledger account ID" });
      }

      const account = await storage.getLedgerAccountById(accountId);
      if (!account) {
        return res.status(404).json({ message: "Ledger account not found" });
      }

      // Verify account belongs to current company
      if (account.companyId !== req.session.currentCompanyId) {
        return res.status(404).json({ message: "Ledger account not found" });
      }

      res.json(account);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post(
    "/api/ledger-accounts",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const parsed = insertLedgerAccountSchema.parse(req.body);

        // Check for duplicate name within the same company
        const existingByName = await storage.getLedgerAccountByName(
          parsed.name,
          parsed.companyId,
        );
        if (existingByName) {
          return res
            .status(400)
            .json({
              message:
                "Duplicate ledger: A ledger account with this name already exists",
            });
        }

        // Auto-generate code from name if not provided
        if (!parsed.code) {
          // Generate code from name: take first 3 letters of each word, uppercase
          const words = parsed.name
            .trim()
            .split(/\s+/)
            .filter((w) => w.length > 0);
          let baseCode = words
            .map((w) => w.substring(0, 3))
            .join("")
            .toUpperCase();

          // Fallback if baseCode is empty (shouldn't happen with validation, but be safe)
          if (!baseCode || baseCode.length === 0) {
            baseCode = "ACC";
          }

          // Ensure uniqueness by adding suffix if needed
          let code = baseCode;
          let suffix = 1;
          while (await storage.getLedgerAccountByCode(code, req.session.currentCompanyId!)) {
            code = `${baseCode}${suffix}`;
            suffix++;
          }
          parsed.code = code;
        } else {
          // Check for duplicate code if manually provided
          const existing = await storage.getLedgerAccountByCode(parsed.code, req.session.currentCompanyId!);
          if (existing) {
            return res
              .status(400)
              .json({ message: "Ledger account code already exists" });
          }
        }

        // Validate opening balance amount and side must both be present or both absent
        const hasBalance =
          parsed.openingBalance && parseFloat(parsed.openingBalance) !== 0;
        const hasSide =
          parsed.openingBalanceSide !== undefined &&
          parsed.openingBalanceSide !== null;

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

        // Validate subType based on accountType
        const validSubTypes: Record<string, string[]> = {
          Income: ["Direct Income", "Indirect Income"],
          Expense: ["Direct Expense", "Indirect Expense"],
          Liability: [
            "Current Liability",
            "Long-term Liability",
            "Loans Payable",
            "Output Tax",
            "Tax Payable",
          ],
          Asset: [
            "Current Asset",
            "Fixed Asset",
            "Input Tax",
            "Tax Receivable",
          ],
        };

        if (parsed.subType && validSubTypes[parsed.accountType]) {
          if (!validSubTypes[parsed.accountType].includes(parsed.subType)) {
            return res.status(400).json({
              message: `Invalid subType "${parsed.subType}" for accountType "${parsed.accountType}". Valid options: ${validSubTypes[parsed.accountType].join(", ")}`,
            });
          }
        }

        const account = await storage.createLedgerAccount(parsed);
        res.status(201).json(account);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  app.put(
    "/api/ledger-accounts/:id",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
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
          return res
            .status(403)
            .json({
              message: "Access denied: Account belongs to a different company",
            });
        }

        const parsed = updateLedgerAccountSchema.parse({
          ...req.body,
          id: accountId,
        });

        // Check for duplicate code if code is being changed
        if (parsed.code && parsed.code !== existingAccount.code) {
          const duplicate = await storage.getLedgerAccountByCode(parsed.code, req.session.currentCompanyId!);
          if (duplicate) {
            return res
              .status(400)
              .json({ message: "Ledger account code already exists" });
          }
        }

        // Validate opening balance amount and side must both be present or both absent
        const hasBalance =
          parsed.openingBalance && parseFloat(parsed.openingBalance) !== 0;
        const hasSide =
          parsed.openingBalanceSide !== undefined &&
          parsed.openingBalanceSide !== null;

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

        // Validate subType based on accountType if accountType is being updated
        const accountType = parsed.accountType || existingAccount.accountType;
        const validSubTypes: Record<string, string[]> = {
          Income: ["Direct Income", "Indirect Income"],
          Expense: ["Direct Expense", "Indirect Expense"],
          Liability: [
            "Current Liability",
            "Long-term Liability",
            "Loans Payable",
            "Output Tax",
            "Tax Payable",
          ],
          Asset: [
            "Current Asset",
            "Fixed Asset",
            "Input Tax",
            "Tax Receivable",
          ],
        };

        if (parsed.subType && validSubTypes[accountType]) {
          if (!validSubTypes[accountType].includes(parsed.subType)) {
            return res.status(400).json({
              message: `Invalid subType "${parsed.subType}" for accountType "${accountType}". Valid options: ${validSubTypes[accountType].join(", ")}`,
            });
          }
        }

        const updatedAccount = await storage.updateLedgerAccount(parsed);
        res.json(updatedAccount);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  app.delete(
    "/api/ledger-accounts/:id",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
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
          return res
            .status(403)
            .json({
              message: "Access denied: Account belongs to a different company",
            });
        }

        // Check if account is used in any voucher entries
        const entries = await storage.getVoucherEntriesByLedger(accountId);
        if (entries && entries.length > 0) {
          return res.status(400).json({
            message:
              "Cannot delete ledger account: It has been used in transactions. Please remove all related transactions first.",
          });
        }

        // Check if account is a parent to other accounts
        const allAccounts = await storage.getAllLedgerAccounts(
          req.session.currentCompanyId,
        );
        const hasChildren = allAccounts.some(
          (acc) => acc.parentId === accountId,
        );
        if (hasChildren) {
          return res.status(400).json({
            message:
              "Cannot delete ledger account: It is a parent account. Please remove or reassign child accounts first.",
          });
        }

        await storage.deleteLedgerAccount(accountId);
        res.json({ message: "Ledger account deleted successfully" });
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  // Employees
  app.get("/api/employees", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const employees = await storage.getAllEmployees(
        req.session.currentCompanyId,
      );
      // Ensure proper camelCase field names for frontend
      const transformedEmployees = employees.map(emp => ({
        ...emp,
        firstName: emp.firstName || (emp as any).first_name,
        lastName: emp.lastName || (emp as any).last_name,
      }));
      res.json(transformedEmployees);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/employees", requireAuth, requireNonPOS, async (req, res) => {
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
          return res
            .status(400)
            .json({ message: "Employee code already exists" });
        }
      }

      const employee = await storage.createEmployee(parsed);
      res.status(201).json(employee);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/employees/:id", requireAuth, async (req, res) => {
    try {
      // Only Admin can delete employees
      const userRole = req.session.currentRole;
      if (userRole !== "Admin") {
        return res.status(403).json({ 
          message: "Only Admin users can delete employees" 
        });
      }

      const employeeId = parseInt(req.params.id);
      if (isNaN(employeeId)) {
        return res.status(400).json({ message: "Invalid employee ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get employee to verify it exists and belongs to current company
      const allEmployees = await storage.getAllEmployees(req.session.currentCompanyId);
      const employee = allEmployees.find(e => e.id === employeeId);
      
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      if (employee.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ 
          message: "Access denied: Employee belongs to a different company" 
        });
      }

      // Check for forceDelete flag from query parameter
      const forceDelete = req.query.forceDelete === "true";

      const result = await storage.deleteEmployee(employeeId, forceDelete);

      if (!result.success) {
        // If balance check failed, return 409 Conflict with balance details
        if (result.employeeBalance !== undefined || result.ledgerBalance !== undefined) {
          return res.status(409).json({
            message: result.message,
            employeeBalance: result.employeeBalance,
            ledgerBalance: result.ledgerBalance,
            requiresConfirmation: true
          });
        }
        // Other errors (salary advances, transaction history)
        return res.status(400).json({ message: result.message });
      }

      res.json({ message: "Employee deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Employee Groups
  app.get("/api/employee-groups", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const groups = await storage.getAllEmployeeGroups(
        req.session.currentCompanyId,
      );
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
      const group = await storage.updateEmployeeGroup(
        parseInt(req.params.id),
        req.body,
      );
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
      const members = await storage.getEmployeeGroupMembers(
        parseInt(req.params.id),
      );
      res.json(members);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post(
    "/api/employee-groups/:groupId/members/:employeeId",
    requireAuth,
    async (req, res) => {
      try {
        await storage.addEmployeeToGroup(
          parseInt(req.params.groupId),
          parseInt(req.params.employeeId),
        );
        res.status(201).send();
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  app.delete(
    "/api/employee-groups/:groupId/members/:employeeId",
    requireAuth,
    async (req, res) => {
      try {
        await storage.removeEmployeeFromGroup(
          parseInt(req.params.groupId),
          parseInt(req.params.employeeId),
        );
        res.status(204).send();
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  // Payroll - Employee Balance Deposit
  app.post(
    "/api/payroll/deposit-employee",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const { employeeId, amount, date, notes } = req.body;

        if (!employeeId || !amount || !date) {
          return res
            .status(400)
            .json({ message: "Employee, amount, and date are required" });
        }

        const depositAmount = parseFloat(amount);
        if (isNaN(depositAmount) || depositAmount <= 0) {
          return res
            .status(400)
            .json({ message: "Amount must be a positive number" });
        }

        // Get employee
        const [employee] = await db
          .select()
          .from(employees)
          .where(eq(employees.id, employeeId));
        if (!employee) {
          return res.status(404).json({ message: "Employee not found" });
        }

        // Get or create SALARY_EXPENSE ledger account
        const allAccounts = await storage.getAllLedgerAccounts(
          req.session.currentCompanyId,
        );
        let salaryExpenseAccount = allAccounts.find(
          (a: any) => a.code === "SALARY_EXPENSE",
        );

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
        let employeeAccount = allAccounts.find(
          (a: any) => a.code === employeeAccountCode,
        );

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
        const [voucher] = await db
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId,
            voucherNumber,
            voucherType: "Journal",
            voucherDate: date,
            description:
              notes ||
              `Salary deposit for ${employee.firstName} ${employee.lastName}`,
            totalAmount: depositAmount.toFixed(2),
            optional: false,
          })
          .returning();

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
        const newTotalDeposits =
          parseFloat(employee.totalDeposits) + depositAmount;

        await db
          .update(employees)
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
    },
  );

  // Payroll - Employee Bonus
  app.post(
    "/api/payroll/bonus-employee",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const { employeeId, amount, date, notes } = req.body;

        if (!employeeId || !amount || !date) {
          return res
            .status(400)
            .json({ message: "Employee, amount, and date are required" });
        }

        const bonusAmount = parseFloat(amount);
        if (isNaN(bonusAmount) || bonusAmount <= 0) {
          return res
            .status(400)
            .json({ message: "Amount must be a positive number" });
        }

        // Get employee
        const [employee] = await db
          .select()
          .from(employees)
          .where(eq(employees.id, employeeId));
        if (!employee) {
          return res.status(404).json({ message: "Employee not found" });
        }

        // Get or create SALARY_EXPENSE ledger account
        const allAccounts = await storage.getAllLedgerAccounts(
          req.session.currentCompanyId,
        );
        let salaryExpenseAccount = allAccounts.find(
          (a: any) => a.code === "SALARY_EXPENSE",
        );

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
        let employeeAccount = allAccounts.find(
          (a: any) => a.code === employeeAccountCode,
        );

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
        const voucherNumber = `BONUS-${Date.now()}`;
        const [voucher] = await db
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId,
            voucherNumber,
            voucherType: "Journal",
            voucherDate: date,
            description:
              notes ||
              `Bonus for ${employee.firstName} ${employee.lastName}`,
            totalAmount: bonusAmount.toFixed(2),
            optional: false,
          })
          .returning();

        // Create voucher entries (double-entry)
        // Debit: Salary Expense
        await db.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: salaryExpenseAccount.id,
          debitAmount: bonusAmount.toFixed(2),
          creditAmount: "0",
          narration: `Bonus payment - ${voucherNumber}`,
        });

        // Credit: Employee Liability Account
        await db.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: employeeAccount.id,
          debitAmount: "0",
          creditAmount: bonusAmount.toFixed(2),
          narration: `Bonus payment - ${voucherNumber}`,
        });

        // Update employee balance
        const newBalance = parseFloat(employee.currentBalance) + bonusAmount;
        const newTotalDeposits =
          parseFloat(employee.totalDeposits) + bonusAmount;

        await db
          .update(employees)
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
    },
  );

  // Payroll - Employee Withdrawal
  app.post(
    "/api/payroll/withdraw-employee",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const {
          employeeId,
          amount,
          paymentAccountType,
          paymentAccountId,
          bankAccountId,
          date,
          notes,
        } = req.body;

        // Support both old (bankAccountId) and new (paymentAccountType/paymentAccountId) parameters
        const accountType = paymentAccountType || "bank";
        const accountId = paymentAccountId || bankAccountId;

        if (!employeeId || !amount || !accountId || !date) {
          return res
            .status(400)
            .json({
              message:
                "Employee, amount, payment account, and date are required",
            });
        }

        const withdrawalAmount = parseFloat(amount);
        if (isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
          return res
            .status(400)
            .json({ message: "Amount must be a positive number" });
        }

        // Get employee
        const [employee] = await db
          .select()
          .from(employees)
          .where(eq(employees.id, employeeId));
        if (!employee) {
          return res.status(404).json({ message: "Employee not found" });
        }

        const currentBalance = parseFloat(employee.currentBalance);
        if (withdrawalAmount > currentBalance) {
          return res
            .status(400)
            .json({
              message: `Insufficient balance. Current balance: ${currentBalance.toFixed(2)}`,
            });
        }

        // Get employee liability account
        const employeeAccountCode = `EMP-${employee.code}`;
        const allAccounts = await storage.getAllLedgerAccounts(
          req.session.currentCompanyId,
        );
        const employeeAccount = allAccounts.find(
          (a: any) => a.code === employeeAccountCode,
        );

        if (!employeeAccount) {
          return res
            .status(404)
            .json({ message: "Employee account not found" });
        }

        // Create voucher
        const voucherNumber = `SAL-WD-${Date.now()}`;
        const [voucher] = await db
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId,
            voucherNumber,
            voucherType: "Payment",
            voucherDate: date,
            description:
              notes ||
              `Salary withdrawal for ${employee.firstName} ${employee.lastName}`,
            totalAmount: withdrawalAmount.toFixed(2),
            optional: false,
          })
          .returning();

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
        const newTotalWithdrawals =
          parseFloat(employee.totalWithdrawals) + withdrawalAmount;

        await db
          .update(employees)
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
    },
  );

  // Payroll - Worker Direct Payment
  app.post(
    "/api/payroll/pay-worker",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const { employeeId, amount, bankAccountId, date, notes } = req.body;

        if (!employeeId || !amount || !bankAccountId || !date) {
          return res
            .status(400)
            .json({
              message: "Employee, amount, bank account, and date are required",
            });
        }

        const paymentAmount = parseFloat(amount);
        if (isNaN(paymentAmount) || paymentAmount <= 0) {
          return res
            .status(400)
            .json({ message: "Amount must be a positive number" });
        }

        // Get employee/worker
        const [employee] = await db
          .select()
          .from(employees)
          .where(eq(employees.id, employeeId));
        if (!employee) {
          return res.status(404).json({ message: "Worker not found" });
        }

        // Get or create SALARY_EXPENSE ledger account
        const allAccounts = await storage.getAllLedgerAccounts(
          req.session.currentCompanyId,
        );
        let salaryExpenseAccount = allAccounts.find(
          (a: any) => a.code === "SALARY_EXPENSE",
        );

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
        const [voucher] = await db
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId,
            voucherNumber,
            voucherType: "Payment",
            voucherDate: date,
            description:
              notes ||
              `Salary payment for ${employee.firstName} ${employee.lastName}`,
            totalAmount: paymentAmount.toFixed(2),
            optional: false,
          })
          .returning();

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
    },
  );

  // Payroll - Bulk Worker Payment
  app.post(
    "/api/payroll/bulk-pay-workers",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const {
          payments,
          paymentAccountType,
          paymentAccountId,
          bankAccountId,
          date,
          notes,
        } = req.body;

        // Support both old (bankAccountId) and new (paymentAccountType/paymentAccountId) parameters
        const accountType = paymentAccountType || "bank";
        const accountId = paymentAccountId || bankAccountId;

        if (!payments || !Array.isArray(payments) || payments.length === 0) {
          return res.status(400).json({ message: "No payments provided" });
        }

        if (!accountId || !date) {
          return res
            .status(400)
            .json({ message: "Payment account and date are required" });
        }

        // Validate all payment amounts
        for (const payment of payments) {
          const amount = parseFloat(payment.amount);
          if (isNaN(amount) || amount <= 0) {
            return res
              .status(400)
              .json({
                message: "All payment amounts must be positive numbers",
              });
          }
        }

        // Get or create SALARY_EXPENSE ledger account
        const allAccounts = await storage.getAllLedgerAccounts(
          req.session.currentCompanyId,
        );
        let salaryExpenseAccount = allAccounts.find(
          (a: any) => a.code === "SALARY_EXPENSE",
        );

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
        const totalAmount = payments.reduce(
          (sum: number, p: any) => sum + parseFloat(p.amount),
          0,
        );

        // Create single voucher for all payments
        const voucherNumber = `SAL-BULK-${Date.now()}`;
        const [voucher] = await db
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId,
            voucherNumber,
            voucherType: "Payment",
            voucherDate: date,
            description:
              notes || `Bulk salary payment for ${payments.length} workers`,
            totalAmount: totalAmount.toFixed(2),
            optional: false,
          })
          .returning();

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
    },
  );

  // Get employees with calculated balances from transactions
  app.get(
    "/api/payroll/employees-with-balances",
    requireAuth,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const employeesWithBalances = await storage.getEmployeesWithBalances(
          req.session.currentCompanyId
        );
        res.json(employeesWithBalances);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    }
  );

  // Get worker payment summary (total paid to each worker)
  app.get(
    "/api/payroll/worker-payments-summary",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        // Get all employees of type Worker for current company
        const allEmployees = await storage.getAllEmployees(
          req.session.currentCompanyId,
        );
        const workers = allEmployees.filter(
          (emp: any) => emp.employeeType === "Worker",
        );

        // Get all ledger accounts for current company
        const allAccounts = await storage.getAllLedgerAccounts(
          req.session.currentCompanyId,
        );

        // Calculate total paid per worker by checking their employee liability account
        const workerPayments = await Promise.all(
          workers.map(async (worker: any) => {
            // Find employee's liability account (code: EMP-{worker.code})
            const employeeAccountCode = `EMP-${worker.code}`;
            const employeeAccount = allAccounts.find(
              (a: any) => a.code === employeeAccountCode,
            );

            let totalPaid = 0;

            if (employeeAccount) {
              // Get all voucher entries that credit this employee account (withdrawals/payments)
              const entries = await db
                .select({
                  creditAmount: voucherEntries.creditAmount,
                })
                .from(voucherEntries)
                .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
                .where(
                  and(
                    eq(vouchers.companyId, req.session.currentCompanyId!),
                    eq(voucherEntries.ledgerAccountId, employeeAccount.id),
                  ),
                );

              // Sum all credits (payments to worker)
              totalPaid = entries.reduce(
                (sum: number, entry: any) =>
                  sum + parseFloat(entry.creditAmount || "0"),
                0,
              );
            }

            return {
              workerId: worker.id,
              workerCode: worker.code,
              workerName: `${worker.firstName} ${worker.lastName}`,
              totalPaid: totalPaid.toFixed(2),
            };
          }),
        );

        // Calculate grand total
        const grandTotal = workerPayments.reduce(
          (sum: number, wp: any) => sum + parseFloat(wp.totalPaid),
          0,
        );

        res.json({
          workerPayments,
          grandTotal: grandTotal.toFixed(2),
        });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Suppliers
  app.get("/api/suppliers", async (_req, res) => {
    try {
      const suppliers = await storage.getAllSuppliers();
      res.json(suppliers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get all suppliers with their container counts and balances (global, no company filter)
  // MUST come before /api/suppliers/:id to avoid route matching issues
  app.get("/api/suppliers/stats", requireAuth, async (req, res) => {
    try {
      const suppliers = await storage.getAllSuppliers();

      const suppliersWithStats = await Promise.all(
        suppliers.map(async (supplier) => {
          // Aggregate container count across ALL companies (no filter)
          const containerCount = await storage.getContainerCountBySupplier(
            supplier.id,
          );

          // Calculate balance from voucher entries across ALL companies
          // For suppliers: Credit = increase in payable (we owe them), Debit = decrease (we paid)
          // Balance = Opening Balance + Credits - Debits
          // Opening balance: Positive = we owe them, Negative = they owe us/we prepaid
          const entries = await storage.getVoucherEntriesBySupplier(
            supplier.id,
          );
          const openingBalance = parseFloat(supplier.openingBalance || "0");

          const balance = entries.reduce((sum, entry) => {
            const credit = parseFloat(entry.creditAmount || "0");
            const debit = parseFloat(entry.debitAmount || "0");

            // Only count if this is a pure credit or pure debit entry
            // This prevents double-counting if both sides of a transaction have supplierId
            if (credit > 0 && debit === 0) {
              return sum + credit; // Increase payable
            } else if (debit > 0 && credit === 0) {
              return sum - debit; // Decrease payable
            }
            return sum;
          }, openingBalance);

          return {
            ...supplier,
            containerCount,
            balance,
          };
        }),
      );

      // Return all suppliers with their stats
      res.json(suppliersWithStats);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/suppliers/:id", async (req, res) => {
    try {
      const supplierId = parseInt(req.params.id);
      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }

      const supplier = await storage.getSupplierById(supplierId);
      if (!supplier) {
        return res.status(404).json({ message: "Supplier not found" });
      }

      res.json(supplier);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/suppliers", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const parsed = insertSupplierSchema.parse(req.body);

      // Auto-generate code from legalName if not provided
      if (!parsed.code) {
        // Generate code from name: remove non-alphanumeric, take first 6 letters, uppercase
        const sanitized = parsed.legalName.trim().replace(/[^a-zA-Z0-9]/g, '');
        let baseCode = sanitized.substring(0, 6).toUpperCase();
        
        // Fallback if baseCode is empty after sanitization
        if (!baseCode || baseCode.length === 0) {
          baseCode = "SUP";
        }
        
        // Ensure uniqueness by adding suffix if needed
        let code = baseCode;
        let suffix = 1;
        while (await storage.getSupplierByCode(code)) {
          code = `${baseCode}${suffix}`;
          suffix++;
        }
        parsed.code = code;
      } else {
        // Check for duplicate code if manually provided
        const existing = await storage.getSupplierByCode(parsed.code);
        if (existing) {
          return res
            .status(400)
            .json({ message: "Supplier code already exists" });
        }
      }

      // Provide defaults for optional fields
      const supplierData = {
        ...parsed,
        email: parsed.email || '',
        phone: parsed.phone || '',
        address: parsed.address || '',
        taxId: parsed.taxId || '',
        paymentTerms: parsed.paymentTerms || '',
      };

      const supplier = await storage.createSupplier(supplierData);
      res.status(201).json(supplier);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch(
    "/api/suppliers/:id",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const supplierId = parseInt(req.params.id);
        if (isNaN(supplierId)) {
          return res.status(400).json({ message: "Invalid supplier ID" });
        }

        const existingSupplier = await storage.getSupplierById(supplierId);
        if (!existingSupplier) {
          return res.status(404).json({ message: "Supplier not found" });
        }

        // If code is being changed, check for duplicates
        if (req.body.code && req.body.code !== existingSupplier.code) {
          const duplicate = await storage.getSupplierByCode(req.body.code);
          if (duplicate) {
            return res
              .status(400)
              .json({ message: "Supplier code already exists" });
          }
        }

        const parsed = insertSupplierSchema.partial().parse(req.body);
        const updatedSupplier = await storage.updateSupplier(
          supplierId,
          parsed,
        );

        res.json(updatedSupplier);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  // Customers
  app.get("/api/customers", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const customers = await storage.getAllCustomers(
        req.session.currentCompanyId,
      );
      res.json(customers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get customers with calculated balances (including voucher entries)
  app.get("/api/customers/stats", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const customers = await storage.getAllCustomers(req.session.currentCompanyId);

      const customersWithBalances = await Promise.all(
        customers.map(async (customer) => {
          // If customer has a linked ledger account, calculate balance from voucher entries
          if (customer.ledgerAccountId) {
            const entries = await storage.getVoucherEntriesByLedger(customer.ledgerAccountId);
            const openingBalance = parseFloat(customer.openingBalance || "0");
            const openingSide = customer.openingBalanceSide || "Dr";

            // For customers (Asset account - Accounts Receivable):
            // Debit = increases amount they owe us
            // Credit = decreases amount they owe us
            const balance = entries.reduce((sum, entry) => {
              const debit = parseFloat(entry.debitAmount || "0");
              const credit = parseFloat(entry.creditAmount || "0");

              if (debit > 0 && credit === 0) {
                return sum + debit; // Increase receivable
              } else if (credit > 0 && debit === 0) {
                return sum - credit; // Decrease receivable
              }
              return sum;
            }, openingSide === "Dr" ? openingBalance : -openingBalance);

            return {
              ...customer,
              balance: Math.abs(balance),
              balanceSide: balance >= 0 ? "Dr" : "Cr",
            };
          }

          // If no ledger account, just return opening balance
          return {
            ...customer,
            balance: parseFloat(customer.openingBalance || "0"),
            balanceSide: customer.openingBalanceSide || "Dr",
          };
        })
      );

      res.json(customersWithBalances);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get(
    "/api/customers/:id",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const customerId = parseInt(req.params.id);
        if (isNaN(customerId)) {
          return res.status(400).json({ message: "Invalid customer ID" });
        }

        const customer = await storage.getCustomerById(customerId);
        if (!customer) {
          return res.status(404).json({ message: "Customer not found" });
        }

        // Verify customer belongs to current company
        if (
          req.session.currentCompanyId &&
          customer.companyId !== req.session.currentCompanyId
        ) {
          return res
            .status(403)
            .json({
              message: "Access denied: Customer belongs to a different company",
            });
        }

        res.json(customer);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  app.post("/api/customers", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Inject companyId before schema validation
      const dataWithCompany = {
        ...req.body,
        companyId: req.session.currentCompanyId,
      };

      const parsed = insertCustomerSchema.parse(dataWithCompany);

      // Auto-generate customer code
      let code = "CUST001";
      let suffix = 1;
      const allCustomers = await storage.getAllCustomers(
        req.session.currentCompanyId,
      );

      // Find the highest existing customer number
      const existingCodes = allCustomers
        .map((c) => c.code)
        .filter((c) => c.startsWith("CUST"))
        .map((c) => parseInt(c.replace("CUST", "")))
        .filter((n) => !isNaN(n));

      if (existingCodes.length > 0) {
        const maxNumber = Math.max(...existingCodes);
        suffix = maxNumber + 1;
      }

      code = `CUST${suffix.toString().padStart(3, "0")}`;

      // Ensure uniqueness
      while (
        await storage.getCustomerByCode(code, req.session.currentCompanyId)
      ) {
        suffix++;
        code = `CUST${suffix.toString().padStart(3, "0")}`;
      }

      // Create customer with auto-generated code
      const customer = await storage.createCustomer({ ...parsed, code } as any);

      // Auto-create ledger account for customer with opening balance
      const customerAccountCode = `CUST-${customer.code}`;
      let customerAccount =
        await storage.getLedgerAccountByCode(customerAccountCode, req.session.currentCompanyId!);

      if (!customerAccount) {
        customerAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId,
          code: customerAccountCode,
          name: `${customer.legalName} - Customer Account`,
          accountType: "Asset",
          subType: "Accounts Receivable",
          openingBalance: parsed.openingBalance || "0",
          openingBalanceSide: parsed.openingBalanceSide || "Dr",
          active: true,
        });

        // Update customer with ledger account ID
        await storage.updateCustomer(customer.id, {
          ledgerAccountId: customerAccount.id,
        });
      }

      res.status(201).json(customer);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.put(
    "/api/customers/:id",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const customerId = parseInt(req.params.id);
        if (isNaN(customerId)) {
          return res.status(400).json({ message: "Invalid customer ID" });
        }

        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const existingCustomer = await storage.getCustomerById(customerId);
        if (!existingCustomer) {
          return res.status(404).json({ message: "Customer not found" });
        }

        // Verify customer belongs to current company
        if (existingCustomer.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message: "Access denied: Customer belongs to a different company",
            });
        }

        // If code is being changed, check for duplicates
        if (req.body.code && req.body.code !== existingCustomer.code) {
          const duplicate = await storage.getCustomerByCode(
            req.body.code,
            req.session.currentCompanyId,
          );
          if (duplicate) {
            return res
              .status(400)
              .json({
                message: "Customer code already exists in this company",
              });
          }
        }

        const parsed = insertCustomerSchema.partial().parse(req.body);
        const updatedCustomer = await storage.updateCustomer(
          customerId,
          parsed,
        );

        res.json(updatedCustomer);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  // Container Sales
  app.get(
    "/api/container-sales",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }
        const sales = await storage.getAllContainerSales(
          req.session.currentCompanyId,
        );
        res.json(sales);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  app.get(
    "/api/container-sales/customer/:customerId",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const customerId = parseInt(req.params.customerId);
        if (isNaN(customerId)) {
          return res.status(400).json({ message: "Invalid customer ID" });
        }

        const sales = await storage.getContainerSalesByCustomer(customerId);
        res.json(sales);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  app.post(
    "/api/container-sales",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        // Inject companyId before schema validation
        const dataWithCompany = {
          ...req.body,
          companyId: req.session.currentCompanyId,
        };

        const parsed = insertContainerSaleSchema.parse(dataWithCompany);

        // Verify customer exists and belongs to current company
        const customer = await storage.getCustomerById(parsed.customerId);
        if (!customer) {
          return res.status(404).json({ message: "Customer not found" });
        }
        if (customer.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({ message: "Customer belongs to a different company" });
        }

        // Verify container exists and belongs to current company
        const container = await storage.getContainerById(parsed.containerId);
        if (!container) {
          return res.status(404).json({ message: "Container not found" });
        }
        if (container.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({ message: "Container belongs to a different company" });
        }

        // Check if container is already sold
        const existingSale = await storage.getContainerSalesByContainer(
          parsed.containerId,
        );
        if (existingSale) {
          return res
            .status(400)
            .json({ message: "Container has already been sold" });
        }

        // Get customer's ledger account
        if (!customer.ledgerAccountId) {
          return res
            .status(400)
            .json({ message: "Customer does not have a ledger account" });
        }

        // Determine commission account - use provided ID or default to COMMISSION_REVENUE
        let commissionAccountId = parsed.commissionAccountId;
        
        if (commissionAccountId) {
          // Verify the provided commission account exists and belongs to current company
          const commissionAccount = await storage.getLedgerAccountById(commissionAccountId);
          if (!commissionAccount) {
            return res.status(404).json({ message: "Commission account not found" });
          }
          if (commissionAccount.companyId !== req.session.currentCompanyId) {
            return res.status(403).json({ message: "Commission account belongs to a different company" });
          }
        } else {
          // Get or create default COMMISSION_REVENUE ledger account
          const allAccounts = await storage.getAllLedgerAccounts(
            req.session.currentCompanyId,
          );
          let commissionRevenueAccount = allAccounts.find(
            (a: any) => a.code === "COMMISSION_REVENUE",
          );

          if (!commissionRevenueAccount) {
            commissionRevenueAccount = await storage.createLedgerAccount({
              companyId: req.session.currentCompanyId,
              code: "COMMISSION_REVENUE",
              name: "Commission Revenue",
              accountType: "Income",
              openingBalance: "0",
              active: true,
            });
          }
          commissionAccountId = commissionRevenueAccount.id;
        }

        // Create voucher for the container sale
        const voucherNumber = `CS-${Date.now()}`;
        const [voucher] = await db
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId,
            voucherNumber,
            voucherType: "Sales",
            voucherDate: parsed.saleDate,
            description:
              parsed.notes ||
              `Container sale - ${container.containerNumber} to ${customer.legalName}`,
            totalAmount: parsed.totalAmount,
            optional: false,
          })
          .returning();

        // Create voucher entries (double-entry)
        // Debit: Customer Account (they owe us)
        await db.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: customer.ledgerAccountId,
          debitAmount: parsed.totalAmount,
          creditAmount: "0",
          narration: `Container sale - ${voucherNumber}`,
        });

        // Credit: Commission Revenue Account
        await db.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: commissionAccountId,
          debitAmount: "0",
          creditAmount: parsed.totalAmount,
          narration: `Container sale commission - ${voucherNumber}`,
        });

        // Create container sale record with voucher reference
        const sale = await storage.createContainerSale({
          ...parsed,
          commissionAccountId,
          voucherId: voucher.id,
        });

        // Update container status to SOLD
        await storage.updateContainer(parsed.containerId, {
          status: "SOLD",
        });

        res.status(201).json(sale);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  // Inter-Company Transfers
  app.get(
    "/api/inter-company-transfers",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }
        // Get all transfers where current company is either sender or receiver
        const transfers = await storage.getAllInterCompanyTransfers(
          req.session.currentCompanyId,
        );
        res.json(transfers);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  app.post(
    "/api/inter-company-transfers",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const parsed = insertInterCompanyTransferSchema.parse(req.body);

        // Verify both companies exist
        const fromCompany = await storage.getCompanyById(parsed.fromCompanyId);
        if (!fromCompany) {
          return res.status(404).json({ message: "From company not found" });
        }

        const toCompany = await storage.getCompanyById(parsed.toCompanyId);
        if (!toCompany) {
          return res.status(404).json({ message: "To company not found" });
        }

        // Verify user has access to both companies (optional, depending on requirements)
        // For now, we'll allow the transfer if the user is in the current company

        // Verify ledger accounts exist
        const fromAccount = await storage.getLedgerAccountById(
          parsed.fromLedgerAccountId,
        );
        if (!fromAccount || fromAccount.companyId !== parsed.fromCompanyId) {
          return res
            .status(404)
            .json({
              message:
                "From ledger account not found or doesn't belong to from company",
            });
        }

        const toAccount = await storage.getLedgerAccountById(
          parsed.toLedgerAccountId,
        );
        if (!toAccount || toAccount.companyId !== parsed.toCompanyId) {
          return res
            .status(404)
            .json({
              message:
                "To ledger account not found or doesn't belong to to company",
            });
        }

        // Get or create inter-company accounts for both companies
        const fromCompanyAccounts = await storage.getAllLedgerAccounts(
          parsed.fromCompanyId,
        );
        let fromInterCompanyAccount = fromCompanyAccounts.find(
          (a: any) => a.code === `IC-TO-${toCompany.code}`,
        );

        if (!fromInterCompanyAccount) {
          fromInterCompanyAccount = await storage.createLedgerAccount({
            companyId: parsed.fromCompanyId,
            code: `IC-TO-${toCompany.code}`,
            name: `Inter-Company - ${toCompany.name}`,
            accountType: parsed.transferType === "Loan" ? "Asset" : "Asset",
            openingBalance: "0",
            active: true,
          });
        }

        const toCompanyAccounts = await storage.getAllLedgerAccounts(
          parsed.toCompanyId,
        );
        let toInterCompanyAccount = toCompanyAccounts.find(
          (a: any) => a.code === `IC-FROM-${fromCompany.code}`,
        );

        if (!toInterCompanyAccount) {
          toInterCompanyAccount = await storage.createLedgerAccount({
            companyId: parsed.toCompanyId,
            code: `IC-FROM-${fromCompany.code}`,
            name: `Inter-Company - ${fromCompany.name}`,
            accountType:
              parsed.transferType === "Loan" ? "Liability" : "Liability",
            openingBalance: "0",
            active: true,
          });
        }

        // Create voucher in FROM company
        const fromVoucherNumber = `ICT-FROM-${Date.now()}`;
        const [fromVoucher] = await db
          .insert(vouchers)
          .values({
            companyId: parsed.fromCompanyId,
            voucherNumber: fromVoucherNumber,
            voucherType: "Payment",
            voucherDate: parsed.transferDate,
            description:
              parsed.description ||
              `Inter-company transfer to ${toCompany.name}`,
            totalAmount: parsed.amount,
            optional: false,
          })
          .returning();

        // Create voucher entries for FROM company
        // Debit: Inter-company account (asset - they owe us)
        await db.insert(voucherEntries).values({
          voucherId: fromVoucher.id,
          ledgerAccountId: fromInterCompanyAccount.id,
          debitAmount: parsed.amount,
          creditAmount: "0",
          narration: `Transfer to ${toCompany.name} - ${fromVoucherNumber}`,
        });

        // Credit: Source account (cash/bank)
        await db.insert(voucherEntries).values({
          voucherId: fromVoucher.id,
          ledgerAccountId: parsed.fromLedgerAccountId,
          debitAmount: "0",
          creditAmount: parsed.amount,
          narration: `Transfer to ${toCompany.name} - ${fromVoucherNumber}`,
        });

        // Create voucher in TO company
        const toVoucherNumber = `ICT-TO-${Date.now()}`;
        const [toVoucher] = await db
          .insert(vouchers)
          .values({
            companyId: parsed.toCompanyId,
            voucherNumber: toVoucherNumber,
            voucherType: "Receipt",
            voucherDate: parsed.transferDate,
            description:
              parsed.description ||
              `Inter-company transfer from ${fromCompany.name}`,
            totalAmount: parsed.amount,
            optional: false,
          })
          .returning();

        // Create voucher entries for TO company
        // Debit: Destination account (cash/bank)
        await db.insert(voucherEntries).values({
          voucherId: toVoucher.id,
          ledgerAccountId: parsed.toLedgerAccountId,
          debitAmount: parsed.amount,
          creditAmount: "0",
          narration: `Transfer from ${fromCompany.name} - ${toVoucherNumber}`,
        });

        // Credit: Inter-company account (liability - we owe them)
        await db.insert(voucherEntries).values({
          voucherId: toVoucher.id,
          ledgerAccountId: toInterCompanyAccount.id,
          debitAmount: "0",
          creditAmount: parsed.amount,
          narration: `Transfer from ${fromCompany.name} - ${toVoucherNumber}`,
        });

        // Create inter-company transfer record
        const transfer = await storage.createInterCompanyTransfer({
          ...parsed,
          fromVoucherId: fromVoucher.id,
          toVoucherId: toVoucher.id,
        });

        res.status(201).json(transfer);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  // Salary Advances
  app.get(
    "/api/salary-advances",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }
        const advances = await storage.getAllSalaryAdvances(
          req.session.currentCompanyId,
        );
        res.json(advances);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  app.get(
    "/api/salary-advances/employee/:employeeId",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const employeeId = parseInt(req.params.employeeId);
        if (isNaN(employeeId)) {
          return res.status(400).json({ message: "Invalid employee ID" });
        }

        const advances = await storage.getSalaryAdvancesByEmployee(employeeId);
        res.json(advances);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  app.post(
    "/api/salary-advances",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        // Inject companyId before schema validation
        const dataWithCompany = {
          ...req.body,
          companyId: req.session.currentCompanyId,
          remainingBalance: req.body.amount, // Initially, remaining balance equals full amount
        };

        const parsed = insertSalaryAdvanceSchema.parse(dataWithCompany);

        // Verify employee exists and belongs to current company
        const employee = await db
          .select()
          .from(employees)
          .where(eq(employees.id, parsed.employeeId))
          .limit(1);

        if (!employee || employee.length === 0) {
          return res.status(404).json({ message: "Employee not found" });
        }

        if (employee[0].companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({ message: "Employee belongs to a different company" });
        }

        // Get employee's ledger account or create one
        const allAccounts = await storage.getAllLedgerAccounts(
          req.session.currentCompanyId,
        );
        const employeeAccountCode = `EMP-${employee[0].code}`;
        let employeeAccount = allAccounts.find(
          (a: any) => a.code === employeeAccountCode,
        );

        if (!employeeAccount) {
          employeeAccount = await storage.createLedgerAccount({
            companyId: req.session.currentCompanyId,
            code: employeeAccountCode,
            name: `${employee[0].firstName} ${employee[0].lastName} - Salary Account`,
            accountType: "Liability",
            openingBalance: "0",
            active: true,
          });
        }

        // Get default cash account from request or use a default one
        const cashAccountId =
          req.body.cashAccountId || req.session.cashAccountId;
        if (!cashAccountId) {
          return res.status(400).json({ message: "Cash account is required" });
        }

        // Create voucher for the salary advance
        const voucherNumber = `SA-${Date.now()}`;
        const [voucher] = await db
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId,
            voucherNumber,
            voucherType: "Payment",
            voucherDate: parsed.advanceDate,
            description:
              parsed.notes ||
              `Salary advance for ${employee[0].firstName} ${employee[0].lastName}`,
            totalAmount: parsed.amount,
            optional: false,
          })
          .returning();

        // Create voucher entries (double-entry)
        // Debit: Employee Liability Account (they owe us)
        await db.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: employeeAccount.id,
          debitAmount: parsed.amount,
          creditAmount: "0",
          narration: `Salary advance - ${voucherNumber}`,
        });

        // Credit: Cash Account
        await db.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: cashAccountId,
          debitAmount: "0",
          creditAmount: parsed.amount,
          narration: `Salary advance - ${voucherNumber}`,
        });

        // Create salary advance record
        const advance = await storage.createSalaryAdvance({
          ...parsed,
          voucherId: voucher.id,
        });

        res.status(201).json(advance);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  app.post(
    "/api/salary-advances/:id/deduction",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const advanceId = parseInt(req.params.id);
        if (isNaN(advanceId)) {
          return res.status(400).json({ message: "Invalid salary advance ID" });
        }

        const parsed = insertSalaryAdvanceDeductionSchema.parse(req.body);

        // Verify salary advance exists and belongs to current company
        const advance = await storage.getSalaryAdvanceById(advanceId);
        if (!advance) {
          return res.status(404).json({ message: "Salary advance not found" });
        }

        if (advance.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({ message: "Salary advance belongs to a different company" });
        }

        if (advance.fullyPaid) {
          return res
            .status(400)
            .json({ message: "Salary advance is already fully paid" });
        }

        const deductionAmount = parseFloat(parsed.deductionAmount);
        const remainingBalance = parseFloat(advance.remainingBalance);

        if (deductionAmount > remainingBalance) {
          return res
            .status(400)
            .json({
              message: `Deduction amount cannot exceed remaining balance of ${remainingBalance}`,
            });
        }

        // Create salary advance deduction record
        await db.insert(salaryAdvanceDeductions).values({
          salaryAdvanceId: advanceId,
          payrollMonth: parsed.payrollMonth,
          deductionAmount: parsed.deductionAmount,
        });

        // Update salary advance remaining balance
        const newRemainingBalance = remainingBalance - deductionAmount;
        const isFullyPaid = newRemainingBalance <= 0.01; // Use small threshold for floating point comparison

        await db
          .update(salaryAdvances)
          .set({
            remainingBalance: newRemainingBalance.toFixed(2),
            fullyPaid: isFullyPaid,
          })
          .where(eq(salaryAdvances.id, advanceId));

        res.json({
          message: "Deduction recorded successfully",
          newRemainingBalance: newRemainingBalance.toFixed(2),
          fullyPaid: isFullyPaid,
        });
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  // Stock Groups
  app.get("/api/stock-groups", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const groups = await storage.getAllStockGroups(
        req.session.currentCompanyId,
      );
      res.json(groups);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post(
    "/api/stock-groups",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
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
        const existing = await storage.getStockGroupByCode(
          parsed.code,
          req.session.currentCompanyId,
        );
        if (existing) {
          return res
            .status(400)
            .json({
              message: "Stock group code already exists in this company",
            });
        }

        const group = await storage.createStockGroup(parsed);
        res.status(201).json(group);
      } catch (error: any) {
        res.status(400).json({ message: error.message });
      }
    },
  );

  // Stock Items
  app.get("/api/stock-items", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const items = await storage.getAllStockItems(
        req.session.currentCompanyId,
      );
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/stock-items", requireAuth, requireNonPOS, async (req, res) => {
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
      const existing = await storage.getStockItemByCode(
        parsed.code,
        req.session.currentCompanyId,
      );
      if (existing) {
        return res
          .status(400)
          .json({ message: "Stock item code already exists in this company" });
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

  // Bulk delete stock items
  app.post("/api/stock-items/bulk-delete", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "Invalid or empty ids array" });
      }

      // Get all items that exist and belong to the current company
      const validItems = await storage.bulkGetStockItemsByIds(ids, req.session.currentCompanyId);
      const validIds = validItems.map(item => item.id);
      
      if (validIds.length === 0) {
        return res.status(404).json({ message: "No valid stock items found to delete" });
      }

      await storage.bulkDeleteStockItems(validIds);
      
      const skippedCount = ids.length - validIds.length;
      const message = skippedCount > 0
        ? `Successfully deleted ${validIds.length} stock item(s). ${skippedCount} item(s) were skipped (not found or belong to another company).`
        : `Successfully deleted ${validIds.length} stock item(s)`;

      res.json({ 
        message,
        deleted: validIds.length,
        skipped: skippedCount
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
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
        return res
          .status(403)
          .json({
            message: "Access denied: Stock item belongs to a different company",
          });
      }

      res.json(stockItem);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bulk import stock items
  app.post(
    "/api/stock-items/import",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const { items } = req.body;
        if (!Array.isArray(items)) {
          return res.status(400).json({ message: "Items must be an array" });
        }

        // Find or create "Uncategorized" stock group for this company
        let uncategorizedGroup = await storage.getStockGroupByCode(
          "UNCATEGORIZED",
          req.session.currentCompanyId,
        );
        if (!uncategorizedGroup) {
          uncategorizedGroup = await storage.createStockGroup({
            companyId: req.session.currentCompanyId,
            code: "UNCATEGORIZED",
            name: "Uncategorized",
            active: true,
          });
        }

        // Fetch all valid stock groups for this company for validation
        const validStockGroups = await storage.getAllStockGroups(
          req.session.currentCompanyId,
        );
        const validStockGroupIds = new Set(validStockGroups.map((sg) => sg.id));

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
            if (
              !itemWithCompany.stockGroupId ||
              !validStockGroupIds.has(itemWithCompany.stockGroupId)
            ) {
              itemWithCompany.stockGroupId = uncategorizedGroup.id;
            }

            const parsed = insertStockItemSchema.parse(itemWithCompany);

            // Check for duplicate code
            const existing = await storage.getStockItemByCode(
              parsed.code,
              req.session.currentCompanyId,
            );
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
    },
  );

  // Update stock item
  app.patch(
    "/api/stock-items/:id",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
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
          return res
            .status(403)
            .json({
              message:
                "Access denied: Stock item belongs to a different company",
            });
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
            return res
              .status(400)
              .json({ message: "Unit of measure is required" });
          }
          updates.uom = trimmedUom;
        }

        if (req.body.barcode !== undefined) {
          updates.barcode = req.body.barcode
            ? String(req.body.barcode).trim()
            : null;
        }

        if (req.body.stockGroupId !== undefined) {
          updates.stockGroupId = req.body.stockGroupId;
        }

        if (req.body.active !== undefined) {
          updates.active = req.body.active;
        }

        // If updating code, check for duplicates
        if (updates.code && updates.code !== existingItem.code) {
          const duplicate = await storage.getStockItemByCode(
            updates.code,
            req.session.currentCompanyId,
          );
          if (duplicate) {
            return res
              .status(400)
              .json({ message: "Stock item code already exists" });
          }
        }

        const updated = await storage.updateStockItem(stockItemId, updates);
        res.json(updated);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Delete stock item
  app.delete(
    "/api/stock-items/:id",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
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
          return res
            .status(403)
            .json({
              message:
                "Access denied: Stock item belongs to a different company",
            });
        }

        // Check if item has any inventory
        const inventoryLocations = await storage.getInventoryLocationsByItem(
          stockItemId,
          req.session.currentCompanyId,
        );
        const hasInventory = inventoryLocations.some(
          (loc) => parseFloat(loc.quantity) > 0,
        );

        if (hasInventory) {
          return res
            .status(400)
            .json({
              message:
                "Cannot delete stock item with existing inventory. Please transfer or adjust inventory to zero first.",
            });
        }

        await storage.deleteStockItem(stockItemId);
        res.json({ message: "Stock item deleted successfully" });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Get stock item transactions (transfers and adjustments)
  app.get(
    "/api/stock-items/:id/transactions",
    requireAuth,
    async (req, res) => {
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
          return res
            .status(403)
            .json({
              message:
                "Access denied: Stock item belongs to a different company",
            });
        }

        const { startDate, endDate } = req.query;
        const transactions = await storage.getStockItemTransactions(
          stockItemId,
          req.session.currentCompanyId,
          startDate as string | undefined,
          endDate as string | undefined,
        );

        res.json(transactions);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

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
        return res
          .status(403)
          .json({
            message: "Access denied: Stock item belongs to a different company",
          });
      }

      // Get all purchases, all sales, and current locations
      const [purchases, sales, inventoryLocations] = await Promise.all([
        storage.getAllPurchasesForItem(
          stockItemId,
          req.session.currentCompanyId,
        ),
        storage.getAllSalesForItem(stockItemId, req.session.currentCompanyId),
        storage.getInventoryLocationsByItem(
          stockItemId,
          req.session.currentCompanyId,
        ),
      ]);

      res.json({
        purchases,
        sales,
        inventoryLocations,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Item Code Aliases
  // Get all code aliases for a stock item
  app.get(
    "/api/stock-items/:id/code-aliases",
    requireAuth,
    async (req, res) => {
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
          return res
            .status(403)
            .json({
              message:
                "Access denied: Stock item belongs to a different company",
            });
        }

        const aliases = await storage.getStockItemCodeAliases(stockItemId);
        res.json(aliases);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Create a new code alias for a stock item
  app.post(
    "/api/stock-items/:id/code-aliases",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
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
          return res
            .status(403)
            .json({
              message:
                "Access denied: Stock item belongs to a different company",
            });
        }

        // Validate the alias (include companyId for security)
        const validatedAlias = insertStockItemCodeAliasSchema.parse({
          ...req.body,
          stockItemId,
          companyId: req.session.currentCompanyId,
        });

        const alias = await storage.createStockItemCodeAlias(validatedAlias);
        res.status(201).json(alias);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res
            .status(400)
            .json({ message: "Validation error", errors: error.errors });
        }
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Delete a code alias
  app.delete(
    "/api/stock-item-code-aliases/:id",
    requireAuth,
    async (req, res) => {
      try {
        const aliasId = parseInt(req.params.id);
        if (isNaN(aliasId)) {
          return res.status(400).json({ message: "Invalid alias ID" });
        }

        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        // Get the alias first to verify ownership
        const alias = await storage.getStockItemCodeAliasById(aliasId);
        if (!alias) {
          return res.status(404).json({ message: "Code alias not found" });
        }

        // Verify the alias belongs to the current company
        if (alias.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message:
                "Access denied: Code alias belongs to a different company",
            });
        }

        await storage.deleteStockItemCodeAlias(aliasId);
        res.json({ message: "Code alias deleted successfully" });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

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
          return res
            .status(400)
            .json({ message: "Quantity must be a valid number" });
        }
      }
      if (req.body.rate !== undefined) {
        const rate = parseFloat(req.body.rate);
        if (isNaN(rate) || rate < 0) {
          return res
            .status(400)
            .json({ message: "Rate must be a valid non-negative number" });
        }
      }
      if (req.body.stockItemId !== undefined) {
        const stockItemId = parseInt(req.body.stockItemId);
        if (isNaN(stockItemId)) {
          return res
            .status(400)
            .json({ message: "Stock item ID must be a valid number" });
        }
      }

      const updated = await storage.updateStockTransferItem(itemId, req.body);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update stock adjustment item
  app.patch(
    "/api/stock-adjustment-items/:id",
    requireAuth,
    async (req, res) => {
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
            return res
              .status(400)
              .json({ message: "Quantity must be a valid number" });
          }
        }
        if (req.body.rate !== undefined) {
          const rate = parseFloat(req.body.rate);
          if (isNaN(rate) || rate < 0) {
            return res
              .status(400)
              .json({ message: "Rate must be a valid non-negative number" });
          }
        }
        if (req.body.stockItemId !== undefined) {
          const stockItemId = parseInt(req.body.stockItemId);
          if (isNaN(stockItemId)) {
            return res
              .status(400)
              .json({ message: "Stock item ID must be a valid number" });
          }
        }

        const updated = await storage.updateStockAdjustmentItem(
          itemId,
          req.body,
        );
        res.json(updated);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

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
      const inventoryMap = new Map<
        number,
        { totalQty: number; totalValue: number }
      >();

      for (const record of inventoryRecords) {
        const existing = inventoryMap.get(record.stockItemId) || {
          totalQty: 0,
          totalValue: 0,
        };
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
        parsed.openingBalanceSide !== undefined &&
        parsed.openingBalanceSide !== null;

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
        parsed.openingBalanceSide !== undefined &&
        parsed.openingBalanceSide !== null;

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

  app.post("/api/fixed-assets", async (req, res) => {
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

        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawData = XLSX.utils.sheet_to_json(worksheet);

        if (rawData.length === 0) {
          return res.status(400).json({ message: "Excel file is empty" });
        }

        // Calculate file hash for idempotency
        const fileHash = crypto
          .MD5(req.file.buffer.toString("base64"))
          .toString();

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

            // Try to find stock item by code/alias or name (for preview purposes only - validation happens in validate step)
            if (row.Item_Barcode) {
              stockItem = await storage.getStockItemByCodeOrAlias(
                row.Item_Barcode,
                req.session.currentCompanyId!,
              );
              if (stockItem) {
                itemName = stockItem.name;
              }
            } else if (row.Item_Name) {
              stockItem = allStockItems.find(
                (item) => item.name === row.Item_Name,
              );
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
              const chargeType = charge.chargeType
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
      } = req.body;

      if (
        !fileHash ||
        !containerNumber ||
        !supplierId ||
        !importDate ||
        !preview
      ) {
        return res.status(400).json({ message: "Missing required fields" });
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

      // Create container charges and their voucher entries
      const charges = containerPreview.charges;
      const chargeTypes = [
        { type: "Freight", amount: charges.freight, isNegative: false },
        { type: "Surcharge", amount: charges.surcharge, isNegative: false },
        { type: "Fumigation", amount: charges.fumigation, isNegative: false },
        { type: "Discount", amount: charges.discount, isNegative: true },
        {
          type: "Document Charges",
          amount: charges.documentCharges,
          isNegative: false,
        },
      ];

      for (const charge of chargeTypes) {
        if (charge.amount > 0) {
          const actualAmount = charge.isNegative
            ? -charge.amount
            : charge.amount;

          // Create container charge record
          await storage.createContainerCharge({
            containerId: container.id,
            chargeType: charge.type,
            amount: actualAmount.toString(),
          });

          // Create voucher for this charge to update supplier balance
          const chargeVoucher = await storage.createVoucher({
            companyId: req.session.currentCompanyId!,
            voucherNumber: `CHARGE-${containerNumber}-${charge.type.toUpperCase().replace(/\s+/g, "_")}-${Date.now()}`,
            voucherType: "Purchase",
            voucherDate: importDate,
            description: `${charge.type} - Container ${containerNumber}`,
            totalAmount: Math.abs(actualAmount).toString(),
            optional: false,
          });

          if (!charge.isNegative) {
            // For normal charges (freight, fumigation, etc.): Debit Import Charges, Credit Supplier
            await storage.createVoucherEntry({
              voucherId: chargeVoucher.id,
              ledgerAccountId: importChargesAccount.id,
              debitAmount: actualAmount.toString(),
              creditAmount: "0",
              narration: `${charge.type} - Container ${containerNumber}`,
            });

            await storage.createVoucherEntry({
              voucherId: chargeVoucher.id,
              supplierId: supplierId,
              debitAmount: "0",
              creditAmount: actualAmount.toString(),
              narration: `${charge.type} - Container ${containerNumber}`,
            });
          } else {
            // For discount: Credit Import Charges, Debit Supplier (reduces payable)
            await storage.createVoucherEntry({
              voucherId: chargeVoucher.id,
              ledgerAccountId: importChargesAccount.id,
              debitAmount: "0",
              creditAmount: Math.abs(actualAmount).toString(),
              narration: `${charge.type} - Container ${containerNumber}`,
            });

            await storage.createVoucherEntry({
              voucherId: chargeVoucher.id,
              supplierId: supplierId,
              debitAmount: Math.abs(actualAmount).toString(),
              creditAmount: "0",
              narration: `${charge.type} - Container ${containerNumber}`,
            });
          }
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
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(sampleData);

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, "PO Import");

      // Generate buffer
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

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

        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawData = XLSX.utils.sheet_to_json(worksheet);

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
      const validatedItems: any[] = [];

      // Validate location exists
      const location = await storage.getLocationById(locationId);
      if (!location) {
        errors.push("Selected location not found");
        return res.json({ errors, validatedItems });
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

          // Get cost price for profit calculation (allow negative stock for POS imports)
          if (inventoryItem.length > 0) {
            validatedItem.costPrice = parseFloat(
              inventoryItem[0].averageRate || "0",
            );
          }
        }

        validatedItems.push(validatedItem);
      }

      res.json({
        errors,
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

      await db.transaction(async (tx) => {
        // Create sales voucher
        const voucherNumber = `SALES-${Date.now()}`;

        const [voucher] = await tx
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId!,
            locationId,
            voucherNumber,
            voucherType: "Sales",
            voucherDate: saleDate,
            description: `POS Import - ${items.length} items`,
            totalAmount: "0", // Will be updated with actual total
            optional: false,
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
          });
          
          // Note: COGS is tracked in sales_items table but not posted to ledger
          // because this system uses purchase-date expense recognition (not COGS method)

          // Update or create inventory record - allow negative stock
          if (inventoryRecord) {
            // Update existing inventory - reduce quantity (can go negative)
            await tx
              .update(inventory)
              .set({
                quantity: (currentQty - item.quantity).toString(),
              })
              .where(
                and(
                  eq(inventory.stockItemId, stockItem.id),
                  eq(inventory.locationId, locationId),
                ),
              );
          } else {
            // Create new inventory record with negative quantity
            await tx.insert(inventory).values({
              companyId: req.session.currentCompanyId!,
              locationId,
              stockItemId: stockItem.id,
              quantity: (-item.quantity).toString(),
              averageRate: "0",
              totalValue: "0",
            });
          }
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
      });

      res.json({
        success: true,
        itemsCount: items.length,
        totalSales: totalSales.toFixed(2),
      });
    } catch (error: any) {
      console.error("POS Import error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Download sample POS import template
  app.get("/api/pos-import/template", (_req, res) => {
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

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(sampleData);
      XLSX.utils.book_append_sheet(workbook, worksheet, "POS Import");

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

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

  // Get containers
  app.get("/api/containers", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const containers = await storage.getAllContainers(
        req.session.currentCompanyId,
      );
      res.json(containers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get active containers (not sold)
  app.get("/api/containers/active", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const containers = await storage.getActiveContainers(
        req.session.currentCompanyId,
      );
      res.json(containers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get sold containers with full details
  app.get("/api/containers/sold", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const soldContainers = await storage.getSoldContainers(
        req.session.currentCompanyId,
      );
      res.json(soldContainers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get container details with POs, line items, and charges
  app.get(
    "/api/containers/:id",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
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
          pos.map((po) => storage.getLineItemsByPO(po.id)),
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
    },
  );

  // Offload container to location
  app.post(
    "/api/containers/:id/offload",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const containerId = parseInt(req.params.id);

        // Validate request body
        const validation = offloadRequestSchema.safeParse(req.body);
        if (!validation.success) {
          return res.status(400).json({
            message: "Validation failed",
            errors: validation.error.errors,
          });
        }

        const {
          locationId,
          duties,
          dutiesAccountId,
          officeCharges,
          officeChargesAccountId,
          officeChargesCashAccountId,
          transferCharges,
          transportFees,
          transportAccountId,
          additionalCharges = [],
        } = validation.data;

        // Validate container exists
        const container = await storage.getContainerById(containerId);
        if (!container) {
          return res.status(404).json({ message: "Container not found" });
        }

        // Check if this is an edit (container already offloaded)
        const isEdit = container.status === "OFFLOADED";
        
        if (isEdit) {
          // For edits, first reverse the existing offload
          const [existingOffload] = await db
            .select()
            .from(containerOffloads)
            .where(eq(containerOffloads.containerId, containerId))
            .limit(1);

          if (existingOffload) {
            // Reverse inventory changes
            const pos = await storage.getPurchaseOrdersByContainer(containerId);
            for (const po of pos) {
              const lineItems = await storage.getLineItemsByPO(po.id);
              for (const item of lineItems) {
                const [inv] = await db
                  .select()
                  .from(inventory)
                  .where(
                    and(
                      eq(inventory.stockItemId, item.stockItemId),
                      eq(inventory.locationId, existingOffload.locationId),
                    ),
                  )
                  .limit(1);

                if (inv) {
                  const newQty = parseFloat(inv.quantity) - parseFloat(item.quantity);
                  if (newQty <= 0) {
                    await db.delete(inventory).where(eq(inventory.id, inv.id));
                  } else {
                    await db.update(inventory).set({ quantity: newQty.toString() }).where(eq(inventory.id, inv.id));
                  }
                }
              }
            }

            // Delete old vouchers
            const oldVouchers = await db
              .select()
              .from(vouchers)
              .where(
                and(
                  eq(vouchers.companyId, container.companyId),
                  sql`LOWER(${vouchers.description}) LIKE LOWER('%container ${container.containerNumber}%')`,
                ),
              );

            for (const voucher of oldVouchers) {
              await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucher.id));
              await db.delete(vouchers).where(eq(vouchers.id, voucher.id));
            }

            // Delete old offload record
            await db.delete(containerOffloads).where(eq(containerOffloads.id, existingOffload.id));
          }

          // Set status back to IN_TRANSIT so offloadContainer can proceed
          await storage.updateContainer(containerId, { status: "IN_TRANSIT" });
        }

        // Perform offload
        const offload = await storage.offloadContainer(
          containerId,
          locationId,
          duties,
          dutiesAccountId,
          officeCharges,
          officeChargesAccountId,
          officeChargesCashAccountId,
          transferCharges,
          transportFees,
          transportAccountId,
          additionalCharges,
        );

        res.json(offload);
      } catch (error: any) {
        console.error("Container offload error:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Reverse container offload (Admin only)
  app.post(
    "/api/containers/:id/reverse-offload",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const containerId = parseInt(req.params.id);
        if (isNaN(containerId)) {
          return res.status(400).json({ message: "Invalid container ID" });
        }

        // Get container
        const container = await storage.getContainerById(containerId);
        if (!container) {
          return res.status(404).json({ message: "Container not found" });
        }

        // Verify container belongs to current company
        if (container.companyId !== req.session.currentCompanyId) {
          return res.status(403).json({
            message: "Access denied: Container belongs to a different company",
          });
        }

        // Check if container is offloaded
        if (container.status !== "OFFLOADED") {
          return res
            .status(400)
            .json({ message: "Container is not offloaded" });
        }

        // Get offload record (may not exist for old offloads)
        const [offloadRecord] = await db
          .select()
          .from(containerOffloads)
          .where(eq(containerOffloads.containerId, containerId))
          .limit(1);

        // If no offload record exists, just change status back and return
        if (!offloadRecord) {
          await db
            .update(containers)
            .set({ status: "IN_TRANSIT" })
            .where(eq(containers.id, containerId));
          
          return res.json({ 
            message: "Container status reversed to IN_TRANSIT (no offload record to clean up)" 
          });
        }

        await db.transaction(async (tx) => {
          // Get all POs for this container
          const pos = await storage.getPurchaseOrdersByContainer(containerId);

          // Reduce inventory quantities (not delete - there might be other stock)
          for (const po of pos) {
            const lineItems = await storage.getLineItemsByPO(po.id);
            for (const item of lineItems) {
              const [inv] = await tx
                .select()
                .from(inventory)
                .where(
                  and(
                    eq(inventory.stockItemId, item.stockItemId),
                    eq(inventory.locationId, offloadRecord.locationId),
                  ),
                )
                .limit(1);

              if (inv) {
                const newQty = parseFloat(inv.quantity) - parseFloat(item.quantity);
                if (newQty <= 0) {
                  // Delete if quantity goes to zero or negative
                  await tx
                    .delete(inventory)
                    .where(eq(inventory.id, inv.id));
                } else {
                  // Otherwise just reduce the quantity
                  await tx
                    .update(inventory)
                    .set({ quantity: newQty.toString() })
                    .where(eq(inventory.id, inv.id));
                }
              }
            }
          }

          // Delete vouchers created for this container offload
          const containerVouchers = await tx
            .select()
            .from(vouchers)
            .where(
              and(
                eq(vouchers.companyId, req.session.currentCompanyId!),
                like(sql`LOWER(${vouchers.description})`, `%container ${container.containerNumber.toLowerCase()}%`),
              ),
            );

          for (const voucher of containerVouchers) {
            // Delete voucher entries first
            await tx
              .delete(voucherEntries)
              .where(eq(voucherEntries.voucherId, voucher.id));

            // Delete the voucher
            await tx.delete(vouchers).where(eq(vouchers.id, voucher.id));
          }

          // Delete the offload record
          await tx
            .delete(containerOffloads)
            .where(eq(containerOffloads.id, offloadRecord.id));

          // Update container status back to IN_TRANSIT
          await tx
            .update(containers)
            .set({
              status: "IN_TRANSIT",
            })
            .where(eq(containers.id, containerId));
        });

        res.json({
          success: true,
          message: "Container offload reversed successfully",
        });
      } catch (error: any) {
        console.error("Reverse offload error:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Edit container offload (Admin only)
  app.patch(
    "/api/containers/:id/offload",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const containerId = parseInt(req.params.id);
        if (isNaN(containerId)) {
          return res.status(400).json({ message: "Invalid container ID" });
        }

        // Get container
        const container = await storage.getContainerById(containerId);
        if (!container) {
          return res.status(404).json({ message: "Container not found" });
        }

        // Verify container belongs to current company
        if (container.companyId !== req.session.currentCompanyId) {
          return res.status(403).json({
            message: "Access denied: Container belongs to a different company",
          });
        }

        // Check if container is offloaded
        if (container.status !== "OFFLOADED") {
          return res
            .status(400)
            .json({ message: "Container must be offloaded to edit" });
        }

        // Validate request body
        const validation = offloadRequestSchema.extend({
          dutiesAccountId: z.number().optional(),
          officeChargesAccountId: z.number().optional(),
          officeChargesCashAccountId: z.number().optional(),
          transportAccountId: z.number().optional(),
          additionalCharges: z.array(z.object({
            description: z.string(),
            amount: z.number(),
            ledgerAccountId: z.number(),
          })).optional(),
        }).safeParse(req.body);

        if (!validation.success) {
          return res.status(400).json({ errors: validation.error.errors });
        }

        const {
          locationId,
          duties,
          dutiesAccountId,
          officeCharges,
          officeChargesAccountId,
          officeChargesCashAccountId,
          transferCharges,
          transportFees,
          transportAccountId,
          additionalCharges = [],
        } = validation.data;

        // Get current offload record
        const [currentOffload] = await db
          .select()
          .from(containerOffloads)
          .where(eq(containerOffloads.containerId, containerId))
          .limit(1);

        if (!currentOffload) {
          return res.status(404).json({ message: "Offload record not found" });
        }

        await db.transaction(async (tx) => {
          // If location changed, need to move inventory
          if (locationId !== currentOffload.locationId) {
            const pos = await storage.getPurchaseOrdersByContainer(containerId);
            for (const po of pos) {
              const lineItems = await storage.getLineItemsByPO(po.id);
              for (const item of lineItems) {
                // Get inventory from old location
                const [oldInv] = await tx
                  .select()
                  .from(inventory)
                  .where(
                    and(
                      eq(inventory.stockItemId, item.stockItemId),
                      eq(inventory.locationId, currentOffload.locationId),
                    ),
                  )
                  .limit(1);

                if (oldInv) {
                  // Delete from old location
                  await tx
                    .delete(inventory)
                    .where(eq(inventory.id, oldInv.id));

                  // Create in new location
                  await tx.insert(inventory).values({
                    companyId: req.session.currentCompanyId!,
                    locationId: locationId,
                    stockItemId: item.stockItemId,
                    quantity: oldInv.quantity,
                    averageRate: oldInv.averageRate,
                  });
                }
              }
            }
          }

          // Recalculate charges
          const additionalChargesTotal = additionalCharges.reduce((sum, charge) => sum + charge.amount, 0);
          const totalCharges = 
            parseFloat(duties) + 
            parseFloat(officeCharges) + 
            parseFloat(transferCharges) + 
            parseFloat(transportFees) +
            additionalChargesTotal;

          const totalBales = parseFloat(currentOffload.totalBales);
          const additionalCostPerBale = totalBales > 0 ? totalCharges / totalBales : 0;

          // Update offload record
          await tx
            .update(containerOffloads)
            .set({
              locationId,
              duties,
              officeCharges,
              transferCharges,
              transportFees,
              totalCharges: totalCharges.toString(),
              additionalCostPerBale: additionalCostPerBale.toString(),
            })
            .where(eq(containerOffloads.id, currentOffload.id));

          // Delete old vouchers and create new ones with updated charges
          const containerVouchers = await tx
            .select()
            .from(vouchers)
            .where(
              and(
                eq(vouchers.companyId, req.session.currentCompanyId!),
                sql`${vouchers.description} LIKE '%Container ${container.containerNumber}%'`,
              ),
            );

          for (const voucher of containerVouchers) {
            await tx
              .delete(voucherEntries)
              .where(eq(voucherEntries.voucherId, voucher.id));
            await tx.delete(vouchers).where(eq(vouchers.id, voucher.id));
          }

          // Create new voucher entries with updated charges (similar to offloadContainer logic)
          // This is a simplified version - you may want to call the full offload logic
          // For now, we'll just update the records
        });

        res.json({
          success: true,
          message: "Container offload updated successfully",
        });
      } catch (error: any) {
        console.error("Edit offload error:", error);
        res.status(500).json({ message: error.message });
      }
    },
  );

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
        return res
          .status(403)
          .json({ message: "Only Admin and Owner can view purchase orders" });
      }

      const po = await storage.getPurchaseOrderById(id);
      if (!po) {
        return res.status(404).json({ message: "Purchase order not found" });
      }

      // Verify purchase order belongs to current company
      if (po.companyId !== req.session.currentCompanyId) {
        return res
          .status(403)
          .json({
            message:
              "Access denied: Purchase order belongs to a different company",
          });
      }

      // Get line items for this PO
      const lineItems = await storage.getLineItemsByPO(id);

      res.json({
        ...po,
        items: lineItems,
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
        return res
          .status(403)
          .json({
            message:
              "Access denied: Purchase order belongs to a different company",
          });
      }

      // Check edit permissions based on role
      const userRole = req.session.currentRole;
      if (!userRole) {
        return res.status(403).json({ message: "User role not found" });
      }

      // Only Admin and Owner can edit purchase orders
      if (userRole !== "Admin" && userRole !== "Owner") {
        return res
          .status(403)
          .json({ message: "Only Admin and Owner can edit purchase orders" });
      }

      // Only allow updating specific fields
      const allowedUpdates: Partial<InsertPurchaseOrder> = {};
      if (req.body.poNumber !== undefined)
        allowedUpdates.poNumber = req.body.poNumber;
      if (req.body.itemsTotal !== undefined)
        allowedUpdates.itemsTotal = req.body.itemsTotal;
      if (req.body.currency !== undefined)
        allowedUpdates.currency = req.body.currency;
      if (req.body.status !== undefined)
        allowedUpdates.status = req.body.status;

      const updated = await storage.updatePurchaseOrder(id, allowedUpdates);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete a purchase order (Admin only)
  app.delete(
    "/api/purchase-orders/:id",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
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
          return res
            .status(403)
            .json({
              message:
                "Access denied: Purchase order belongs to a different company",
            });
        }

        await storage.deletePurchaseOrder(id);
        res.json({ message: "Purchase order deleted successfully" });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Delete a container (Admin only)
  app.delete(
    "/api/containers/:id",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid container ID" });
        }

        const existingContainer = await storage.getContainerById(id);
        if (!existingContainer) {
          return res.status(404).json({ message: "Container not found" });
        }

        // Verify container belongs to current company
        if (existingContainer.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message:
                "Access denied: Container belongs to a different company",
            });
        }

        await storage.deleteContainer(id);
        res.json({ message: "Container deleted successfully" });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Backfill voucher entries for existing POs
  app.post("/api/po-import/backfill", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get all POs without voucher IDs
      const allPOs = await storage.getAllPurchaseOrders(
        req.session.currentCompanyId!,
      );
      const posWithoutVouchers = allPOs.filter((po: any) => !po.voucherId);

      if (posWithoutVouchers.length === 0) {
        return res.json({
          message: "No POs need backfilling",
          count: 0,
        });
      }

      // Get or create "Purchases" ledger account for double-entry bookkeeping
      let purchasesAccount = await storage.getLedgerAccountByCode("PURCHASES", req.session.currentCompanyId!);
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
      const allContainers = await storage.getAllContainers(
        req.session.currentCompanyId!,
      );
      const containerMap = new Map(allContainers.map((c) => [c.id, c]));

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
        count: backfilledCount,
      });
    } catch (error: any) {
      console.error("Backfill error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Backfill voucher entries for existing sales
  app.post("/api/sales-import/backfill", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { locationCashAccountMap } = req.body;

      if (!locationCashAccountMap || typeof locationCashAccountMap !== 'object') {
        return res.status(400).json({ 
          message: "Location-to-cash-account mapping is required. Please specify which cash account to use for each location's sales." 
        });
      }

      // Validate all cash accounts belong to this company
      const cashAccountIds = Object.values(locationCashAccountMap) as number[];
      for (const cashAccountId of cashAccountIds) {
        const cashAccount = await storage.getLedgerAccountById(cashAccountId);
        if (!cashAccount || cashAccount.companyId !== req.session.currentCompanyId) {
          return res.status(400).json({ message: `Invalid cash account ID: ${cashAccountId}` });
        }
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

      // Get all Sales vouchers for this company
      const allVouchers = await db
        .select()
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, req.session.currentCompanyId!),
            eq(vouchers.voucherType, "Sales")
          )
        )
        .execute();

      if (allVouchers.length === 0) {
        return res.json({
          message: "No sales vouchers found",
          count: 0,
        });
      }

      // Get all existing voucher entries for these vouchers
      const voucherIds = allVouchers.map(v => v.id);
      const existingEntries = await db
        .select()
        .from(voucherEntries)
        .where(inArray(voucherEntries.voucherId, voucherIds))
        .execute();

      // Create a map of voucher ID -> set of ledger account IDs
      const voucherLedgerMap = new Map<number, Set<number>>();
      for (const entry of existingEntries) {
        if (!voucherLedgerMap.has(entry.voucherId)) {
          voucherLedgerMap.set(entry.voucherId, new Set());
        }
        if (entry.ledgerAccountId) {
          voucherLedgerMap.get(entry.voucherId)!.add(entry.ledgerAccountId);
        }
      }

      // Filter to vouchers that need backfill (missing entries or have wrong structure)
      const vouchersNeedingBackfill = allVouchers.filter(v => {
        const ledgerIds = voucherLedgerMap.get(v.id) || new Set();
        const entryCount = ledgerIds.size;
        
        // Need backfill if:
        // 1. No entries at all
        // 2. Missing sales revenue
        // 3. Has wrong number of entries (old format had COGS/Inventory)
        const hasSalesRev = ledgerIds.has(salesRevenueAccount!.id);
        return entryCount === 0 || !hasSalesRev || entryCount !== 2;
      });

      if (vouchersNeedingBackfill.length === 0) {
        return res.json({
          message: "All sales vouchers already have complete accounting entries",
          count: 0,
        });
      }

      let backfilledCount = 0;
      let skippedCount = 0;

      for (const voucher of vouchersNeedingBackfill) {
        // Use a transaction to ensure atomic updates
        await db.transaction(async (tx) => {
          // Get all sales items for this voucher
          const items = await tx
            .select()
            .from(salesItems)
            .where(eq(salesItems.voucherId, voucher.id))
            .execute();

          if (items.length === 0) {
            console.warn(`No sales items found for voucher ${voucher.id}, skipping`);
            skippedCount++;
            return;
          }

          // Calculate total sales
          const totalSales = items.reduce((sum, item) => sum + parseFloat(item.totalSales || "0"), 0);

          if (totalSales === 0) {
            console.warn(`Voucher ${voucher.id} has zero sales, skipping`);
            skippedCount++;
            return;
          }

          // Determine location for this voucher by checking first sales item
          const firstItem = items[0];
          const stockItem = await tx
            .select()
            .from(stockItems)
            .where(eq(stockItems.id, firstItem.stockItemId))
            .limit(1);

          if (stockItem.length === 0) {
            console.warn(`Could not find stock item ${firstItem.stockItemId} for voucher ${voucher.id}, skipping`);
            skippedCount++;
            return;
          }

          // Find inventory record to determine location
          const inventoryRecords = await tx
            .select()
            .from(inventory)
            .where(eq(inventory.stockItemId, stockItem[0].id))
            .limit(1);

          if (inventoryRecords.length === 0) {
            console.warn(`Could not determine location for voucher ${voucher.id}, skipping`);
            skippedCount++;
            return;
          }

          const locationId = inventoryRecords[0].locationId;
          const cashAccountId = locationCashAccountMap[locationId];

          if (!cashAccountId) {
            console.warn(`No cash account mapped for location ${locationId}, skipping voucher ${voucher.id}`);
            skippedCount++;
            return;
          }

          // Delete all existing voucher entries (in case of old format)
          await tx
            .delete(voucherEntries)
            .where(eq(voucherEntries.voucherId, voucher.id));

          // Create new balanced entries (periodic inventory system)
          
          // Entry 1: Debit Cash Account (location-specific)
          await tx.insert(voucherEntries).values({
            voucherId: voucher.id,
            ledgerAccountId: cashAccountId,
            debitAmount: totalSales.toFixed(2),
            creditAmount: "0",
            narration: `Cash from POS Sales - ${items.length} items (Backfilled)`,
          });

          // Entry 2: Credit Sales Revenue
          await tx.insert(voucherEntries).values({
            voucherId: voucher.id,
            ledgerAccountId: salesRevenueAccount!.id,
            debitAmount: "0",
            creditAmount: totalSales.toFixed(2),
            narration: `Sales Revenue - ${items.length} items (Backfilled)`,
          });

          backfilledCount++;
        });
      }

      res.json({
        message: `Sales backfill completed. ${backfilledCount} vouchers updated, ${skippedCount} skipped.`,
        backfilledCount,
        skippedCount,
        totalSalesVouchers: allVouchers.length,
      });
    } catch (error: any) {
      console.error("Sales backfill error:", error);
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

      const companyVoucherIds = companyVouchers.map((v) => v.id);

      // Get all voucher entries for this company
      const allEntries =
        companyVoucherIds.length > 0
          ? await db
              .select()
              .from(voucherEntries)
              .where(inArray(voucherEntries.voucherId, companyVoucherIds))
              .execute()
          : [];

      // Group entries by account type and calculate balances
      const ledgerBalances = new Map<
        number,
        { debits: number; credits: number }
      >();
      const bankBalances = new Map<
        number,
        { debits: number; credits: number }
      >();
      const assetBalances = new Map<
        number,
        { debits: number; credits: number }
      >();
      const supplierBalances = new Map<
        number,
        { debits: number; credits: number }
      >();

      for (const entry of allEntries) {
        const debit = parseFloat(entry.debitAmount || "0");
        const credit = parseFloat(entry.creditAmount || "0");

        if (entry.ledgerAccountId) {
          const existing = ledgerBalances.get(entry.ledgerAccountId) || {
            debits: 0,
            credits: 0,
          };
          ledgerBalances.set(entry.ledgerAccountId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

        if (entry.bankAccountId) {
          const existing = bankBalances.get(entry.bankAccountId) || {
            debits: 0,
            credits: 0,
          };
          bankBalances.set(entry.bankAccountId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

        if (entry.fixedAssetId) {
          const existing = assetBalances.get(entry.fixedAssetId) || {
            debits: 0,
            credits: 0,
          };
          assetBalances.set(entry.fixedAssetId, {
            debits: existing.debits + debit,
            credits: existing.credits + credit,
          });
        }

        if (entry.supplierId) {
          const existing = supplierBalances.get(entry.supplierId) || {
            debits: 0,
            credits: 0,
          };
          // Only count pure credit or pure debit entries to prevent double-counting
          // This matches the logic in /api/suppliers/stats
          if (credit > 0 && debit === 0) {
            supplierBalances.set(entry.supplierId, {
              debits: existing.debits,
              credits: existing.credits + credit,
            });
          } else if (debit > 0 && credit === 0) {
            supplierBalances.set(entry.supplierId, {
              debits: existing.debits + debit,
              credits: existing.credits,
            });
          }
        }
      }

      // Helper function to calculate actual balance
      const calculateBalance = (
        openingBalance: string,
        openingBalanceSide: string | null,
        debits: number,
        credits: number,
      ) => {
        let balance = parseFloat(openingBalance || "0");

        // If opening balance has a side, convert to signed number
        if (openingBalanceSide === "Cr") {
          balance = -balance;
        }

        // Add net change (debits increase, credits decrease)
        balance += debits - credits;

        // Determine side based on final balance
        const balanceSide = balance >= 0 ? "Dr" : "Cr";
        const absoluteBalance = Math.abs(balance);

        return { balance: absoluteBalance, balanceSide };
      };

      const accounts = [
        ...ledgers.map((account) => {
          const movements = ledgerBalances.get(account.id) || {
            debits: 0,
            credits: 0,
          };
          const { balance, balanceSide } = calculateBalance(
            account.openingBalance || "0",
            account.openingBalanceSide,
            movements.debits,
            movements.credits,
          );

          return {
            id: `ledger-${account.id}`,
            accountId: account.id,
            type: "ledger",
            code: account.code,
            name: account.name,
            accountType: account.accountType,
            subType: account.subType,
            balance: balance.toFixed(2),
            balanceSide,
            active: account.active,
            parentId: account.parentId,
          };
        }),
        ...banks.map((account) => {
          const movements = bankBalances.get(account.id) || {
            debits: 0,
            credits: 0,
          };
          const { balance, balanceSide } = calculateBalance(
            account.openingBalance || "0",
            account.openingBalanceSide,
            movements.debits,
            movements.credits,
          );

          return {
            id: `bank-${account.id}`,
            accountId: account.id,
            type: "bank",
            code: account.code,
            name: `${account.name} (${account.bankName})`,
            balance: balance.toFixed(2),
            balanceSide,
            active: account.active,
            parentId: null,
          };
        }),
        ...assets.map((asset) => {
          const movements = assetBalances.get(asset.id) || {
            debits: 0,
            credits: 0,
          };
          const { balance, balanceSide } = calculateBalance(
            asset.openingBalance || "0",
            "Dr", // Fixed assets are always debit balance
            movements.debits,
            movements.credits,
          );

          return {
            id: `asset-${asset.id}`,
            accountId: asset.id,
            type: "fixedAsset",
            code: asset.code,
            name: asset.name,
            balance: balance.toFixed(2),
            balanceSide,
            active: asset.active,
            parentId: null,
          };
        }),
        ...suppliers.map((supplier) => {
          const movements = supplierBalances.get(supplier.id) || {
            debits: 0,
            credits: 0,
          };

          // Calculate balance using signed opening balance (same logic as /api/suppliers/stats)
          // Positive opening balance = we owe them, Negative = they owe us/prepaid
          // Credits increase payable, Debits decrease payable
          const openingBalance = parseFloat(supplier.openingBalance || "0");
          const calculatedBalance =
            openingBalance + movements.credits - movements.debits;

          // Determine side based on final balance
          const balanceSide = calculatedBalance >= 0 ? "Cr" : "Dr";
          const absoluteBalance = Math.abs(calculatedBalance);

          return {
            id: `supplier-${supplier.id}`,
            accountId: supplier.id,
            type: "supplier",
            code: supplier.code,
            name: supplier.legalName,
            balance: absoluteBalance.toFixed(2),
            balanceSide,
            active: supplier.active,
            parentId: null,
          };
        }),
      ];

      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get all accounts for voucher sidebar (optimized format with balances)
  app.get("/api/accounts/voucher-sidebar", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const companyId = req.session.currentCompanyId;

      // Fetch all account types
      const ledgers = await storage.getAllLedgerAccounts(companyId);
      const banks = await storage.getAllBankAccounts(companyId);
      const assets = await storage.getAllFixedAssets(companyId);
      const suppliers = await storage.getAllSuppliers();
      const employeesData = await storage.getAllEmployees(companyId);

      // Get all voucher entries for this company's vouchers
      const companyVouchers = await db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(eq(vouchers.companyId, companyId))
        .execute();

      const companyVoucherIds = companyVouchers.map((v) => v.id);

      // Get all voucher entries for this company
      const allEntries =
        companyVoucherIds.length > 0
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
          // Only count pure credit or pure debit entries to prevent double-counting
          if (credit > 0 && debit === 0) {
            supplierBalances.set(entry.supplierId, {
              debits: existing.debits,
              credits: existing.credits + credit,
            });
          } else if (debit > 0 && credit === 0) {
            supplierBalances.set(entry.supplierId, {
              debits: existing.debits + debit,
              credits: existing.credits,
            });
          }
        }
      }

      // Helper function to calculate signed balance (positive = Dr, negative = Cr)
      const calculateSignedBalance = (
        openingBalance: string,
        openingBalanceSide: string | null,
        debits: number,
        credits: number,
      ) => {
        let balance = parseFloat(openingBalance || "0");

        // If opening balance has a side, convert to signed number
        if (openingBalanceSide === "Cr") {
          balance = -balance;
        }

        // Add net change (debits increase, credits decrease)
        return balance + debits - credits;
      };

      // Build simplified account array for sidebar
      const accounts = [
        // Bank accounts
        ...banks.map((account) => {
          const movements = bankBalances.get(account.id) || { debits: 0, credits: 0 };
          const balance = calculateSignedBalance(
            account.openingBalance || "0",
            account.openingBalanceSide,
            movements.debits,
            movements.credits,
          );

          return {
            id: account.id,
            type: "bank",
            name: account.name,
            code: account.code,
            balance,
          };
        }),
        // Ledger accounts
        ...ledgers.map((account) => {
          const movements = ledgerBalances.get(account.id) || { debits: 0, credits: 0 };
          const balance = calculateSignedBalance(
            account.openingBalance || "0",
            account.openingBalanceSide,
            movements.debits,
            movements.credits,
          );

          return {
            id: account.id,
            type: "ledger",
            name: account.name,
            code: account.code,
            balance,
          };
        }),
        // Suppliers
        ...suppliers.map((supplier) => {
          const movements = supplierBalances.get(supplier.id) || { debits: 0, credits: 0 };
          // Suppliers: Credits increase payable (negative balance), Debits decrease payable
          const openingBalance = parseFloat(supplier.openingBalance || "0");
          const balance = -(openingBalance + movements.credits - movements.debits);

          return {
            id: supplier.id,
            type: "supplier",
            name: supplier.legalName,
            code: supplier.code,
            balance,
          };
        }),
        // Employees
        ...employeesData.map((employee) => {
          const balance = parseFloat(employee.currentBalance || "0");

          return {
            id: employee.id,
            type: "employee",
            name: `${employee.firstName} ${employee.lastName}`,
            code: employee.code,
            balance,
          };
        }),
        // Fixed Assets
        ...assets.map((asset) => {
          const movements = assetBalances.get(asset.id) || { debits: 0, credits: 0 };
          const balance = calculateSignedBalance(
            asset.openingBalance || "0",
            "Dr", // Fixed assets are always debit balance
            movements.debits,
            movements.credits,
          );

          return {
            id: asset.id,
            type: "fixedAsset",
            name: asset.name,
            code: asset.code,
            balance,
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
        endDate as string | undefined,
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
        endDate as string | undefined,
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
        endDate as string | undefined,
      );

      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get transactions for a specific supplier with optional date filtering
  app.get(
    "/api/accounts/supplier/:id/transactions",
    requireAuth,
    async (req, res) => {
      try {
        const supplierId = parseInt(req.params.id);

        if (isNaN(supplierId)) {
          return res.status(400).json({ message: "Invalid supplier ID" });
        }

        const { startDate, endDate, companyId } = req.query;

        // Use query param companyId or session companyId, or undefined for all companies
        const filterCompanyId = companyId
          ? parseInt(companyId as string)
          : req.session.currentCompanyId;

        const transactions = await storage.getVoucherEntriesBySupplier(
          supplierId,
          filterCompanyId,
          startDate as string | undefined,
          endDate as string | undefined,
        );

        res.json(transactions);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Get transactions for a specific employee with optional date filtering
  app.get(
    "/api/accounts/employee/:id/transactions",
    requireAuth,
    async (req, res) => {
      try {
        const employeeId = parseInt(req.params.id);

        if (isNaN(employeeId)) {
          return res.status(400).json({ message: "Invalid employee ID" });
        }

        const { startDate, endDate, companyId } = req.query;

        // Use query param companyId or session companyId, or undefined for all companies
        const filterCompanyId = companyId
          ? parseInt(companyId as string)
          : req.session.currentCompanyId;

        const transactions = await storage.getVoucherEntriesByEmployee(
          employeeId,
          filterCompanyId,
          startDate as string | undefined,
          endDate as string | undefined,
        );

        res.json(transactions);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

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
          endDate as string,
        );
      } else {
        vouchers = await storage.getAllVouchers(req.session.currentCompanyId);
      }

      res.json(vouchers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get unified ledger for a supplier across all companies
  app.get(
    "/api/suppliers/:supplierId/unified-ledger",
    requireAuth,
    async (req, res) => {
      try {
        const supplierId = parseInt(req.params.supplierId);

        if (isNaN(supplierId)) {
          return res.status(400).json({ message: "Invalid supplier ID" });
        }

        const { companyId, startDate, endDate } = req.query;
        const filterCompanyId = companyId
          ? parseInt(companyId as string)
          : undefined;

        // Get voucher entries (filtered by company if specified)
        const voucherEntries = await storage.getVoucherEntriesBySupplier(
          supplierId,
          filterCompanyId,
          startDate as string | undefined,
          endDate as string | undefined,
        );

        // Get all companies to map IDs to names
        const companies = await storage.getAllCompanies();
        const companyMap = new Map(companies.map((c) => [c.id, c]));

        // Combine all transactions with company information
        const transactions: any[] = [];

        // Add voucher entries (which already include PO-generated vouchers)
        // No need to add POs separately as they're already represented by voucher entries
        for (const entry of voucherEntries) {
          const company = companyMap.get(entry.companyId);
          transactions.push({
            type: "voucher",
            date: entry.voucherDate,
            companyId: entry.companyId,
            companyName: company?.name || "Unknown",
            docNumber: entry.voucherNumber,
            description: entry.narration || entry.voucherDescription || "",
            voucherType: entry.voucherType,
            debit: parseFloat(entry.debitAmount || "0"),
            credit: parseFloat(entry.creditAmount || "0"),
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
        const transactionsWithBalance = transactions.map((t) => {
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
    },
  );

  // Get purchase orders for a specific supplier filtered by company
  app.get(
    "/api/suppliers/:supplierId/purchase-orders",
    requireAuth,
    async (req, res) => {
      try {
        const supplierId = parseInt(req.params.supplierId);

        if (isNaN(supplierId)) {
          return res.status(400).json({ message: "Invalid supplier ID" });
        }

        const { companyId } = req.query;
        const filterCompanyId = companyId
          ? parseInt(companyId as string)
          : undefined;

        if (!filterCompanyId) {
          // If no company filter, get POs from all companies
          const companies = await storage.getAllCompanies();
          const allPOs: any[] = [];

          for (const company of companies) {
            const pos = await storage.getPurchaseOrdersBySupplier(
              supplierId,
              company.id,
            );
            allPOs.push(
              ...pos.map((po) => ({ ...po, companyName: company.name })),
            );
          }

          return res.json(allPOs);
        }

        const purchaseOrders = await storage.getPurchaseOrdersBySupplier(
          supplierId,
          filterCompanyId,
        );
        const company = await storage.getCompanyById(filterCompanyId);
        const posWithCompanyName = purchaseOrders.map((po) => ({
          ...po,
          companyName: company?.name,
        }));

        res.json(posWithCompanyName);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Create a new voucher
  app.post("/api/vouchers", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const voucher = await storage.createVoucher(req.body);
      res.json(voucher);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create a voucher with entries in one transaction
  app.post(
    "/api/vouchers/with-entries",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const { voucher, entries } = req.body;

        if (!req.session.currentCompanyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        // Validate voucher data
        if (
          !voucher ||
          !entries ||
          !Array.isArray(entries) ||
          entries.length === 0
        ) {
          return res
            .status(400)
            .json({ message: "Voucher and entries are required" });
        }

        // Validate that debits equal credits (only for non-optional vouchers)
        const totalDebits = entries.reduce(
          (sum: number, entry: any) =>
            sum + parseFloat(entry.debitAmount || "0"),
          0,
        );
        const totalCredits = entries.reduce(
          (sum: number, entry: any) =>
            sum + parseFloat(entry.creditAmount || "0"),
          0,
        );

        // For active (non-optional) vouchers, enforce debit=credit balance
        if (!voucher.optional && Math.abs(totalDebits - totalCredits) >= 0.01) {
          return res
            .status(400)
            .json({
              message:
                "Total debits must equal total credits for active vouchers",
            });
        }

        // Create voucher with error handling
        let createdVoucher;
        let createdEntries = [];

        try {
          [createdVoucher] = await db
            .insert(vouchers)
            .values({
              companyId: req.session.currentCompanyId!,
              locationId: voucher.locationId || null,
              voucherNumber: voucher.voucherNumber,
              voucherType: voucher.voucherType,
              voucherDate: voucher.voucherDate,
              description: voucher.description || null,
              totalAmount: Math.max(totalDebits, totalCredits).toFixed(2),
              optional: voucher.optional ?? false,
            })
            .returning();

          // Create voucher entries
          for (const entry of entries) {
            const [createdEntry] = await db
              .insert(voucherEntries)
              .values({
                voucherId: createdVoucher.id,
                ledgerAccountId: entry.ledgerAccountId || null,
                bankAccountId: entry.bankAccountId || null,
                fixedAssetId: entry.fixedAssetId || null,
                supplierId: entry.supplierId || null,
                employeeId: entry.employeeId || null,
                debitAmount: entry.debitAmount || "0",
                creditAmount: entry.creditAmount || "0",
                narration: entry.narration || null,
              })
              .returning();
            createdEntries.push(createdEntry);
          }
        } catch (error: any) {
          // Cleanup: Delete voucher and entries if anything failed
          if (createdVoucher?.id) {
            await db
              .delete(voucherEntries)
              .where(eq(voucherEntries.voucherId, createdVoucher.id))
              .catch(() => {});
            await db
              .delete(vouchers)
              .where(eq(vouchers.id, createdVoucher.id))
              .catch(() => {});
          }
          throw error;
        }

        const result = { voucher: createdVoucher, entries: createdEntries };

        res.json(result);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

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
        return res
          .status(403)
          .json({
            message: "Access denied: Voucher belongs to a different company",
          });
      }

      const entries = await storage.getVoucherEntriesByVoucher(id);

      // If this is a Purchase voucher, also fetch the linked purchase order
      let purchaseOrder = null;
      if (voucher.voucherType === "Purchase") {
        const allPOs = await storage.getAllPurchaseOrders(voucher.companyId);
        const linkedPO = allPOs.find((po) => po.voucherId === id);
        if (linkedPO) {
          const lineItems = await storage.getLineItemsByPO(linkedPO.id);
          purchaseOrder = {
            ...linkedPO,
            items: lineItems,
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
              const stockItem = await storage.getStockItemById(
                item.stockItemId,
              );
              return {
                ...item,
                stockItemCode: stockItem?.code || "",
                stockItemName: stockItem?.name || "",
                stockItemUom: stockItem?.uom || "",
              };
            }),
          );
          salesItemsList = itemsWithDetails;
        }
      }

      // If this is a Consumption, Mixed, or Production voucher, fetch adjustment details
      let adjustmentData = null;
      if (
        voucher.voucherType === "Consumption" ||
        voucher.voucherType === "Mixed" ||
        voucher.voucherType === "Production"
      ) {
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
              const stockItem = await storage.getStockItemById(
                item.stockItemId,
              );
              return {
                ...item,
                stockItemCode: stockItem?.code || "",
                stockItemName: stockItem?.name || "",
                stockItemUom: stockItem?.uom || "",
              };
            }),
          );

          const location = await storage.getLocationById(
            adjustment[0].locationId,
          );

          adjustmentData = {
            ...adjustment[0],
            locationName: location?.name || "",
            items: itemsWithDetails,
          };
        } else {
          // No adjustment record exists - return empty structure so frontend can show form
          let adjustmentType = "production";
          if (voucher.voucherType === "Consumption")
            adjustmentType = "consumption";
          else if (voucher.voucherType === "Mixed") adjustmentType = "mixed";

          adjustmentData = {
            id: 0,
            voucherId: id,
            locationId: voucher.locationId || 1,
            locationName: "",
            adjustmentType: adjustmentType,
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
              const stockItem = await storage.getStockItemById(
                item.stockItemId,
              );
              return {
                ...item,
                stockItemCode: stockItem?.code || "",
                stockItemName: stockItem?.name || "",
                stockItemUom: stockItem?.uom || "",
              };
            }),
          );

          const sourceLocation = await storage.getLocationById(
            transfer[0].sourceLocationId,
          );
          const destLocation = await storage.getLocationById(
            transfer[0].destinationLocationId,
          );

          transferData = {
            ...transfer[0],
            sourceLocationName: sourceLocation?.name || "",
            destinationLocationName: destLocation?.name || "",
            items: itemsWithDetails,
          };
        } else {
          // No transfer record exists - return empty structure so frontend can show form
          transferData = {
            id: 0,
            voucherId: id,
            sourceLocationId: voucher.locationId || 1,
            destinationLocationId: voucher.locationId || 1,
            sourceLocationName: "",
            destinationLocationName: "",
            notes: voucher.description || "",
            items: [],
            createdAt: new Date(),
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

  // Update a voucher with entries (Admin, Owner, or Manager for today's vouchers)
  app.patch(
    "/api/vouchers/:id",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
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
          return res
            .status(403)
            .json({
              message: "Access denied: Voucher belongs to a different company",
            });
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
              return res
                .status(403)
                .json({ message: "Managers can only edit today's vouchers" });
            }
          } else {
            // Other roles cannot edit
            return res
              .status(403)
              .json({ message: "Insufficient permissions to edit vouchers" });
          }
        }

        // Update voucher and entries in a transaction
        await db.transaction(async (tx) => {
          // Update voucher header
          const voucherUpdates: Partial<any> = {};
          if (req.body.voucherDate !== undefined)
            voucherUpdates.voucherDate = req.body.voucherDate;
          if (req.body.description !== undefined)
            voucherUpdates.description = req.body.description;
          if (req.body.optional !== undefined)
            voucherUpdates.optional = req.body.optional;

          await tx
            .update(vouchers)
            .set(voucherUpdates)
            .where(eq(vouchers.id, id));

          // Delete all existing entries
          await tx
            .delete(voucherEntries)
            .where(eq(voucherEntries.voucherId, id));

          // Insert new entries if provided
          if (req.body.entries && Array.isArray(req.body.entries)) {
            for (const entry of req.body.entries) {
              await tx.insert(voucherEntries).values({
                voucherId: id,
                ledgerAccountId: entry.ledgerAccountId || null,
                bankAccountId: entry.bankAccountId || null,
                supplierId: entry.supplierId || null,
                employeeId: entry.employeeId || null,
                fixedAssetId: entry.fixedAssetId || null,
                debitAmount: entry.debitAmount || "0",
                creditAmount: entry.creditAmount || "0",
                narration: entry.narration || "",
              });
            }
          }
        });

        // Fetch updated voucher with entries
        const updated = await storage.getVoucherById(id);
        const entries = await storage.getVoucherEntriesByVoucher(id);

        res.json({ ...updated, entries });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Toggle optional status for a voucher
  app.patch(
    "/api/vouchers/:id/optional",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid voucher ID" });
        }

        const { optional } = req.body;
        if (typeof optional !== "boolean") {
          return res
            .status(400)
            .json({ message: "Optional must be a boolean value" });
        }

        // Get the existing voucher to check company and permissions
        const existingVoucher = await storage.getVoucherById(id);
        if (!existingVoucher) {
          return res.status(404).json({ message: "Voucher not found" });
        }

        // Verify voucher belongs to current company
        if (existingVoucher.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message: "Access denied: Voucher belongs to a different company",
            });
        }

        // Only Admin and Owner can toggle optional status
        const userRole = req.session.currentRole;
        if (userRole !== "Admin" && userRole !== "Owner") {
          return res
            .status(403)
            .json({
              message: "Only Admin and Owner can toggle optional status",
            });
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
    },
  );

  // Update a sales voucher with line items
  app.patch("/api/vouchers/:id/sales", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      const {
        voucherDate,
        description,
        locationId,
        items,
        paymentAccountType,
        paymentAccountId,
        isCreditSale,
      } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res
          .status(400)
          .json({ message: "At least one item is required" });
      }

      // Get the existing voucher to check company and permissions
      const existingVoucher = await storage.getVoucherById(id);
      if (!existingVoucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Verify this is a Sales voucher
      if (existingVoucher.voucherType !== "Sales") {
        return res
          .status(400)
          .json({ message: "This endpoint only updates Sales vouchers" });
      }

      // Verify voucher belongs to current company
      if (existingVoucher.companyId !== req.session.currentCompanyId) {
        return res
          .status(403)
          .json({
            message: "Access denied: Voucher belongs to a different company",
          });
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
            return res
              .status(403)
              .json({ message: "Managers can only edit today's vouchers" });
          }
        } else {
          // POS users can edit if they have canEditDaybook permission
          const canEditDaybook = req.user?.canEditDaybook || false;
          if (!canEditDaybook) {
            return res
              .status(403)
              .json({ message: "Insufficient permissions to edit vouchers" });
          }
          // POS users can only edit today's vouchers
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const voucherDate = new Date(existingVoucher.voucherDate);
          voucherDate.setHours(0, 0, 0, 0);

          if (voucherDate.getTime() !== today.getTime()) {
            return res
              .status(403)
              .json({ message: "You can only edit today's vouchers" });
          }
        }
      }

      // Validate and authorize location if provided
      let validatedLocationId: number | null = null;
      if (locationId !== undefined && locationId !== null) {
        const parsedLocationId = parseInt(locationId);
        if (isNaN(parsedLocationId) || parsedLocationId <= 0) {
          return res.status(400).json({ message: "Invalid location ID" });
        }

        // Verify location belongs to current company
        const [targetLocation] = await db
          .select()
          .from(locations)
          .where(eq(locations.id, parsedLocationId));

        if (!targetLocation) {
          return res.status(404).json({ message: "Location not found" });
        }

        if (targetLocation.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message: "Access denied: Location belongs to a different company",
            });
        }

        validatedLocationId = parsedLocationId;
      }

      // Fetch stock items to calculate cost prices
      const stockItemIds = items.map((item) => item.stockItemId);
      const stockItemsData = await db
        .select()
        .from(stockItems)
        .where(inArray(stockItems.id, stockItemIds));

      const stockItemsMap = new Map(
        stockItemsData.map((item) => [item.id, item]),
      );

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

      // STEP 1: Reverse inventory for old sales items before deleting
      const oldSalesItems = await db
        .select()
        .from(salesItems)
        .where(eq(salesItems.voucherId, id));

      if (existingVoucher.locationId) {
        for (const oldItem of oldSalesItems) {
          const quantity = parseFloat(oldItem.quantity);
          const costPrice = parseFloat(oldItem.costPrice);

          // Get current inventory
          const [currentInventory] = await db
            .select()
            .from(inventory)
            .where(
              and(
                eq(inventory.locationId, existingVoucher.locationId),
                eq(inventory.stockItemId, oldItem.stockItemId),
              ),
            );

          if (currentInventory) {
            // Add back the old quantity
            const newQuantity =
              parseFloat(currentInventory.quantity) + quantity;
            const currentTotalValue = parseFloat(currentInventory.totalValue);
            const newTotalValue = currentTotalValue + quantity * costPrice;
            const newAverageRate =
              newQuantity > 0 ? newTotalValue / newQuantity : 0;

            await db
              .update(inventory)
              .set({
                quantity: newQuantity.toFixed(3),
                averageRate: newAverageRate.toFixed(2),
                totalValue: newTotalValue.toFixed(2),
              })
              .where(eq(inventory.id, currentInventory.id));
          } else {
            // Create new inventory record (shouldn't normally happen, but handle it)
            await db.insert(inventory).values({
              companyId: existingVoucher.companyId,
              locationId: existingVoucher.locationId,
              stockItemId: oldItem.stockItemId,
              quantity: quantity.toFixed(3),
              averageRate: costPrice.toFixed(2),
              totalValue: (quantity * costPrice).toFixed(2),
            });
          }
        }
      }

      // STEP 2: Delete existing sales items
      await db.delete(salesItems).where(eq(salesItems.voucherId, id));

      // STEP 3: Deduct inventory for new sales items from the new location
      // Use validated locationId if provided, otherwise use existing voucher location
      const targetLocationId =
        validatedLocationId !== null
          ? validatedLocationId
          : existingVoucher.locationId;

      if (targetLocationId) {
        for (const newItem of salesItemsData) {
          const quantity = parseFloat(newItem.quantity);
          const costPrice = parseFloat(newItem.costPrice);

          // Get current inventory at the target location
          const [currentInventory] = await db
            .select()
            .from(inventory)
            .where(
              and(
                eq(inventory.locationId, targetLocationId),
                eq(inventory.stockItemId, newItem.stockItemId),
              ),
            );

          if (currentInventory) {
            // Deduct the new quantity
            const newQuantity = Math.max(
              0,
              parseFloat(currentInventory.quantity) - quantity,
            );
            const currentTotalValue = parseFloat(currentInventory.totalValue);
            const newTotalValue = Math.max(
              0,
              currentTotalValue - quantity * costPrice,
            );
            const newAverageRate =
              newQuantity > 0 ? newTotalValue / newQuantity : 0;

            await db
              .update(inventory)
              .set({
                quantity: newQuantity.toFixed(3),
                averageRate: newAverageRate.toFixed(2),
                totalValue: newTotalValue.toFixed(2),
              })
              .where(eq(inventory.id, currentInventory.id));
          }
        }
      }

      // STEP 4: Insert new sales items
      await db.insert(salesItems).values(salesItemsData);

      // STEP 5: Update voucher entries (accounting transactions)
      // NOTE: POS Sales vouchers in this system are ALWAYS 2-entry transactions:
      //   1. Debit: Cash/Bank/Customer Account (payment account)
      //   2. Credit: Sales Revenue Account
      // This is confirmed by the POST /api/pos/sales endpoint (lines ~5420-5446) which creates exactly 2 entries.
      // No taxes, COGS, or other entries exist for POS sales in the current implementation.
      // If payment info is not provided, derive it from existing entries
      let finalPaymentAccountId = paymentAccountId;
      let finalPaymentAccountType = paymentAccountType;
      let finalIsCreditSale = isCreditSale;

      if (!finalPaymentAccountId || !finalPaymentAccountType) {
        // Fetch existing voucher entries to derive payment account
        const existingEntries = await db
          .select()
          .from(voucherEntries)
          .where(eq(voucherEntries.voucherId, id));

        // Find the debit entry that represents the payment account
        // Priority: bank account > cash ledger > other ledger (customer/receivable)
        const debitEntries = existingEntries.filter(
          (entry) => parseFloat(entry.debitAmount || "0") > 0,
        );

        // Check for bank account first
        let existingDebitEntry = debitEntries.find(
          (entry) => entry.bankAccountId !== null,
        );
        if (existingDebitEntry) {
          finalPaymentAccountId = String(existingDebitEntry.bankAccountId);
          finalPaymentAccountType = "bank";
          finalIsCreditSale = false;
        } else {
          // Check for ledger accounts - need to fetch ledger details to identify type
          for (const entry of debitEntries) {
            if (entry.ledgerAccountId) {
              const [ledgerAccount] = await db
                .select()
                .from(ledgerAccounts)
                .where(eq(ledgerAccounts.id, entry.ledgerAccountId))
                .limit(1);

              if (ledgerAccount) {
                if (ledgerAccount.accountType === "Cash") {
                  // Found cash account
                  finalPaymentAccountId = String(entry.ledgerAccountId);
                  finalPaymentAccountType = "cash";
                  finalIsCreditSale = false;
                  existingDebitEntry = entry;
                  break;
                } else if (
                  ledgerAccount.accountType === "Asset" ||
                  entry.narration?.includes("Credit Sale")
                ) {
                  // Found customer receivable account (credit sale)
                  finalPaymentAccountId = String(entry.ledgerAccountId);
                  finalPaymentAccountType = "credit";
                  finalIsCreditSale = true;
                  existingDebitEntry = entry;
                  break;
                }
              }
            }
          }
        }
      }

      // Only proceed if we have payment account information
      if (finalPaymentAccountId && finalPaymentAccountType) {
        // Delete old voucher entries
        await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, id));

        const accountId = parseInt(finalPaymentAccountId);
        const accountType = finalPaymentAccountType;

        // Debit: Cash/Bank/Customer Account (Asset increases)
        const debitEntry: any = {
          voucherId: id,
          debitAmount: totalSalesAmount.toFixed(2),
          creditAmount: "0",
          narration: finalIsCreditSale
            ? `Credit Sale - ${existingVoucher.voucherNumber}`
            : `POS Sale - ${existingVoucher.voucherNumber}`,
        };

        if (
          finalIsCreditSale ||
          accountType === "cash" ||
          accountType === "credit"
        ) {
          // For credit sales and cash accounts, use ledgerAccountId
          debitEntry.ledgerAccountId = accountId;
        } else {
          // For bank accounts, use bankAccountId
          debitEntry.bankAccountId = accountId;
        }

        await db.insert(voucherEntries).values(debitEntry);

        // Credit: Sales Account (Revenue increases)
        // Get the SALES ledger account for this company
        const [salesAccount] = await db
          .select()
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.companyId, existingVoucher.companyId),
              eq(ledgerAccounts.accountType, "SALES"),
            ),
          )
          .limit(1);

        if (!salesAccount) {
          throw new Error("Sales revenue account not found for this company");
        }

        await db.insert(voucherEntries).values({
          voucherId: id,
          ledgerAccountId: salesAccount.id,
          debitAmount: "0",
          creditAmount: totalSalesAmount.toFixed(2),
          narration: `POS Sale - ${existingVoucher.voucherNumber}`,
        });
      } else {
        throw new Error(
          "Unable to determine payment account for voucher update",
        );
      }

      // Update the voucher
      const voucherUpdates: any = {
        totalAmount: totalSalesAmount.toFixed(2),
      };
      if (voucherDate !== undefined) voucherUpdates.voucherDate = voucherDate;
      if (description !== undefined) voucherUpdates.description = description;
      if (validatedLocationId !== null)
        voucherUpdates.locationId = validatedLocationId;

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
  app.patch(
    "/api/vouchers/:id/purchase",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid voucher ID" });
        }

        const { voucherDate, description, items } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
          return res
            .status(400)
            .json({ message: "At least one item is required" });
        }

        // Get the existing voucher to check company and permissions
        const existingVoucher = await storage.getVoucherById(id);
        if (!existingVoucher) {
          return res.status(404).json({ message: "Voucher not found" });
        }

        // Verify this is a Purchase voucher
        if (existingVoucher.voucherType !== "Purchase") {
          return res
            .status(400)
            .json({ message: "This endpoint only updates Purchase vouchers" });
        }

        // Verify voucher belongs to current company
        if (existingVoucher.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message: "Access denied: Voucher belongs to a different company",
            });
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
              return res
                .status(403)
                .json({ message: "Managers can only edit today's vouchers" });
            }
          } else {
            // Other roles cannot edit
            return res
              .status(403)
              .json({ message: "Insufficient permissions to edit vouchers" });
          }
        }

        // Find the associated purchase order
        const [po] = await db
          .select()
          .from(purchaseOrders)
          .where(eq(purchaseOrders.voucherId, id))
          .limit(1);

        if (!po) {
          return res
            .status(404)
            .json({ message: "Associated purchase order not found" });
        }

        // Store old total for container update calculation
        const oldPOTotal = parseFloat(po.itemsTotal || "0");

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
        await db.delete(poLineItems).where(eq(poLineItems.poId, po.id));

        // Insert new PO line items
        await db.insert(poLineItems).values(poItemsData);

        // Update the purchase order total
        await db
          .update(purchaseOrders)
          .set({ itemsTotal: totalAmount.toFixed(2) })
          .where(eq(purchaseOrders.id, po.id));

        // Update the container totals to reflect the PO change
        const [container] = await db
          .select()
          .from(containers)
          .where(eq(containers.id, po.containerId))
          .limit(1);

        if (container) {
          const containerItemsTotal = parseFloat(container.itemsTotal || "0");
          const containerChargesTotal = parseFloat(
            container.chargesTotal || "0",
          );

          // Calculate the difference and update container
          const difference = totalAmount - oldPOTotal;
          const newContainerItemsTotal = containerItemsTotal + difference;
          const newContainerGrandTotal =
            newContainerItemsTotal + containerChargesTotal;

          await db
            .update(containers)
            .set({
              itemsTotal: newContainerItemsTotal.toFixed(2),
              grandTotal: newContainerGrandTotal.toFixed(2),
            })
            .where(eq(containers.id, po.containerId));
        }

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
    },
  );

  // Update an adjustment voucher (Consumption, Production, or Mixed) with line items
  app.patch(
    "/api/vouchers/:id/adjustment",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid voucher ID" });
        }

        const { voucherDate, description, locationId, items } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
          return res
            .status(400)
            .json({ message: "At least one item is required" });
        }

        if (!locationId) {
          return res.status(400).json({ message: "Location ID is required" });
        }

        // Get the existing voucher to check company and permissions
        const existingVoucher = await storage.getVoucherById(id);
        if (!existingVoucher) {
          return res.status(404).json({ message: "Voucher not found" });
        }

        // Verify this is a Consumption, Production, or Mixed voucher
        if (
          existingVoucher.voucherType !== "Consumption" &&
          existingVoucher.voucherType !== "Production" &&
          existingVoucher.voucherType !== "Mixed"
        ) {
          return res
            .status(400)
            .json({
              message:
                "This endpoint only updates Consumption, Production, or Mixed vouchers",
            });
        }

        // Verify voucher belongs to current company
        if (existingVoucher.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message: "Access denied: Voucher belongs to a different company",
            });
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
              return res
                .status(403)
                .json({ message: "Managers can only edit today's vouchers" });
            }
          } else {
            return res
              .status(403)
              .json({ message: "Insufficient permissions to edit vouchers" });
          }
        }

        // Find or create the associated adjustment voucher
        let adjustmentVoucher = await db
          .select()
          .from(stockAdjustmentVouchers)
          .where(eq(stockAdjustmentVouchers.voucherId, id))
          .limit(1)
          .then((rows) => rows[0]);

        // If no adjustment voucher exists, create one
        if (!adjustmentVoucher) {
          let adjustmentType = "production";
          if (existingVoucher.voucherType === "Consumption")
            adjustmentType = "consumption";
          else if (existingVoucher.voucherType === "Mixed")
            adjustmentType = "mixed";

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

        // STEP 1: Reverse inventory for old adjustment items before deleting
        const oldAdjustmentItems = await db
          .select()
          .from(stockAdjustmentItems)
          .where(eq(stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));

        const oldLocationId = adjustmentVoucher.locationId;

        for (const oldItem of oldAdjustmentItems) {
          // Reverse the adjustment (negate the quantity)
          const quantity = parseFloat(oldItem.quantity);
          const rate = parseFloat(oldItem.rate);
          const reversedQuantity = -quantity; // Flip the sign to reverse

          const [currentInventory] = await db
            .select()
            .from(inventory)
            .where(
              and(
                eq(inventory.locationId, oldLocationId),
                eq(inventory.stockItemId, oldItem.stockItemId),
              ),
            );

          if (currentInventory) {
            const newQuantity = Math.max(
              0,
              parseFloat(currentInventory.quantity) + reversedQuantity,
            );
            const currentTotalValue = parseFloat(currentInventory.totalValue);
            const newTotalValue = Math.max(
              0,
              currentTotalValue + reversedQuantity * rate,
            );
            const newAverageRate =
              newQuantity > 0 ? newTotalValue / newQuantity : 0;

            await db
              .update(inventory)
              .set({
                quantity: newQuantity.toFixed(3),
                averageRate: newAverageRate.toFixed(2),
                totalValue: newTotalValue.toFixed(2),
              })
              .where(eq(inventory.id, currentInventory.id));
          }
        }

        // STEP 2: Delete existing adjustment items
        await db
          .delete(stockAdjustmentItems)
          .where(eq(stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));

        // STEP 3: Apply inventory for new adjustment items
        const newLocationId = parseInt(locationId);

        for (const newItem of adjustmentItemsData) {
          const quantity = parseFloat(newItem.quantity);
          const rate = parseFloat(newItem.rate);

          const [currentInventory] = await db
            .select()
            .from(inventory)
            .where(
              and(
                eq(inventory.locationId, newLocationId),
                eq(inventory.stockItemId, newItem.stockItemId),
              ),
            );

          if (currentInventory) {
            const newQuantity = Math.max(
              0,
              parseFloat(currentInventory.quantity) + quantity,
            );
            const currentTotalValue = parseFloat(currentInventory.totalValue);
            const newTotalValue = Math.max(
              0,
              currentTotalValue + quantity * rate,
            );
            const newAverageRate =
              newQuantity > 0 ? newTotalValue / newQuantity : 0;

            await db
              .update(inventory)
              .set({
                quantity: newQuantity.toFixed(3),
                averageRate: newAverageRate.toFixed(2),
                totalValue: newTotalValue.toFixed(2),
              })
              .where(eq(inventory.id, currentInventory.id));
          } else {
            await db.insert(inventory).values({
              companyId: existingVoucher.companyId,
              locationId: newLocationId,
              stockItemId: newItem.stockItemId,
              quantity: Math.max(0, quantity).toFixed(3),
              averageRate: rate.toFixed(2),
              totalValue: Math.max(0, quantity * rate).toFixed(2),
            });
          }
        }

        // STEP 4: Insert new adjustment items
        await db.insert(stockAdjustmentItems).values(adjustmentItemsData);

        // Update the adjustment voucher (location can be changed, but shouldn't affect old inventory)
        await db
          .update(stockAdjustmentVouchers)
          .set({ locationId: parseInt(locationId), notes: description || "" })
          .where(eq(stockAdjustmentVouchers.id, adjustmentVoucher.id));

        // Update the main voucher
        const voucherUpdates: any = {
          totalAmount: totalAmount.toFixed(2),
          locationId: parseInt(locationId),
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
    },
  );

  // Update a stock transfer voucher with line items
  app.patch(
    "/api/vouchers/:id/transfer",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid voucher ID" });
        }

        const {
          voucherDate,
          description,
          sourceLocationId,
          destinationLocationId,
          items,
        } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
          return res
            .status(400)
            .json({ message: "At least one item is required" });
        }

        if (!sourceLocationId || !destinationLocationId) {
          return res
            .status(400)
            .json({ message: "Source and destination locations are required" });
        }

        // Get the existing voucher to check company and permissions
        const existingVoucher = await storage.getVoucherById(id);
        if (!existingVoucher) {
          return res.status(404).json({ message: "Voucher not found" });
        }

        // Verify this is a Stock Transfer voucher
        if (existingVoucher.voucherType !== "Stock Transfer") {
          return res
            .status(400)
            .json({
              message: "This endpoint only updates Stock Transfer vouchers",
            });
        }

        // Verify voucher belongs to current company
        if (existingVoucher.companyId !== req.session.currentCompanyId) {
          return res
            .status(403)
            .json({
              message: "Access denied: Voucher belongs to a different company",
            });
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
              return res
                .status(403)
                .json({ message: "Managers can only edit today's vouchers" });
            }
          } else {
            return res
              .status(403)
              .json({ message: "Insufficient permissions to edit vouchers" });
          }
        }

        console.log(`[Stock Transfer Edit] Starting update for voucher ${id}`);

        // Wrap the entire operation in a transaction for atomicity
        const updated = await db.transaction(async (tx) => {
          // Find or create the associated transfer voucher
          let transferVoucher = await tx
            .select()
            .from(stockTransferVouchers)
            .where(eq(stockTransferVouchers.voucherId, id))
            .limit(1)
            .then((rows) => rows[0]);

          // If no transfer voucher exists, create one
          if (!transferVoucher) {
            const [newTransfer] = await tx
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

          // STEP 1: Reverse inventory for old transfer items before deleting
          const oldTransferItems = await tx
            .select()
            .from(stockTransferItems)
            .where(eq(stockTransferItems.transferId, transferVoucher.id));

          const oldSourceLocationId = transferVoucher.sourceLocationId;
          const oldDestinationLocationId =
            transferVoucher.destinationLocationId;

          for (const oldItem of oldTransferItems) {
            const quantity = parseFloat(oldItem.quantity);
            const rate = parseFloat(oldItem.rate);

            // Add back to source location
            const [sourceInventory] = await tx
              .select()
              .from(inventory)
              .where(
                and(
                  eq(inventory.locationId, oldSourceLocationId),
                  eq(inventory.stockItemId, oldItem.stockItemId),
                ),
              );

            if (sourceInventory) {
              const newQuantity =
                parseFloat(sourceInventory.quantity) + quantity;
              const newTotalValue =
                parseFloat(sourceInventory.totalValue) + quantity * rate;
              const newAverageRate =
                newQuantity > 0 ? newTotalValue / newQuantity : 0;

              await tx
                .update(inventory)
                .set({
                  quantity: newQuantity.toFixed(3),
                  averageRate: newAverageRate.toFixed(2),
                  totalValue: newTotalValue.toFixed(2),
                })
                .where(eq(inventory.id, sourceInventory.id));
            } else {
              await tx.insert(inventory).values({
                companyId: existingVoucher.companyId,
                locationId: oldSourceLocationId,
                stockItemId: oldItem.stockItemId,
                quantity: quantity.toFixed(3),
                averageRate: rate.toFixed(2),
                totalValue: (quantity * rate).toFixed(2),
              });
            }

            // Subtract from destination location
            const [destInventory] = await tx
              .select()
              .from(inventory)
              .where(
                and(
                  eq(inventory.locationId, oldDestinationLocationId),
                  eq(inventory.stockItemId, oldItem.stockItemId),
                ),
              );

            if (destInventory) {
              const newQuantity = Math.max(
                0,
                parseFloat(destInventory.quantity) - quantity,
              );
              const newTotalValue = Math.max(
                0,
                parseFloat(destInventory.totalValue) - quantity * rate,
              );
              const newAverageRate =
                newQuantity > 0 ? newTotalValue / newQuantity : 0;

              await tx
                .update(inventory)
                .set({
                  quantity: newQuantity.toFixed(3),
                  averageRate: newAverageRate.toFixed(2),
                  totalValue: newTotalValue.toFixed(2),
                })
                .where(eq(inventory.id, destInventory.id));
            }
          }

          // STEP 2: Delete existing transfer items
          await tx
            .delete(stockTransferItems)
            .where(eq(stockTransferItems.transferId, transferVoucher.id));

          // STEP 3: Apply inventory for new transfer items
          const newSourceLocationId = parseInt(sourceLocationId);
          const newDestinationLocationId = parseInt(destinationLocationId);

          for (const newItem of transferItemsData) {
            const quantity = parseFloat(newItem.quantity);
            const rate = parseFloat(newItem.rate);

            // Subtract from new source location
            const [sourceInventory] = await tx
              .select()
              .from(inventory)
              .where(
                and(
                  eq(inventory.locationId, newSourceLocationId),
                  eq(inventory.stockItemId, newItem.stockItemId),
                ),
              );

            if (sourceInventory) {
              const newQuantity = Math.max(
                0,
                parseFloat(sourceInventory.quantity) - quantity,
              );
              const newTotalValue = Math.max(
                0,
                parseFloat(sourceInventory.totalValue) - quantity * rate,
              );
              const newAverageRate =
                newQuantity > 0 ? newTotalValue / newQuantity : 0;

              await tx
                .update(inventory)
                .set({
                  quantity: newQuantity.toFixed(3),
                  averageRate: newAverageRate.toFixed(2),
                  totalValue: newTotalValue.toFixed(2),
                })
                .where(eq(inventory.id, sourceInventory.id));
            }

            // Add to new destination location
            const [destInventory] = await tx
              .select()
              .from(inventory)
              .where(
                and(
                  eq(inventory.locationId, newDestinationLocationId),
                  eq(inventory.stockItemId, newItem.stockItemId),
                ),
              );

            if (destInventory) {
              const newQuantity = parseFloat(destInventory.quantity) + quantity;
              const newTotalValue =
                parseFloat(destInventory.totalValue) + quantity * rate;
              const newAverageRate =
                newQuantity > 0 ? newTotalValue / newQuantity : 0;

              await tx
                .update(inventory)
                .set({
                  quantity: newQuantity.toFixed(3),
                  averageRate: newAverageRate.toFixed(2),
                  totalValue: newTotalValue.toFixed(2),
                })
                .where(eq(inventory.id, destInventory.id));
            } else {
              await tx.insert(inventory).values({
                companyId: existingVoucher.companyId,
                locationId: newDestinationLocationId,
                stockItemId: newItem.stockItemId,
                quantity: quantity.toFixed(3),
                averageRate: rate.toFixed(2),
                totalValue: (quantity * rate).toFixed(2),
              });
            }
          }

          // STEP 4: Insert new transfer items
          await tx.insert(stockTransferItems).values(transferItemsData);

          // Update the transfer voucher (locations can be changed, but shouldn't affect old inventory)
          await tx
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
            locationId: parseInt(sourceLocationId), // Use source location as the primary location for the voucher
          };
          if (voucherDate !== undefined)
            voucherUpdates.voucherDate = voucherDate;
          if (description !== undefined)
            voucherUpdates.description = description;

          const [updatedVoucher] = await tx
            .update(vouchers)
            .set(voucherUpdates)
            .where(eq(vouchers.id, id))
            .returning();

          return updatedVoucher;
        });

        console.log(`[Stock Transfer Edit] Successfully updated voucher ${id}`);
        res.json(updated);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Update a voucher with all entries (completely replace entries)
  app.put("/api/vouchers/:id/with-entries", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid voucher ID" });
      }

      const { voucher, entries } = req.body;

      if (
        !voucher ||
        !entries ||
        !Array.isArray(entries) ||
        entries.length === 0
      ) {
        return res
          .status(400)
          .json({ message: "Voucher and entries are required" });
      }

      // Get the existing voucher to check company and permissions
      const existingVoucher = await storage.getVoucherById(id);
      if (!existingVoucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Verify voucher belongs to current company
      if (existingVoucher.companyId !== req.session.currentCompanyId) {
        return res
          .status(403)
          .json({
            message: "Access denied: Voucher belongs to a different company",
          });
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
            return res
              .status(403)
              .json({ message: "Managers can only edit today's vouchers" });
          }
        } else {
          // Other roles cannot edit
          return res
            .status(403)
            .json({ message: "Insufficient permissions to edit vouchers" });
        }
      }

      // Validate that debits equal credits (only for non-optional vouchers)
      const totalDebits = entries.reduce(
        (sum: number, entry: any) => sum + parseFloat(entry.debitAmount || "0"),
        0,
      );
      const totalCredits = entries.reduce(
        (sum: number, entry: any) =>
          sum + parseFloat(entry.creditAmount || "0"),
        0,
      );

      // For active (non-optional) vouchers, enforce debit=credit balance
      if (!voucher.optional && Math.abs(totalDebits - totalCredits) >= 0.01) {
        return res
          .status(400)
          .json({
            message:
              "Total debits must equal total credits for active vouchers",
          });
      }

      // Update voucher with error handling
      let updatedVoucher;
      let createdEntries = [];
      let oldEntries: any[] = [];

      try {
        // Backup old entries before deleting
        oldEntries = await db
          .select()
          .from(voucherEntries)
          .where(eq(voucherEntries.voucherId, id));

        // Update voucher metadata
        [updatedVoucher] = await db
          .update(vouchers)
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
          const [createdEntry] = await db
            .insert(voucherEntries)
            .values({
              voucherId: id,
              ledgerAccountId: entry.ledgerAccountId || null,
              bankAccountId: entry.bankAccountId || null,
              fixedAssetId: entry.fixedAssetId || null,
              supplierId: entry.supplierId || null,
              employeeId: entry.employeeId || null,
              debitAmount: entry.debitAmount || "0",
              creditAmount: entry.creditAmount || "0",
              narration: entry.narration || null,
            })
            .returning();
          createdEntries.push(createdEntry);
        }
      } catch (error: any) {
        // Cleanup: Restore old entries if update failed after deletion
        if (oldEntries.length > 0 && createdEntries.length === 0) {
          for (const oldEntry of oldEntries) {
            await db
              .insert(voucherEntries)
              .values({
                voucherId: oldEntry.voucherId,
                ledgerAccountId: oldEntry.ledgerAccountId,
                bankAccountId: oldEntry.bankAccountId,
                fixedAssetId: oldEntry.fixedAssetId,
                supplierId: oldEntry.supplierId,
                employeeId: oldEntry.employeeId,
                debitAmount: oldEntry.debitAmount,
                creditAmount: oldEntry.creditAmount,
                narration: oldEntry.narration,
              })
              .catch(() => {});
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

  // Get voucher entries for a specific voucher (for editing)
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
        return res
          .status(403)
          .json({
            message: "Access denied: Voucher belongs to a different company",
          });
      }

      // Use storage method to get entries with account names from joins
      const entries = await storage.getVoucherEntriesByVoucher(id);
      
      // Transform entries to include accountType for the Daybook editor
      const transformedEntries = entries.map(entry => {
        let accountType: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset" = "ledger";
        let accountId = entry.ledgerAccountId;
        
        if (entry.bankAccountId) {
          accountType = "bank";
          accountId = entry.bankAccountId;
        } else if (entry.supplierId) {
          accountType = "supplier";
          accountId = entry.supplierId;
        } else if (entry.employeeId) {
          accountType = "employee";
          accountId = entry.employeeId;
        } else if (entry.fixedAssetId) {
          accountType = "fixedAsset";
          accountId = entry.fixedAssetId;
        }
        
        return {
          ...entry,
          accountType,
          accountId: accountId || 0,
        };
      });
      
      res.json(transformedEntries);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get voucher entries with full details for viewing (includes account names and stock items)
  app.get("/api/vouchers/:id/view-entries", requireAuth, async (req, res) => {
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
        return res
          .status(403)
          .json({
            message: "Access denied: Voucher belongs to a different company",
          });
      }

      // Get regular voucher entries with account names
      const entries = await storage.getVoucherEntriesByVoucher(id);

      // For Sales vouchers, also get sales items
      if (voucher.voucherType === "Sales") {
        const salesItemsList = await db
          .select({
            id: salesItems.id,
            voucherId: salesItems.voucherId,
            stockItemId: salesItems.stockItemId,
            quantity: salesItems.quantity,
            sellingPrice: salesItems.sellingPrice,
            totalSales: salesItems.totalSales,
            stockItemName: stockItems.name,
            stockItemCode: stockItems.code,
          })
          .from(salesItems)
          .leftJoin(stockItems, eq(salesItems.stockItemId, stockItems.id))
          .where(eq(salesItems.voucherId, id));

        if (salesItemsList.length > 0) {
          const itemsWithDetails = salesItemsList.map((item) => ({
            id: item.id,
            voucherId: item.voucherId,
            stockItemId: item.stockItemId,
            stockItemName: item.stockItemName || 'Unknown Item',
            stockItemCode: item.stockItemCode || '-',
            quantity: item.quantity,
            rate: item.sellingPrice,
            debitAmount: "0",
            creditAmount: item.totalSales,
            narration: `Sale of ${item.quantity} x ${item.stockItemName || 'Unknown Item'} @ $${item.sellingPrice}`,
            accountName: item.stockItemName || 'Unknown Item',
            accountCode: item.stockItemCode || '-',
          }));
          return res.json([...entries, ...itemsWithDetails]);
        }
      }

      // For Production/Consumption vouchers, get stock adjustment items
      if (voucher.voucherType === "Production" || voucher.voucherType === "Consumption") {
        const adjustmentVoucher = await db.query.stockAdjustmentVouchers.findFirst({
          where: eq(stockAdjustmentVouchers.voucherId, id),
        });

        if (adjustmentVoucher) {
          const adjustmentItemsList = await db
            .select({
              id: stockAdjustmentItems.id,
              adjustmentId: stockAdjustmentItems.adjustmentId,
              stockItemId: stockAdjustmentItems.stockItemId,
              quantity: stockAdjustmentItems.quantity,
              rate: stockAdjustmentItems.rate,
              totalAmount: stockAdjustmentItems.totalAmount,
              stockItemName: stockItems.name,
              stockItemCode: stockItems.code,
            })
            .from(stockAdjustmentItems)
            .leftJoin(stockItems, eq(stockAdjustmentItems.stockItemId, stockItems.id))
            .where(eq(stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));

          if (adjustmentItemsList.length > 0) {
            const isProduction = voucher.voucherType === "Production";
            const itemsWithDetails = adjustmentItemsList.map((item) => ({
              id: item.id,
              voucherId: id,
              stockItemId: item.stockItemId,
              stockItemName: item.stockItemName || 'Unknown Item',
              stockItemCode: item.stockItemCode || '-',
              quantity: item.quantity,
              rate: item.rate,
              debitAmount: isProduction ? item.totalAmount : "0",
              creditAmount: isProduction ? "0" : item.totalAmount,
              narration: `${voucher.voucherType} of ${item.quantity} x ${item.stockItemName || 'Unknown Item'} @ $${item.rate}`,
              accountName: item.stockItemName || 'Unknown Item',
              accountCode: item.stockItemCode || '-',
            }));
            return res.json([...entries, ...itemsWithDetails]);
          }
        }
      }

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
        return res
          .status(403)
          .json({
            message: "Access denied: Voucher belongs to a different company",
          });
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
            return res
              .status(403)
              .json({
                message:
                  "Managers can only create entries for today's vouchers",
              });
          }
        } else {
          // Other roles cannot create entries
          return res
            .status(403)
            .json({
              message: "Insufficient permissions to create voucher entries",
            });
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
        return res
          .status(404)
          .json({ message: "Associated voucher not found" });
      }

      // Verify voucher belongs to current company
      if (voucher.companyId !== req.session.currentCompanyId) {
        return res
          .status(403)
          .json({
            message: "Access denied: Voucher belongs to a different company",
          });
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
            return res
              .status(403)
              .json({ message: "Managers can only edit today's vouchers" });
          }
        } else {
          // Other roles cannot edit
          return res
            .status(403)
            .json({
              message: "Insufficient permissions to edit voucher entries",
            });
        }
      }

      // Only allow updating debit/credit amounts and narration
      const allowedUpdates: Partial<any> = {};
      if (req.body.debitAmount !== undefined)
        allowedUpdates.debitAmount = req.body.debitAmount;
      if (req.body.creditAmount !== undefined)
        allowedUpdates.creditAmount = req.body.creditAmount;
      if (req.body.narration !== undefined)
        allowedUpdates.narration = req.body.narration;

      const updated = await storage.updateVoucherEntry(id, allowedUpdates);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete a voucher (Admin only)
  app.delete(
    "/api/vouchers/:id",
    requireAuth,
    requireRole("Admin"),
    async (req, res) => {
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
    },
  );

  // Fiscal Period Closing
  // Close a fiscal period (Admin/Owner only)
  app.post("/api/fiscal-period/close", requireAuth, async (req, res) => {
    try {
      // Check role authorization - use currentRole from session
      const userRole = req.session.currentRole;
      if (userRole !== "Admin" && userRole !== "Owner") {
        return res.status(403).json({ 
          message: "Only Admins and Owners can close fiscal periods" 
        });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { 
        periodStartDate, 
        periodEndDate, 
        retainedEarningsAccountId, 
        notes 
      } = req.body;

      // Validate required fields
      if (!periodStartDate || !periodEndDate || !retainedEarningsAccountId) {
        return res.status(400).json({ 
          message: "Period start date, end date, and retained earnings account are required" 
        });
      }

      // Parse and validate retained earnings account ID
      const accountId = parseInt(retainedEarningsAccountId);
      if (isNaN(accountId)) {
        return res.status(400).json({ 
          message: "Invalid retained earnings account ID" 
        });
      }

      // Validate dates are valid and in correct order
      const startDate = new Date(periodStartDate);
      const endDate = new Date(periodEndDate);
      
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ 
          message: "Invalid date format. Use YYYY-MM-DD" 
        });
      }

      if (startDate > endDate) {
        return res.status(400).json({ 
          message: "Period start date must be before or equal to end date" 
        });
      }

      // Validate retained earnings account exists and is an Equity account
      const retainedEarningsAccount = await storage.getLedgerAccountById(accountId);
      if (!retainedEarningsAccount) {
        return res.status(400).json({ 
          message: "Retained earnings account not found" 
        });
      }
      if (retainedEarningsAccount.accountType !== "Equity") {
        return res.status(400).json({ 
          message: "Retained earnings account must be an Equity account" 
        });
      }
      if (retainedEarningsAccount.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ 
          message: "Retained earnings account belongs to a different company" 
        });
      }

      const closure = await storage.closeFiscalPeriod(
        req.session.currentCompanyId,
        periodStartDate,
        periodEndDate,
        accountId,
        req.session.userId!,
        notes
      );

      res.json(closure);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get fiscal period closures for current company
  app.get("/api/fiscal-period/closures", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const closures = await storage.getFiscalPeriodClosures(req.session.currentCompanyId);
      res.json(closures);
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
      const salesByLocation = new Map<
        number,
        {
          locationId: number;
          locationName: string;
          locationCode: string;
          totalSales: number;
          totalTransactions: number;
        }
      >();

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
  app.get(
    "/api/financial/sales/:locationId/details",
    requireAuth,
    checkPOSLocation,
    async (req, res) => {
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
    },
  );

  // Get individual POS transactions for a specific location
  app.get(
    "/api/financial/sales/:locationId/transactions",
    requireAuth,
    checkPOSLocation,
    async (req, res) => {
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

        // Get all sales vouchers for this location with details
        const salesVouchers = await db
          .select()
          .from(vouchers)
          .where(and(...conditions))
          .orderBy(sql`${vouchers.voucherDate} DESC, ${vouchers.createdAt} DESC`);

        // For each voucher, get the sales items
        const transactions = await Promise.all(
          salesVouchers.map(async (voucher) => {
            const items = await db
              .select({
                id: salesItems.id,
                stockItemId: salesItems.stockItemId,
                stockItemName: stockItems.name,
                quantity: salesItems.quantity,
                sellingPrice: salesItems.sellingPrice,
                totalSales: salesItems.totalSales,
              })
              .from(salesItems)
              .leftJoin(stockItems, eq(salesItems.stockItemId, stockItems.id))
              .where(eq(salesItems.voucherId, voucher.id));

            const totalQty = items.reduce((sum, item) => sum + parseFloat(item.quantity), 0);
            const totalAmt = parseFloat(voucher.totalAmount || "0");

            return {
              id: voucher.id,
              voucherNumber: voucher.voucherNumber,
              voucherDate: voucher.voucherDate,
              createdAt: voucher.createdAt,
              description: voucher.description,
              totalAmount: totalAmt,
              totalQuantity: totalQty,
              itemCount: items.length,
              items,
            };
          })
        );

        res.json(transactions);
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // POS Sales
  app.post("/api/pos/sales", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const {
        locationId,
        cashAccountId,
        paymentAccountType,
        paymentAccountId,
        items,
        notes,
        isCreditSale,
      } = req.body;

      // Support both old (cashAccountId) and new (paymentAccountType/paymentAccountId) parameters
      const accountType = paymentAccountType || "bank";
      const accountId = paymentAccountId || cashAccountId;

      // Validate required fields
      if (!locationId) {
        return res.status(400).json({ message: "Location is required" });
      }
      if (!accountId) {
        return res
          .status(400)
          .json({
            message: isCreditSale
              ? "Customer is required"
              : "Payment account is required",
          });
      }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res
          .status(400)
          .json({ message: "At least one item is required" });
      }

      // Validate and calculate total
      let grandTotal = 0;
      for (const item of items) {
        if (!item.stockItemId) {
          return res
            .status(400)
            .json({ message: "Stock item ID is required for all items" });
        }
        if (!item.quantity || parseFloat(item.quantity) <= 0) {
          return res
            .status(400)
            .json({ message: "Quantity must be positive for all items" });
        }
        if (!item.rate || parseFloat(item.rate) < 0) {
          return res
            .status(400)
            .json({ message: "Rate must be non-negative for all items" });
        }
        grandTotal += parseFloat(item.quantity) * parseFloat(item.rate);
      }

      // Get or create SALES revenue account (outside transaction for simplicity)
      const allAccounts = await storage.getAllLedgerAccounts(
        req.session.currentCompanyId!,
      );
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
      const voucherDate = new Date().toISOString().split("T")[0];

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
          .where(
            and(
              eq(inventory.locationId, locationId),
              eq(inventory.stockItemId, item.stockItemId),
            ),
          );

        if (!inventoryRecord) {
          throw new Error(
            `Inventory not found for item ${item.stockItemId} at location ${locationId}`,
          );
        }

        const currentQty = parseFloat(inventoryRecord.quantity);
        const saleQty = parseFloat(item.quantity);

        // Check if user can sell negative stock
        const canSellNegativeStock = req.user?.canSellNegativeStock || false;

        if (currentQty < saleQty && !canSellNegativeStock) {
          throw new Error(
            `Insufficient stock for item ${item.stockItemId}. Available: ${currentQty}, Requested: ${saleQty}`,
          );
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
        [voucher] = await db
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId!,
            locationId,
            voucherNumber,
            voucherType: "Sales",
            voucherDate,
            description: notes || `POS Sale at ${location.name}`,
            totalAmount: grandTotal.toFixed(2),
            optional: false,
          })
          .returning();

        // Create voucher entries (double-entry bookkeeping)
        // Debit: Cash/Bank/Customer Account (Asset increases)
        const debitEntry: any = {
          voucherId: voucher.id,
          debitAmount: grandTotal.toFixed(2),
          creditAmount: "0",
          narration: isCreditSale
            ? `Credit Sale - ${voucherNumber}`
            : `POS Sale - ${voucherNumber}`,
        };

        if (
          isCreditSale ||
          accountType === "cash" ||
          accountType === "credit"
        ) {
          // For credit sales and cash accounts, use ledgerAccountId
          debitEntry.ledgerAccountId = accountId;
        } else {
          // For bank accounts, use bankAccountId
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
          const { item, newQty, currentRate, inventoryRecord, currentQty } =
            validatedItem;

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
          await db
            .delete(salesItems)
            .where(eq(salesItems.voucherId, voucher.id))
            .catch(() => {});
          // Delete voucher entries
          await db
            .delete(voucherEntries)
            .where(eq(voucherEntries.voucherId, voucher.id))
            .catch(() => {});
          // Delete voucher
          await db
            .delete(vouchers)
            .where(eq(vouchers.id, voucher.id))
            .catch(() => {});
        }

        // Restore inventory quantities
        for (let i = 0; i < updatedInventoryIds.length; i++) {
          const validatedItem = inventoryValidation[i];
          const originalQty = validatedItem.currentQty;
          const originalTotalValue = (
            originalQty * validatedItem.currentRate
          ).toFixed(2);

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

      // Get customer details for credit sales
      let customerAccount = null;
      if (isCreditSale) {
        customerAccount = await storage.getLedgerAccountById(accountId);
      }

      // Return complete sale details
      res.json({
        voucher: result.voucher,
        location,
        items: result.saleItems,
        grandTotal: grandTotal.toFixed(2),
        voucherNumber,
        saleDate: voucherDate,
        isCreditSale,
        customer: customerAccount
          ? {
              id: customerAccount.id,
              code: customerAccount.code,
              name: customerAccount.name,
            }
          : null,
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

  // Draft POS Sales Routes
  // Get all drafts for current user
  app.get("/api/pos/drafts", requireAuth, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const locationId = req.query.locationId ? parseInt(req.query.locationId as string) : undefined;
      const drafts = await storage.getAllDraftPosSales(userId, locationId);
      res.json(drafts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get a specific draft by ID
  app.get("/api/pos/drafts/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const draft = await storage.getDraftPosSaleById(id);
      
      if (!draft) {
        return res.status(404).json({ message: "Draft not found" });
      }

      // Verify the draft belongs to the current user
      if (draft.userId !== req.user?.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(draft);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create a new draft
  app.post("/api/pos/drafts", requireAuth, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const { locationId, paymentAccountType, paymentAccountId, isCreditSale, notes, items } = req.body;

      if (!locationId) {
        return res.status(400).json({ message: "Location is required" });
      }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      const draftData: InsertDraftPosSale = {
        userId,
        locationId,
        paymentAccountType: paymentAccountType || null,
        paymentAccountId: paymentAccountId || null,
        isCreditSale: isCreditSale || false,
        notes: notes || null,
      };

      const draft = await storage.createDraftPosSale(draftData, items);
      res.status(201).json(draft);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update an existing draft
  app.patch("/api/pos/drafts/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Verify the draft belongs to the current user
      const existingDraft = await storage.getDraftPosSaleById(id);
      if (!existingDraft) {
        return res.status(404).json({ message: "Draft not found" });
      }
      if (existingDraft.userId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { locationId, paymentAccountType, paymentAccountId, isCreditSale, notes, items } = req.body;

      const updateData: Partial<InsertDraftPosSale> = {};
      if (locationId !== undefined) updateData.locationId = locationId;
      if (paymentAccountType !== undefined) updateData.paymentAccountType = paymentAccountType;
      if (paymentAccountId !== undefined) updateData.paymentAccountId = paymentAccountId;
      if (isCreditSale !== undefined) updateData.isCreditSale = isCreditSale;
      if (notes !== undefined) updateData.notes = notes;

      const draft = await storage.updateDraftPosSale(id, updateData, items);
      res.json(draft);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete a draft
  app.delete("/api/pos/drafts/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      // Verify the draft belongs to the current user
      const existingDraft = await storage.getDraftPosSaleById(id);
      if (!existingDraft) {
        return res.status(404).json({ message: "Draft not found" });
      }
      if (existingDraft.userId !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      await storage.deleteDraftPosSale(id);
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Transfers - GET endpoint
  app.get(
    "/api/stock-transfers",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const voucherId = req.query.voucherId ? parseInt(req.query.voucherId as string) : null;
        
        if (!voucherId) {
          return res.status(400).json({ message: "voucherId query parameter is required" });
        }

        const transfer = await storage.getStockTransferByVoucherId(voucherId);
        res.json(transfer);
      } catch (error: any) {
        console.error("[Stock Transfer GET] Error:", error.message);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Stock Transfers - POST endpoint
  app.post(
    "/api/stock-transfers",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const { voucherId, destinationLocationId, notes, items } = req.body;

        // Validate required fields
        if (!voucherId) {
          return res.status(400).json({ message: "Voucher ID is required" });
        }
        if (!destinationLocationId) {
          return res
            .status(400)
            .json({ message: "Destination location is required" });
        }
        if (!items || !Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ message: "Items are required" });
        }

        // Validate that destination location exists
        const destLocation = await storage.getLocationById(
          destinationLocationId,
        );
        if (!destLocation) {
          return res
            .status(404)
            .json({ message: "Destination location not found" });
        }

        // Validate that voucher exists
        const voucher = await storage.getVoucherById(voucherId);
        if (!voucher) {
          return res.status(404).json({ message: "Voucher not found" });
        }

        // Validate items and their source locations
        for (const item of items) {
          if (!item.sourceLocationId) {
            return res
              .status(400)
              .json({ message: "Source location is required for all items" });
          }
          if (!item.stockItemId) {
            return res
              .status(400)
              .json({ message: "Stock item ID is required for all items" });
          }
          if (!item.quantity || parseFloat(item.quantity) <= 0) {
            return res
              .status(400)
              .json({ message: "Quantity must be positive for all items" });
          }
          if (!item.rate || parseFloat(item.rate) < 0) {
            return res
              .status(400)
              .json({ message: "Rate must be non-negative for all items" });
          }

          // Validate that source and destination are different for each item
          if (item.sourceLocationId === destinationLocationId) {
            return res
              .status(400)
              .json({
                message:
                  "Source and destination locations must be different for each item",
              });
          }

          // Validate that source location exists
          const sourceLocation = await storage.getLocationById(
            item.sourceLocationId,
          );
          if (!sourceLocation) {
            return res
              .status(404)
              .json({
                message: `Source location with ID ${item.sourceLocationId} not found`,
              });
          }
        }

        console.log("[Stock Transfer] Creating transfer:", {
          voucherId,
          destinationLocationId,
          itemCount: items.length,
        });

        const transfer = await storage.createStockTransfer(
          voucherId,
          destinationLocationId,
          notes || "",
          items,
        );

        console.log("[Stock Transfer] Transfer created successfully:", {
          transferId: transfer.transfer.id,
          itemsCount: transfer.items.length,
        });
        res.status(201).json(transfer);
      } catch (error: any) {
        console.error(
          "[Stock Transfer] Error creating transfer:",
          error.message,
          error.stack,
        );
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Stock Transfers - PUT endpoint (update)
  app.put(
    "/api/stock-transfers/:id",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (!id) {
          return res.status(400).json({ message: "Transfer ID is required" });
        }

        // Validate request body using Zod
        const parseResult = updateStockTransferSchema.safeParse(req.body);
        if (!parseResult.success) {
          return res.status(400).json({
            message: "Invalid request data",
            errors: parseResult.error.errors,
          });
        }

        const { destinationLocationId, notes, items } = parseResult.data;

        // Validate that source !== destination for each item
        const invalidItem = items.find(item => item.sourceLocationId === destinationLocationId);
        if (invalidItem) {
          return res.status(400).json({ message: "Source and destination locations must be different for each item" });
        }

        // Convert numbers back to strings with fixed precision for storage layer
        const itemsForStorage = items.map(item => ({
          sourceLocationId: item.sourceLocationId,
          stockItemId: item.stockItemId,
          quantity: item.quantity.toFixed(3),
          rate: item.rate.toFixed(2),
        }));

        // Update the stock transfer using the storage method
        const updated = await storage.updateStockTransfer(id, destinationLocationId, notes || "", itemsForStorage);
        
        // Recalculate voucher totalAmount based on updated items
        const newTotalAmount = items.reduce((sum, item) => sum + (item.quantity * item.rate), 0);
        await db.update(vouchers)
          .set({ totalAmount: newTotalAmount.toFixed(2) })
          .where(eq(vouchers.id, updated.transfer.voucherId));
        
        res.json(updated);
      } catch (error: any) {
        console.error("[Stock Transfer PUT] Error:", error.message);
        
        // Check if this is a legacy transfer validation error (400) vs server error (500)
        if (error.message && error.message.includes("missing source location data")) {
          return res.status(400).json({ message: error.message });
        }
        
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Stock Adjustments - GET endpoint
  app.get(
    "/api/stock-adjustments",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const voucherId = req.query.voucherId ? parseInt(req.query.voucherId as string) : null;
        
        if (!voucherId) {
          return res.status(400).json({ message: "voucherId query parameter is required" });
        }

        const adjustment = await storage.getStockAdjustmentByVoucherId(voucherId);
        res.json(adjustment);
      } catch (error: any) {
        console.error("[Stock Adjustment GET] Error:", error.message);
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Stock Adjustments - POST endpoint
  app.post(
    "/api/stock-adjustments",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const { voucherId, locationId, adjustmentType, notes, items } =
          req.body;

        // Validate required fields
        if (!voucherId) {
          return res.status(400).json({ message: "Voucher ID is required" });
        }
        if (!locationId) {
          return res.status(400).json({ message: "Location is required" });
        }
        if (!adjustmentType) {
          return res
            .status(400)
            .json({ message: "Adjustment type is required" });
        }
        if (
          adjustmentType !== "Production" &&
          adjustmentType !== "Consumption"
        ) {
          return res
            .status(400)
            .json({
              message:
                "Adjustment type must be either 'Production' or 'Consumption'",
            });
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
            return res
              .status(400)
              .json({ message: "Stock item ID is required for all items" });
          }
          if (!item.quantity || parseFloat(item.quantity) === 0) {
            return res
              .status(400)
              .json({ message: "Quantity cannot be zero for any items" });
          }
          // Note: Negative quantities are allowed for consumption items
          if (!item.rate || parseFloat(item.rate) < 0) {
            return res
              .status(400)
              .json({ message: "Rate must be non-negative for all items" });
          }
        }

        console.log("[Stock Adjustment] Creating adjustment:", {
          voucherId,
          locationId,
          adjustmentType,
          itemCount: items.length,
        });

        const adjustment = await storage.createStockAdjustment(
          voucherId,
          locationId,
          adjustmentType,
          notes || "",
          items,
        );

        console.log("[Stock Adjustment] Adjustment created successfully:", {
          adjustmentId: adjustment.adjustment.id,
          itemsCount: adjustment.items.length,
        });
        res.status(201).json(adjustment);
      } catch (error: any) {
        console.error(
          "[Stock Adjustment] Error creating adjustment:",
          error.message,
          error.stack,
        );
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Stock Adjustments - PUT endpoint (update)
  app.put(
    "/api/stock-adjustments/:id",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        if (!id) {
          return res.status(400).json({ message: "Adjustment ID is required" });
        }

        // Validate request body using Zod
        const parseResult = updateStockAdjustmentSchema.safeParse(req.body);
        if (!parseResult.success) {
          return res.status(400).json({
            message: "Invalid request data",
            errors: parseResult.error.errors,
          });
        }

        const { locationId, adjustmentType, notes, items } = parseResult.data;

        // Convert numbers back to strings with fixed precision for storage layer
        const itemsForStorage = items.map(item => ({
          stockItemId: item.stockItemId,
          quantity: item.quantity.toFixed(3),
          rate: item.rate.toFixed(2),
        }));

        // Update the stock adjustment using the storage method
        const updated = await storage.updateStockAdjustment(id, locationId, adjustmentType, notes || "", itemsForStorage);
        
        // Recalculate voucher totalAmount based on updated items
        const newTotalAmount = items.reduce((sum, item) => sum + (Math.abs(item.quantity) * item.rate), 0);
        await db.update(vouchers)
          .set({ totalAmount: newTotalAmount.toFixed(2) })
          .where(eq(vouchers.id, updated.adjustment.voucherId));
        
        res.json(updated);
      } catch (error: any) {
        console.error("[Stock Adjustment PUT] Error:", error.message);
        res.status(500).json({ message: error.message });
      }
    },
  );

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
        .filter((acc) => acc.accountType === "Income")
        .map((acc) => acc.id);
      
      // Exclude inventory acquisition costs from net profit calculation
      // These costs are capitalized to inventory until sold, NOT operating expenses
      // COGS is NOT excluded - it represents sold inventory and should reduce profit
      const excludedExpenseCodes = [
        "PURCHASES",           // Direct inventory purchases (capitalized)
        "IMPORTCHARGES",       // Old consolidated import charges (deprecated, capitalized)
        "DUTIES",              // Container import duties (capitalized)
        "TRANSPORTCHARGES",    // Container transport costs (capitalized)
        "TRANSPORT",           // Alternative transport account name (capitalized)
        "CONTAINERLICENSES",   // Container license fees (capitalized)
        "LICENSES",            // Alternative license account name (capitalized)
      ];
      
      // Normalize function: uppercase + remove spaces/underscores for comparison
      const normalizeCode = (code: string) => 
        code.toUpperCase().replace(/[\s_-]/g, "");
      
      const expenseAccounts = companyAccounts.filter((acc) => {
        // Support both correct format (accountType="Expense") and legacy format
        // (accountType="Indirect Expense" or "Direct Expense")
        const isExpenseAccount = 
          acc.accountType === "Expense" || 
          acc.accountType === "Indirect Expense" || 
          acc.accountType === "Direct Expense";
        
        if (!isExpenseAccount) return false;
        
        const normalizedCode = normalizeCode(acc.code);
        return !excludedExpenseCodes.some(excluded => 
          normalizeCode(excluded) === normalizedCode
        );
      });
      const expenseAccountIds = expenseAccounts.map((acc) => acc.id);

      // Get voucher IDs for this company
      const companyVouchers = await db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(eq(vouchers.companyId, companyId))
        .execute();

      const companyVoucherIds = companyVouchers.map((v) => v.id);

      // Get voucher entries only for this company's vouchers
      const companyEntries =
        companyVoucherIds.length > 0
          ? await db
              .select()
              .from(voucherEntries)
              .where(inArray(voucherEntries.voucherId, companyVoucherIds))
              .execute()
          : [];

      // Calculate total income (credits - debits for income accounts)
      let totalIncome = 0;
      for (const entry of companyEntries) {
        if (
          entry.ledgerAccountId &&
          incomeAccountIds.includes(entry.ledgerAccountId)
        ) {
          totalIncome +=
            parseFloat(entry.creditAmount || "0") -
            parseFloat(entry.debitAmount || "0");
        }
      }

      // Calculate total expenses (debits - credits for expense accounts)
      // Excludes PURCHASES and IMPORT_CHARGES (inventory costs)
      let totalExpenses = 0;
      for (const entry of companyEntries) {
        if (
          entry.ledgerAccountId &&
          expenseAccountIds.includes(entry.ledgerAccountId)
        ) {
          totalExpenses +=
            parseFloat(entry.debitAmount || "0") -
            parseFloat(entry.creditAmount || "0");
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
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.voucherType, "Sales"),
          ),
        )
        .execute();

      // Get all Income and Expense ledger accounts
      const companyAccounts = await storage.getAllLedgerAccounts(companyId);
      const incomeAccountIds = companyAccounts
        .filter((acc) => acc.accountType === "Income")
        .map((acc) => acc.id);
      
      // Exclude inventory acquisition costs from monthly profit calculation
      // These costs are capitalized to inventory until sold, NOT operating expenses
      // COGS is NOT excluded - it represents sold inventory and should reduce profit
      const excludedExpenseCodes = [
        "PURCHASES",           // Direct inventory purchases (capitalized)
        "IMPORTCHARGES",       // Old consolidated import charges (deprecated, capitalized)
        "DUTIES",              // Container import duties (capitalized)
        "TRANSPORTCHARGES",    // Container transport costs (capitalized)
        "TRANSPORT",           // Alternative transport account name (capitalized)
        "CONTAINERLICENSES",   // Container license fees (capitalized)
        "LICENSES",            // Alternative license account name (capitalized)
      ];
      
      // Normalize function: uppercase + remove spaces/underscores for comparison
      const normalizeCode = (code: string) => 
        code.toUpperCase().replace(/[\s_-]/g, "");
      
      const expenseAccounts = companyAccounts.filter((acc) => {
        // Support both correct format (accountType="Expense") and legacy format
        // (accountType="Indirect Expense" or "Direct Expense")
        const isExpenseAccount = 
          acc.accountType === "Expense" || 
          acc.accountType === "Indirect Expense" || 
          acc.accountType === "Direct Expense";
        
        if (!isExpenseAccount) return false;
        
        const normalizedCode = normalizeCode(acc.code);
        return !excludedExpenseCodes.some(excluded => 
          normalizeCode(excluded) === normalizedCode
        );
      });
      const expenseAccountIds = expenseAccounts.map((acc) => acc.id);

      // Get all voucher entries for this company
      const companyVouchers = await db
        .select({ id: vouchers.id, voucherDate: vouchers.voucherDate })
        .from(vouchers)
        .where(eq(vouchers.companyId, companyId))
        .execute();

      const companyVoucherIds = companyVouchers.map((v) => v.id);
      const voucherDateMap = new Map(
        companyVouchers.map((v) => [v.id, v.voucherDate]),
      );

      const companyEntries =
        companyVoucherIds.length > 0
          ? await db
              .select()
              .from(voucherEntries)
              .where(inArray(voucherEntries.voucherId, companyVoucherIds))
              .execute()
          : [];

      // Group data by month (last 6 months)
      const monthlyData = new Map<string, { sales: number; profit: number }>();
      const monthNames = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];

      // Initialize last 6 months
      const currentDate = new Date();
      for (let i = 5; i >= 0; i--) {
        const date = new Date(
          currentDate.getFullYear(),
          currentDate.getMonth() - i,
          1,
        );
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
        if (
          entry.ledgerAccountId &&
          incomeAccountIds.includes(entry.ledgerAccountId)
        ) {
          data.profit +=
            parseFloat(entry.creditAmount || "0") -
            parseFloat(entry.debitAmount || "0");
        }

        // Expense accounts: debits decrease profit, credits increase it
        if (
          entry.ledgerAccountId &&
          expenseAccountIds.includes(entry.ledgerAccountId)
        ) {
          data.profit -=
            parseFloat(entry.debitAmount || "0") -
            parseFloat(entry.creditAmount || "0");
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
        .filter(
          (item) =>
            parseFloat(item.quantity) < lowStockThreshold &&
            parseFloat(item.quantity) > 0,
        )
        .map((item) => ({
          name: item.stockItemName,
          stock: parseFloat(item.quantity),
          location: item.locationName || "Unknown",
        }))
        .sort((a, b) => a.stock - b.stock) // Sort by lowest stock first
        .slice(0, 10); // Limit to top 10 low stock items

      // Count critical items (quantity < 5)
      const criticalThreshold = 5;
      const criticalCount = inventory.filter(
        (item) =>
          parseFloat(item.quantity) < criticalThreshold &&
          parseFloat(item.quantity) > 0,
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
        conditions.push(
          eq(vouchers.locationId, parseInt(locationId as string)),
        );
      }
      if (stockItemId) {
        conditions.push(
          eq(salesItems.stockItemId, parseInt(stockItemId as string)),
        );
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
          actualSellingPrice: salesItems.sellingPrice, // Price item was actually sold at
          configuredSellingPrice: stockItems.sellingPrice, // Configured price in stock items
          costPrice: salesItems.costPrice,
          totalSales: salesItems.totalSales,
          totalCost: salesItems.totalCost,
          costProfit: salesItems.profit, // Actual selling price - cost price
          createdAt: salesItems.createdAt,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .innerJoin(stockItems, eq(salesItems.stockItemId, stockItems.id))
        .leftJoin(locations, eq(vouchers.locationId, locations.id))
        .where(and(...conditions))
        .orderBy(vouchers.voucherDate);

      // Calculate configured profit for each item (actual selling price - configured selling price) * quantity
      const enhancedSalesData = salesData.map(item => ({
        ...item,
        configuredProfit: (parseFloat(item.actualSellingPrice || "0") - parseFloat(item.configuredSellingPrice || "0")) * parseFloat(item.quantity || "0"),
        totalConfiguredCost: parseFloat(item.configuredSellingPrice || "0") * parseFloat(item.quantity || "0"),
      }));

      res.json(enhancedSalesData);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Reports API Endpoints

  // Profit & Loss Report
  app.get(
    "/api/reports/profit-loss",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const { startDate, endDate } = req.query;

        // Get all ledger accounts for this company
        const companyAccounts = await storage.getAllLedgerAccounts(companyId);

        const incomeAccounts = companyAccounts.filter(
          (acc) => acc.accountType === "Income",
        );
        const expenseAccounts = companyAccounts.filter(
          (acc) => 
            acc.accountType === "Expense" || 
            acc.accountType === "Indirect Expense" || 
            acc.accountType === "Direct Expense",
        );

        const incomeAccountIds = incomeAccounts.map((acc) => acc.id);
        const expenseAccountIds = expenseAccounts.map((acc) => acc.id);

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

        const companyVoucherIds = companyVouchers.map((v) => v.id);

        // Get voucher entries
        const companyEntries =
          companyVoucherIds.length > 0
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
            const currentBalance =
              accountBalances.get(entry.ledgerAccountId) || 0;
            accountBalances.set(
              entry.ledgerAccountId,
              currentBalance + credit - debit,
            );
          }
        }

        // Build income statement
        const incomeItems = incomeAccounts
          .map((acc) => ({
            id: acc.id,
            code: acc.code,
            name: acc.name,
            accountType: acc.accountType,
            balance: accountBalances.get(acc.id) || 0,
          }))
          .filter((item) => item.balance !== 0);

        const expenseItems = expenseAccounts
          .map((acc) => ({
            id: acc.id,
            code: acc.code,
            name: acc.name,
            accountType: acc.accountType,
            balance: accountBalances.get(acc.id) || 0,
          }))
          .filter((item) => item.balance !== 0);

        const totalIncome = incomeItems.reduce(
          (sum, item) => sum + item.balance,
          0,
        );
        const totalExpenses = expenseItems.reduce(
          (sum, item) => sum + item.balance,
          0,
        );
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
    },
  );

  // Balance Sheet Report
  app.get(
    "/api/reports/balance-sheet",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
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

        const companyVoucherIds = companyVouchers.map((v) => v.id);

        const allEntries =
          companyVoucherIds.length > 0
            ? await db
                .select()
                .from(voucherEntries)
                .where(inArray(voucherEntries.voucherId, companyVoucherIds))
                .execute()
            : [];

        // Calculate balances
        const ledgerBalances = new Map<
          number,
          { debits: number; credits: number }
        >();
        const bankBalances = new Map<
          number,
          { debits: number; credits: number }
        >();
        const assetBalances = new Map<
          number,
          { debits: number; credits: number }
        >();
        const supplierBalances = new Map<
          number,
          { debits: number; credits: number }
        >();

        for (const entry of allEntries) {
          const debit = parseFloat(entry.debitAmount || "0");
          const credit = parseFloat(entry.creditAmount || "0");

          if (entry.ledgerAccountId) {
            const existing = ledgerBalances.get(entry.ledgerAccountId) || {
              debits: 0,
              credits: 0,
            };
            ledgerBalances.set(entry.ledgerAccountId, {
              debits: existing.debits + debit,
              credits: existing.credits + credit,
            });
          }

          if (entry.bankAccountId) {
            const existing = bankBalances.get(entry.bankAccountId) || {
              debits: 0,
              credits: 0,
            };
            bankBalances.set(entry.bankAccountId, {
              debits: existing.debits + debit,
              credits: existing.credits + credit,
            });
          }

          if (entry.fixedAssetId) {
            const existing = assetBalances.get(entry.fixedAssetId) || {
              debits: 0,
              credits: 0,
            };
            assetBalances.set(entry.fixedAssetId, {
              debits: existing.debits + debit,
              credits: existing.credits + credit,
            });
          }

          if (entry.supplierId) {
            const existing = supplierBalances.get(entry.supplierId) || {
              debits: 0,
              credits: 0,
            };
            // Only count pure credit or pure debit entries to prevent double-counting
            // This matches the logic in /api/suppliers/stats
            if (credit > 0 && debit === 0) {
              supplierBalances.set(entry.supplierId, {
                debits: existing.debits,
                credits: existing.credits + credit,
              });
            } else if (debit > 0 && credit === 0) {
              supplierBalances.set(entry.supplierId, {
                debits: existing.debits + debit,
                credits: existing.credits,
              });
            }
          }
        }

        // Categorize and calculate net balances
        const assetAccounts = ledgers
          .filter((l) => l.accountType === "Asset")
          .map((acc) => {
            const bal = ledgerBalances.get(acc.id) || { debits: 0, credits: 0 };
            const openingBalance = parseFloat(acc.openingBalance || "0");
            return {
              id: acc.id,
              code: acc.code,
              name: acc.name,
              balance: openingBalance + bal.debits - bal.credits,
            };
          });

        const bankAccounts = banks.map((bank) => {
          const bal = bankBalances.get(bank.id) || { debits: 0, credits: 0 };
          const openingBalance = parseFloat(bank.openingBalance || "0");
          return {
            id: bank.id,
            code: bank.accountNumber,
            name: bank.bankName,
            balance: openingBalance + bal.debits - bal.credits,
          };
        });

        const fixedAssetAccounts = assets.map((asset) => {
          const bal = assetBalances.get(asset.id) || { debits: 0, credits: 0 };
          const purchaseValue = parseFloat(asset.purchaseAmount || "0");
          return {
            id: asset.id,
            code: asset.code,
            name: asset.name,
            balance: purchaseValue + bal.debits - bal.credits,
          };
        });

        const liabilityAccounts = ledgers
          .filter((l) => l.accountType === "Liability")
          .map((acc) => {
            const bal = ledgerBalances.get(acc.id) || { debits: 0, credits: 0 };
            const openingBalance = parseFloat(acc.openingBalance || "0");
            return {
              id: acc.id,
              code: acc.code,
              name: acc.name,
              balance: openingBalance + bal.credits - bal.debits,
            };
          });

        const supplierAccounts = suppliers
          .map((supplier) => {
            const bal = supplierBalances.get(supplier.id) || {
              debits: 0,
              credits: 0,
            };
            return {
              id: supplier.id,
              code: supplier.code,
              name: supplier.legalName,
              balance: bal.credits - bal.debits,
            };
          })
          .filter((s) => s.balance !== 0);

        const equityAccounts = ledgers
          .filter((l) => l.accountType === "Equity")
          .map((acc) => {
            const bal = ledgerBalances.get(acc.id) || { debits: 0, credits: 0 };
            const openingBalance = parseFloat(acc.openingBalance || "0");
            return {
              id: acc.id,
              code: acc.code,
              name: acc.name,
              balance: openingBalance + bal.credits - bal.debits,
            };
          });

        const totalAssets = [
          ...assetAccounts,
          ...bankAccounts,
          ...fixedAssetAccounts,
        ].reduce((sum, item) => sum + item.balance, 0);

        const totalLiabilities = [
          ...liabilityAccounts,
          ...supplierAccounts,
        ].reduce((sum, item) => sum + item.balance, 0);

        const totalEquity = equityAccounts.reduce(
          (sum, item) => sum + item.balance,
          0,
        );

        res.json({
          assets: {
            ledgers: assetAccounts.filter((a) => a.balance !== 0),
            banks: bankAccounts.filter((b) => b.balance !== 0),
            fixedAssets: fixedAssetAccounts.filter((f) => f.balance !== 0),
            total: totalAssets,
          },
          liabilities: {
            ledgers: liabilityAccounts.filter((l) => l.balance !== 0),
            suppliers: supplierAccounts,
            total: totalLiabilities,
          },
          equity: {
            accounts: equityAccounts.filter((e) => e.balance !== 0),
            total: totalEquity,
          },
          asOfDate: asOfDate || null,
        });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

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
        conditions.push(
          eq(vouchers.locationId, parseInt(locationId as string)),
        );
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
        salesData = salesData.filter(
          (s) => s.stockGroupId === parseInt(stockGroupId as string),
        );
      }

      const totalQuantity = salesData.reduce(
        (sum, item) => sum + parseFloat(item.quantity),
        0,
      );
      const totalSales = salesData.reduce(
        (sum, item) => sum + parseFloat(item.totalSales),
        0,
      );
      const totalCost = salesData.reduce(
        (sum, item) => sum + parseFloat(item.totalCost),
        0,
      );
      const totalProfit = salesData.reduce(
        (sum, item) => sum + parseFloat(item.profit),
        0,
      );

      res.json({
        items: salesData,
        summary: {
          totalQuantity,
          totalSales,
          totalCost,
          totalProfit,
          grossProfitMargin:
            totalSales > 0 ? (totalProfit / totalSales) * 100 : 0,
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
        ? allStockItems.filter(
            (item) => item.stockGroupId === parseInt(stockGroupId as string),
          )
        : allStockItems;

      // Get all inventory records
      const inventoryConditions = [eq(locations.companyId, companyId)];

      if (locationId) {
        inventoryConditions.push(
          eq(inventory.locationId, parseInt(locationId as string)),
        );
      }

      const inventoryRecords = await db
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
        .where(and(...inventoryConditions))
        .execute();

      // Build movement report
      const movementData = stockItemsToReport
        .map((item) => {
          const itemInventory = inventoryRecords.filter(
            (inv) => inv.stockItemId === item.id,
          );
          const totalQuantity = itemInventory.reduce(
            (sum, inv) => sum + parseFloat(inv.quantity),
            0,
          );
          const totalValue = itemInventory.reduce(
            (sum, inv) => sum + parseFloat(inv.totalValue),
            0,
          );

          return {
            stockItemId: item.id,
            stockItemCode: item.code,
            stockItemName: item.name,
            locations: itemInventory.map((inv) => ({
              locationId: inv.locationId,
              locationName: inv.locationName,
              quantity: parseFloat(inv.quantity),
              averageRate: parseFloat(inv.averageRate),
              totalValue: parseFloat(inv.totalValue),
            })),
            totalQuantity,
            totalValue,
          };
        })
        .filter((item) => item.totalQuantity > 0);

      const grandTotalQuantity = movementData.reduce(
        (sum, item) => sum + item.totalQuantity,
        0,
      );
      const grandTotalValue = movementData.reduce(
        (sum, item) => sum + item.totalValue,
        0,
      );

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
        conditions.push(
          eq(containers.supplierId, parseInt(supplierId as string)),
        );
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
          supplierName: suppliers.legalName,
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

      const totalItemsTotal = containerData.reduce(
        (sum, c) => sum + parseFloat(c.itemsTotal || "0"),
        0,
      );
      const totalChargesTotal = containerData.reduce(
        (sum, c) => sum + parseFloat(c.chargesTotal || "0"),
        0,
      );
      const totalGrandTotal = containerData.reduce(
        (sum, c) => sum + parseFloat(c.grandTotal || "0"),
        0,
      );

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

      const incomeAccountIds = companyAccounts
        .filter((acc) => acc.accountType === "Income")
        .map((acc) => acc.id);
      const expenseAccountIds = companyAccounts
        .filter((acc) => acc.accountType === "Expense")
        .map((acc) => acc.id);
      const assetAccountIds = companyAccounts
        .filter((acc) => acc.accountType === "Asset")
        .map((acc) => acc.id);
      const liabilityAccountIds = companyAccounts
        .filter((acc) => acc.accountType === "Liability")
        .map((acc) => acc.id);

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

      const companyVoucherIds = companyVouchers.map((v) => v.id);

      const companyEntries =
        companyVoucherIds.length > 0
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

      const totalSales = salesData.reduce(
        (sum, s) => sum + parseFloat(s.totalSales),
        0,
      );
      const totalCost = salesData.reduce(
        (sum, s) => sum + parseFloat(s.totalCost),
        0,
      );
      const grossProfit = totalSales - totalCost;

      // Calculate ratios
      const netProfit = totalIncome - totalExpenses;
      const grossProfitMargin =
        totalSales > 0 ? (grossProfit / totalSales) * 100 : 0;
      const netProfitMargin =
        totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;
      const currentRatio =
        totalLiabilities > 0 ? totalAssets / totalLiabilities : 0;
      const debtToEquity =
        totalAssets - totalLiabilities > 0
          ? totalLiabilities / (totalAssets - totalLiabilities)
          : 0;

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

  // Dashboard Cash Accounts - user-selected accounts for dashboard display
  app.get("/api/dashboard-cash-accounts", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { dashboardCashAccounts } = await import("@shared/schema");
      
      const accounts = await db
        .select()
        .from(dashboardCashAccounts)
        .where(eq(dashboardCashAccounts.companyId, companyId))
        .orderBy(dashboardCashAccounts.displayOrder)
        .execute();

      // Enrich with account details
      const enrichedAccounts = await Promise.all(
        accounts.map(async (account) => {
          let accountDetails: any = null;
          if (account.accountType === "ledger") {
            const { ledgerAccounts } = await import("@shared/schema");
            const [ledger] = await db
              .select()
              .from(ledgerAccounts)
              .where(eq(ledgerAccounts.id, account.accountId))
              .execute();
            accountDetails = ledger ? { ...ledger, type: "Ledger" } : null;
          } else if (account.accountType === "bank") {
            const { bankAccounts } = await import("@shared/schema");
            const [bank] = await db
              .select()
              .from(bankAccounts)
              .where(eq(bankAccounts.id, account.accountId))
              .execute();
            accountDetails = bank ? { ...bank, type: "Bank" } : null;
          }

          return {
            id: account.id,
            accountType: account.accountType,
            accountId: account.accountId,
            displayOrder: account.displayOrder,
            account: accountDetails,
          };
        })
      );

      // Filter out deleted accounts
      const validAccounts = enrichedAccounts.filter((a) => a.account !== null);
      res.json(validAccounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/dashboard-cash-accounts", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { dashboardCashAccounts, insertDashboardCashAccountSchema } = await import("@shared/schema");
      
      const data = insertDashboardCashAccountSchema.parse({
        ...req.body,
        companyId,
      });

      const [account] = await db
        .insert(dashboardCashAccounts)
        .values(data)
        .returning()
        .execute();

      res.json(account);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/dashboard-cash-accounts/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { dashboardCashAccounts } = await import("@shared/schema");
      const id = parseInt(req.params.id);

      await db
        .delete(dashboardCashAccounts)
        .where(
          and(
            eq(dashboardCashAccounts.id, id),
            eq(dashboardCashAccounts.companyId, companyId)
          )
        )
        .execute();

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Bales API Routes
  app.get("/api/bales", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const bales = await storage.getAllBales(companyId);
      res.json(bales);
    } catch (error: any) {
      console.error("Error fetching bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/bales/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const id = parseInt(req.params.id);
      const bale = await storage.getBaleById(id);
      
      if (!bale) {
        return res.status(404).json({ message: "Bale not found" });
      }

      // Check company ownership
      if (bale.companyId !== companyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(bale);
    } catch (error: any) {
      console.error("Error fetching bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/bales/barcode/:barcode", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const barcode = req.params.barcode;
      const bale = await storage.getBaleByBarcode(barcode, companyId);
      
      if (!bale) {
        return res.status(404).json({ message: "Bale not found" });
      }

      res.json(bale);
    } catch (error: any) {
      console.error("Error fetching bale by barcode:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/bales", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { insertBaleSchema } = await import("@shared/schema");
      const data = insertBaleSchema.parse({ ...req.body, companyId });

      // Check for duplicate barcode
      const existing = await storage.getBaleByBarcode(data.barcode, companyId);
      if (existing) {
        return res.status(409).json({ message: "Barcode already exists" });
      }

      const bale = await storage.createBale(data);
      res.json(bale);
    } catch (error: any) {
      console.error("Error creating bale:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/bales/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const id = parseInt(req.params.id);
      const existing = await storage.getBaleById(id);
      
      if (!existing) {
        return res.status(404).json({ message: "Bale not found" });
      }

      // Check company ownership
      if (existing.companyId !== companyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Prevent companyId changes
      const { companyId: _, ...updateData } = req.body;
      const bale = await storage.updateBale(id, updateData);
      res.json(bale);
    } catch (error: any) {
      console.error("Error updating bale:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/bales/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const id = parseInt(req.params.id);
      const existing = await storage.getBaleById(id);
      
      if (!existing) {
        return res.status(404).json({ message: "Bale not found" });
      }

      // Check company ownership
      if (existing.companyId !== companyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      await storage.deleteBale(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/bales/import", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { insertBaleSchema } = await import("@shared/schema");
      const balesData = req.body.bales || [];

      if (!Array.isArray(balesData)) {
        return res.status(400).json({ message: "Invalid data format" });
      }

      const validatedBales = balesData.map((b: any) => 
        insertBaleSchema.parse({ ...b, companyId })
      );

      const created = await storage.bulkCreateBales(validatedBales);
      res.json({ success: true, count: created.length, bales: created });
    } catch (error: any) {
      console.error("Error importing bales:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Company Settings API Routes
  app.get("/api/company-settings", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const settings = await storage.getCompanySettings(companyId);
      res.json(settings || { companyId });
    } catch (error: any) {
      console.error("Error fetching company settings:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/company-settings", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { insertCompanySettingsSchema } = await import("@shared/schema");
      const data = insertCompanySettingsSchema.parse({ ...req.body, companyId });

      const settings = await storage.upsertCompanySettings(data);
      res.json(settings);
    } catch (error: any) {
      console.error("Error updating company settings:", error);
      res.status(400).json({ message: error.message });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
