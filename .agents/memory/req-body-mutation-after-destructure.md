---
name: req.body mutation after destructuring is a no-op
description: Route handlers that destructure req.body into consts, then later mutate req.body fields "to strip/override" them, don't actually affect already-bound local variables.
---

Some legacy route handlers destructure fields from `req.body` into local `const`s near the top, then later do `(req.body as any).someField = undefined;` intending to strip/force a value for downstream logic. Because destructuring copies primitive values, this mutation never affects the already-bound local consts used later in the function — it's a silent no-op bug.

**Why this matters:** found in the POS edit-sale handler (`PUT /api/vouchers/:id/sales`) — POS-role users were supposedly having `paymentAccountType`/`paymentAccountId` stripped to force preservation of the original payment account, but the strip never actually took effect because the values were destructured earlier. The intended restriction has been silently inert in production.

**How to apply:** When refactoring/extracting such handlers, preserve the no-op behavior byte-for-byte (don't "fix" it) unless the user explicitly asks to fix the underlying bug — flag it to the user as a discovered latent bug worth a separate decision. When writing new handlers, mutate `req.body` before destructuring, or mutate the local variable directly, not `req.body`, to avoid recreating this bug.
