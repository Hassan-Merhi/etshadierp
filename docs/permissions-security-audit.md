# Permissions & Security Audit Report

**Date:** 2026-06-24  
**Scope:** All backend routes under `server/routes/`, `server/middleware/`, `server/index.ts`  
**Method:** Static code analysis + subagent-assisted route enumeration

---

## 1. Route Auth Coverage

### Global Middleware (server/index.ts)
| Middleware | Coverage |
|---|---|
| `helmet` | All routes — security headers |
| `blockViewOnlyWrites` | All API mutation routes — blocks `View Only` role |
| CSRF Origin Guard | All cross-origin POST/PUT/PATCH/DELETE |
| CSRF Synchronizer Token | All state-changing API calls |
| `express-session` | All routes — session management |

### Auth Middleware Functions (server/auth.ts)
| Middleware | Purpose |
|---|---|
| `requireAuth` | Validates session, populates `req.user`, requires `currentCompanyId` |
| `requireLogin` | Validates session only (used for screen-feed, presence) |
| `requireRole(...roles)` | Restricts to named roles |
| `canDelete` | Allows Admin/Owner or users with `canDeleteRecords` flag |
| `requireNonPOS` | Blocks POS role from accessing route |
| `checkPOSLocation` | For POS users, verifies `locationId` is in user's assigned locations |
| `blockViewOnlyWrites` | Blocks all mutations for `View Only` role |
| `canModifyDate` | Restricts POS users to current-date vouchers only |
| `requirePasswordConfirmation` | Requires recent password re-entry |

### Route Files — Auth Coverage Summary
| File | Routes | Auth Status |
|---|---|---|
| `posRoutes.ts` | All | `requireAuth` on all routes |
| `voucherEntryRoutes.ts` | All | `requireAuth`; bulk-delete has `requireRole` |
| `voucherRoutes.ts` (barrel) | Delegates to sub-files | Sub-files all use `requireAuth` |
| `accountRoutes.ts` | All | `requireAuth` |
| `ledgerRoutes.ts` | All | `requireAuth` |
| `inventoryRoutes.ts` | All | `requireAuth` |
| `locationRoutes.ts` | All | `requireAuth`; most also have `checkPOSLocation` |
| `stockRoutes.ts` (barrel) | Delegates | Sub-files use `requireAuth` |
| `containerRoutes.ts` (barrel) | Delegates | Sub-files use `requireAuth` |
| `exportRoutes.ts` | All | `requireAuth` + `requireRole` guard array |
| `whatsappRoutes.ts` | All | `requireAuth` |
| `factoryWhatsappRoutes.ts` | All | `requireAuth` |
| `debugRoutes.ts` | All | `requireAuth` + `requireRole("Admin","Developer")` |
| `gitRoutes.ts` | All | `requireAuth` + `requireRole("Admin","Owner")` |
| `payroll/` sub-files | All | `requireAuth` |
| `admin/adminRepairRoutes.ts` | All | `requireAuth` + `requireRole("Admin")` |
| `admin/companySettingsRoutes.ts` | All | `requireAuth` |
| `admin/userManagementRoutes.ts` | All | `requireAuth` |
| `factory/labelBannersRoutes.ts` | Write/delete | **Fixed:** now `requireNonPOS` added |
| `factory/factoryBalesRoutes.ts` | All | `requireAuth` |
| `factory/factoryStockRoutes.ts` | All | `requireAuth` |
| `authRoutes.ts` | Login, logout | Public (by design) |
| `authRoutes.ts` | `/api/user-presence/leave` | Public (sendBeacon — non-sensitive) |
| `admin/adminRepairRoutes.ts` | `/api/dev/seed` | **Fixed:** now `requireAuth` + `requireRole("Admin")` |

---

## 2. Permission Middleware Coverage

### Admin/Owner-only routes (correctly guarded)
- All `/api/admin/*` repair/reset routes: `requireRole("Admin")`
- All `/api/debug/*` routes: `requireRole("Admin", "Developer", "Owner")`
- All `/api/git/*` routes: `requireRole("Admin", "Owner")`
- Export schedule management: `requireRole` guard
- Company data reset: `requireRole("Admin")`

