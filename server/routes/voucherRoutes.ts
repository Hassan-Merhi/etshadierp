import type { Express } from "express";
import { registerVoucherQueryRoutes } from "./vouchers/voucherQueryRoutes";
import { registerVoucherCreateRoutes } from "./vouchers/voucherCreateRoutes";
import { registerVoucherPaymentRoutes } from "./vouchers/voucherPaymentRoutes";
import { registerCentralGenericVoucherCreateRoute } from "./vouchers/centralGenericVoucherCreateRoute";
import { registerCentralPaymentReceiptCreateRoute } from "./vouchers/centralPaymentReceiptCreateRoute";
import { registerCentralPaymentReceiptLifecycleRoutes } from "./vouchers/centralPaymentReceiptLifecycleRoute";
import { registerCentralPaymentReceiptDeleteRoute } from "./vouchers/centralPaymentReceiptDeleteRoute";
import { registerCentralJournalCreateRoute } from "./vouchers/centralJournalCreateRoute";
import { registerCentralJournalLifecycleRoutes } from "./vouchers/centralJournalLifecycleRoute";
import { registerCentralStockTransferDeleteRoutes } from "./vouchers/centralStockTransferDeleteRoute";
import { registerVoucherJournalRoutes } from "./vouchers/voucherJournalRoutes";
import { registerVoucherSalesUpdateRoutes } from "./vouchers/voucherSalesUpdateRoutes";
import { registerVoucherPurchaseUpdateRoutes } from "./vouchers/voucherPurchaseUpdateRoutes";
import { registerVoucherTransferRoutes } from "./vouchers/voucherTransferRoutes";
import { registerSmartTransferPreviewRoutes } from "./vouchers/smartTransferPreviewRoutes";
import { registerStockTransferLifecycleRoutes } from "./vouchers/stockTransferLifecycleRoutes";
import { registerStockTransferRevisionLifecycleRoutes } from "./vouchers/stockTransferRevisionLifecycleRoutes";

export function registerVoucherRoutes(app: Express) {
  // Stock-transfer lifecycle routes must shadow the older direct transfer editor.
  registerStockTransferLifecycleRoutes(app);
  registerStockTransferRevisionLifecycleRoutes(app);

  registerVoucherQueryRoutes(app);

  // Program 2 protected creation handlers call next() for unsupported legacy
  // compatibility shapes, so they must be registered before the old creators.
  registerCentralGenericVoucherCreateRoute(app);
  registerVoucherCreateRoutes(app);

  registerCentralPaymentReceiptCreateRoute(app);
  registerCentralPaymentReceiptLifecycleRoutes(app);
  registerCentralPaymentReceiptDeleteRoute(app);
  registerVoucherPaymentRoutes(app);

  registerCentralJournalCreateRoute(app);
  registerCentralJournalLifecycleRoutes(app);
  registerVoucherJournalRoutes(app);

  // Stock Transfer deletion must run before the generic voucher delete routes,
  // which server/routes.ts registers once immediately after this registry.
  registerCentralStockTransferDeleteRoutes(app);

  registerVoucherSalesUpdateRoutes(app);
  registerVoucherPurchaseUpdateRoutes(app);
  registerVoucherTransferRoutes(app);
  registerSmartTransferPreviewRoutes(app);
}
