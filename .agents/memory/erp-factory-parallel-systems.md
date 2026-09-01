---
name: ERP vs factory are parallel mirrored systems
description: This codebase maintains two separate, hand-mirrored implementations per company type (erp vs factory) for several modules — schema tables, services, routes, and UI. Read before implementing any cross-cutting feature.
---

## The pattern

For at least the container/OTW tracking module, the codebase does not share one
implementation across company types. Instead there are two fully parallel trees:

- ERP: `containers` table, `containerTrackingService.ts`, `server/routes/containerRoutes.ts`,
  `client/src/pages/containers/*` (e.g. `Containers.tsx`, `ContainerToolbar.tsx`).
- Factory: `factory_containers` table (Drizzle `factoryContainers` in `shared/schema/factory.ts`),
  `factoryContainerTrackingService.ts` (explicit mirror, says so in its own header comment),
  `server/routes/factory/factoryContainerTrackingRoutes.ts` and `factoryContainersRoutes.ts`,
  `client/src/pages/factory/FactoryContainers.tsx` / `FactoryOtwTrackingTab.tsx`.

Routing to one tree vs the other happens at the top of the app
(`AuthenticatedApp.tsx` picks `FactoryShell` vs `ErpRoutes` based on `isFactoryCompany`);
a factory-type company never reaches the ERP component tree at all, so flags like
`isFactory` inside the ERP components are dead code for that path.

Known field-shape differences between the two trees for the same concept:
factory containers use `arrivalDate` as their ETA field (not `eta`), and have no
`etaSource` column — a mirrored write only sets the date, no source tag.

**Why:** the codebase's established convention is literal duplicated files per
company type rather than a shared/generic core — this was a deliberate choice for
time/risk reasons on past features (e.g. JSONCargo ETA tracking), matching the
pattern already set by `factoryContainerTrackingService.ts` itself.

**How to apply:** before answering "does X work for company type Y" or before
implementing any cross-cutting feature request (tracking, exports, imports, POS,
etc.), grep for the module name under both `containers`/`containerTracking...`-style
paths AND `factory*`-prefixed paths. Assume a feature that "already works" only
covers the tree you found it in — verify the other company type's tree explicitly
before declaring the feature complete. When implementing new cross-cutting work,
default to mirroring the existing file into the other tree (adjusting field-shape
differences) rather than trying to generalize both into one shared core.
