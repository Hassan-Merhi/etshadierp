import type { Express } from "express";
import { registerOrderExcelExportRoutes } from "./orderExcelExportRoutes";
import { registerOrderPdfExportRoutes } from "./pdf-export";

export function registerOrderDocumentsRoutes(app: Express) {
  registerOrderExcelExportRoutes(app);
  registerOrderPdfExportRoutes(app);
}
