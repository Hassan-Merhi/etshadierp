---
name: Golden Coast normal POS integration
description: Durable constraints for database-backed tests of the linked Golden Coast/HADI itemized POS flow.
---

The normal Golden Coast POS flow is a cross-company operation, so an integration fixture must model the real parent-company link and authorize the HADI company through the request's target-company scope. Assertions should verify both sides of the cash movement and the reciprocal intercompany balances; checking only that each voucher is internally balanced can miss a direction or account-selection error.

**Why:** The ordinary POS sale and its paired settlement are separate company-scoped postings. A legacy single-company fixture can pass while never exercising tenant authorization, HADI account resolution, or the full cash transfer.

**How to apply:** Use a unique client sale identity per scenario, include targetCompanyId on create/edit requests, and count settlement postings by that identity so retry and edit-revision assertions are isolated from neighboring cases.