---
name: Spreadsheet security dependency boundary
description: Security and compatibility boundary for SheetJS-style spreadsheet APIs and the isolated desktop Electron toolchain.
---

The application spreadsheet import/export surface uses the existing `xlsx-js-style` package instead of the vulnerable direct `xlsx` package. The isolated desktop Electron toolchain uses Electron 43+, whose internal archive helper replaces the older transitive `extract-zip` package.

**Why:** The direct `xlsx` package has no safe release in its original line, while the application already depended on a compatible SheetJS-style fork. Electron 43 provides the upstream fix for the desktop archive helper.

**How to apply:** Keep browser/server spreadsheet imports on the shared compatible package and keep desktop dependencies isolated under `desktop/`; do not reintroduce direct `xlsx` or downgrade Electron below the fixed line.