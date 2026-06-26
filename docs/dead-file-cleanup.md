# Dead File Cleanup — Phase 22

**Date:** 2026-06-26  
**Source:** Phase 21 folder organisation audit (`docs/folder-organization-audit.md`)

---

## Summary

9 files deleted. All confirmed unused before deletion. Build verified (exit 0) after every deletion. No business logic changed.

---

## Files Deleted

### 1. `client/src/components/CreateBaleDialog.tsx`
- **Proof unused:** Zero imports, zero route references, zero dynamic references found across all `.ts`/`.tsx`/`.js` files.
- **Build after deletion:** ✅ Pass

### 2. `client/src/components/ERPAdvancesTab.tsx`
- **Proof unused:** Zero imports, zero route references, zero dynamic references found across all `.ts`/`.tsx`/`.js` files.
- **Build after deletion:** ✅ Pass

### 3. `client/src/components/LocationAutocomplete.tsx`
- **Proof unused:** Zero imports, zero route references, zero dynamic references found across all `.ts`/`.tsx`/`.js` files.
- **Build after deletion:** ✅ Pass

### 4. `client/src/components/LocationCreateDialog.tsx`
- **Proof unused:** Zero imports, zero route references, zero dynamic references found across all `.ts`/`.tsx`/`.js` files.
- **Build after deletion:** ✅ Pass

### 5. `client/src/components/LocationSelector.tsx`
- **Proof unused:** Zero imports, zero route references, zero dynamic references found across all `.ts`/`.tsx`/`.js` files.
- **Build after deletion:** ✅ Pass

### 6. `client/src/components/SpSidebar.tsx`
- **Proof unused:** Zero imports, zero route references, zero dynamic references found across all `.ts`/`.tsx`/`.js` files.
- **Build after deletion:** ✅ Pass (batch build for items 1–6 together)

### 7. `client/src/pages/factory/FactoryStockAllocation.tsx` (v1)
- **Proof unused:**
  - `client/src/App.tsx` line 219: `const FactoryStockAllocation = lazy(() => import("@/pages/factory/FactoryStockAllocationV2"))` — local variable imports V2, not this file.
  - Route at line 1739 `component={FactoryStockAllocation}` uses that V2 alias, never the v1 file.
  - No direct `import … from "@/pages/factory/FactoryStockAllocation"` anywhere in the codebase.
- **Build after deletion:** ✅ Pass (exit 0)

### 8. `client/src/pages/bale-transfer.tsx`
- **Proof unused:**
  - Grep hits for `BaleTransfer` pointed to `BALE_TRANSFER` enum string in `FactoryDaybook.tsx` and `getBaleTransfer*` / `createBaleTransfer` storage functions — all part of the live bale transfer *feature*, not imports of this page file.
  - No `import … from "@/pages/bale-transfer"` anywhere in the codebase.
  - Not registered in any router.
- **Build after deletion:** ✅ Pass (exit 0)

### 9. `client/src/pages/stock-transfer.tsx`
- **Proof unused:**
  - Grep hits for `stock-transfer` pointed to `/api/stock-transfer-*` API endpoint strings and `StockTransfer*` form components under `pages/vouchers/` — none are imports of this page file.
  - No `import … from "@/pages/stock-transfer"` anywhere in the codebase.
  - Not registered in any router.
- **Build after deletion:** ✅ Pass (exit 0)

---

## Files Kept (and why)

No files from the Phase 21 candidate list were kept — all 9 were confirmed safe and deleted.

Files **not** on the deletion list were untouched regardless of any observations made during audit, in accordance with the rule "do not delete business logic files."

---

## Commands Run and Results

```
# Pre-deletion verification (all candidates)
grep -rn "CreateBaleDialog|ERPAdvancesTab|LocationAutocomplete|LocationCreateDialog|LocationSelector|SpSidebar" ...
grep -rn "FactoryStockAllocation\b" (excluding V2/V3/V5)
grep -rn "bale-transfer\b|BaleTransfer\b"
grep -rn "\"stock-transfer\"|\/stock-transfer\b"
grep -n "FactoryStockAllocation" client/src/App.tsx   → confirmed V2 import only

# Deletions
rm client/src/components/CreateBaleDialog.tsx
rm client/src/components/ERPAdvancesTab.tsx
rm client/src/components/LocationAutocomplete.tsx
rm client/src/components/LocationCreateDialog.tsx
rm client/src/components/LocationSelector.tsx
rm client/src/components/SpSidebar.tsx
npx vite build → EXIT:0  ✅

rm client/src/pages/factory/FactoryStockAllocation.tsx
npx vite build → EXIT:0  ✅

rm client/src/pages/bale-transfer.tsx
npx vite build → EXIT:0  ✅

rm client/src/pages/stock-transfer.tsx
npx vite build → EXIT:0  ✅

# Final checks
npx eslint client/src --ext .ts,.tsx → 0 errors, 2329 warnings (all pre-existing)
```

---

## Confirmation: No Business Logic Changed

- All deleted files had **zero consumers** — no component mounted them, no route served them, no import referenced them.
- The live bale transfer feature (`BaleTransferStorage`, `baleRoutes.ts`, `FactoryDaybook.tsx` BALE_TRANSFER handling) is entirely unaffected — those files were not touched.
- The live stock transfer feature (`StockTransferForm.tsx`, `fiscalTransferRoutes.ts`, `/api/stock-transfer-revisions`) is entirely unaffected — those files were not touched.
- The `/factory/stock-allocation` route continues to serve `FactoryStockAllocationV2` as before — the v1 dead file was never wired into the router.
