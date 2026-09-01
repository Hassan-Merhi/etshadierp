---
name: AI-driven optional stock transfers
description: How to add an AI-suggested "optional" transfer path without changing an existing shared confirm endpoint's behavior for its original caller.
---

When adding a new AI-suggested/analysis flow that reuses an existing shared write endpoint (e.g. a chatbot "confirm" route also used by an older direct/manual flow), any new server-side safety validation (stock-sufficiency checks, stricter defaults, etc.) must be scoped behind the new flow's explicit intent flag, not applied unconditionally to the whole endpoint.

**Why:** the confirm endpoint here is shared by both a pre-existing direct "transfer N of X from A to B" chatbot flow and a new "AI analysis suggests transfer" flow. Defaulting a boolean like `optional` to `true` when absent, or adding a blanket "reject if qty > current stock" check, silently changed behavior for the old flow (which previously always created a real, immediately-posted transfer and never blocked on stock sufficiency — that enforcement lives client-side/is optional via `allowNegativeInventory` on the manual UI).

**How to apply:** when threading a new safety flag (e.g. `optional`) through a shared endpoint, default it to match the endpoint's pre-existing behavior (e.g. `optional === true` opt-in, not `optional !== false` opt-out). Gate any new strict validation inside `if (isNewFlowIntent) { ... }` so the old caller's request/response shape and failure modes are unchanged. Verify by diffing behavior for both callers, not just the new one.
