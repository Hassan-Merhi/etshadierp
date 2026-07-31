import type { Express } from "express";
import { createServer, type Server } from "http";

import { requireAuth } from "../auth";
import { db } from "../db";
import { broadcast } from "../wsServer";
import { registerAccountRoutes } from "./accounts";
import { registerAdminRoutes } from "./adminRoutes";
import { registerAiAgentRoutes } from "./aiAgentRoutes";
import { registerAiImportRoutes } from "./ai-import";
import { registerAiValidationRoutes } from "./aiValidationRoutes";
import { registerApprovalRoutes } from "./approvalRoutes";
import { registerAuthRoutes } from "./authRoutes";
import { registerBalanceRepairRoutes } from "./balance-repair";
import { registerBaleRoutes } from "./baleRoutes";
import { registerBankAssetRoutes } from "./bankAssetRoutes";
import { registerBusinessAlertRoutes } from "./businessAlertsRoutes";
import { registerChatbotRoutes } from "./chatbot";
import { registerContainerRoutes } from "./containerRoutes";
import { registerContainerTrackingRoutes } from "./containerTrackingRoutes";
import { registerCreditNoteRoutes } from "./creditNoteRoutes";
import { registerCustomerRoutes } from "./customerRoutes";
import { registerDebugRoutes } from "./debugRoutes";
import { registerEmployeeRoutes } from "./employeeRoutes";
import { registerErpRentalRoutes } from "./erpRentalRoutes";
import { registerExportRoutes } from "./exportRoutes";
import { registerFactoryAttendanceRoutes } from "./factoryAttendanceRoutes";
import { registerFactoryIntelligenceRoutes } from "./factory-intelligence";
import { registerFactoryPayrollRoutes } from "./factoryPayrollRoutes";
import { registerFactoryRentalRoutes } from "./factoryRentalRoutes";
import { registerFactoryReportRoutes } from "./factoryReportRoutes";
import { registerFactoryRoutes } from "./factoryRoutes";
import { registerFactoryWorkerRoutes } from "./factoryWorkerRoutes";
import { registerFactoryWhatsappRoutes } from "./factoryWhatsappRoutes";
import { registerFiscalTransferRoutes } from "./fiscal-transfers";
import { registerGitRoutes } from "./git";
import { registerGlobalTransactionRoutes } from "./globalTransactionRoutes";
import { registerImportCycleRoutes } from "./import-cycle";
import { registerImportRoutes } from "./import";
import { registerIntercompanyNotificationRoutes } from "./intercompanyNotificationRoutes";
import { registerInventoryRoutes } from "./inventoryRoutes";
import { registerLedgerRoutes } from "./ledgerRoutes";
import { registerLocationRoutes } from "./locationRoutes";
import { registerNetPositionMonthlyExcelRoute } from "./netPositionMonthlyExcelRoute";
import { registerNetProfitExcelRoute } from "./netProfitExcelRoute";
import { registerNotificationRoutes } from "./notificationRoutes";
import { registerPasskeyRoutes } from "./passkeyRoutes";
import { registerPosRoutes } from "./posRoutes";
import { registerPropertiesRentalRoutes } from "./propertiesRentalRoutes";
import { registerReportsRoutes } from "./reportsRoutes";
import { registerScreenFeedRoutes } from "./screenFeedRoutes";
import { registerSpRoutes } from "./sp";
import { registerSpMigrationRoutes } from "./sp-migration";
import { registerStatsRoutes } from "./statsRoutes";
import { registerStockRoutes } from "./stockRoutes";
import { registerStockSummaryRoutes } from "./stockSummaryRoutes";
import { registerSupplierProfitCheckRoutes } from "./supplier-profit-check";
import { registerSupplierProformaRoutes } from "./supplierProformaRoutes";
import { registerSupplierRoutes } from "./supplierRoutes";
import { registerTransporterStatementRoutes } from "./transporterStatementRoutes";
import { registerUserNotesRoutes } from "./userNotesRoutes";
import { registerVoucherEntryRoutes } from "./voucher-entries";
import { registerVoucherRoutes } from "./voucherRoutes";
import { registerWhatsAppRoutes } from "./whatsappRoutes";
import { registerDispatchBatchRoutes } from "./factory/dispatch-batches";
import { registerFactoryInvoiceLoadingRoutes } from "./factory/invoice-loading";
import { registerFactoryInsuranceRoutes } from "./factory/factoryInsuranceRoutes";
import { registerFactorySheetsAndSacksRoutes } from "./factory/factorySheetsAndSacksRoutes";
import { registerFactorySheetsRoutes } from "./factory/factorySheetsRoutes";
import { registerFactoryStatusBuilderRoutes } from "./factory/factoryStatusBuilderRoutes";
import { registerFactoryStatusBuilderSheetsRoutes } from "./factory/factoryStatusBuilderSheetsRoutes";
import { registerFactoryStockAllocationV3Routes } from "./factory/factoryStockAllocationV3Routes";
import { registerFactoryTransporterRoutes } from "./factory/factoryTransporterRoutes";
import { registerProductionPlannerRoutes } from "./factory/factoryProductionPlannerRoutes";
import { registerEndProductionRoutes } from "./factory/endProductionRoutes";
import { registerLabelBannersRoutes } from "./factory/labelBannersRoutes";
import { registerErpWorkerDocumentRoutes } from "./employees/erpWorkerDocumentRoutes";
import { registerSalaryAdvanceRoutes } from "./employees/salaryAdvanceRoutes";
import { registerLegacyHealthRoutes } from "./core/healthRoutes";
import { registerPermissionBoundaryRoutes } from "./core/permissionBoundaryRoutes";
import { registerIntercompanyPosConfigRoutes } from "./pos/intercompanyPosConfigRoutes";

