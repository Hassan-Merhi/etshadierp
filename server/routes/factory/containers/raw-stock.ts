/**
 * factoryContainersRoutes: FactoryContainerRawStockDelegation endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { registerFactoryRawStockRoutes } from "../factoryRawStockRoutes";

export function registerFactoryContainerRawStockDelegation(app: Express) {
  // ───────────────────────────────────────────────
  // 5. Factory Raw Stock
  // ───────────────────────────────────────────────

  registerFactoryRawStockRoutes(app);

  // ───────────────────────────────────────────────
  // NOTE: fx-rates CRUD is handled by factoryBalesRoutes (GET, POST, DELETE /:id,
  //       GET /latest/:currencyCode, GET /:currencyCode/:date).
  //       Do NOT add duplicate handlers here — Express first-match wins and
  //       the duplicate below would shadow the more complete bales implementation.
  // ───────────────────────────────────────────────
}
