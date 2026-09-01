---
name: Git tree manifest safety
description: Reliable handling of large Git trees when publishing through the GitHub API
---

Never derive a complete Git tree manifest from shell output returned through the durable tool layer. Large output may be truncated without an obvious failure, causing a publish script to interpret omitted files as deletions.

**Why:** A synchronization publish once consumed a truncated `git ls-tree` result and produced a remote branch containing only the visible subset. The branch had to be rebuilt through incremental GitHub tree objects before it could be trusted.

**How to apply:** For large repositories, obtain Git entries with direct `child_process.execFile` and parse in the impure function, or use a NUL-delimited local file/stream. Always compare local and remote path counts and blob SHAs before advancing the branch.