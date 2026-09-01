---
name: Express literal routes must register before sibling :id routes
description: A literal-path route (e.g. /resource/summary) added after an existing /resource/:id route on the same router gets swallowed by the :id handler, since Express matches purely by registration order, not specificity.
---

Express resolves routes strictly in the order they were `app.get/post(...)`-registered, not by
pattern specificity. If `/api/things/:id` is registered before a new literal sibling route like
`/api/things/summary` or `/api/things/bulk-action`, every request to the literal path gets
swallowed by the `:id` handler (with `:id` bound to the literal string), typically surfacing as a
confusing 400/404 from the wrong handler instead of a 404 for the new route.

**Why:** Hit this when adding new top-level literal routes (`/api/containers/eta-tracking-summary`,
`/api/containers/refresh-etas`) alongside a pre-existing `/api/containers/:id` route registered in
an earlier-imported route-registration module — the new routes silently returned 400 "Invalid id"
from the old handler instead of running.

**How to apply:** When adding a new literal-path route as a sibling of an existing `:id` route on
the same base path, either (a) register the module containing the new literal route before the
module containing the `:id` route in the barrel/registration file, or (b) namespace the new route
under a path segment that cannot collide with `:id` (e.g. a nested prefix). Always add an
integration test that actually hits the new literal route through the full registered app (not just
unit-testing the handler) — that is what catches this class of bug.
