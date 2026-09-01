---
name: Stale Vite source rewrites
description: How to handle strict build-time source transforms after a component's implementation has evolved.
---

When a component's current source owns the behavior that an older Vite rewrite used to inject, the old transform must be bypassed for that component. Strict marker-based rewrites are useful for drift detection, but they should not remain in the dev transform path once their target source shape is obsolete.

**Why:** Vite can invoke a transform again while serving or retrying a module. A stale rewrite then throws a missing-target error and makes the entire preview unavailable, often producing misleading secondary React errors.

**How to apply:** Keep unrelated transforms active, add a narrow path guard in the wrapper plugin for the source-owned component, and verify the actual module URL plus the root preview after restarting the workflow.