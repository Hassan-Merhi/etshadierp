import { type Express } from "express";
import { requireAuth } from "../../auth";
import { enforcePosOperationalPermissionScope } from "../../middleware/posOperationalPermissionScope";
import { registerPosPrintRoutes } from "./posPrintRoutes";
import { registerPosSalesRoutes } from "./posSalesRoutes";
import { registerPosEditSaleRoutes } from "./posEditSaleRoutes";
import { registerPosShiftRoutes } from "./posShiftRoutes";
import { registerPosDraftRoutes } from "./posDraftRoutes";
import { registerPosCustomerRoutes } from "./posCustomerRoutes";
import { registerPosWhatsAppRoutes } from "./posWhatsAppRoutes";

export function registerAllPosRoutes(app: Express): void {
  // Run before all POS handlers. The legacy handlers keep their own requireAuth
  // middleware; this boundary refreshes company-role/POS flags and validates
  // operational scope before any POS business transaction begins.
  app.use("/api/pos", requireAuth, enforcePosOperationalPermissionScope);
  app.use(/^\/api\/vouchers\/\d+\/sales$/, requireAuth, enforcePosOperationalPermissionScope);

  registerPosPrintRoutes(app);
  registerPosSalesRoutes(app);
  registerPosEditSaleRoutes(app);
  registerPosShiftRoutes(app);
  registerPosDraftRoutes(app);
  registerPosCustomerRoutes(app);
  registerPosWhatsAppRoutes(app);
}
