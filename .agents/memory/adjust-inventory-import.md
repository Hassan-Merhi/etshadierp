---
name: adjustInventory missing import in inventoryRoutes
description: quick-adjust route called adjustInventory without importing it; exposed by removing a silent-pass guard in tests.
---

# adjustInventory Missing Import

## The rule
`server/routes/inventoryRoutes.ts` must import `adjustInventory` from `../inventoryHelper`.

**Why:** The quick-adjust endpoint (`POST /api/inventory/quick-adjust`) calls `adjustInventory(tx, ...)` at line ~233. The function was never imported, causing a `ReferenceError` at runtime. The old test guarded this with `if (res.status === 200) { ... }` which silently passed on 500.

**How to apply:**
- The import was added: `import { adjustInventory } from "../inventoryHelper";`
- After any route refactor that touches `inventoryRoutes.ts`, verify this import is present.
- If `adjustInventory` is moved or renamed, update both the helper export and this import.
