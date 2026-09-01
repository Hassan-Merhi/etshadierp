---
name: AI chat draft anti-hallucination pattern
description: How to stop an AI assistant from claiming it "prepared a draft" (voucher/stock transfer/stock adjustment/etc.) when no draft object was actually built.
---

Any intent-specific system prompt that tells the LLM to acknowledge "I've prepared a draft for you" runs the risk of the LLM saying this even when the deterministic draft-building code found nothing (ambiguous match, missing required field, zero eligible data). The LLM has no way to know the backend outcome when it generates that acknowledgment.

**Why:** happened concretely with the stock-transfer intent in `buildActionSystemPrompt` — the case always told the LLM to claim a draft was ready regardless of whether `stockTransferDraft` ended up defined.

**How to apply:** after all of an intent's draft-building branches run, add a final guard: if the resulting draft variable is still undefined/empty (or is only an ambiguous-candidates placeholder), set a deterministic override string and use it to replace `finalResponse` for that intent — never let the raw LLM acknowledgment stand uncontested. Do NOT touch `finalResponse` when a real draft was produced; only override on the no-draft/ambiguous paths, so successful flows keep their existing (already-tested) wording.

This same structural risk likely exists for other draft-creating intents (voucher creation, stock adjustment, price update) since they share the same `buildActionSystemPrompt` pattern — worth auditing if similar "says done but nothing happened" reports come up for those intents.
