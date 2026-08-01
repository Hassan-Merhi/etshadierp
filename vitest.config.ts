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
    // The smoke sweep runs as its own invocation so that "an endpoint stopped
    // responding" is a separate CI signal: npm run test:smoke-sweep
    exclude: ["tests/ui/**", "tests/api-smoke-sweep.test.ts"],
    pool: "forks",
    // Backend suites share one database and several process-global settings
    // (notably system_settings.parentCompanyId). Running files in parallel lets
    // one suite's fixture company be observed by another, which made results
    // vary run to run. Vitest 4 moved fork options to the test root.
    fileParallelism: false,
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
        // Raise the whole-backend floor while legacy monoliths are still being
        // split, and add stronger gates for the critical modules below.
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
