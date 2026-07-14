---
name: Bare block + return inside a route's try block silently swallows the response
description: A `try { { ...; if (x) return; ... } } catch {}` pattern in an Express handler exits the whole handler on early-return, skipping res.json/res.send and hanging the client until timeout.
---

A nested `{ }` block is not a function scope — `return` inside it exits the *enclosing function*, not the block. When this pattern is used inside a route handler's try/catch (e.g. a "side effect" section meant to run best-effort after the main response is computed), every early-return path in that side-effect logic skips the actual response call placed after the try/catch, so the client hangs until its own timeout.

**Why:** found in an exchange-rate save endpoint where an FX-revaluation side effect had `if (!prevRateRow) return;` — meant to skip revaluation, but instead it returned from the whole `app.post` handler before `res.json(rate)`, hanging every "first rate ever for a company" save for ~30s+.

**How to apply:** whenever you see `try { { ... return; ... } } catch (e) {}` followed by code that should always run (like sending the response), wrap the inner block in an `await (async () => { ... })();` IIFE so early returns only exit the side-effect logic, not the route handler. Grep for `try {\s*{` patterns when auditing similar "wrapped best-effort side effect" code.
