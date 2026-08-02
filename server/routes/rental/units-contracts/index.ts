/**
 * rentalUnitsContractsRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import type { RentalModule } from "../shared";
import type { RentalRoutesContext } from "./_helpers";
import { registerRentalUnitsReadRoutes } from "./units-read";
import { registerRentalUnitsWriteRoutes } from "./units-write";
import { registerRentalContractRoutes } from "./contracts";
import { registerRentalStatementExportRoutes } from "./statement-export";
import { registerRentalContractNoteRoutes } from "./contract-notes";
import { registerRentalContractEndRoutes } from "./contract-end";
import { registerRentalGuaranteeRoutes } from "./guarantees";

export function registerRentalUnitsContractsRoutes(
  app: Express,
  module: RentalModule,
  urlPrefix: string,
  incomeAccountName: string,
  shopExpenseAccountName: string = "Rent Expense - Shops"
) {
  const ctx: RentalRoutesContext = {
    module,
    urlPrefix,
    incomeAccountName,
    shopExpenseAccountName,
    tag: `[${module}/rental]`,
  };

  registerRentalUnitsReadRoutes(app, ctx);
  registerRentalUnitsWriteRoutes(app, ctx);
  registerRentalContractRoutes(app, ctx);
  registerRentalStatementExportRoutes(app, ctx);
  registerRentalContractNoteRoutes(app, ctx);
  registerRentalContractEndRoutes(app, ctx);
  registerRentalGuaranteeRoutes(app, ctx);
}
