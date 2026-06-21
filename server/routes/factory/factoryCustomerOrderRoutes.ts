import type { Express } from "express";
import { registerOrderCrudRoutes } from "./customer-orders/orderCrudRoutes";
import { registerBaleScanningRoutes } from "./customer-orders/baleScanningRoutes";
import { registerOrderChargesRoutes } from "./customer-orders/orderChargesRoutes";
import { registerOrderStatusRoutes } from "./customer-orders/orderStatusRoutes";
import { registerOrderPricingRoutes } from "./customer-orders/orderPricingRoutes";
import { registerOrderDocumentsRoutes } from "./customer-orders/orderDocumentsRoutes";
import { registerOrderTrackingRoutes } from "./customer-orders/orderTrackingRoutes";

export function registerFactoryCustomerOrderRoutes(app: Express) {
  registerOrderCrudRoutes(app);
  registerBaleScanningRoutes(app);
  registerOrderChargesRoutes(app);
  registerOrderStatusRoutes(app);
  registerOrderPricingRoutes(app);
  registerOrderDocumentsRoutes(app);
  registerOrderTrackingRoutes(app);
}
