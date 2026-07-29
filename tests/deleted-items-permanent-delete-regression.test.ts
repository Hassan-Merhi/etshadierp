import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("dependent Deleted Items permanent deletion", () => {
  it("registers the targeted cleanup route before the legacy route", () => {
    const routes = source("server/routes/adminRoutes.ts");

    expect(routes).toContain("registerDependentDeletedItemPermanentRoutes");
    expect(routes.indexOf("registerDependentDeletedItemPermanentRoutes(app)")).toBeLessThan(
      routes.indexOf("registerDeletedItemsRoutes(app)")
    );
  });

  it("serializes bulk permanent deletes across app instances", () => {
    const routes = source("server/routes/adminRoutes.ts");
    const serialization = source("server/routes/admin/permanentDeleteSerialization.ts");

    expect(routes).toContain(
      'app.use("/api/deleted-items/:type/:id/permanent", serializeDeletedItemPermanentDeletes)'
    );
    expect(serialization).toContain("pg_advisory_lock");
    expect(serialization).toContain("pg_advisory_unlock");
    expect(serialization).toContain('res.once("finish", release)');
    expect(serialization).toContain('res.once("close", release)');
  });

  it("clears the restrictive container receipt and factory dependencies transactionally", () => {
    const route = source("server/routes/admin/dependentDeletedItemPermanentRoutes.ts");

    expect(route).toContain("db.transaction");
    expect(route).toContain("DELETE FROM factory_container_receipts");
    expect(route).toContain("DELETE FROM factory_container_tracking_events");
    expect(route).toContain("DELETE FROM factory_container_tracking_checks");
    expect(route).toContain("DELETE FROM factory_mix_batch_sources WHERE container_id");
    expect(route).toContain("DELETE FROM factory_raw_stock WHERE container_id");
  });

  it("detaches mix-batch history before deleting the soft-deleted parent", () => {
    const route = source("server/routes/admin/dependentDeletedItemPermanentRoutes.ts");

    expect(route).toContain("DELETE FROM factory_mix_batch_sources WHERE mix_batch_id");
    expect(route).toContain("SET source_batch_id = NULL");
    expect(route).toContain("DELETE FROM factory_daily_usages");
    expect(route).toContain("SET carry_forward_from_id = NULL");
    expect(route).toContain("UPDATE factory_pressing_batches");
    expect(route).toContain("UPDATE factory_bales");
    expect(route).toContain("UPDATE factory_waste_entries");
  });

  it("clears shipping, loading, auxiliary, and history rows before an order", () => {
    const route = source("server/routes/admin/dependentDeletedItemPermanentRoutes.ts");

    expect(route).toContain("DELETE FROM factory_invoice_loading_bales");
    expect(route).toContain("DELETE FROM factory_invoice_loading_sessions");
    expect(route).toContain("DELETE FROM factory_shipping_container_documents");
    expect(route).toContain("DELETE FROM factory_shipping_container_rows");
    expect(route).toContain("DELETE FROM customer_order_bale_removals");
    expect(route).toContain("DELETE FROM customer_order_expected_lines");
    expect(route).toContain("DELETE FROM customer_order_bales_history");
  });

  it("uses the live PostgreSQL catalog to clear schema-drifted restrictive references", () => {
    const route = source("server/routes/admin/dependentDeletedItemPermanentRoutes.ts");

    expect(route).toContain("FROM pg_constraint constraint_row");
    expect(route).toContain("constraint_row.confdeltype IN ('a', 'r')");
    expect(route).toContain("cardinality(constraint_row.conkey) = 1");
    expect(route).toContain("reference.column_not_null");
    expect(route).toContain("SET ${column} = NULL");
    expect(route).toContain('clearRemainingRestrictiveReferences(tx, "factory_containers", itemId)');
    expect(route).toContain('clearRemainingRestrictiveReferences(tx, "factory_mix_batches", itemId)');
    expect(route).toContain('clearRemainingRestrictiveReferences(tx, "customer_orders", itemId)');
  });

  it("surfaces the nested PostgreSQL reason if a non-FK blocker remains", () => {
    const route = source("server/routes/admin/dependentDeletedItemPermanentRoutes.ts");

    expect(route).toContain("extractDatabaseErrorMetadata");
    expect(route).toContain("dbErrorCode: databaseError.code");
    expect(route).toContain("dbConstraint: databaseError.constraint");
    expect(route).toContain("databaseError.message || getErrorMessage(error)");
  });

  it("requires company scope and an already soft-deleted target", () => {
    const route = source("server/routes/admin/dependentDeletedItemPermanentRoutes.ts");

    expect(route).toContain("req.session.currentCompanyId");
    expect(route).toContain("eq(factoryContainers.companyId, companyId)");
    expect(route).toContain("eq(factoryMixBatches.companyId, companyId)");
    expect(route).toContain("eq(customerOrders.companyId, companyId)");
    expect(route.match(/isNotNull\([^)]*\.deletedAt\)/g)?.length).toBeGreaterThanOrEqual(6);
  });
});
