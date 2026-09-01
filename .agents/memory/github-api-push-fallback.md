---
name: GitHub push fallback
description: How to publish a verified branch when the local HTTPS Git remote cannot authenticate.
---

When the local Git remote rejects HTTPS credentials, do not ask for or expose a token. Use the already-authorized GitHub connection and the Git database API instead: create blobs or inline tree entries, create a commit whose parent is the current remote base, create the branch ref, then open the pull request.

**Why:** The repository can have valid Replit-managed GitHub authorization even when the container's `git push` credential helper is unavailable. Large tree payloads may exceed the connector request limit, so incremental tree objects based on the prior tree are safer than a single full upload.

**How to apply:** Verify the live base ref has not moved before uploading. Refuse to overwrite an existing branch, upload binary files as blobs, apply small text chunks through successive `base_tree` updates, and verify the remote commit tree SHA matches the local verified tree before reporting success. Large file-content arguments can trigger durable connector serialization failures, so upload blobs in separate calls and keep tree/commit payloads small.