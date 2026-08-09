# Phase 3 — Authentication route extraction

Phase 3 removes HTTP handlers from `server/routes/authRoutesLegacy.ts` and composes authentication through focused route modules.

## Focused boundaries

- `auth/coreAuthRoutes.ts` — login, logout, current-user hydration, self-service password change, and password reconfirmation.
- `auth/sessionRoutes.ts` — active sessions, session revocation, and login history.
- `auth/auditLogRoutes.ts` — company-scoped audit-log access and filtering.
- `auth/userAdministrationRoutes.ts` — users, password resets, company roles, permission auditing, and session invalidation.
- `auth/userAccessRoutes.ts` — assigned locations, per-location cash accounts, current-user locations, and preferences.
- `auth/companyAccessRoutes.ts` — company CRUD, accessible-company listing, current company state, and company switching.
- `userPresenceRoutes.ts` — presence behavior already separated before this phase.
- `exchangeRateRoutes.ts` — exchange-rate behavior already separated before this phase.

## Compatibility boundary

`authRoutesLegacy.ts` is now a no-op registrar retained only while stacked branches may still import its historical symbol. It contains no HTTP registrations and has a 12-line maximum budget with a final target of zero.

## Security contracts preserved

- Login rate limiting remains 10 attempts per 15 minutes per IP.
- Successful login regenerates the session identifier before authenticated state is written.
- CSRF token issuance remains part of login.
- Master-password use remains blocked for protected roles and security-audited.
- Company switching verifies access and explicitly saves the new session state.
- Role mutations remain audited and invalidate the affected user's active sessions.
- Password reconfirmation remains stored as a short-lived session timestamp.

## Verification contract

`tests/auth-route-composition.test.ts` requires every focused registrar to execute before the compatibility boundary, prevents HTTP registrations from returning to the legacy file, and checks that sensitive endpoints remain in their intended modules.
