/**
 * importExportRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerFileRoutes } from "./files";
import { registerSpreadsheetRoutes } from "./spreadsheets";
import { registerAgentFreightAccountRoutes } from "./accounts";
import { registerSnapshotPinnedAccountRoutes } from "./snapshot-pinned";
import { registerAccountMigrationRoutes } from "./account-migration";

export function registerImportExportRoutes(app: Express) {
  registerFileRoutes(app);
  registerSpreadsheetRoutes(app);
  registerAgentFreightAccountRoutes(app);
  registerSnapshotPinnedAccountRoutes(app);
  registerAccountMigrationRoutes(app);
}
