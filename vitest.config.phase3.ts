import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/group-a-phase-3-pos-transfer-revisions.test.ts"],
    setupFiles: [],
    fileParallelism: false,
  },
});
