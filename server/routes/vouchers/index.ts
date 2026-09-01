// Compatibility re-export. The active server imports ../voucherRoutes directly;
// keeping this index as a re-export prevents route-order drift between two
// independently maintained registries.
export { registerVoucherRoutes } from "../voucherRoutes";
