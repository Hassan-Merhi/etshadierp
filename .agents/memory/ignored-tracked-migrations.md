---
name: Ignored tracked migration files
description: Recovery guidance for schema files that are tracked on GitHub but hidden by local ignore patterns after a branch merge
---

When a startup bridge reports a missing migration after synchronizing with GitHub, compare `git ls-tree` for the local head and the fetched canonical branch before changing application code. This repository has SQL ignore patterns, while some migration SQL files are nevertheless tracked in GitHub.

**Why:** A merge can leave the local tree without migration files that exist in the canonical GitHub tree, producing an application startup failure even though the bridge and migration history are valid.

**How to apply:** Restore the canonical tracked migration files explicitly and stage ignored SQL files with force when needed; then rerun typecheck, build, and the application workflow.