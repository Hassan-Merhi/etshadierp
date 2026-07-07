import { type Express } from "express";
import { registerPosPrintRoutes } from "./posPrintRoutes";
import { registerPosSalesRoutes } from "./posSalesRoutes";
import { registerPosEditSaleRoutes } from "./posEditSaleRoutes";
import { registerPosShiftRoutes } from "./posShiftRoutes";
import { registerPosDraftRoutes } from "./posDraftRoutes";
import { registerPosCustomerRoutes } from "./posCustomerRoutes";
import { registerPosWhatsAppRoutes } from "./posWhatsAppRoutes";

export function registerAllPosRoutes(app: Express): void {
  registerPosPrintRoutes(app);
  registerPosSalesRoutes(app);
  registerPosEditSaleRoutes(app);
  registerPosShiftRoutes(app);
  registerPosDraftRoutes(app);
  registerPosCustomerRoutes(app);
  registerPosWhatsAppRoutes(app);
}
