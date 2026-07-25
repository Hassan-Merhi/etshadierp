import type { Express } from "express";
import { registerVoucherQueryRoutes } from "./voucherQueryRoutes";
import { registerVoucherCreateRoutes } from "./voucherCreateRoutes";
import { registerVoucherPaymentRoutes } from "./voucherPaymentRoutes";
import { registerCentralGenericVoucherCreateRoute } from "./centralGenericVoucherCreateRoute";
import { registerCentralPaymentReceiptCreateRoute } from "./centralPaymentReceiptCreateRoute";
import { registerCentralJournalCreateRoute } from "./centralJournalCreateRoute";
import { registerCentralJournalLifecycleRoutes } from "./centralJournalLifecycleRoute";
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
  // Active, retry-identified Payment/Receipt creation uses the central engine.
  // Optional drafts and unidentified compatibility callers continue into the
  // unchanged legacy Payment/Receipt handler below.
  registerCentralPaymentReceiptCreateRoute(app);
  registerVoucherPaymentRoutes(app);
  // Active manual journals use the central posting engine. Optional journals
  // call next() and continue into the unchanged legacy handler below.
  registerCentralJournalCreateRoute(app);
  // Active Journal -> active Journal edits and active Journal deletions use
  // transaction-bound employee reversal. Optional transitions and every
  // non-journal deletion continue into the unchanged legacy routes.
  registerCentralJournalLifecycleRoutes(app);
  registerVoucherJournalRoutes(app);
  registerVoucherSalesUpdateRoutes(app);
  registerVoucherPurchaseUpdateRoutes(app);
  registerVoucherTransferRoutes(app);
  registerVoucherEntryRoutes(app);
}
