/**
 * accounting schema, split by domain.
 *
 * Every part is re-exported here, so `@shared/schema` continues to expose
 * exactly the names it did before the split - which is the only thing that
 * has to hold, since these are declarations rather than ordered registrations.
 */
export * from "./ledger-accounts";
export * from "./bank-fixed-assets";
export * from "./vouchers";
export * from "./stock-transactions";
export * from "./voucher-writes";
export * from "./fiscal-periods";
export * from "./exchange-rates";
export * from "./customers";
export * from "./intercompany";
export * from "./customer-balances";
export * from "./permissions";
export * from "./system-settings";
export * from "./spreadsheets";
