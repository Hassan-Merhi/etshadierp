---
name: Heavy-endpoint guard queues instead of rejecting
description: ENDPOINT_BUSY 429s come from the production-only runtime memory guard; saturated slots now queue briefly instead of instantly rejecting.
---

The heavy-endpoint concurrency guard (per-path max-active limits emitting `429 ENDPOINT_BUSY`) is loaded only by the production `start` script, NOT `npm run dev` — the raw JSON error users see in production can never be reproduced in the dev workflow.

Saturated slots now hold requests in a short FIFO queue (env-tunable wait/depth) and start them when a slot frees; only queue overflow or wait timeout still sheds with `ENDPOINT_BUSY`.

**Why:** Users hitting a guarded report twice (double-click, two POS users) saw a raw `{"code":"ENDPOINT_BUSY"}` page instead of the app; instant rejection punished normal usage while the queue preserves the memory-protection intent.

**How to apply:** When debugging a production-only 429/503 with codes ENDPOINT_BUSY / MEMORY_PRESSURE / SERVER_SHUTTING_DOWN, look at the runtime guard preload chain, not Express routes. Test guard changes with a standalone HTTP server harness since dev never loads it.
