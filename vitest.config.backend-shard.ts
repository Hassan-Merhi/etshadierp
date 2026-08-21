import { defineConfig } from "vitest/config";
import path from "node:path";

const coverage = process.argv.includes("--coverage");
const coverageDirectory = process.env.BACKEND_COVERAGE_DIRECTORY ?? "coverage/backend";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ["./tests/backendTestSetup.mjs"],
    include: ["tests/**/*.test.ts", "server/**/*.test.ts", "shared/**/*.test.ts"],
    exclude: ["tests/ui/**"],
    pool: "forks",
    fileParallelism: false,
    coverage: {
      enabled: coverage,
      provider: "v8",
      reporter: ["json"],
      reportsDirectory: coverageDirectory,
      include: ["server/**/*.ts", "shared/**/*.ts"],
      exclude: ["server/index.ts", "server/vite.ts", "server/**/*.d.ts", "shared/**/*.d.ts"],
    },
    reporters: ["default"],
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
});