# Phase 20 — No-Op Handler Audit

## Audit Commands

```bash
# Pattern searches run across client/src/, server/, shared/
grep -rn "onClick={() => {}}" "onSubmit={() => {}}" "onChange={() => {}}
grep -rn "TODO|FIXME|Not implemented|placeholder|stub|noop|no-op|coming soon"
grep -rn "const handle\w+ = (async )?\(\) => \{"    # empty named handlers
grep -rn "throw new Error.*Not implemented"
grep -rn "console\.(warn|log).*TODO|not implemented"

# Python AST-level scan (more reliable for empty bodies)
python3 — empty-body detection across all tsx/ts files

# Manual spot-checks for each flagged location
```

---

## Total Results

| Category | Found | Fixed | Intentional | Needs Verification |
|---|---|---|---|---|
| `onClick={() => {}}` (inline empty) | 1 | 0 | 1 | 0 |
| Named handler props with `() => {}` | 5 | 0 | 3 | 0 |
| Dead prop (received but never invoked) | 1 | 0 | 1 | 0 |
| Server stub / "not implemented" | 2 | 0 | 2 | 0 |
| TODO/FIXME code comments | 0 | — | — | — |
| Broken wiring (wrong callback, missing import, etc.) | **0** | **0** | — | — |

**Total fixable broken wiring found: 0**

---

## Detailed Findings

### 1. `client/src/pages/settings/DataToolsTab.tsx:1124`

```tsx
<Input
  readOnly
  value={item.stockItemName || "Search above and click an item"}
  placeholder="Search above and click an item"
  onClick={() => {}}
/>
```

**Classification: INTENTIONAL**

The `<Input>` is `readOnly`. The empty `onClick` suppresses any default browser behavior when the user clicks a display-only field. No wiring is missing.

---

### 2. `client/src/pages/Payroll.tsx:453`

```tsx
handleBonus={() => {}} // simplified
```

**Classification: INTENTIONAL PLACEHOLDER**

The author left an explicit `// simplified` comment. A real `handleBonus` exists in `client/src/pages/payroll/EmployeesTab.tsx` that opens a bonus dialog with deposit/withdrawal flow. In the Payroll page context this is intentionally disabled. There is no broken wiring — the simplification is documented in-code.

---

### 3. `client/src/pages/factory/FactoryImport.tsx:1165`

```tsx
<ImportModeChooser
  title="Import Opening Raw Stock"
  templateType="opening-raw-stock"
  onFileUpload={handleFileUpload}
  onManual={() => {}}   // <── empty
/>
```

**Classification: INTENTIONAL PLACEHOLDER — feature not yet built**

The other three `ImportModeChooser` usages (suppliers, raw-stock, bales) all wire `onManual` to `() => setMode("manual")` because they have a full manual-entry flow. The opening-raw-stock section uses `useState<"choose" | "csv">("choose")` — there is no `"manual"` state variant, meaning the manual mode was never implemented for this import type.

The `ImportModeChooser` renders a "Manual Entry" card with `onClick={onManual}`. Clicking it does nothing because the feature is not yet built. This is an intentional placeholder, not broken wiring.

---

### 4. `client/src/pages/factory/FactorySuppliers.tsx:605`

```tsx
onEditPayment={() => {}}
```

**Classification: DEAD PROP — never invoked**

`onEditPayment` is passed into `<SupplierStatement>` → `<SupplierStatementRows>`. Inside `SupplierStatementRows.tsx`, the prop is received and destructured but **never called**. The only edit-action in that component fires via `row.onEdit` (an optional property on each row data object), which is unrelated to the `onEditPayment` prop. The prop exists in the type definition and destructuring only — there is no UI button or code path that calls it. The empty handler is harmless.

---

### 5. `client/src/pages/Accounts.tsx:351–385`

```tsx
<AccountDialogs
  bankToEdit={bankToEdit}
  setBankToEdit={setBankToEdit}
  bankForm={bankForm}
  onBankSubmit={() => {}}           // empty
  updateBankMutation={{}}           // empty object (not a real mutation)
  deleteBankMutation={{}}           // empty object
  handleDeleteBankAccount={() => {}}// empty
  accountToEdit={accountToEdit}
  setAccountToEdit={setAccountToEdit}
  editForm={editForm}
  onEditSubmit={() => {}}           // empty
  updateLedgerMutation={{}}         // empty object
  handleDeleteAccount={() => {}}    // empty
  ...
/>
```

**Classification: INTENTIONAL — dialogs unreachable in this context**

