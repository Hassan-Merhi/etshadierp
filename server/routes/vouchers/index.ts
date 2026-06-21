import type { Express } from "express";
import { registerVoucherQueryRoutes } from "./voucherQueryRoutes";
import { registerVoucherCreateRoutes } from "./voucherCreateRoutes";
import { registerVoucherPaymentRoutes } from "./voucherPaymentRoutes";
import { registerVoucherJournalRoutes } from "./voucherJournalRoutes";
import { registerVoucherSalesUpdateRoutes } from "./voucherSalesUpdateRoutes";
import { registerVoucherPurchaseUpdateRoutes } from "./voucherPurchaseUpdateRoutes";
import { registerVoucherTransferRoutes } from "./voucherTransferRoutes";
import { registerVoucherEntryRoutes } from "../voucherEntryRoutes";

export function registerVoucherRoutes(app: Express) {
  registerVoucherQueryRoutes(app);
  registerVoucherCreateRoutes(app);
  registerVoucherPaymentRoutes(app);
  registerVoucherJournalRoutes(app);
  registerVoucherSalesUpdateRoutes(app);
  registerVoucherPurchaseUpdateRoutes(app);
  registerVoucherTransferRoutes(app);
  registerVoucherEntryRoutes(app);
}
