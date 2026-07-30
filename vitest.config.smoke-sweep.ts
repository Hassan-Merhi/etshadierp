import { defineConfig } from "vitest/config";
import path from "path";

/**
 * The API smoke sweep runs as its own Vitest invocation, not as part of the
 * backend suite.
 *
 * The sweep needs a seeded ERP company for the ~3 seconds it takes to call
 * every read endpoint. Several endpoints are only well-defined when exactly one
 * ERP company exists — `resolveParentCompanyId()` refuses to guess which
 * company owns legacy supplier opening balances otherwise — so while the sweep
 * holds its fixture, any other suite that also holds an ERP company sees two
 * and fails. Backend test files are not guaranteed to be serialised against
 * each other, so isolating the sweep at the process level is the only reliable
 * separation.
 *
 *     npm run test:smoke-sweep
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 300000,
    hookTimeout: 300000,
    setupFiles: ["./server/supplierCompanyScopeBridge.mjs"],
    include: ["tests/api-smoke-sweep.test.ts"],
    pool: "forks",
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
});
