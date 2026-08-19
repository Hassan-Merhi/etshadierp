import type { Express } from "express";
import { registerCommonInventoryPerformanceRoutes } from "./commonInventoryPerformanceRoutes";
import { registerLocationWhatsappLegacyCompatibilityRoutes } from "./locationWhatsappLegacyCompatibilityRoutes";
import { registerLocationCrudRoutes } from "./locationCrudRoutes";
import { registerLocationDeleteRoutes } from "./locationDeleteRoutes";
import { registerLocationInventoryRoutes } from "./locationInventoryRoutes";
import { registerLocationReportRoutes } from "./locationReportRoutes";
import { registerLocationWhatsappScheduleRoutes } from "./locationWhatsappScheduleRoutes";
import { registerLocationWhatsappDeliveryRoutes } from "./locationWhatsappDeliveryRoutes";

export function registerLocationRoutes(app: Express) {
  registerCommonInventoryPerformanceRoutes(app);
  // Must be registered before the generic location CRUD PATCH route so older
  // clients that still send whatsappGroupChatId are upgraded through the same
  // permission + group-validation boundary instead of bypassing Phase 1.
  registerLocationWhatsappLegacyCompatibilityRoutes(app);
  registerLocationCrudRoutes(app);
  registerLocationDeleteRoutes(app);
  registerLocationInventoryRoutes(app);
  registerLocationReportRoutes(app);
  registerLocationWhatsappScheduleRoutes(app);
  registerLocationWhatsappDeliveryRoutes(app);
}