### Delete routes
- Voucher bulk delete: `canDelete` middleware
- Most entity deletes: `canDelete` or `requireRole("Admin")`
- Factory bale delete: admin check inline

### View-only write block
- `blockViewOnlyWrites` is registered globally in `server/index.ts` before route registration — covers all API mutations without needing per-route handling.

---

## 3. Company Isolation Findings

### Pattern (correct — used consistently)
```typescript
const companyId = req.session.currentCompanyId; // or factoryCompanyId
// All queries include: eq(table.companyId, companyId)
```

### Confirmed correct isolation
- `vouchers` — company-scoped in fetch + cross-company check on GET by ID
- `ledgerAccounts` — always filtered by companyId from session
- `stockItems` / `inventory` — filtered by session companyId
- `locations` — filtered by companyId; cross-ownership verified before write
- `factoryBales` — always filtered by `factoryCompanyId || currentCompanyId`
- `customerOrders` — filtered by session factoryCompanyId
- `suppliers` / `customers` — session companyId in WHERE
- `employees` / `workers` — session companyId
- `payroll` — session companyId

### Findings — Needs Verification
| Area | Finding |
|---|---|
| `factoryCompanyId` vs `currentCompanyId` | Factory routes use `factoryCompanyId \|\| currentCompanyId` fallback — correct for single-mode sessions, acceptable risk |
| Client-supplied `companyId` in request body | Several factory routes accept `companyId` in body but override with session value — safe |
| `/api/pos/last-sold-prices` | Was using `location.companyId` without verifying location belongs to current session company — **Fixed** |

---

## 4. POS User Restriction Findings

### What POS restriction covers (confirmed working)
- `POST /api/pos/sales` — manual check via `userLocationCashAccounts` mapping; POS cash account enforced server-side
- `GET /api/vouchers` — filters to `assignedLocationId` for all non-admin users
- `GET /api/locations/:locationId` — `checkPOSLocation` middleware
- `GET /api/locations/:locationId/inventory` — `checkPOSLocation` middleware
- `GET /api/locations/:locationId/inventory-rates` — `checkPOSLocation` middleware
- `POST /api/locations/:locationId/import-cost-prices` — `checkPOSLocation`
- `POST /api/locations/:locationId/import-inventory` — `checkPOSLocation`
- `GET /api/pos/shifts/:id` — POS users can only access their own shift
- `GET /api/pos/shifts/history` — POS users filtered to their own shifts only
- All admin/settings routes — `requireNonPOS` or `requireRole` blocks POS access
- `canModifyDate` — POS users cannot backdate/forward-date vouchers

### Gaps fixed in this audit
| Route | Gap | Fix Applied |
|---|---|---|
| `POST /api/pos/shifts/open` | POS user could open shift at any company location | Added assignment check after company check |
| `GET /api/pos/last-sold-prices` | No company ownership check; POS user could query any location | Added company check + POS assignment check |
| `GET /api/locations/:locationId/inventory/export` | Missing `checkPOSLocation` | Added middleware |
| `GET /api/locations/:locationId/inventory/pdf` | Missing `checkPOSLocation` | Added middleware |
| `GET /api/locations/:locationId/vouchers/today` | Missing `checkPOSLocation` | Added middleware |

### Needs Verification
| Route | Note |
|---|---|
| `POST /api/pos/send-invoice-pdf-backend` | Sends PDF for a voucherId; voucher lookup verifies companyId but not POS location assignment |
| `POST /api/pos/send-stock-pdf-backend` | Takes locationId but no POS location assignment check; low-risk (read-only report) |
| `POST /api/pos/send-shift-report` | Sends shift report WhatsApp; shift ownership verified by userId filter |

---

## 5. File / Export / WhatsApp Security Findings

