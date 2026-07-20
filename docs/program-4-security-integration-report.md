# Program 4 — Security Integration Report

Status: complete on `agent/program-4-security-runtime-enforcement`.

Program 4 integrates the pure Program 3 security policies into selected production routes and middleware. It intentionally avoids accounting, inventory valuation, costing, historical transaction, and deployment behavior changes.

## Integrated production boundaries

### Authentication and session enforcement

- `server/auth.ts` now routes login/session checks through `sessionEnforcementAdapter.ts`.
- Enforced controls include idle timeout, absolute session lifetime, active company context, password confirmation age, and credential-version compatibility.
- Legacy sessions are upgraded into the new security shape rather than being rejected without migration support.

### Company isolation

- Factory insurance reads and writes derive the operating company from authenticated session state.
- Request-supplied company identifiers are treated as assertions and must equal the active company.
- Member listing, ledger reads, creation, update, toggle, delete, and monthly journal generation retain company predicates.

### Privileged administrative operations

- `/api/admin/rebuild-inventory` is protected by the Program 3 privileged-operation policy.
- Non-dry-run execution requires the exact repair permission, reason, idempotency key, source identity, company-bound confirmation token, and recent password confirmation.
- Authorization attempts are persisted before mutation logic can continue.

### Unsafe mutation input

- Inventory rebuild requests are validated against an exact allow-list before privileged authorization.
- Unknown fields, unsafe prototype keys, excessive nesting, oversized strings, arrays, and invalid types are rejected.
- The validated payload is frozen and replaces `req.body`.

### Protected assets

- Factory container-document downloads are intercepted before the legacy upload route.
- Asset existence, company ownership, storage keys, byte size, and filenames are validated through the canonical protected-asset policy.
- Downloads use attachment disposition, RFC 5987 filename encoding, `nosniff`, and private no-store caching.

### Security audit and anomaly surfacing

- Security events are stored in the existing append-only `audit_log` table; no schema migration was required.
- Secret-bearing metadata is redacted by the Program 3 audit policy.
- `GET /api/admin/security-anomalies` provides a company-scoped 15-minute anomaly summary to Admin and Developer users.

## End-to-end regression coverage

`tests/program-4-end-to-end-enforcement.test.ts` exercises the complete sensitive-mutation chain:

1. Exact input validation.
2. Frozen validated request payload.
3. Named privileged permission enforcement.
4. Company-bound confirmation enforcement.
5. Recent password-confirmation enforcement.
6. Audit persistence before route execution.
7. Fail-closed handling when an approved decision cannot be persisted.
8. Repeated-denial anomaly classification.

Existing focused suites additionally cover session enforcement, factory insurance company isolation, protected-asset access, unsafe input validation, privileged operation enforcement, and audit record mapping.

## Compatibility bridges still present

- Admin and Developer sessions without persisted named permissions temporarily receive the exact permission required by the protected route. Explicit permission arrays still fail closed when the required permission is absent.
- Credential version `0` remains the compatibility baseline until a persistent credential-version field and rotation workflow are introduced.
- Factory company resolution still contains legacy fallback behavior outside the specifically migrated company-isolation slice.

These bridges are documented migration aids, not the final long-term authorization model.

## Remaining incremental adoption

Program 4 proves and integrates each security boundary on a production slice. It does not claim that every route in the ERP has been migrated.

Remaining future rollout work includes:

- Replace role-only authorization on additional repair, recalculation, import, configuration, and diagnostic-write endpoints.
- Apply exact input schemas to remaining sensitive mutations.
- Route additional attachments, generated exports, reports, and upload folders through protected-asset access control.
- Persist security decisions from company-isolation, session, authentication, input-validation, and protected-asset boundaries.
- Remove temporary Admin/Developer permission bridging after named permissions are persisted and administered centrally.
- Add persistent credential versions and invalidate sessions after password or credential changes.
- Remove legacy factory-company fallback once explicit company selection is guaranteed for all factory sessions.

## Verification boundary

- Source changes and PR patches were inspected through GitHub.
- Tests were written but were not executed through Replit or GitHub Actions.
- No runtime deployment, production database, or live-session verification is claimed.
- PR #80 must remain draft and unmerged until owner approval.

## Completion conclusion

All planned Program 4 phases, 4A through 4H, are implemented on the dedicated branch. Program 4 is complete as an integration and regression package, with the remaining items above explicitly classified as broader incremental rollout rather than unfinished Phase 4 work.
