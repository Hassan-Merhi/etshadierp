import type { Express } from "express";

/**
 * Phase 4 compatibility boundary.
 *
 * All customer, container-sale, and company-transfer HTTP handlers now live in
 * focused modules composed by customerRoutes.ts. Keep this registrar temporarily
 * so stacked branches can remove old imports without changing runtime behavior.
 */
export function registerCustomerRoutes(_app: Express) {}
