---
name: Duplicate posting audit
description: Phase 1 identity and retry rules for financial and inventory mutations.
---

The duplicate-posting standard distinguishes four states: replay-safe, intentionally repeatable, state-guarded, and not retry-safe. A timestamp, random voucher number, amount/date combination, or payload hash alone is never a request identity. Stable caller identity must be company-scoped and its canonical payload fingerprint must reject same-key conflicts.

**Why:** The audit found that central posting, selected POS/inventory flows, infrastructure voucher phases, and exact reversals already have durable protection, while legacy payroll, rental, import, raw-stock, container, supplier, repair, and replacement flows vary materially.

**How to apply:** When implementing the shared boundary, preserve legitimate repeated events with new identities, keep edits/reversals separate from creates, and require the identity marker and financial effects to share an atomic recovery boundary.