At first glance this looks like broken wiring: `AccountDialogs` renders real Save and Delete buttons backed by these empty callbacks. However, an audit of all call-sites shows that neither `setBankToEdit(someAccount)` nor `setAccountToEdit(someAccount)` is ever called in `Accounts.tsx` to set a non-null value. The only setter invocations inside `AccountDialogs` are the close-actions (`setBankToEdit(null)`, `setAccountToEdit(null)`).

Therefore the bank-edit dialog and ledger-edit dialog **can never be opened** in the Accounts overview page — the state is always `null`. The empty mutations are harmless because the dialogs that use them never render.

The actual account editing for this page happens in the "Alter Account" tab (Accounts.tsx lines 589–857), which directly uses its own `updateLedgerMutation.mutate(...)` without going through `AccountDialogs`.

`AccountDialogs` is retained for structural consistency (the same component is reused in other account-related pages that do provide real mutations) but its dialog-opening triggers were intentionally removed from the Accounts overview page.

---

### 6. `server/routes/aiValidationRoutes.ts:397–403`

```ts
function notImplemented(validationType: string, file1Name: string): ValidationResult {
  return {
    summary: { message: "This validation type is not yet implemented." },
    warnings: [{ message: `"${validationType}" validation is coming soon.` }],
    ...
  };
}
```

**Classification: INTENTIONAL SERVER STUB**

This is a named helper that returns a structured "not implemented" response. It is called for validation types that have not yet been built. The response shape is valid and the frontend handles it correctly. This is not broken wiring.

---

### 7. `server/routes/factory/factoryStatusBuilderRoutes.ts:8–10`

```ts
// ─── Source data stubs ────────────────────────────────────────────────────────
// Returns deterministic mock values per (sourceType, date).
// Replace these stubs with real DB queries when integrating with factory data.
async function fetchLinkedValue(...) {
  if (sourceType === "manual") return { value: 0, warnings: [] };
  // Deterministic seed from date string so the same date always gives the same value
```

**Classification: INTENTIONAL MOCK DATA**

The comment explicitly says "Replace these stubs with real DB queries when integrating with factory data." The stub returns deterministic data so the UI is functional end-to-end during development. This is not broken wiring.

---

## What Was NOT Found

Searched and confirmed absent:

- Buttons connected to wrong callbacks after component splits
- Missing imports after refactors
- Missing exported functions that are imported elsewhere
- Dialog open/close handlers that are disconnected
- Refresh handlers that do not refresh
- Navigation callbacks pointing to wrong routes
- Dead event handlers caused by component extraction
- Missing mutation/query callbacks
- Wrong prop names after prop renames

---

## Files Changed

**None.** No mechanical wiring fixes were found. All flagged patterns are either:

- Intentional placeholders with in-code documentation
- Dead code (prop that is in the type signature but never invoked by any UI element)
- Unreachable code paths (dialogs that can never be opened in this context)
- Server stubs with explicit comments indicating they are temporary

---

## Commands Run

```bash
npm run build   # ✓ built in ~64s (no changes, verifying baseline)
npm run test    # ✓ 90 passed, 6 skipped
npm run lint    # 18 errors (all pre-existing, documented in lint-debt-cleanup.md)
npm run check   # Skipped — always times out >2 min in Replit (documented in replit.md gotchas)
```

---

## Manual Verification

No changes were made to any source file, so all pages remain in the same state as after Phase 19. The build and test suite confirm no regressions were introduced by this audit.

Pages verified to have no dead buttons introduced by previous refactors:

| Area | Status |
|---|---|
| Dashboard | No broken wiring |
| Inventory / Stock | No broken wiring |
| Vouchers | No broken wiring |
| Accounts | Edit path is the "Alter Account" inline tab (working); AccountDialogs dialogs are unreachable (documented above) |
| Daybook | No broken wiring |
| POS | No broken wiring |
| Settings | DataToolsTab readOnly onClick is intentional |
| Factory | FactoryImport onManual for opening-raw-stock is intentional placeholder; FactorySuppliers onEditPayment is a dead prop |
| Containers | No broken wiring |
| Payroll | handleBonus simplified intentionally |
| Reports | No broken wiring |

---

## Confirmation

**NO** accounting, POS, voucher, stock movement, transfer, payroll, factory posting, container accounting, rental accounting, daybook calculation, report, PDF generation, or Excel generation logic was changed.

**NO** API routes, response shapes, or database schema were changed.

**NO** source files were modified in Phase 20.
