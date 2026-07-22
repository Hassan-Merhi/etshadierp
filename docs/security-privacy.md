# Security & Privacy

## Authentication
- Session-based authentication using server-side sessions stored in PostgreSQL.
- Sessions expire on logout or server restart (configurable via session settings).
- Passwords are hashed using bcrypt before storage — plain-text passwords are never saved.

---

## Access Control
- Page-level access is controlled per user by an Admin (Settings → User Access Management).
- Admin users bypass all page restrictions and always have full access.
- POS users are locked to their assigned location and cannot see cost/profit data.
- Factory and ERP modes have independent access control tables.

---

## Data Isolation
- All data (transactions, employees, inventory, accounts) is scoped to a company.
- Users can only access data for companies they belong to.
- Switching companies requires a deliberate action (company selector); there is no accidental cross-company data leakage.

---

## Data in Transit
- In production, serve the app over HTTPS to encrypt all traffic.
- WebSocket connections should also be secured (WSS) in production.
- The app does not transmit data to any third-party services unless explicitly integrated.

---

## Sensitive Fields
- Cost and profit fields are hidden from POS-role users at the API level — not just the UI.
- Employee salary and advance data is only accessible to users with Payroll page access.

---

## Audit Trail
- Login history is recorded per user (timestamp, IP, device).
- Duty confirmation changes on factory containers are logged in an audit table with old/new values, user ID, and notes.
- Deleted vouchers are soft-deleted (not permanently removed), preserving the audit trail.

---

## Backups
- The system uses PostgreSQL — set up regular database backups using your hosting provider's tools or `pg_dump`.
- No automatic backup mechanism is built into the app itself.

---

## What Is Not Collected
- No analytics, telemetry, or usage tracking is sent to any external server.
- No user data is shared with third parties.
- The system does not use cookies beyond what is required for session management.

---

## Known Accepted Risks

### `xlsx` (SheetJS) — prototype pollution / ReDoS
- **Advisories:** GHSA-4r6h-8v6p-xvw6 (prototype pollution), GHSA-5pgg-2g8v-p4x9 (ReDoS). No npm fix is published — SheetJS ships fixes only via its own CDN.
- **Exposure:** these are only reachable when *parsing* a malicious `.xlsx` file. In this app that requires an **authenticated user uploading a crafted spreadsheet** (factory/payroll/git import flows) — there is no unauthenticated or remote vector.
- **Decision:** accepted for now. Removing the dependency means migrating Excel parse/export logic off `xlsx` (used across several import/export routes) to `exceljs`, which cannot be validated without exercising each export/import against real data. Tracked as a follow-up; all other production `npm audit` criticals/highs have been resolved.
