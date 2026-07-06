/**
 * Production build script — invoked directly by Render (`node build.mjs`).
 * Bypasses `npm run build` to avoid the npm 10 "Exit handler never called"
 * crash that occurs when npm's script runner exits after spawning build tools.
 */

import { build as viteBuild } from "vite";
import * as esbuild from "esbuild";

// ── 1. Frontend (Vite) ────────────────────────────────────────────────────────
console.log("[build] vite: building client...");
await viteBuild();
console.log("[build] vite: done");

// ── 2. Backend (esbuild) ─────────────────────────────────────────────────────
console.log("[build] esbuild: bundling server...");
await esbuild.build({
  entryPoints: ["server/index.ts"],
  platform: "node",
  packages: "external",
  bundle: true,
  format: "esm",
  outdir: "dist",
});
console.log("[build] esbuild: done");
