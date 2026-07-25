import type { Express } from "express";
import { registerVoucherQueryRoutes } from "./voucherQueryRoutes";
import { registerVoucherCreateRoutes } from "./voucherCreateRoutes";
import { registerVoucherPaymentRoutes } from "./voucherPaymentRoutes";
import { registerCentralGenericVoucherCreateRoute } from "./centralGenericVoucherCreateRoute";
import { registerCentralJournalCreateRoute } from "./centralJournalCreateRoute";
import { registerVoucherJournalRoutes } from "./voucherJournalRoutes";
import { registerVoucherSalesUpdateRoutes } from "./voucherSalesUpdateRoutes";
import { registerVoucherPurchaseUpdateRoutes } from "./voucherPurchaseUpdateRoutes";
import { registerVoucherTransferRoutes } from "./voucherTransferRoutes";
import { registerVoucherEntryRoutes } from "../voucherEntryRoutes";

export function registerVoucherRoutes(app: Express) {
  registerVoucherQueryRoutes(app);
  // Retry-identified, simple USD active vouchers use the central posting engine.
  // Optional, multi-currency, or compatibility-only payloads call next() and
  // continue into the unchanged legacy create handler.
  registerCentralGenericVoucherCreateRoute(app);
  registerVoucherCreateRoutes(app);
  registerVoucherPaymentRoutes(app);
  // Active manual journals use the central posting engine. Optional journals
  // call next() and continue into the unchanged legacy handler below.
  registerCentralJournalCreateRoute(app);
  registerVoucherJournalRoutes(app);
  registerVoucherSalesUpdateRoutes(app);
  registerVoucherPurchaseUpdateRoutes(app);
  registerVoucherTransferRoutes(app);
  registerVoucherEntryRoutes(app);
}
