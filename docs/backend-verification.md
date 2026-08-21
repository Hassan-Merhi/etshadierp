# Backend verification

The backend suite contains database-backed integration tests and must not run
against a shared database in parallel. The complete CI-sized verification
command is:

```sh
npm run test:backend:verify
```

It bootstraps the idempotent factory, RLS, and Supplier Partner schema bridges
once, then runs all backend test files in eight serial shards. It repeats the
shards with V8 coverage, merges the shard reports, and enforces the thresholds
from `config/coverage-thresholds.json`.

Useful focused commands:

```sh
# Tests only, with per-shard timing and slowest-file output.
npm run test:backend:verify

# Coverage shards only, including merged threshold enforcement.
npm run test:backend:verify:coverage

# Run one shard in CI or while investigating a slow group.
BACKEND_TEST_SHARD_INDEX=3 node scripts/run-backend-verification.mjs

# Print the deterministic file-to-shard assignment.
node scripts/run-backend-verification.mjs --list
```

Each shard has a 180-second budget by default. Override the budget only when
the measured group is understood:

```sh
BACKEND_TEST_SHARD_BUDGET_SECONDS=240 npm run test:backend:verify
```

The ordinary `npm run test:backend` command remains available for targeted
Vitest usage. Route-manifest and migration checks remain part of the complete
test-file inventory; deployment workflows continue to run their explicit
startup-migration and smoke gates separately.