import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ["./server/supplierCompanyScopeBridge.mjs"],
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/ui/**"],
    pool: "forks",
    singleFork: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/backend",
      include: ["server/**/*.ts", "shared/**/*.ts"],
      exclude: [
        "server/index.ts",
        "server/vite.ts",
        "server/**/*.d.ts",
        "shared/**/*.d.ts",
      ],
      thresholds: {
        // Preserve the last measured whole-repository floor while enforcing
        // substantially stronger gates on the critical modules covered below.
        lines: 8,
        statements: 8,
        functions: 6,
        branches: 6,

        "server/routes/helpers/passwordHelpers.ts": {
          lines: 95,
          statements: 95,
          functions: 100,
          branches: 90,
        },

        "server/services/accounting/centralPostingEngine.ts": {
          lines: 45,
          statements: 45,
          functions: 40,
          branches: 35,
        },

        "server/services/security/companyContextPolicy.ts": {
          lines: 95,
          statements: 95,
          functions: 100,
          branches: 90,
        },

        "server/services/accounting/customerLinkedLedgerValidation.ts": {
          lines: 90,
          statements: 90,
          functions: 100,
          branches: 85,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
});
