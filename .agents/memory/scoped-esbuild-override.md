---
name: Scoped esbuild security override
description: Dependency security boundary for the Drizzle development toolchain and Vite
---

The vulnerable esbuild path is nested under `@esbuild-kit/core-utils`, which is used by
Drizzle Kit. Override that child dependency to the patched `0.28.x` line, but do not
override esbuild globally.

**Why:** A global override also replaces Vite's supported esbuild version and makes
production builds fail during final transpilation.

**How to apply:** Keep the direct root esbuild dependency on its existing compatible
range, and use a package-manager nested override for
`@esbuild-kit/core-utils.esbuild`. Normalize generated lockfile URLs back to the public
npm registry before committing.