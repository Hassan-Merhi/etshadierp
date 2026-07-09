import type { Express } from "express";
import { registerSpSetupRoutes } from "./spSetupRoutes";
import { registerSpContainerRoutes } from "./spContainerRoutes";
import { registerSpOffloadRoutes } from "./spOffloadRoutes";
import { registerSpSalesRoutes } from "./spSalesRoutes";
import { registerSpOpeningStockRoutes } from "./spOpeningStockRoutes";
import { registerSpAliasRoutes } from "./spAliasRoutes";
import { registerSpReportRoutes } from "./spReportRoutes";
import { registerSpExportRoutes } from "./spExportRoutes";

// ── Supplier Partner (SP) route registration ─────────────────────────────────
// Structural split of the former monolithic server/routes/spRoutes.ts.
// Every endpoint, SQL query, accounting/voucher posting, and inventory
// adjustment call below is byte-for-byte identical to the original file —
// only file boundaries and helper imports changed.
export function registerSpRoutes(app: Express) {
  registerSpSetupRoutes(app);
  registerSpContainerRoutes(app);
  registerSpOffloadRoutes(app);
  registerSpSalesRoutes(app);
  registerSpOpeningStockRoutes(app);
  registerSpAliasRoutes(app);
  registerSpReportRoutes(app);
  registerSpExportRoutes(app);
}
