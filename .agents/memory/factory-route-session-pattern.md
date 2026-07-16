---
name: Factory route session pattern
description: How factory routes extract companyId from the session — NOT req.session.companyId
---

Factory API routes (under `/api/factory/`) get their companyId via:

```typescript
const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
if (!companyId) return res.status(400).json({ message: "No company selected" });
```

**Why:** The factory middleware sets `factoryCompanyId` / `currentCompanyId` on the session, not the generic `companyId` field used by ERP routes. Using `req.session.companyId` returns undefined → 400 on every request.

**How to apply:** Any new route added to `rawStockRecalcRoutes.ts` or any other factory routes file must use `factoryCompanyId || currentCompanyId`. ERP routes (non-factory) use `req.session.companyId`.

Also use `async (req: any, res: any)` to avoid TypeScript complaints about the custom session fields.
