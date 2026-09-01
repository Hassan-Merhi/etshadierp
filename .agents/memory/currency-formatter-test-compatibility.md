---
name: Currency formatter test compatibility
description: Compatibility rule for currency-aware financial screens and lightweight UI test providers.
---

Financial screens should use the historical-base formatter for persisted accounting values and the native transaction formatter for original-currency values. Some focused UI tests intentionally provide only the legacy generic formatter, so presentation components should use the historical formatter when available and a legacy formatter as a non-production compatibility fallback.

**Why:** Migrating formatter semantics must not turn existing isolated render tests into false failures when their minimal context provider predates the richer currency contract.

**How to apply:** Keep the fallback local to the consuming screen; do not change the accounting meaning of production values or reintroduce current-rate conversion for historical balances.