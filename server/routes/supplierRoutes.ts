import type { Express } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { stockGroups } from "@shared/schema";
import {
  companyScopedSuppliers,
  insertCompanyScopedSupplierSchema,
} from "@shared/schema/supplierCompanyScope";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireNonPOS } from "../auth";
import { getErrorMessage } from "../lib/httpHandlers";
import { logAudit } from "./_helpers";
import { getSupplierBalanceForContext } from "./helpers/supplierBalanceHelpers";

function currentCompanyId(req: any): number | null {
  const value = Number(req.session?.currentCompanyId);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function supplierIdParam(value: string): number | null {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function auditIdentity(req: any) {
  return {
    userId: req.session.userId!,
    username: req.session.username || "unknown",
  };
}

export function registerSupplierRoutes(app: Express) {
  app.get("/api/suppliers", requireAuth, async (req: any, res) => {
    try {
      const companyId = currentCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      if (req.query.companyId && Number(req.query.companyId) !== companyId) {
        return res.status(403).json({ message: "Supplier access is limited to the active company" });
      }

      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      const suppliers = await storage.getAllSuppliers(search || undefined, search ? 50 : undefined, companyId);
      res.json(suppliers);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // MUST come before /api/suppliers/:id to avoid route matching issues.
  app.get("/api/suppliers/stats", requireAuth, async (req: any, res) => {
    try {
      const companyId = currentCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const suppliers = await storage.getAllSuppliers(undefined, undefined, companyId);
      const suppliersWithStats = await Promise.all(
        suppliers.map(async (supplier) => {
          const [containerCount, balanceResult, purchaseOrders] = await Promise.all([
            storage.getContainerCountBySupplier(supplier.id, companyId),
            getSupplierBalanceForContext(supplier, companyId),
            storage.getPurchaseOrdersBySupplier(supplier.id, companyId),
          ]);

          return {
            ...supplier,
            containerCount,
            balance: balanceResult.balance,
            openingBalance: balanceResult.openingBalance,
            hasActivity:
              containerCount > 0 || balanceResult.hasActivity || purchaseOrders.length > 0,
          };
        })
      );

      res.json(suppliersWithStats);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/suppliers/:id", requireAuth, async (req: any, res) => {
    try {
      const companyId = currentCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = supplierIdParam(req.params.id);
      if (!supplierId) return res.status(400).json({ message: "Invalid supplier ID" });

      const supplier = await storage.getSupplierById(supplierId, companyId);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });
      res.json(supplier);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/suppliers/:id/balance", requireAuth, async (req: any, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const companyId = currentCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = supplierIdParam(req.params.id);
      if (!supplierId) return res.status(400).json({ message: "Invalid supplier ID" });

      const supplier = await storage.getSupplierById(supplierId, companyId);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });

      const { balance, openingBalance, balancesByCurrency, historicalBaseBalance } =
        await getSupplierBalanceForContext(supplier, companyId);
      res.json({ balance, openingBalance, balancesByCurrency, historicalBaseBalance });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/suppliers", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = currentCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertCompanyScopedSupplierSchema.parse({
        ...req.body,
        companyId,
      });

      let code = parsed.code?.trim();
      if (!code) {
        const sanitized = parsed.legalName.trim().replace(/[^a-zA-Z0-9]/g, "");
        const baseCode = sanitized.substring(0, 6).toUpperCase() || "SUP";
        code = baseCode;
        let suffix = 1;
        while (await storage.getSupplierByCode(code, companyId)) {
          code = `${baseCode}${suffix}`;
          suffix += 1;
        }
      } else if (await storage.getSupplierByCode(code, companyId)) {
        return res.status(400).json({ message: "Supplier code already exists in this company" });
      }

      const supplier = await storage.createSupplier({
        ...parsed,
        code,
        email: parsed.email || "",
        phone: parsed.phone || "",
        address: parsed.address || "",
        taxId: parsed.taxId || "",
        paymentTerms: parsed.paymentTerms || "",
      });

      await logAudit({
        ...auditIdentity(req),
        companyId,
        action: "create",
        tableName: "suppliers",
        recordId: supplier.id,
        recordIdentifier: supplier.legalName,
        changes: {
          companyId: { old: null, new: companyId },
          name: { old: null, new: supplier.legalName },
          code: { old: null, new: supplier.code },
          phone: { old: null, new: supplier.phone || null },
          email: { old: null, new: supplier.email || null },
          address: { old: null, new: supplier.address || null },
        },
      });

      res.status(201).json(supplier);
    } catch (error: unknown) {
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.patch("/api/suppliers/:id", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = currentCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = supplierIdParam(req.params.id);
      if (!supplierId) return res.status(400).json({ message: "Invalid supplier ID" });

      const existing = await storage.getSupplierById(supplierId, companyId);
      if (!existing) return res.status(404).json({ message: "Supplier not found" });

      const { companyId: _ignoredCompanyId, ...requestedUpdates } = req.body || {};
      const parsed = insertCompanyScopedSupplierSchema
        .omit({ companyId: true })
        .partial()
        .parse(requestedUpdates);

      if (parsed.code && parsed.code !== existing.code) {
        const duplicate = await storage.getSupplierByCode(parsed.code, companyId);
        if (duplicate && duplicate.id !== supplierId) {
          return res.status(400).json({ message: "Supplier code already exists in this company" });
        }
      }

      const updated = await storage.updateSupplier(supplierId, parsed, companyId);
      const changes: Record<string, { old?: unknown; new?: unknown }> = {};
      for (const field of [
        "legalName",
        "code",
        "phone",
        "email",
        "address",
        "taxId",
        "paymentTerms",
        "openingBalance",
        "active",
      ] as const) {
        if (String((existing as any)[field] ?? "") !== String((updated as any)[field] ?? "")) {
          changes[field] = { old: (existing as any)[field], new: (updated as any)[field] };
        }
      }

      await logAudit({
        ...auditIdentity(req),
        companyId,
        action: "update",
        tableName: "suppliers",
        recordId: updated.id,
        recordIdentifier: updated.legalName,
        changes,
      });

      res.json(updated);
    } catch (error: unknown) {
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.delete("/api/suppliers/:id", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = currentCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = supplierIdParam(req.params.id);
      if (!supplierId) return res.status(400).json({ message: "Invalid supplier ID" });

      const existing = await storage.getSupplierById(supplierId, companyId);
      if (!existing) return res.status(404).json({ message: "Supplier not found" });
      await storage.deleteSupplier(supplierId, companyId);

      await logAudit({
        ...auditIdentity(req),
        companyId,
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

      res.status(204).send();
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.patch("/api/suppliers/:id/stock-group", requireAuth, requireNonPOS, async (req: any, res) => {
    try {
      const companyId = currentCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = supplierIdParam(req.params.id);
      if (!supplierId) return res.status(400).json({ message: "Invalid supplier ID" });

      const supplier = await storage.getSupplierById(supplierId, companyId);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });

      const rawStockGroupId = req.body?.stockGroupId;
      const stockGroupId = rawStockGroupId == null ? null : Number(rawStockGroupId);
      if (stockGroupId !== null) {
        if (!Number.isInteger(stockGroupId) || stockGroupId <= 0) {
          return res.status(400).json({ message: "Invalid stock group ID" });
        }
        const [ownedGroup] = await db
          .select({ id: stockGroups.id })
          .from(stockGroups)
          .where(and(eq(stockGroups.id, stockGroupId), eq(stockGroups.companyId, companyId)))
          .limit(1);
        if (!ownedGroup) return res.status(404).json({ message: "Stock group not found" });
      }

      const [updated] = await db
        .update(companyScopedSuppliers)
        .set({ stockGroupId })
        .where(
          and(
            eq(companyScopedSuppliers.id, supplierId),
            eq(companyScopedSuppliers.companyId, companyId),
            isNull(companyScopedSuppliers.deletedAt)
          )
        )
        .returning();
      if (!updated) return res.status(404).json({ message: "Supplier not found" });

      await logAudit({
        ...auditIdentity(req),
        companyId,
        action: "update",
        tableName: "suppliers",
        recordId: supplierId,
        recordIdentifier: supplier.legalName,
        changes: { stockGroupId: { old: supplier.stockGroupId ?? null, new: stockGroupId } },
      });

      res.json({ success: true, supplier: updated });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
