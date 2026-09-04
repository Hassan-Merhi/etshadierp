---
name: GC Sales Cash is a credit-normal payable
description: GC Sales Cash is the liability Golden Coast owes Fresh Start; sales credit it, payments debit it, and the raw Dr-minus-Cr ledger figure must be negated before use.
---

GC Sales Cash (`sp_payable`, account type Liability) is the running amount Golden
Coast owes Fresh Start FZ for sold goods. It is credit-normal: a sale increases
it with a credit, a payment reduces it with a debit. Balance queries return a
signed debit-minus-credit figure, so that raw number is the NEGATIVE of the
outstanding payable and must go through `goldenCoastSalesCashPayable` —
`gcSalesCashPayableBalance`, `gcSalesCashSettleablePayable`,
`gcSalesCashConservativePayable` — before any cap, report or readiness payload
uses it. No caller may re-derive the sign itself.

A transfer fee on a payment never reduces what Fresh Start is owed: the payable
falls by the settlement amount alone while the fee is debited to Shared Charges
(`sp_shared_charges`) and the paying account funds both.

**Why:** Phase 10 and Phase 7 were originally written against the opposite
reading, treating the raw debit balance as a collectible receivable. Because a
company with real sales carries a credit balance, Phase 10 reported nothing
collectible and could never be used, and had it posted it would have grown the
liability instead of clearing it.

**How to apply:** a new path that touches GC Sales Cash must credit it for value
owed and debit it for value paid or reassigned (the Phase 6 special-location
deduction debits it because that amount moves to Hassan Savings instead).
`goldenCoastSalesCashPostingPaths.test.ts` drives every builder and asserts the
side each lands on; add new paths there.

The retired Phase 5/6 `pos-sale` endpoint is the one exception and posts
Dr GC Sales Cash / Cr Sales on a sale. Its own chain is self-consistent — the
Phase 7 collection that follows clears the debit it just created — and live POS
sales no longer reach it: the POS client posts to `/api/pos/sales`, which
settles through `goldenCoastPosAccounting` and credits the payable. Do not flip
it silently; that would change the meaning of vouchers already posted through it.
