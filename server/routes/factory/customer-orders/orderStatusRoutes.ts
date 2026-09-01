import type { Express } from "express";
import { registerOrderFinalizeLoadingRoutes } from "./finalize-loading";
import { registerOrderVerifyRecoverRoutes } from "./verify-recover";

export function registerOrderStatusRoutes(app: Express) {
  registerOrderFinalizeLoadingRoutes(app);
  registerOrderVerifyRecoverRoutes(app);
}
