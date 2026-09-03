---
name: Payment/Receipt narration mapping
description: The non-Journal Payment/Receipt editor preserves narration on both sides of its generated accounting legs.
---

Payment/Receipt editing has two narration sources: the selected payment/receive account and each contra line. The posting builder expands every contra line into a debit and credit leg, so it must map the source narration to the payment-side leg and the line narration to the contra-side leg. Empty side-specific narration may fall back to the voucher notes.

**Why:** The legacy editor hydrated only amounts and the posting builder applied the voucher notes to both generated legs, causing entry narrations to disappear when a voucher was opened or saved.

**How to apply:** Any new Payment/Receipt edit or posting path must carry both narration fields end to end, including hydration, form schema, submit payload, route input, and generated entry mapping.