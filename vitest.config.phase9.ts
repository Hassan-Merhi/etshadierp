import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "tests/phase14-i18n-release-gate.test.ts",
      "tests/phase8-rtl-responsive-accessibility.test.ts",
      "tests/phase9-final-release-gate.test.ts",
    ],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
});
