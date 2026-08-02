/**
 * spSalesFormExport schema, split by domain.
 *
 * Every part is re-exported here, so `@shared/schema` continues to expose
 * exactly the names it did before the split - which is the only thing that
 * has to hold, since these are declarations rather than ordered registrations.
 */
export * from "./layout";
export * from "./generate";
