---
name: Spreadsheet security dependency boundary
description: Security and compatibility boundary for SheetJS-style spreadsheet APIs and the isolated desktop Electron toolchain.
---

The application spreadsheet import/export surface uses the existing `xlsx-js-style` package instead of the vulnerable direct `xlsx` package. The isolated desktop Electron toolchain is upgraded independently; Electron's `extract-zip` dependency may remain flagged until its upstream package publishes a fixed release.

**Why:** The direct `xlsx` package has no safe release in its original line, while the application already depended on a compatible SheetJS-style fork. Electron's archive helper is pulled transitively and currently has no upstream fixed version.

**How to apply:** Keep browser/server spreadsheet imports on the shared compatible package and re-run the dependency scan when Electron or `extract-zip` publishes a remediation; do not reintroduce direct `xlsx`.