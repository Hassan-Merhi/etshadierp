# Phase 1 — Legacy Route Baseline and Safety Contracts

## Scope

This phase freezes the four remaining backend compatibility registries before route migration begins:

- `server/routes/reportsRoutesLegacy.ts`
- `server/routes/authRoutesLegacy.ts`
- `server/routesLegacy.ts`
- `server/routes/customerRoutesLegacy.ts`

These files are migration boundaries, not destinations for new endpoints or business logic.

## Baseline

| File | Domain owner | Frozen maximum | Reduction target | Migration phase |
| --- | --- | ---: | ---: | ---: |
| `server/routes/reportsRoutesLegacy.ts` | Reporting | 1,628 lines | 400 lines | 2 |
| `server/routes/authRoutesLegacy.ts` | Authentication and access control | 1,537 lines | 350 lines | 3 |
| `server/routesLegacy.ts` | Accounting, vouchers, inventory and operations | 1,478 lines | 300 lines | 5 |
| `server/routes/customerRoutesLegacy.ts` | Customer accounting and operations | 1,073 lines | 300 lines | 4 |

The machine-readable source of truth is `config/legacy-route-boundaries.json`.

## Automated inventory

Run:

```bash
node scripts/audit-legacy-route-boundaries.mjs --write
```

The command scans every literal `app.*` and `router.*` registration in the four files and produces:

- `artifacts/legacy-route-inventory.json` for structured analysis
- `docs/engineering/legacy-route-inventory.md` for human review

Each inventory entry records the HTTP method, route path, source file and line number. The report also groups duplicate route signatures so route shadowing can be reviewed before deletion.

## Enforced rules

The Vitest contract in `tests/legacy-route-boundaries.test.ts` runs with the normal backend test suite and enforces these rules:

1. All four migration boundaries remain registered in the baseline until fully removed.
2. None of the four files may exceed its frozen Phase 1 line count.
3. Every file must remain readable and produce an endpoint-level inventory.
4. A file budget may only be lowered as routes move into focused modules.
5. New endpoints must be created in focused domain route modules, never in a legacy registry.

## Migration workflow

For every later extraction:

1. Move the route into a focused module.
2. Move business logic into a service or repository where appropriate.
3. Remove the old legacy registration.
4. Lower `maxLines` in `config/legacy-route-boundaries.json` in the same change.
5. Run the boundary test and regenerate the inventory.
6. Review duplicate route signatures before merging.

## Phase 1 completion criteria

- Four legacy files identified and assigned domain ownership.
- Current size ceilings frozen.
- Reduction targets recorded.
- Automated endpoint inventory available.
- Duplicate-route reporting available.
- Regression test prevents legacy-file growth.
- Migration rules documented for all later phases.
