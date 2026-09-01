---
    name: OTW stock-transfer shop matching
    description: How Stock OTW (on-the-way) container data feeds the AI stock-transfer analysis, and the shop-name matching rule.
    ---
    - `containers.shopName` is the source of truth for which destination an OTW container is headed to; only exact normalized (trim+lowercase) equality against the destination location's name/code counts as a match — never fuzzy/substring, to avoid conflating similarly named shops (e.g. "Kolwezi" vs "Kolwezi 2").
    - `server/services/stockTransferAnalysis.ts`'s `loadOtwStockByItem(companyId, destinationLocationId?)` classifies each OTW container per stock item as "direct" (shopName matches destination), "unknown" (shopName missing — still counted, but disclosed), or "other" (shopName is a different known shop — excluded from that destination's need calc, shown for transparency only).
    - **Why:** without a destination to compare against, there is nothing to exclude a container from, so all OTW quantity must count in that case; only when a destination is given does shop-name classification apply. Getting this backwards silently undercounts global OTW totals whenever containers have a shopName.
    - **How to apply:** any future feature reading company-wide OTW totals should call `loadOtwStockByItem(companyId)` with no destination, not partially reproduce this logic.
    