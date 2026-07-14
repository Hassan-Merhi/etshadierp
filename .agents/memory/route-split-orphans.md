---
name: Route split orphan pattern
description: After route barrel splits, some sub-dir files were split but never wired into any barrel — causing dead endpoints silently.
---

## The rule
After splitting a monolithic route file into sub-directory files, always verify every new sub-dir file is imported (directly or via a parent barrel) by `server/routes.ts` or an intermediate barrel that IS in the chain.

## What was found and fixed
Seven route files existed with real handlers but were never called:

| File | Handlers | Fixed by wiring into |
|---|---|---|
| `server/routes/admin/adminPoFixRoutes.ts` | 4 | `adminRoutes.ts` |
| `server/routes/admin/adminRepairRoutes.ts` | 12 | `adminRoutes.ts` |
| `server/routes/admin/deletedItemsRoutes.ts` | 8 | `adminRoutes.ts` |
| `server/routes/stock/stockItemManageRoutes.ts` | 10 | `stockRoutes.ts` |
| `server/routes/stock/stockPriceListImportRoutes.ts` | 8 | `stockRoutes.ts` |
| `server/routes/factory/endProductionRoutes.ts` | 3 | `factoryRoutes.ts` |
| `server/routes/factory/factoryProductionPlannerRoutes.ts` | 5 | `factoryRoutes.ts` |

**Why:** The split was done mechanically without updating the barrel's import list. The server starts fine because the barrel just doesn't call them — no import error.

**How to apply:** When auditing or doing a route split, use this pattern to find orphans:
```bash
for f in $(grep -rl "^export function register" server/routes/ --include="*.ts"); do
  funcname=$(grep -o "^export function register[A-Za-z]*" "$f" | head -1 | awk '{print $3}')
  hits=$(grep -rl "$funcname" server/routes/ server/routes.ts --include="*.ts" 2>/dev/null | grep -v "^$f$" | wc -l)
  if [ "$hits" -eq 0 ]; then echo "ORPHAN: $f → $funcname"; fi
done
```
Note: the grep must include `server/routes.ts` (outside the sub-dir) or top-level files will all show as orphans.

## Sub-directory index.ts files
Each sub-dir also has an `index.ts` that mirrors or re-exports the barrel — these are NOT imported anywhere; `server/routes.ts` imports the outer barrel files (`adminRoutes.ts`, `stockRoutes.ts`, etc.) not the inner index files. They are redundant, but NOT always harmless: if the dead `index.ts` exports a function with the SAME NAME as the real barrel's registration function (e.g. both export `registerFactorySuppliersRoutes`), editing/adding routes to the dead file compiles clean and looks correct, but the new route is never actually registered — 404s that look like an auth/session bug. Before adding a new route to any `registerX(app)` function, grep `server/routes.ts` (or trace the barrel chain) to confirm which physical file with that export name is actually in the live import chain, not just that a file with the right function name exists.
