import type { Express } from "express";
import { registerOrderFinalizeLoadingRoutes } from "./orderFinalizeLoadingRoutes";
import { registerOrderVerifyRecoverRoutes } from "./orderVerifyRecoverRoutes";

export function registerOrderStatusRoutes(app: Express) {
  registerOrderFinalizeLoadingRoutes(app);
  registerOrderVerifyRecoverRoutes(app);
}
