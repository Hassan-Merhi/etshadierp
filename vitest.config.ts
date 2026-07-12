import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
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
        lines: 5,
        statements: 5,
        functions: 3,
        branches: 3,
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
