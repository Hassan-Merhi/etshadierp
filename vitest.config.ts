import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ["./server/supplierCompanyScopeBridge.mjs"],
    // Co-located tests under server/ and shared/ are included too. They existed
    // from the initial import but no config matched them, so 78 tests never ran
    // anywhere - including the audit-coverage guards that had silently gone stale.
    include: ["tests/**/*.test.ts", "server/**/*.test.ts", "shared/**/*.test.ts"],
    // The smoke sweep runs as its own invocation so that "an endpoint stopped
    // responding" is a separate CI signal: npm run test:smoke-sweep
    exclude: ["tests/ui/**", "tests/api-smoke-sweep.test.ts"],
    pool: "forks",
    // Backend suites share one database and several process-global settings
    // (notably system_settings.parentCompanyId), so files run serially: in
    // parallel one suite's fixture company becomes visible to another and
    // results vary run to run. Separate fork processes additionally stop
    // module-cache state leaking between suites, which made route discovery
    // nondeterministic. Vitest 4 removed `poolOptions.forks.singleFork`; the
    // supported equivalent is `fileParallelism: false`, which also pins the pool
    // to a single worker.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/backend",
      include: ["server/**/*.ts", "shared/**/*.ts"],
      exclude: ["server/index.ts", "server/vite.ts", "server/**/*.d.ts", "shared/**/*.d.ts"],
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
