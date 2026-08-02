import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
import path from "path";

const { frontend } = JSON.parse(
  readFileSync(path.resolve(__dirname, "config/coverage-thresholds.json"), "utf8")
);

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["tests/ui/setup.ts"],
    testTimeout: 15000,
    include: ["tests/ui/**/*.test.{ts,tsx}", "client/src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/frontend",
      // This used to name three files, so "59% lines" described those three and
      // not the frontend. Measuring all of client/src puts the real number —
      // 5.8% lines — in front of anyone who looks, and lets it ratchet up as
      // tests are added. The per-file floors below keep the strong signal on
      // the surfaces that are genuinely covered.
      include: ["client/src/**/*.{ts,tsx}"],
      exclude: ["client/src/**/*.test.{ts,tsx}", "client/src/**/*.d.ts"],
      thresholds: {
        ...frontend.global,
        ...frontend.perFile,
      },
    },
    // No pool/fork overrides — jsdom runs in the same process
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
});
