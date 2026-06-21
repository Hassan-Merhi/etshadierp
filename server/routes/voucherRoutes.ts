import type { Express } from "express";
import { registerVoucherQueryRoutes } from "./vouchers/voucherQueryRoutes";
import { registerVoucherCreateRoutes } from "./vouchers/voucherCreateRoutes";
import { registerVoucherPaymentRoutes } from "./vouchers/voucherPaymentRoutes";
import { registerVoucherJournalRoutes } from "./vouchers/voucherJournalRoutes";
import { registerVoucherSalesUpdateRoutes } from "./vouchers/voucherSalesUpdateRoutes";
import { registerVoucherPurchaseUpdateRoutes } from "./vouchers/voucherPurchaseUpdateRoutes";
import { registerVoucherTransferRoutes } from "./vouchers/voucherTransferRoutes";
import { registerVoucherEntryRoutes } from "./voucherEntryRoutes";

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
