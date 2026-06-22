import type { Express } from "express";
import { registerOrderExcelExportRoutes } from "./orderExcelExportRoutes";
import { registerOrderPdfExportRoutes } from "./orderPdfExportRoutes";

export function registerOrderDocumentsRoutes(app: Express) {
  registerOrderExcelExportRoutes(app);
  registerOrderPdfExportRoutes(app);
}
