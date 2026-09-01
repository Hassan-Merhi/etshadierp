---
name: Ledger subtype validation
description: Generic ledger account writes must accept canonical domain subtypes used by specialized accounting flows.
---

Canonical account subtypes owned by a specialized accounting flow must also be
accepted by the generic ledger-account create and update validators when users
edit names, types, or opening balances.

**Why:** The Golden Coast provisioning flow correctly created canonical equity
and intercompany subtypes, but the generic Accounts editor rejected them while
saving an opening balance because its allow-list only knew legacy subtypes.

**How to apply:** When adding or renaming a canonical ledger subtype, update the
shared create/update validation map together and cover both paths with a test.