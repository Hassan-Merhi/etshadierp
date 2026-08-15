import { logAudit } from "../_helpers";
import { getSupplierBalanceForContext, resolveParentCompanyId } from "../helpers/supplierBalanceHelpers";
import { SupplierRouteError } from "./supplierErrors";
import type { SupplierAuditActor } from "./supplierRequestContext";
import { supplierRepository } from "./supplierRepository";
import {
  parseCreateSupplierInput,
  parseSupplierStockGroupId,
  parseUpdateSupplierInput,
} from "./supplierValidation";

async function requireSupplier(supplierId: number, companyId: number) {
  const supplier = await supplierRepository.getById(supplierId, companyId);
  if (!supplier) throw new SupplierRouteError(404, "Supplier not found");
  return supplier;
}

async function createUniqueSupplierCode(companyId: number, legalName: string, requestedCode?: string | null) {
  let code = requestedCode?.trim();
  if (code) {
    if (await supplierRepository.getByCode(code, companyId)) {
      throw new SupplierRouteError(400, "Supplier code already exists in this company");
    }
    return code;
  }

  const sanitized = legalName.trim().replace(/[^a-zA-Z0-9]/g, "");
  const baseCode = sanitized.substring(0, 6).toUpperCase() || "SUP";
  code = baseCode;
  let suffix = 1;
  while (await supplierRepository.getByCode(code, companyId)) {
    code = `${baseCode}${suffix}`;
    suffix += 1;
  }
  return code;
}

function supplierAuditChanges(existing: unknown, updated: unknown) {
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
    if (String(existing?.[field] ?? "") !== String(updated?.[field] ?? "")) {
      changes[field] = { old: existing?.[field], new: updated?.[field] };
    }
  }
  return changes;
}

export const supplierService = {
  async list(companyId: number, search: string, allowParentFallback = false) {
    const suppliers = await supplierRepository.list(companyId, search);
    if (suppliers.length > 0 || !allowParentFallback) return suppliers;

    // PO Import is the one compatibility flow that may intentionally resolve
    // the configured parent supplier master when a new child company has no
    // company-owned suppliers yet. Every normal supplier/accounting picker must
    // remain strict to the active company so a foreign supplier ID can never be
    // selected and then rejected by the central posting ownership guard.
    const companySuppliers = search ? await supplierRepository.listAll(companyId) : suppliers;
    if (companySuppliers.length > 0) return suppliers;

    const parentCompanyId = await resolveParentCompanyId();
    if (parentCompanyId === companyId) return suppliers;

    return supplierRepository.list(parentCompanyId, search);
  },

  async stats(companyId: number) {
    const suppliers = await supplierRepository.listAll(companyId);
    return Promise.all(
      suppliers.map(async (supplier) => {
        const [containerCount, balanceResult, purchaseOrders] = await Promise.all([
          supplierRepository.getContainerCount(supplier.id, companyId),
          getSupplierBalanceForContext(supplier, companyId),
          supplierRepository.getPurchaseOrders(supplier.id, companyId),
        ]);

        return {
          ...supplier,
          containerCount,
          balance: balanceResult.balance,
          openingBalance: balanceResult.openingBalance,
          hasActivity: containerCount > 0 || balanceResult.hasActivity || purchaseOrders.length > 0,
        };
      }),
    );
  },

  get(supplierId: number, companyId: number) {
    return requireSupplier(supplierId, companyId);
  },

  async balance(supplierId: number, companyId: number) {
    const supplier = await requireSupplier(supplierId, companyId);
    const { balance, openingBalance, balancesByCurrency, historicalBaseBalance } =
      await getSupplierBalanceForContext(supplier, companyId);
    return { balance, openingBalance, balancesByCurrency, historicalBaseBalance };
  },

  async create(companyId: number, input: unknown, actor: SupplierAuditActor) {
    const parsed = parseCreateSupplierInput(input, companyId);
    const code = await createUniqueSupplierCode(companyId, parsed.legalName, parsed.code);
    const supplier = await supplierRepository.create({
      ...parsed,
      code,
      email: parsed.email || "",
      phone: parsed.phone || "",
      address: parsed.address || "",
      taxId: parsed.taxId || "",
      paymentTerms: parsed.paymentTerms || "",
    });

    await logAudit({
      ...actor,
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

    return supplier;
  },

  async update(supplierId: number, companyId: number, input: unknown, actor: SupplierAuditActor) {
    const existing = await requireSupplier(supplierId, companyId);
    const parsed = parseUpdateSupplierInput(input);

    if (parsed.code && parsed.code !== existing.code) {
      const duplicate = await supplierRepository.getByCode(parsed.code, companyId);
      if (duplicate && duplicate.id !== supplierId) {
        throw new SupplierRouteError(400, "Supplier code already exists in this company");
      }
    }

    const updated = await supplierRepository.update(supplierId, parsed, companyId);
    await logAudit({
      ...actor,
      companyId,
      action: "update",
      tableName: "suppliers",
      recordId: updated.id,
      recordIdentifier: updated.legalName,
      changes: supplierAuditChanges(existing, updated),
    });
    return updated;
  },

  async delete(supplierId: number, companyId: number, actor: SupplierAuditActor) {
    const existing = await requireSupplier(supplierId, companyId);
    await supplierRepository.delete(supplierId, companyId);
    await logAudit({
      ...actor,
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
  },

  async assignStockGroup(
    supplierId: number,
    companyId: number,
    input: unknown,
    actor: SupplierAuditActor,
  ) {
    const supplier = await requireSupplier(supplierId, companyId);
    const stockGroupId = parseSupplierStockGroupId(input);
    if (stockGroupId !== null && !(await supplierRepository.stockGroupExists(stockGroupId, companyId))) {
      throw new SupplierRouteError(404, "Stock group not found");
    }

    const updated = await supplierRepository.updateStockGroup(supplierId, companyId, stockGroupId);
    if (!updated) throw new SupplierRouteError(404, "Supplier not found");

    await logAudit({
      ...actor,
      companyId,
      action: "update",
      tableName: "suppliers",
      recordId: supplierId,
      recordIdentifier: supplier.legalName,
      changes: { stockGroupId: { old: supplier.stockGroupId ?? null, new: stockGroupId } },
    });

    return updated;
  },
};
