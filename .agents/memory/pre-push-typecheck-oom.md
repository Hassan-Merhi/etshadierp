---
name: Pre-push typecheck OOM
description: The repository pre-push hook can exhaust Node heap during branch-only remote operations.
---

When a confirmed git branch deletion is blocked by the repository pre-push type-check hook exhausting Node memory, the deletion can be retried with the repository-supported `SKIP_TSC_CHECK=1` override, then the remote refs must be fetched and verified.

**Why:** The hook validates the whole TypeScript project even for remote branch deletion, and the check may fail from memory exhaustion before reporting source errors.

**How to apply:** Use the override only for explicitly confirmed branch-management operations; do not treat it as evidence that the application type-check passes.