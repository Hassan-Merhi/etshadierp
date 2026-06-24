# Permissions & Security

## Roles

Roles are stored in `userCompanyRoles` and set in the session as `currentRole`.

| Role | Level | Notes |
|---|---|---|
| `Developer` | Highest | Bypasses all role checks, all date restrictions, and all advanced restrictions. Cannot be restricted. |
| `Admin` | High | Bypasses all advanced restrictions. Cannot be restricted. Bypasses date restrictions. |
| `Owner` | Medium-high | Full access by default; can be restricted via Advanced Restrictions. Cannot delete records. |
| `Manager` | Medium | Full access by default; can be restricted. Can delete records only if `canDeleteRecords = true`. |
| `POS` | Restricted | Limited route set. Today-only date restriction. Cannot delete records. Must be assigned to a location. |
| `Normal User` | Lowest | Denied by default for most features. Must be explicitly granted access via Advanced Restrictions. |

The `canDeleteRecords` flag is a per-user-company-role boolean that grants delete capability to Managers (not Owners or POS).

---

## Route Auth Pattern

Every protected route applies middleware in this order:

```
requireAuth          → verifies session, populates req.user + req.user.role
requireNonPOS        → (optional) blocks POS role entirely
requireRole(...)     → (optional) allows only specific roles
canDelete            → (optional) used on DELETE routes
checkPOSLocation     → (optional) used on location-scoped POS routes
canModifyDate        → (optional) used on routes that accept a date field
requireModuleAccess  → (optional) checks mod_* permission key
requireActionAccess  → (optional) checks act_* permission key
requireExportAccess  → (optional) checks exp_* permission key
```

Example:
```typescript
app.post("/api/vouchers", requireAuth, requireNonPOS, async (req, res) => { ... });
app.delete("/api/vouchers/:id", requireAuth, canDelete, async (req, res) => { ... });
app.get("/api/pos/inventory", requireAuth, checkPOSLocation, async (req, res) => { ... });
```

---

## Company Access

Each user-company pair has an entry in `userCompanyRoles`. A user can have different roles in different companies. The active company is stored in the session as `currentCompanyId`.

Company switching updates the session's `currentCompanyId`. All subsequent queries use the new company context.

---

## POS Location Access

POS users are additionally constrained by `userLocations`:
- The `checkPOSLocation` middleware queries `userLocations` to confirm the requesting user is assigned to the `locationId` in the request.
- If no assignment exists, the request is rejected with 403.
- Non-POS roles bypass the location check.

---

## Advanced Restrictions System

Defined in `shared/permissionConfig.ts`. Implemented by `server/lib/permissionHelpers.ts` and `server/lib/permissionMiddleware.ts`.

**Key naming conventions**:

| Prefix | Scope |
|---|---|
| `mod_*` | Top-level module visibility (ERP, Factory, POS, Properties, Inventory, Accounting, Analytics, Settings) |
| `page_*` | Full page/route visibility |
| `tab_*` | Tab or sub-section visibility within a page |
| `act_*` | Action buttons / write operations (create voucher, adjust stock, transfer stock, etc.) |
| `fld_*` | Sensitive field visibility (cost price, profit margin, supplier/customer balances, bank balances) |
| `exp_*` | Export / print capabilities (PDF, Excel, WhatsApp, audit log, backup) |
| `pos_perm_*` | POS-specific capabilities (price override, discount, credit sale, refund, shift open/close) |

**Semantics** (from the catalog comment):
- `Developer` / `Admin` → always allowed, cannot be restricted
- `Owner` / `Manager` / `POS` → allowed by default; `enabled = false` in DB means restricted
- `Normal User` → denied by default; `enabled = true` in DB means explicitly allowed

This means the UI checkbox means opposite things for different roles:
- For Owner/Manager/POS: checked = restriction is active (stored as `enabled = false`)
- For Normal User: checked = access is granted (stored as `enabled = true`)

---

## CSRF Protection

Two independent layers in `server/index.ts`:

**Layer 1 — Origin / Referer guard**:
- Checks the `Origin` or `Referer` header on state-changing requests.
- Rejects requests where neither header matches the request host.
- Exceptions: requests without either header (e.g. server-to-server), Capacitor WebView origins.

**Layer 2 — Synchronizer token**:
- A per-session CSRF token is generated and exposed via `GET /api/csrf-token`.
- All state-changing requests must include a matching `X-CSRF-Token` header.
- Controlled by `CSRF_ENFORCE` env var: default = enforcing (hard 403). Set `CSRF_ENFORCE=0` for warn-only mode.

---

## Session Security

- Sessions are stored in PostgreSQL (pg-based session store).
- The session `secret` is read from `SESSION_SECRET` env var. If missing in production, startup logs a critical error and generates a random secret (which means sessions are invalidated on restart).
- `secure: true` cookie flag is set in production, on Replit (when `REPL_ID` is set), or with Capacitor.
- Session does not use `httpOnly: false` by default (Needs verification — confirm httpOnly setting).

---

## Soft Delete

Key entities use soft deletion (Needs verification — confirm which tables have a `deletedAt` or `isDeleted` column). The 30-day purge scheduler (`[Purge]`) runs daily at 2 AM EST and permanently removes soft-deleted rows older than 30 days.

The "Deleted Items" admin page (`server/routes/admin/deletedItemsRoutes.ts`) allows reviewing and restoring soft-deleted records before the purge window expires.

---

## Known Risk Areas Needing Future Audit

1. **No DB-level row security**: all tenant isolation is application-level. A `currentCompanyId` bug exposes all companies' data.
2. **POS location isolation**: not all POS-accessible routes call `checkPOSLocation`. Audit every route accessible to the `POS` role.
3. **`canSellNegativeStock`**: set from role at session login time. If a user's role changes mid-session, the session value is stale until re-login.
4. **Developer role bypass**: Developer bypasses every restriction. Accounts with this role should be audited regularly.
5. **Orphaned FK constraints**: several FKs are `NOT VALID`, meaning orphaned rows exist. Queries expecting referential integrity may return unexpected nulls.
6. **Session fixation**: confirm `req.session.regenerate()` is called on login (Needs verification).
7. **Audit log completeness**: not all write operations call `logAudit`. Confirm coverage for financial mutations.
8. **Export access**: `exp_backup_download` guards bulk data downloads. Verify all backup/export endpoints check this permission.
