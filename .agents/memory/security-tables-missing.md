---
name: Security tables missing in prod
description: user_security_permissions and user_credential_versions tables were never migrated to production DB, causing a cascade of 500 errors on repair endpoints.
---

## The Problem

`requireLegacyPrivilegedWrite` middleware calls `hydrateSessionNamedPermissions(db, session)` which queries `user_security_permissions` via Drizzle ORM. If the table doesn't exist, Drizzle throws a PostgreSQL "relation does not exist" error.

The catch block in `legacyPrivilegedWriteGuard.ts` (line 110) only suppresses `PrivilegedOperationError` and `AuthorizationDeniedError` instances:
```js
const denied = error instanceof PrivilegedOperationError || error instanceof AuthorizationDeniedError;
if (!denied) return next(error);  // ← DB errors go here
```

A missing-table error is neither — so `next(error)` fires → Express global error handler → 500 "An unexpected error occurred. Please try again." in production.

## The Fix

Created tables directly in production DB:
```sql
CREATE TABLE IF NOT EXISTS user_security_permissions (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL,
  permission TEXT NOT NULL,
  granted_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_security_permissions_unique 
  ON user_security_permissions (user_id, company_id, permission);
CREATE INDEX IF NOT EXISTS user_security_permissions_company_user_idx 
  ON user_security_permissions (company_id, user_id);

CREATE TABLE IF NOT EXISTS user_credential_versions (
  user_id VARCHAR PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  credential_version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Why:** drizzle-kit push can't run non-interactively, so these tables were never applied to prod despite being in the schema.

**How to apply:** Any new security schema table must be manually created in prod via direct SQL (same pattern as above).
