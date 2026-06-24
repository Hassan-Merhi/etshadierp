# Development Checklist

Run these checks before every push to `main` or before opening a pull request.

---

## Automated Checks

```bash
# 1. TypeScript type-check (slow — 2-5 min, skip in Replit sandbox if needed; runs in CI)
npm run check

# 2. Build (full frontend + backend bundle)
npm run build

# 3. Lint (ESLint across client/src, server, shared)
npm run lint

# 4. Format check (Prettier)
npm run format:check
```

If `format:check` fails, run `npm run format` to auto-fix, then re-run the check.

If `lint` reports errors (severity 2 violations from ESLint recommended rules), fix them before pushing. Warnings are acceptable.

---

## Manual Functional Tests

After starting the dev server (`npm run dev`), manually verify:

### Inventory

- [ ] Location inventory page loads without error for at least one location
- [ ] Stock items list shows items with correct quantities
- [ ] Stock transfer between two locations updates both location balances
- [ ] Stock adjustment increases or decreases inventory correctly

### Vouchers & Accounting

- [ ] Create a Journal voucher with balanced debit/credit — saves successfully
- [ ] Attempt to save an unbalanced Journal voucher — expect HTTP 400 error
- [ ] Voucher appears in the Daybook on the correct date
- [ ] Customer or supplier ledger reflects the new voucher

### POS

- [ ] POS user can log in and see the POS sale screen
- [ ] Adding items to a sale and completing it reduces inventory
- [ ] Completed sale appears in POS Daybook
- [ ] POS user cannot access ERP-only pages (e.g. `/daybook` should redirect or show Access Denied)

### Settings & Users

- [ ] Admin can create a new user and assign a role
- [ ] Advanced Restrictions page loads without error
- [ ] Toggling a restriction saves without error

### Factory (if changes affect factory)

- [ ] Bale scanning page loads and search dropdown works
- [ ] Arrow key navigation works in the bale product search dropdown
- [ ] Customer orders list loads

### Containers (if changes affect containers)

- [ ] Containers / OTW page loads
- [ ] Container tracking statuses display correctly
- [ ] Offload dialog opens for an OTW container

---

## Error Boundary Check

- [ ] No `ErrorBoundary` fallback is visible on any page after your changes
- [ ] Browser console shows no uncaught React errors
- [ ] Browser console shows no failed `import()` chunk errors

---

## API Health Check

- [ ] No `/api/*` routes return 404 that previously returned 200
- [ ] No `/api/*` routes return 500 after your changes
- [ ] Server logs show no new stack traces after startup

---

## Schema / Migration Check (if you changed `shared/schema/`)

- [ ] Added an idempotent `ALTER TABLE` / `CREATE TABLE IF NOT EXISTS` statement to the migration array in `server/index.ts`
- [ ] Server starts and logs `✓ Database tables and columns verified/migrated` without errors
- [ ] Did **not** run `drizzle-kit push` (it is currently blocked due to schema drift)

---

## Route Check (if you added or moved route files)

- [ ] New route file is imported in `server/routes.ts` (or its sub-barrel `index.ts`)
- [ ] `register*Routes(app)` is called for the new module
- [ ] Test the new endpoint with a direct API call to confirm it responds

---

## Permission Check (if you added a new page or action)

- [ ] If a new page was added, consider whether it needs a `page_*` permission key in `shared/permissionConfig.ts`
- [ ] If a new action was added, consider whether it needs an `act_*` permission key
- [ ] Routes that should be blocked for POS users have `requireNonPOS` middleware applied
- [ ] Routes that should be blocked for non-admins have `requireRole(...)` applied

---

## CI

The GitHub Actions CI workflow (`.github/workflows/ci.yml`) runs automatically on push/PR to `main`:
- Type-check
- Build
- Lint
- Format check

A green CI run covers the automated checks above. Manual functional tests still need to be done locally.
