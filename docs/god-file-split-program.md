# God-file split program

The repository carries 136 files of 1,000+ lines, about 222,000 lines or 38% of
the TypeScript source. This document describes the program for splitting them
and — more importantly — the safety harness that makes those splits verifiable
rather than hopeful.

Phases 0, 1 and 2 are complete. Phase 3 is in progress.

## Why a harness came first

Two facts about this repository shaped the approach:

1. **A previous split was additive, not subtractive.** `raw-stock/` has the
   right shape — an `index.ts` barrel, one `registerXRoutes(app)` per file — but
   `rawStockBalanceRoutes.ts` is a 647-byte facade delegating to
   `rawStockBalanceRoutesLegacy.ts`, which kept all 1,106 lines. Its own comment
   notes a "duplicate handler remains temporarily for compatibility but is
   unreachable". File count went up; the monolith stayed.

2. **The safety net had a specific hole.** `api-smoke.test.ts` was written to
   catch "broken imports / missing exports after file splits" — the right
   instinct — but covered 31 of ~1,800 registered routes.

So the first work was not splitting anything. It was making a split provable.

## Phase 0 — the harness

### 0.1 Route manifest (`config/route-manifest.json`)

An ordered snapshot of every registered Express route: method, path, and guard
chain, plus every middleware mount. **1,787 routes, 72 mounts.**

It protects the three things a split must preserve:

- the route still exists,
- its guard chain is unchanged — a dropped `requireAuth` is an authorization
  hole that no type-check or lint rule would catch,
- its registration order is unchanged — Express resolves first-match, so
  reordering silently changes which handler wins for overlapping paths like
  `/api/factory/bales/daily-summary` versus `/api/factory/bales/:id`.

A behaviour-preserving split produces **no diff** to this file. Route membership
changes and reordering are reported separately, because losing a route and
reshuffling two registrations are very different failures.

```bash
# after an intentional route change only
UPDATE_ROUTE_MANIFEST=1 npm run test:backend -- route-manifest
```

Regenerating during a pure file split defeats the purpose.

### 0.2 API smoke sweep (`tests/api-smoke-sweep.test.ts`)

Calls **380 parameterless `GET /api/...` endpoints across 186 route groups** as
an authenticated admin and requires a non-5xx response.

This is complementary to the manifest, not redundant with it. The manifest
proves a route is *registered*; it cannot prove the handler still *works*. A
helper that moved without being re-exported, or a circular import resolving to
`undefined` at call time, registers fine and throws only when executed.

Mutating, long-running, and file-generating endpoints are excluded — the
exclusion list is deliberately narrow. Endpoints that fail under test seed data
are recorded in `config/api-smoke-baseline.json` — 2 today, both dependent on
state the test harness does not create (`GET /api/sessions` reads the
`connect-pg-simple` session table). Stale entries are reported, not asserted:
whether a baselined endpoint fails varies by environment, so failing the build
on it would buy no safety.

Each request has a 15s deadline, because a handler that throws without
responding would otherwise hang CI rather than fail it.

The sweep runs as its own Vitest invocation (`npm run test:smoke-sweep`, wired
into CI as a separate step) so that "an endpoint stopped responding" stays a
distinct signal rather than one red line inside a two-thousand-test run.

### 0.3 Source-text assertion triage (`config/source-text-assertion-baseline.json`)

69 tests read source files. The audit separates two kinds:

- **8 structural guards** deliberately assert repository shape (a retired file
  stays deleted, a composition root contains no route handlers). Code motion is
  exactly what they exist to constrain, so they are correct as written.
- **61 source-coupled tests** assert literal code substrings as a proxy for
  behaviour — 713 such assertions. They fail when code moves even though
  behaviour is unchanged, which trains reviewers to ignore red builds.

The audit's exact and actionable output is the reverse index: **4 god files are
pinned by source-coupled tests** and must have those tests rewritten before they
are split.

| Lines | File | Pinned by |
|---|---|---|
| 2479 | `client/src/pages/factory/production-raw-stock/RawStockRecalculate.tsx` | `factory-historical-replay-typed-confirmation` |
| 2174 | `client/src/pages/factory/FactoryWorkers.tsx` | `frontend-layout` |
| 1976 | `server/chatService.ts` | `phase6-chat-report-domains` |
| 1701 | `client/src/pages/vouchers/JournalForm.tsx` | `frontend-layout` |

