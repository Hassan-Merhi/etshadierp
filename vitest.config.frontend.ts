import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["tests/ui/setup.ts"],
    testTimeout: 15000,
    include: ["tests/ui/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/frontend",
      include: [
        "client/src/components/ui/period-filter.tsx",
        "client/src/pages/StockHub.tsx",
        "client/src/pages/InventoryHub.tsx",
      ],
      thresholds: {
        lines: 65,
        statements: 60,
        functions: 60,
        branches: 55,
      },
    },
    // No pool/fork overrides — jsdom runs in the same process
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
});
