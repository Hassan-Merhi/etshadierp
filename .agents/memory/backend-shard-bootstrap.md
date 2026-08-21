---
name: Backend shard bootstrap and coverage
description: Backend integration shards share one database; schema bridges must bootstrap once and shard coverage must be merged before enforcing floors.
---

Database-backed backend tests use serialized forks because suites share schema and process-global settings. Re-running the supplier, factory, and RLS bridges in every worker dominates runtime and can exceed CI budgets. A verification runner should bootstrap those bridges once, keep per-worker setup lightweight, and merge per-shard V8 coverage before applying global/per-file floors.

**Why:** The measured suite spent most of its time in repeated worker setup rather than test bodies, while direct per-shard coverage thresholds falsely failed because each shard only covered part of the source tree.

**How to apply:** Keep test shards serial against the shared database unless each shard gets an isolated database. Use separate test and coverage budgets, emit per-shard timing reports, and enforce thresholds only after coverage-map merge.