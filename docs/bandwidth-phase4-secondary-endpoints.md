# Bandwidth Phase 4 — secondary heavy endpoints

Phase 4 follows the production bandwidth ranking after the location-inventory work in Phases 1–3. It focuses on POS drafts, POS last-sold prices, and factory stock-entry history. CI and production acceptance checks remain deferred to the final verification phase.

## POS drafts

The Drafts dialog only needs a draft id, location, timestamps, item count, total quantity, and total amount. The list query now returns that summary shape instead of `draft_pos_sales.*`. Full payment, notes, and item details still come from `GET /api/pos/drafts/:id` when a user explicitly opens a draft.

POS autosave previously called `refetchDrafts()` after every successful write. Since autosave checks every three seconds, active editing could repeatedly download the draft list even though the client already knew exactly what changed. Autosave now updates the TanStack Query summary cache in memory. Manual Save Draft and Delete Draft use the same upsert/remove helpers.

Draft reads intentionally remain outside the server read microcache so an explicit refresh can still see current state from another browser or tab. The optimization removes self-generated repeat GETs rather than hiding fresh draft state behind a server TTL.

## POS last-sold prices

Pricing behavior remains company-wide: the selected item still receives its latest sale price from the current company. The response map is now restricted to stock-item ids that exist in the requested active location. Items unavailable at that POS location are not selectable and therefore no longer consume response bytes.

The existing company/location validation and POS assigned-location authorization execute before this query, preserving the existing isolation boundary.

## Factory stock-entry history

Normal Stock Entry History usage already follows the desired Phase 4 bandwidth pattern and is retained:

- condensed mode is the default and sends `lite=1`, returning group summaries with `bales: []` rather than embedding every bale;
- search is debounced, and focus/reconnect refetches are disabled;
- bale details are fetched only when a user expands a specific group;
- export and print actions use the existing paginated helper at up to 250 groups per request;
- the Stock Entry History tab is lazy-mounted and does not load merely because Bale Stock Entry is open.

Detailed mode intentionally requests full bale details because the screen renders a flat per-bale view. Phase 4 does not silently cap that explicit user-requested dataset because doing so would truncate reports. The final production verification should distinguish default condensed traffic from deliberate detailed/export traffic when reviewing the bandwidth ranking.

## Phase 4 acceptance boundary

Phase 4 is complete when:

1. POS autosave/manual draft writes do not force a draft-list GET.
2. The POS draft list is summary-only while draft-by-id remains full fidelity.
3. Last-sold prices exclude stock items outside the active location without changing latest-price semantics.
4. Normal Stock Entry History stays on its existing lite/lazy path and full-data transfers occur only for deliberate detailed/export actions.
5. CI, build, lint, database tests, and live Render bandwidth acceptance remain deferred to the final phase.
