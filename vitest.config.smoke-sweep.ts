import { defineConfig } from "vitest/config";
import path from "path";

/**
 * The API smoke sweep runs as its own Vitest invocation, not as part of the
 * backend suite.
 *
 * It is kept separate for signal, not isolation: the sweep calls several hundred
 * endpoints in one hook, so a failure here means "an endpoint stopped
 * responding", which is worth its own red/green in CI rather than being buried
 * in a two-thousand-test run. It also keeps the unit suite's runtime honest.
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