```bash
npm run audit:source-text-assertions
```

Classification is heuristic — a test reading source files that also asserts on
parsed JSON can be reported as source-coupled. The reverse index is exact.

### 0.4 Size ratchet (`config/god-file-boundaries.json`, v16)

Extends the existing boundary system rather than adding a competing ESLint rule.

Previously `excludeFiles` exempted the 8 largest files from all size limits, so
they could grow without bound. Now:

- **162 files** over the 900-line repository limit are frozen in
  `repositoryScan.grandfathered` at their current size, rounded up to the next
  25 lines. They may shrink freely; growing one fails.
- Only genuinely vendored code (`components/ui/sidebar.tsx`) is exempt.
- Any *new* file crossing 900 lines fails until it is split or explicitly
  baselined.
- `grandfatheredExcessLines` — **102,337** — is the backlog as a single number,
  asserted as a falling ceiling.

```bash
npm run audit:god-files
```

## Working rules for every split

1. **The original file must not exist when the change merges.** No facade plus
   `*Legacy`. If it cannot be finished, do not start it.
2. **Route order is preserved exactly.** The manifest is an ordered list.
3. **No duplicate handlers "kept for compatibility."** Delete them.
4. **Lower the baselines in the same change.** Shrinking a file without lowering
   its `grandfathered` cap leaves headroom that will silently refill.

## Remaining phases

| Phase | Scope | Notes |
|---|---|---|
| 1 | ~~`server/startupSchema.ts`~~ | **Done.** Split into ten parts under `server/startup-schema/`, largest 772 lines. Order preserved and proven by a sha256 pin of the assembled array in `tests/startup-schema-integrity.test.ts`. |
| 2 | ~~Delete before splitting~~ | **Done, and the premise was wrong** — see below. No file was deletable; three dead *handlers* (349 lines) were removed instead. |
| 3 | Route monoliths (~71 files) | **In progress.** Split by URL prefix into a directory with an `index.ts` barrel. `gitRoutes.ts` (1,969) and `spMigrationRoutes.ts` (2,349) done. |
| 4 | Page components (~63 files) | Extract types, then pure helpers, then sub-components, then hooks — strictly safest first. |
| 5 | `shared/schema/*.ts` | Highest blast radius, lowest urgency. Barrel must preserve every export name. |
| 6 | Tighten the ratchet | Lower `softMaxLines` as the backlog empties. |

Phase 1 removed 4,312 lines from the backlog and Phase 2 a further 349; it now
stands at 161 files and 98,565 excess lines.

Phases 3 and 4 touch disjoint trees and can run in parallel.

## Phase 2 — what the evidence actually showed

The plan assumed ~10,300 lines across seven `*Legacy` / dead-version files could
simply be deleted. Checking each one against the router and the route manifest
showed that **none of them were dead**:

- `AnalyticsLegacy.tsx`, `AccountsLegacy.tsx`, `SalesReportLegacy.tsx` are each
  rendered unconditionally by a same-named wrapper that exists only to inject a
  compatibility shim. They are the live implementation; the name misleads.
- `FactoryStockAllocationV3.tsx` still has a live route,
  `/factory/stock-allocation-v3`.
- The three server `*Legacy` route modules are all registered, and each supplies
  the majority of the live handlers for its area. They run *last* in their
  composition group, so only paths that an earlier sibling also registers are
  shadowed.

Measured per module, that was 1 shadowed route of 8, 3 of 19, and 0 of 10. Of
those four, one — `POST /api/factory/raw-stock/recalc/undo` — turned out to be
live after all: the V4 handler registered before it calls `next()` on purpose to
fall through, and says so in a comment.

So the real dead code was three handlers, not seven files: the legacy
`assign-to-bales`, `recalc/historical-replay`, and
`recalc/historical-replay/apply`. Removing them and their orphaned imports took
out 349 lines. All three endpoints still resolve, served by the newer modules
registered ahead of them — the manifest reported exactly three removed
registrations, no additions and no reordering.

