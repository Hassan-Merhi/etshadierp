/**
 * Shared state and helpers for the containerLoadedItemsRoutes routes.
 *
 * Extracted verbatim from the former single-file containerLoadedItemsRoutes.ts.
 */
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { containers } from "@shared/schema";

/**
 * Container loaded-items routes.
 *
 * Loaded-item CRUD, Excel import, auto-populate, and the proforma-vs-loaded
 * verification summary / export for shipping containers. Extracted from
 * supplierProformaRoutes.ts as a sub-registrar; behaviour is unchanged. The
 * shared barcode/alias helpers now live in ./helpers/proformaBarcodeHelpers.
 */

/**
 * Confirm a container belongs to the caller's company.
 *
 * Declared at module scope so the handlers that call it - every endpoint in
 * this group - can live in separate modules.
 */
export const verifyContainerOwnership = async (containerId: number, companyId: number) => {
  const [container] = await db
    .select()
    .from(containers)
    .where(and(eq(containers.id, containerId), eq(containers.companyId, companyId)));
  return !!container;
};
