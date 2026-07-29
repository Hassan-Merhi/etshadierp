import { insertCompanyScopedSupplierSchema } from "@shared/schema/supplierCompanyScope";

import { SupplierRouteError } from "./supplierErrors";

export function parseCreateSupplierInput(input: unknown, companyId: number) {
  return insertCompanyScopedSupplierSchema.parse({
    ...(input && typeof input === "object" ? input : {}),
    companyId,
  });
}

export function parseUpdateSupplierInput(input: unknown) {
  const body = input && typeof input === "object" ? input : {};
  const { companyId: _ignoredCompanyId, ...requestedUpdates } = body as Record<string, unknown>;
  return insertCompanyScopedSupplierSchema.omit({ companyId: true }).partial().parse(requestedUpdates);
}

export function parseSupplierStockGroupId(input: unknown): number | null {
  const rawStockGroupId =
    input && typeof input === "object" ? (input as Record<string, unknown>).stockGroupId : undefined;
  if (rawStockGroupId == null) return null;

  const stockGroupId = Number(rawStockGroupId);
  if (!Number.isInteger(stockGroupId) || stockGroupId <= 0) {
    throw new SupplierRouteError(400, "Invalid stock group ID");
  }
  return stockGroupId;
}
