import type { Express } from "express";
import { db, pool } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate, syncEmployeeBalancesFromEntries } from "./_helpers";
import { resolveParentCompanyId, getSupplierBalanceForContext } from "./helpers/supplierBalanceHelpers";
import {
  locations,
  inventory,
  stockItems,
  stockGroups,
  ledgerAccounts,
  employees,
  employeeGroups,
  employeeGroupMembers,
  suppliers,
  customers,
  customerBalances,
  customerOrders,
  stockTransferVouchers,
  stockTransferItems,
  stockAdjustmentVouchers,
  stockAdjustmentItems,
  containers,
  containerOffloads,
  containerOffloadItems,
  vouchers,
  voucherEntries,
  salesItems,
  insertLocationSchema,
  insertLedgerAccountSchema,
  updateLedgerAccountSchema,
  insertEmployeeSchema,
  insertEmployeeGroupSchema,
  insertSupplierSchema,
  insertCustomerSchema,
  userLocations,
  userCompanyRoles,
  companies,
  bankAccounts,
  fixedAssets,
  agentAccounts,
  auditLog,
  users,
  FEATURE_KEYS,
} from "@shared/schema";
import {
  eq,
  and,
  or,
  desc,
  asc,
  lt,
  gt,
  ne,
  inArray,
  sql,
  isNull,
  isNotNull,
  not,
  gte,
  lte,
  like,
  ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";

export function registerSupplierRoutes(app: Express) {
  app.get("/api/suppliers", requireAuth, async (req, res) => {
    try {
      const search = (req.query.search as string | undefined)?.trim() || undefined;
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : null;

      if (companyId && !isNaN(companyId)) {
        // Determine the company type so we can isolate ERP vs factory suppliers
        const companyRow = await pool.query(`SELECT company_type FROM companies WHERE id = $1`, [companyId]);
        const companyType: string = companyRow.rows[0]?.company_type ?? "erp";
        const isFactory = companyType === "factory" || companyType === "factory_v2";
        const peerTypes = isFactory ? ["factory", "factory_v2"] : ["erp", "properties", "supplier_partner"];
        const peerTypesParam = peerTypes.map((_, i) => `$${i + 2}`).join(", ");

        // Return suppliers that:
        //   a) have at least one PO with a company of the same type group, OR
        //   b) have NO purchase orders at all (new/uncategorised suppliers)
        // This keeps factory and ERP supplier lists isolated while allowing new
        // suppliers to appear until their first PO assigns them to a type.
        const searchClause = search ? `AND lower(s.legal_name) LIKE lower($${peerTypes.length + 2})` : "";
        const params: any[] = [companyId, ...peerTypes];
        if (search) params.push(`%${search}%`);

        const result = await pool.query(
          `SELECT s.*
           FROM suppliers s
           WHERE s.deleted_at IS NULL
             ${searchClause}
             AND (
               EXISTS (
                 SELECT 1 FROM purchase_orders po
                 JOIN companies c ON c.id = po.company_id
                 WHERE po.supplier_id = s.id
                   AND c.company_type IN (${peerTypesParam})
               )
               OR NOT EXISTS (
                 SELECT 1 FROM purchase_orders po2
                 WHERE po2.supplier_id = s.id
               )
             )
           ORDER BY s.legal_name
           ${search ? `LIMIT 50` : ""}`,
          params
        );
        return res.json(result.rows);
      }

      // No companyId — fall back to returning all suppliers (existing behaviour for
      // other callers like stats, chatbot, admin pages)
      const limit = search ? 50 : undefined;
      const result = await storage.getAllSuppliers(search, limit);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get suppliers with their container counts and balances, filtered by current company
  // MUST come before /api/suppliers/:id to avoid route matching issues
  app.get("/api/suppliers/stats", requireAuth, async (req, res) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      const suppliers = await storage.getAllSuppliers();

      // The supplier opening balance is a historical value that belongs only to
      // the explicitly configured parent company's books (never guessed via
      // "lowest company ID"). Sub-companies that transact with the same
      // supplier start from zero.
      const suppliersWithStats = await Promise.all(
        suppliers.map(async (supplier) => {
          const containerCount = await storage.getContainerCountBySupplier(supplier.id, companyId || undefined);

          const { balance, openingBalance, hasActivity: hasEntries } = await getSupplierBalanceForContext(
            supplier,
            companyId || undefined
          );

          let poCount = 0;
          if (companyId) {
            const pos = await storage.getPurchaseOrdersBySupplier(supplier.id, companyId);
            poCount = pos.length;
          }

          return {
            ...supplier,
            containerCount,
            balance,
            hasActivity: containerCount > 0 || hasEntries || poCount > 0,
          };
        })
      );

      if (companyId) {
        res.json(suppliersWithStats.filter((s) => s.hasActivity));
      } else {
        res.json(suppliersWithStats);
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/suppliers/:id", requireAuth, async (req, res) => {
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

  app.get("/api/suppliers/:id/balance", requireAuth, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const supplierId = parseInt(req.params.id);
      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }
      const companyId = (req.session as any).currentCompanyId;
      const supplier = await storage.getSupplierById(supplierId);
      if (!supplier) {
        return res.status(404).json({ message: "Supplier not found" });
      }
      // Opening balance belongs only to the explicitly configured parent
      // company — never guessed via "lowest company ID".
      const { balance } = await getSupplierBalanceForContext(supplier, companyId || undefined);
      res.json({ balance });
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
        const sanitized = parsed.legalName.trim().replace(/[^a-zA-Z0-9]/g, "");
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
          return res.status(400).json({ message: "Supplier code already exists" });
        }
      }

      // Provide defaults for optional fields
      const supplierData = {
        ...parsed,
        email: parsed.email || "",
        phone: parsed.phone || "",
        address: parsed.address || "",
        taxId: parsed.taxId || "",
        paymentTerms: parsed.paymentTerms || "",
      };

      const supplier = await storage.createSupplier(supplierData);
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "create",
          tableName: "suppliers",
          recordId: supplier.id,
          recordIdentifier: supplier.legalName,
          changes: {
            name: { old: null, new: supplier.legalName },
            code: { old: null, new: supplier.code },
            phone: { old: null, new: supplier.phone || null },
            email: { old: null, new: supplier.email || null },
            address: { old: null, new: supplier.address || null },
          },
        });
      } catch {
        /* non-fatal */
      }
      res.status(201).json(supplier);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/suppliers/:id", requireAuth, requireNonPOS, async (req, res) => {
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
          return res.status(400).json({ message: "Supplier code already exists" });
        }
      }

      const parsed = insertSupplierSchema.partial().parse(req.body);
      const updatedSupplier = await storage.updateSupplier(supplierId, parsed);

      try {
        const _supChanges: Record<string, { old?: any; new?: any }> = {};
        for (const _f of ["legalName", "phone", "email", "address", "taxId", "paymentTerms"] as const) {
          if (String((existingSupplier as any)[_f] ?? "") !== String((updatedSupplier as any)[_f] ?? "")) {
            _supChanges[_f] = { old: (existingSupplier as any)[_f], new: (updatedSupplier as any)[_f] };
          }
        }
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "update",
          tableName: "suppliers",
          recordId: updatedSupplier.id,
          recordIdentifier: updatedSupplier.legalName,
          changes: _supChanges,
        });
      } catch {
        /* non-fatal */
      }
      res.json(updatedSupplier);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/suppliers/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const supplierId = parseInt(req.params.id);
      if (isNaN(supplierId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }
      const existing = await storage.getSupplierById(supplierId);
      if (!existing) {
        return res.status(404).json({ message: "Supplier not found" });
      }
      await storage.deleteSupplier(supplierId);
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "delete",
          tableName: "suppliers",
          recordId: existing.id,
          recordIdentifier: existing.legalName,
          changes: {
            name: { old: existing.legalName, new: null },
            code: { old: existing.code, new: null },
            phone: { old: existing.phone || null, new: null },
            email: { old: existing.email || null, new: null },
          },
        });
      } catch {
        /* non-fatal */
      }
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH /api/suppliers/:id/stock-group — link/unlink a stock group from a supplier
  app.patch("/api/suppliers/:id/stock-group", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const supplierId = parseInt(req.params.id);
      const { stockGroupId } = req.body; // null to unlink
      await db
        .update(suppliers)
        .set({ stockGroupId: stockGroupId ?? null })
        .where(eq(suppliers.id, supplierId));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Customers
}
