---
name: Golden Coast normal POS settlement
description: Golden Coast sales use the shared itemized POS journal and append atomic, idempotent GC/HADI settlement postings.
---

Golden Coast must use the shared itemized POS sale as the source document. Its normal Supplier Partner posting carries the full cash debit, net payable credit, and one location-deduction credit. A separate payable reclassification is only needed when the configured Supplier Partner payable account differs from canonical GC Sales Cash; when they are the same account, posting a debit and credit to that account would be a misleading no-op.

Cash settlement is a paired, same-transaction posting: Golden Coast credits the selected cash/bank account and debits its HADI intercompany account; HADI debits a matching active cash/bank account and credits its reciprocal intercompany account. The request must authorize HADI through the tenant boundary's target-company field, and every voucher must use a location owned by its own company.

**Why:** Golden Coast's canonical GC Sales Cash currently adopts the historical Supplier Partner payable account, while cash proceeds still need to move completely to HADI without duplicating the configured per-unit location deduction.

**How to apply:** Keep the settlement source type distinct from retired Phase 5/6 postings, use stable company-scoped idempotency identities, and on itemized edits reverse only the latest settlement revision before rebuilding the new one.

Existing duplicate legacy transfer vouchers are historical financial records and must remain untouched unless the user explicitly authorizes a separate audited reversal; preventing future duplicates is independent from correcting history.

**Why:** The user chose to preserve the existing 2026-08-31 voucher history rather than silently delete or rewrite posted transactions.

**How to apply:** Do not add automatic cleanup to startup or the normal POS path. Offer an explicit, balanced reversal workflow separately when historical correction is requested.