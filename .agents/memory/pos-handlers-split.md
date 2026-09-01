---
name: POS handlers hook composition pattern
description: usePosHandlers.ts is a thin orchestrator over focused sub-hooks; keep this shape for future POS frontend splits.
---

`client/src/pages/pos/hooks/usePosHandlers.ts` composes smaller single-responsibility hooks rather than
implementing logic inline:
- `usePosRowCalculations.ts` — item selection + cell-edit math
- `usePosCheckout.ts` — save/new-sale/load-draft lifecycle
- `usePosInvoiceActions.ts` — print + spreadsheet export actions
- `usePosKeyboardNavigation.ts` — grid keyboard navigation
- `utils/posKeyboardHelpers.ts` — `makeFocusCell` (pure closure factory, not a hook)

**Why:** Phase 18 structural-split requirement was zero logic changes; splitting via a thin orchestrator that
preserves the exact same params-in/return-shape-out contract let the consumer (`POS.tsx`) stay untouched while
still meeting file-size targets.

**How to apply:** When any of these files grow large again, extract further sub-hooks the same way — new hook
takes only the params it needs, orchestrator wires them together and re-exports the same combined surface.
Do not let two hooks each build their own `focusCell`; instantiate it once in the orchestrator and pass it down,
or duplication/divergence risk appears (flagged explicitly in code review for this pattern).
