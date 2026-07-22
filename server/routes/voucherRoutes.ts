import type { Express } from "express";
import { registerVoucherQueryRoutes } from "./vouchers/voucherQueryRoutes";
import { registerVoucherCreateRoutes } from "./vouchers/voucherCreateRoutes";
import { registerVoucherPaymentRoutes } from "./vouchers/voucherPaymentRoutes";
import { registerVoucherJournalRoutes } from "./vouchers/voucherJournalRoutes";
import { registerVoucherSalesUpdateRoutes } from "./vouchers/voucherSalesUpdateRoutes";
import { registerVoucherPurchaseUpdateRoutes } from "./vouchers/voucherPurchaseUpdateRoutes";
import { registerVoucherTransferRoutes } from "./vouchers/voucherTransferRoutes";
import { registerSmartTransferPreviewRoutes } from "./vouchers/smartTransferPreviewRoutes";
import { registerStockTransferLifecycleRoutes } from "./vouchers/stockTransferLifecycleRoutes";
import { registerVoucherEntryRoutes } from "./voucherEntryRoutes";

export function registerVoucherRoutes(app: Express) {
  // Must be registered before generic/legacy voucher handlers so stock-transfer
  // draft/post transitions are owned by one atomic lifecycle transaction.
  registerStockTransferLifecycleRoutes(app);
  registerVoucherQueryRoutes(app);
  registerVoucherCreateRoutes(app);
  registerVoucherPaymentRoutes(app);
  registerVoucherJournalRoutes(app);
  registerVoucherSalesUpdateRoutes(app);
  registerVoucherPurchaseUpdateRoutes(app);
  registerVoucherTransferRoutes(app);
  registerSmartTransferPreviewRoutes(app);
  registerVoucherEntryRoutes(app);
}
