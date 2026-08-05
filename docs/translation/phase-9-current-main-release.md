# Phase 9 — current-main release reconciliation

## Implementation status

Phase 9 release infrastructure is reconciled on the consolidated current-main code after Phases 4–8.

The implementation includes:

- a manual-only final release workflow;
- authenticated English, Arabic and French browser coverage on phone, tablet and desktop;
- exact-route enforcement for authenticated smoke routes;
- current-main Supplier Partner, Properties/Rentals, Reports/Exports, backend-message and RTL/accessibility reconciliation gates;
- sidebar-edge, skip-navigation focus and protected LTR-value browser assertions;
- a schema-versioned untranslated-text regression ratchet;
- disposable PostgreSQL startup and migration coverage;
- backend, frontend, API, coverage, security, dependency and secret-scan gates;
- one final result aggregator that fails unless every required result is successful.

## Release secrets

The manual workflow requires these repository secrets:

- `PHASE9_ERP_SMOKE_USERNAME` — a dedicated test account able to open the configured release routes;
- `PHASE9_ERP_SMOKE_PASSWORD` — that test account’s password.

The smoke account should be company-scoped and should not be a production end-user account. The workflow never writes the credentials to artifacts or step summaries.

## Current verification state

```json
{
  "implementation": "merged-ready",
  "automaticTriggers": false,
  "verificationRequested": false,
  "verificationExecuted": false,
  "productionReleaseAttested": false,
  "reason": "The user explicitly requested that no CI checks be run during implementation."
}
```

This status is intentionally honest: the implementation is complete, but a production release must not be described as verified until the manual workflow has actually completed successfully on the intended source head.

## Database and SQL

No production SQL or schema migration is introduced by Phase 9. The PostgreSQL service in the workflow is disposable release-verification infrastructure only.