The durable outcome is the ratchet: `MAX_SHADOWED_REGISTRATIONS` in
`tests/route-manifest.test.ts` pins the number of registrations shadowed by an
earlier identical method+path at 142, down from 145. It can fall but not rise.

The lesson generalises to the remaining phases: a file named `*Legacy` in this
repository usually means "the original implementation, still in use", not "dead
code". Those lines have to be split, not deleted.

## Phase 3 — the recipe, as applied to `gitRoutes.ts`

`server/routes/gitRoutes.ts` (1,969 lines, 27 endpoints) became
`server/routes/git/`:

| File | Lines | Contents |
|---|---|---|
| `_helpers.ts` | 484 | Module state, multer config, types, `fifoAllocate`, `buildAgentsForCompany` |
| `gitReportRoutes.ts` | 334 | Agent/duty balances, container lists, summaries, at-port, truck location |
| `gitImportRoutes.ts` | 680 | Excel templates, bulk import, undo |
| `gitWhatsappRoutes.ts` | 244 | WhatsApp group settings and sends |
| `gitAgentRoutes.ts` | 278 | Agent notes, adjustments, prepaid |
| `index.ts` | 19 | Composition, in the original registration order |

What made it verifiable:

- **The route manifest did not change at all** — not one route, guard chain, or
  position. That is the proof the split preserved behaviour, and it is worth
  more than any amount of reading the diff.
- `importUndoStore` is module-level mutable state shared by the import and undo
  endpoints, so it lives in `_helpers.ts` and is imported. A copy per module
  would have silently broken undo.
- Relative import depth changes by one level for every moved line, including
  inside dynamic `await import()` calls in route bodies.
- Cut points must be checked against the source: the first attempt sliced into
  the middle of a JSDoc block because the registration function started two
  lines earlier than assumed. `tsc` caught it immediately.
- The original had zero unused-import warnings; the split initially introduced
  several, because a symbol that is genuinely used somewhere in a 2,000-line
  file is usually not used in every 300-line piece of it. Trim per module until
  lint is clean again.

`spMigrationRoutes.ts` (2,349 lines, 19 endpoints) followed the same recipe and
became `server/routes/sp-migration/` in five modules plus `_helpers.ts`. One
extra wrinkle: `ensureTargetLocation` was defined *inside* the registration
function, so it had to be hoisted into `_helpers.ts` before the endpoints that
use it could move. Nested declarations are worth grepping for before choosing
cut points — `^  (const|function|async function)` inside the register body finds
them.

## A note on scope

Of the 136 files over 1,000 lines, the 76 in the 1,000–1,499 band are mostly
large but coherent — a 1,200-line route module with 15 related endpoints is a
module, not a god file. Splitting those is churn with real regression risk and
little gain. The 60 files at 1,500+ lines, plus the Phase 2 deletions, address
~135,000 lines and cover every genuine god file.

## Observations recorded while building the harness

These were surfaced by the harness and are not yet acted on:

- **131 method+path combinations are registered more than once** (145 shadowed
  registrations). Some are deliberate interceptor chains that call `next()`;
  others are the dead duplicates noted in the code's own comments. The manifest
  makes them enumerable.
- **`GET /api/production-bales/next-barcode` writes** — it allocates a
  `bale_sequences` row on read. Found because test cleanup began failing on a
  foreign key after a read-only sweep.
- **A `GET` endpoint persists `equity_adjustment_<companyId>` rows** into the
  global `system_settings` table, so a read-only pass leaves state behind.
- **The backend suite was non-deterministic — now fixed.** Two runs of identical
  code produced 8 and then 14 failures. `resolveParentCompanyId()` throws when
  the `parentCompanyId` setting is unset and more than one ERP company exists,
  and companies default to `companyType: "erp"`, so any suite that created a
  second company broke every endpoint reading supplier balances. Test files were
  also running in parallel against one shared database, so suites observed each
  other's fixtures. Both are fixed: `seedTestData` pins the setting, and
  `fileParallelism: false` serialises the files. The suite now produces
  byte-identical results across runs, at 378s instead of 165s — a cost worth
  paying, since a suite that fails randomly cannot certify a refactor.