| Route | Auth | Role Check | Notes |
|---|---|---|---|
| `GET /api/export/download/:jobId` | `requireAuth` + `requireRole` | Yes | Safe |
| `POST /api/export/start` | `requireAuth` + `requireRole` | Yes | Safe |
| `POST /api/whatsapp/send-net-position` | `requireAuth` | No role | Any authenticated user can trigger — acceptable (internal tool) |
| `POST /api/daily-export/trigger-whatsapp` | `requireAuth` | No role | Needs verification for role restriction |
| `POST /api/factory/accounts/:id/send-statement-whatsapp` | `requireAuth` | No role | Any factory user can send; acceptable |
| `GET /api/locations/:locationId/inventory/export` | `requireAuth` + `checkPOSLocation` | — | **Fixed** |
| `GET /api/locations/:locationId/inventory/pdf` | `requireAuth` + `checkPOSLocation` | — | **Fixed** |
| Label banner upload/delete | `requireAuth` + `requireNonPOS` | — | **Fixed** |

---

## 6. High-Risk Routes

| Route | Risk | Status |
|---|---|---|
| `POST /api/admin/reset-company-data` | Wipes company data | `requireRole("Admin")` — protected |
| `POST /api/admin/company-data-reset` | Wipes company data | `requireRole("Admin")` — protected |
| `DELETE /api/vouchers/bulk` | Mass delete | `canDelete` — protected |
| `POST /api/dev/seed` | Wipes/seeds DB | **Fixed:** `requireAuth` + `requireRole("Admin")` + NODE_ENV check |
| `POST /api/pos/shifts/open` | Shift at unassigned location | **Fixed:** POS location assignment check |
| `GET /api/locations/:locationId/inventory/export` | Inventory data export | **Fixed:** `checkPOSLocation` |
| `POST /api/factory/payroll/generate` | Payroll generation | `requireAuth` — no role check (needs verification) |

---

## 7. Safe Fixes Applied

| Fix | File | Description |
|---|---|---|
| `checkPOSLocation` on inventory export | `locationRoutes.ts` | POS users blocked from exporting other locations |
| `checkPOSLocation` on inventory PDF | `locationRoutes.ts` | POS users blocked from PDF of other locations |
| `checkPOSLocation` on vouchers/today | `inventoryRoutes.ts` | POS users blocked from viewing other locations' vouchers |
| POS assignment check on shift open | `posRoutes.ts` | POS user cannot open shift at unassigned location |
| POS assignment + company check on last-sold-prices | `posRoutes.ts` | Location must belong to session company; POS limited to assigned location |
| `requireNonPOS` on label banner write/delete routes | `labelBannersRoutes.ts` | POS and Staff+ only; label design changes require non-POS role |
| `requireAuth` + `requireRole("Admin")` on dev/seed | `adminRepairRoutes.ts` | Defense-in-depth on top of NODE_ENV check |

---

## 8. Needs Verification

| Item | Reason |
|---|---|
| `POST /api/factory/payroll/generate` | No role check beyond `requireAuth` — any authenticated factory user could trigger payroll |
| `POST /api/pos/send-invoice-pdf-backend` | Voucher companyId checked, but POS location not verified against user assignment |
| `POST /api/daily-export/trigger-whatsapp` | No role check; any authenticated user can trigger WhatsApp export |
| Manual role checks inline | Some handlers use `if (role !== 'Admin')` inside handler body instead of middleware — functionally equivalent but harder to audit |
| `factoryCompanyId` vs `currentCompanyId` fallback | In single-mode sessions both are the same; in multi-mode verify the fallback is always correct |

---

## 9. Future Hardening Recommendations

1. **Standardize role checks as middleware** — Replace inline `if (role === 'Admin')` with `requireRole()` middleware for auditability.
2. **Add `requireRole` to payroll generation** — `POST /api/factory/payroll/generate` should require Manager/Admin.
3. **Rate-limit POS sale creation** — Add per-user rate limiting to `POST /api/pos/sales` to prevent abuse.
4. **Add role check to WhatsApp trigger** — `POST /api/daily-export/trigger-whatsapp` should require Admin or Manager.
5. **Audit log on all deletes** — Some delete routes write to `auditLog`; ensure consistent coverage.
6. **Consider adding `requireNonPOS` to factory routes** — POS users generally shouldn't access factory endpoints; a global guard would be cleaner than per-route checks.
7. **Validate item/account ownership on create** — When a voucher or stock movement references an `accountId`, verify it belongs to the current company (most routes already do this; standardize the pattern).
