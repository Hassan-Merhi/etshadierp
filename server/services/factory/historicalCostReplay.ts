/**
 * Historical Raw-Material Cost Replay facade.
 *
 * Read-only preview supplies the PostgreSQL pool as an executor. Apply acquires
 * one client, begins a transaction, takes the company advisory lock, and passes
 * that same executor through the complete replay calculation chain.
 */
export * from "./historical-replay/types";
export * from "./historical-replay/readModel";
export * from "./historical-replay/closure";
export * from "./historical-replay/selectedScope";
export * from "./historical-replay/apply";
