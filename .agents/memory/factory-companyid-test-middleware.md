---
name: /api/factory test-session company resolution
description: why supertest requests to /api/factory/* 404 on a freshly seeded test company even after selecting it
---

`/api/factory/*` routes are gated by middleware (`registerFactoryRoutes` in `server/routes/factoryRoutes.ts`) that pins
`req.session.factoryCompanyId` on the first factory request of a session. It only recognizes companies with
`companyType` `"factory"`/`"factory_v2"`; if the currently-selected company doesn't have that type, it silently falls
back to *some other* active factory-type company already in the DB and pins that instead — so all subsequent
`factoryCompanyId || currentCompanyId` lookups in factory routes use the wrong company, and container/data lookups
404 even though `set-company` succeeded.

**Why:** `seedTestData()` creates companies with no `companyType` set, so any `/api/factory` test hits this fallback.

**How to apply:** before making any `/api/factory/*` request against a seeded test company, run
`db.update(schema.companies).set({ companyType: "factory" }).where(eq(schema.companies.id, ctx.companyId))` first.
