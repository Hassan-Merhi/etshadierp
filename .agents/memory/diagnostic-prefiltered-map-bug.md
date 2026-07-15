---
name: Diagnostic scan built from a pre-filtered lookup map silently drops valid rows
description: A recurring bug shape where a read-only scan builds its container/parent lookup map from a currency- or status-filtered subquery, so child rows attached to a filtered-out parent lose context.
---

The raw-material FX diagnostic scanned "unresolved non-USD rate" rows by first
filtering containers to non-USD currency, then using THAT filtered set both as
the container list to scan AND as the lookup map for resolving a linked
charge/commission's container status. A non-USD charge attached to a
USD-currency container was invisible to the scan and, worse, silently lost its
real container status (so a charge on a CLOSED/historical container was never
classified as needing manual review).

**Why:** it's tempting to reuse the same filtered query for both "what do I
iterate" and "what do I look up by id" — but a child row's own currency can
differ from its parent's currency, so the child needs to be scanned
independently by its own filter, while the parent lookup map must be built
from the UNFILTERED parent set.

**How to apply:** whenever a diagnostic/report joins a child table to a parent
for context (status, currency, id), build the parent lookup map from an
unfiltered query and apply the filter only to the child table being scanned.
Never reuse a filtered parent query as the lookup source for children scanned
under a different filter.
