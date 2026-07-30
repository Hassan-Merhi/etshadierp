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
        "client/src/app/authenticatedAppRouteGuard.ts",
        "client/src/app/factoryAccessGuard.ts",
      ],
      thresholds: {
        lines: 65,
        statements: 60,
        functions: 60,
        branches: 55,

        "client/src/app/authenticatedAppRouteGuard.ts": {
          lines: 90,
          statements: 90,
          functions: 100,
          branches: 85,
        },

        "client/src/app/factoryAccessGuard.ts": {
          lines: 85,
          statements: 85,
          functions: 100,
          branches: 80,
        },
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
