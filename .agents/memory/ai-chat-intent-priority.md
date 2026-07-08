---
name: AI chat intent classification priority and anti-hallucination override
description: How explicit-domain regex signals must outrank generic financial-transfer heuristics in classifyChatIntent, and how the anti-hallucination override must apply independent of the (possibly wrong) classified intent.
---

## Rule
In `server/chatService.ts`'s `classifyChatIntent`, a generic financial-transfer
regex heuristic (e.g. "transfer/pay/deposit ... <digit>" within N chars) can
false-positive on unrelated domains whenever their own keyword also appears
near a digit (e.g. "stock transfer draft for 410 bales" trips the voucher
heuristic purely because "transfer" precedes a digit). An explicit,
domain-specific signal (e.g. stock/item/inventory named directly next to
transfer/move/shift) must be checked with priority *before* the generic
heuristic's exclusion logic, not folded into the same `&& !RE_GENERIC.test()`
condition — otherwise the generic match silently wins and misroutes the
message to the wrong intent.

**Why:** This exact bug caused a real production failure: a stock-transfer
draft request was misclassified as `create_voucher`, which meant the
stock-transfer-specific anti-hallucination override (`stockTransferResponseOverride`)
never applied (it was gated on `intent === "create_stock_transfer"`), so the
LLM's raw/hallucinated "I've prepared a draft" text became the final response
even though no valid draft existed — followed by a live 400 error surfaced to
the user, then the assistant contradicting itself.

**How to apply:** (1) When adding a new domain-specific classification signal
that competes with a broad heuristic, give it its own priority check ahead of
the broad one, not a modifier folded into the broad one's condition. (2) Any
override variable that is only ever assigned within a specific intent's
extraction block is safe to apply unconditionally to the final response
(regardless of what `intent` was classified as) — this is a stronger
anti-hallucination guard than gating on intent equality, since intent
classification can be wrong. (3) When a domain regex is broadened to win
priority over a competing heuristic, explicitly exclude adjacent contexts that
would flip its meaning (e.g. "stock/inventory ACCOUNT" turns "transfer stock
account" back into a ledger/journal operation, not a physical stock move) —
verified via architect code review after the initial fix.

## Deterministic pre-parser as LLM backfill (grounded in real DB rows)
For structured extraction tasks (e.g. parsing "destination + N source
locations + target quantity" from free text), pair a deterministic
regex/name-matching parser with the existing LLM extraction as a fallback
rather than replacing it. Match location names by iterating the company's
*actual* location rows (not generic word-boundary heuristics) so that e.g.
"Kolwezi" vs "Kolwezi 2" are never conflated — sort candidate mentions by
match length descending and drop any mention whose span overlaps a longer
one already kept. Only trust the deterministic result when it fully resolves
destination + sources + quantity; otherwise fall through to the LLM. This
catches known-fragile LLM extraction patterns (repeated full-name lists,
"do not use X" exclusions) without risking regressions on cases the LLM
already handled correctly.