function registerWriteInvalidationSignal(app: Express): void {
  app.use((req, res, next) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
      res.on("finish", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          broadcast({ type: "invalidate" });
        }
      });
    }
    next();
  });
}

export async function registerApplicationRoutes(app: Express): Promise<Server> {
  registerWriteInvalidationSignal(app);
  registerPermissionBoundaryRoutes(app);

  registerFactoryRoutes(app, requireAuth, db);
  registerFactoryWorkerRoutes(app, requireAuth, db);
  registerFactoryPayrollRoutes(app, requireAuth, db);
  registerFactoryReportRoutes(app, requireAuth, db);
  registerFactoryIntelligenceRoutes(app, requireAuth, db);
  registerFactoryAttendanceRoutes(app, requireAuth, db);
  registerSupplierProformaRoutes(app, requireAuth);
  registerSupplierProfitCheckRoutes(app, requireAuth);
  registerGlobalTransactionRoutes(app, requireAuth);
  registerPropertiesRentalRoutes(app);
  registerErpRentalRoutes(app);
  registerFactoryRentalRoutes(app);
  registerProductionPlannerRoutes(app);
  registerFactorySheetsRoutes(app);
  registerFactoryStockAllocationV3Routes(app);
  registerFactoryInvoiceLoadingRoutes(app);
  registerFactoryWhatsappRoutes(app, requireAuth);
  registerEndProductionRoutes(app, requireAuth);
  registerFactoryStatusBuilderRoutes(app);
  registerFactoryStatusBuilderSheetsRoutes(app);
  registerDispatchBatchRoutes(app);
  registerLabelBannersRoutes(app, requireAuth);
  registerFactoryTransporterRoutes(app);
  registerFactoryInsuranceRoutes(app);
  registerFactorySheetsAndSacksRoutes(app);

  registerLegacyHealthRoutes(app);
  registerAuthRoutes(app);
  registerPasskeyRoutes(app);
  registerScreenFeedRoutes(app);
  registerLocationRoutes(app);
  registerInventoryRoutes(app);
  registerLedgerRoutes(app);
  registerEmployeeRoutes(app);
  registerSupplierRoutes(app);
  registerCustomerRoutes(app);
  registerIntercompanyPosConfigRoutes(app);
  registerErpWorkerDocumentRoutes(app);
  registerSalaryAdvanceRoutes(app);

  registerStockRoutes(app);
  registerBankAssetRoutes(app);
  registerContainerRoutes(app);
  registerImportRoutes(app);
  registerAccountRoutes(app);
  registerVoucherRoutes(app);
  registerVoucherEntryRoutes(app);
  registerFiscalTransferRoutes(app);
  registerPosRoutes(app);
  registerStatsRoutes(app);
  registerImportCycleRoutes(app);
  registerDebugRoutes(app);
  registerReportsRoutes(app);
  registerBaleRoutes(app);
  registerAdminRoutes(app);
  registerBalanceRepairRoutes(app);
  registerStockSummaryRoutes(app);
  registerChatbotRoutes(app);
  registerCreditNoteRoutes(app);
  registerNetProfitExcelRoute(app);
  registerNetPositionMonthlyExcelRoute(app);
  registerWhatsAppRoutes(app);
  registerExportRoutes(app);
  registerGitRoutes(app);
  registerContainerTrackingRoutes(app);
  registerUserNotesRoutes(app);
  registerSpRoutes(app);
  registerSpMigrationRoutes(app);
  registerAiImportRoutes(app);
  registerAiValidationRoutes(app);
  registerAiAgentRoutes(app);
  registerApprovalRoutes(app);
  registerBusinessAlertRoutes(app);
  registerIntercompanyNotificationRoutes(app);
  registerNotificationRoutes(app);
  registerTransporterStatementRoutes(app);

  return createServer(app);
}
