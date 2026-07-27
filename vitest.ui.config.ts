import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Separate Vitest configuration for browser-environment (jsdom) UI tests.
 * Run with: npx vitest run --config vitest.ui.config.ts
 *
 * These tests live in tests/ui/ and require @testing-library/react + jsdom.
 * They are intentionally excluded from the main vitest.config.ts which targets
 * server/shared code with a plain node environment.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["tests/ui/setup.ts"],
    testTimeout: 15000,
    include: ["tests/ui/**/*.test.tsx", "tests/ui/**/*.test.ts"],
    pool: "forks",
    singleFork: true,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
});
