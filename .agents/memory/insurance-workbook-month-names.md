---
name: Insurance workbook month names
description: The supported month-sheet naming rule for Insurance Excel imports.
---

Plain month worksheet names such as January or February are interpreted using the year selected in the import dialog. Worksheet names that include a year, such as January 2026 or 2026-01, retain their explicit year.

**Why:** Users commonly organize monthly workbooks with month-only sheet tabs, while historical or multi-year workbooks need an unambiguous explicit year.

**How to apply:** Preserve both forms when changing the Insurance workbook parser or its UI; never silently infer the year for an explicit-year sheet.