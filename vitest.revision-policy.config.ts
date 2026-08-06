import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/stock-transfer-revision-lifecycle-policy.test.ts"],
    setupFiles: [],
  },
});
