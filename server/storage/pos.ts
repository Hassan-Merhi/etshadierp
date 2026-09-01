// Compatibility barrel — server/storage.ts imports this as `import * as pos from "./storage/pos"`.
// Implementation is split by POS persistence responsibility.
export * from "./pos/drafts";
export * from "./pos/shifts";
