# API Quickstart

All API routes are served on the same port as the frontend. The base URL is the app's root URL (e.g. `http://localhost:5000`).

---

## Authentication

All routes (except login) require an active session cookie.

**Login**
```http
POST /api/auth/login
Content-Type: application/json

{ "username": "admin", "password": "yourpassword" }
```

**Set active company** (required after login if multi-company)
```http
POST /api/auth/set-company
Content-Type: application/json

{ "companyId": 1 }
```

**Get current user**
```http
GET /api/auth/me
```

**Logout**
```http
POST /api/auth/logout
```

---

## Common Endpoints

### Accounts & Ledger
```http
GET  /api/ledger-accounts          # All ledger accounts
GET  /api/ledger-accounts/:id      # Single account
```

### Inventory
```http
GET   /api/inventory               # Stock levels
POST  /api/inventory/quick-adjust  # Adjust stock quantity
```

### Employees & Payroll
```http
GET  /api/employees                # All employees
GET  /api/employees/:id            # Single employee
GET  /api/employees/:id/balance    # Outstanding balance
GET  /api/payroll/runs             # Payroll run history
POST /api/payroll/runs             # Create payroll run
GET  /api/salary-advances/:id      # Single advance record
```

### Suppliers & Customers
```http
GET  /api/suppliers                # All suppliers
GET  /api/suppliers/:id/balance    # Supplier balance
GET  /api/customers                # All customers
```

### Locations
```http
GET  /api/locations                # All locations
GET  /api/locations/:id            # Single location
```

### Health
```http
GET  /api/health                   # Server status
GET  /api/health/db                # Database connection status
```

---

## Factory Routes

Factory-specific routes are prefixed with `/api/factory/`:

```http
GET  /api/factory/bales                        # All bales
GET  /api/factory/bales/stock-entry-history    # Grouped stock entries
GET  /api/factory/containers                   # All containers
GET  /api/factory/workers                      # Factory workers
```

---

## Response Format

Successful responses return JSON directly (array or object).

Errors return:
```json
{ "error": "Human-readable message" }
```

HTTP status codes follow standard conventions: `200` OK, `400` bad request, `401` unauthenticated, `403` forbidden, `404` not found, `500` server error.

---

## Notes

- Sessions are cookie-based — include `credentials: "include"` in fetch calls.
- All data is scoped to the currently selected company (set via `/api/auth/set-company`).
- Factory routes share the same session but are logically separated.
