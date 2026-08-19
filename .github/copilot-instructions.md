# Repository instructions for AI coding agents

This is a production ERP repository. Changes can affect accounting, inventory, vouchers, authentication, company isolation, migrations, exports, and operational workflows.

For bug-fix work, prefer evidence-driven, minimal repairs. Reproduce the failure when possible, identify root cause, add a focused regression test, and keep unrelated cleanup out of the patch.

Do not weaken or bypass existing CI ratchets, coverage thresholds, security checks, type checks, lint rules, god-file boundaries, company-scope checks, migration verification, or test suites to make a change pass. Do not introduce blanket `any`, `@ts-ignore`, broad test skips, or ignored errors as shortcuts.

Treat accounting formulas, inventory quantities/valuation, voucher posting, authentication/authorization, RLS/company isolation, destructive operations, and database migrations as high-risk. Only change these when the task specifically requires it and there is focused verification proving the intended behavior.

Use existing repository commands and CI contracts as the validation source of truth. For TypeScript/source changes, run `npm run check` and relevant lint/tests. For database-sensitive behavior, use the PostgreSQL-backed verification path. Preserve existing behavior unless the issue explicitly identifies that behavior as defective.

AI-authored changes must be delivered through a reviewable branch and pull request. Never push directly to `main`, merge your own PR, alter branch protection, or reduce required review/check coverage.
