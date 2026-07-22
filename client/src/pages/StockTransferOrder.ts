// Vite/TypeScript resolves .ts before .tsx for extensionless imports.
// Keep the established editor in StockTransferOrder.tsx and expose the Phase 5
// wrapper to existing lazy imports without modifying the large editor file.
export { default } from "./SmartStockTransferOrderPage";
