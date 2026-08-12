import type { Express } from "express";
import { registerFactoryEmployeesPosRoutes as registerCanonicalFactoryEmployeesPosRoutes } from "./employee-pos/index";

// Compatibility entry point used by factoryRoutes.ts. Keep the actual employee/POS
// route list in one canonical registrar so new routes cannot be added to one
// aggregator and silently omitted from production.
export function registerFactoryEmployeesPosRoutes(app: Express) {
  registerCanonicalFactoryEmployeesPosRoutes(app);
}
