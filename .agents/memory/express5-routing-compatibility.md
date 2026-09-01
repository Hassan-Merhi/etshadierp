---
name: Express 5 routing compatibility
description: Express 5 catch-all syntax and router introspection differ from Express 4.
---

Use named catch-all parameters such as `/{*splat}` instead of bare `*`, and read
the application stack from `app.router` with an `_router` fallback. Express 5
does not retain the original `app.use()` mount pattern on its layer, so
introspection tests that need exact mount paths must capture the mount argument
at registration time.

**Why:** Express 5 rejects unnamed wildcards and removes the router regexp
metadata that older route-manifest tooling relied on.

**How to apply:** When migrating route code or manifest tooling, update runtime
wildcards, stack access, and registration-time metadata capture together.