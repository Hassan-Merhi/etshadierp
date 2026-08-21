# God-file split program

The repository carried 136 files of 1,000+ lines when this started — about
222,000 lines, or 38% of the TypeScript source. This document describes the
program for splitting them and, more importantly, the safety harness that makes
those splits verifiable rather than hopeful.

Phases 0, 1 and 2 are complete. Phases 3 and 4 are in progress; 3b and 5 have
not been started.

**Backlog: 8 files, 7,557 lines over the limit** (from 162 and 102,337).
`npm run audit:god-files` prints the current figure; the ceiling is asserted in
`tests/god-file-boundaries.test.ts` and is lowered with each split. This line is
bound to the audit in `config/doc-index.json`, so it now fails the build instead
of going stale — it previously read "139 files, 74,858", and a later section
"82 files and 45,684", while the real figure was neither.

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

82 tests read source files. The audit separates two kinds:

- **14 structural guards** deliberately assert repository shape (a retired file
  stays deleted, a composition root contains no route handlers). Code motion is
  exactly what they exist to constrain, so they are correct as written.
- **68 source-coupled tests** assert literal code substrings as a proxy for
  behaviour — 893 such assertions. They fail when code moves even though
  behaviour is unchanged, which trains reviewers to ignore red builds.

The audit's exact and actionable output is the reverse index: **4 god files are
pinned by source-coupled tests** and must have those tests rewritten before they
are split.

| Lines | File | Pinned by |
|---|---|---|
| 1976 | `server/chatService.ts` | `phase6-chat-report-domains` |
| 1906 | `client/src/pages/factory/FactoryContainerLoadingScan.tsx` | `ui/bandwidth-phase-1-page-polling` |
| 1626 | `client/src/pages/vouchers/JournalForm.tsx` | `frontend-layout` |
| 1133 | `client/src/pages/ContainerLoadingScan.tsx` | `ui/bandwidth-phase-1-page-polling` |

```bash
npm run audit:source-text-assertions
```

Classification is heuristic — a test reading source files that also asserts on
parsed JSON can be reported as source-coupled. The reverse index is exact.

### 0.4 Size ratchet (`config/god-file-boundaries.json`, v18)

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
| 1 | ~~`server/startupSchema.ts`~~ | **Done.** Ten parts under `server/startup-schema/`, largest 772 lines. Order proven by a sha256 pin in `tests/startup-schema-integrity.test.ts`. |
| 2 | ~~Delete before splitting~~ | **Done, and the premise was wrong** — see below. No file was deletable; three dead *handlers* (349 lines) were removed instead. |
| 3 | Route monoliths | **Nearly done — 6 files and 4,050 lines remain.** Every file whose bulk is a *run of endpoints* has been split. What is left is six files whose bulk is a single handler; see "Where Phase 3 stops" below. |
| 3b | Services, storage, `server/index.ts` | **Not started** — 16 files, 7,227 lines. Not routes, so the manifest does not cover them. |
| 4 | Page components | **Stalled by design — 54 files, 31,109 lines.** Every compiler-verifiable seam has been taken; the rest is component-boundary design. |
| 5 | `shared/schema/*.ts` | **Not started** — 2 files, 3,622 lines. Highest blast radius, lowest urgency. Barrel must preserve every export name. |
| 6 | Tighten the ratchet | Lower `softMaxLines` as the backlog empties. |
| — | Oversized test files | **Done.** The four oversized integration/export suites were split into focused isolated files; every resulting test file is now at or below the 900-line repository limit. |

The backlog started at **162 files and 102,337 excess lines**. It now stands at
63 files and 33,982 — 67% cleared. (Both figures in this paragraph were stale
until `npm run audit:doc-index` began asserting the one in the header.)

### Where Phase 3 stops

The route splits were safe because `config/route-manifest.json` is regenerated
and compared byte for byte after every one: same methods, same paths, same guard
chains, same registration order. That is a real proof, and it is why 60 files
could be split quickly and without incident.

Six route files remain, and the manifest cannot carry them:

| File | Lines | Endpoints | Largest handler |
|---|---|---|---|
| `factory/employee-pos/employeeNetPositionRoutes.ts` | 1,755 | 1 | 1,623 |
| `factory/raw-stock/rawStockOffloadRoutes.ts` | 1,496 | 2 | 972 |
| `containers/containerFreightWriteRoutes.ts` | 1,380 | 3 | 1,156 |
| `netProfitExcelRoute.ts` | 1,131 | 1 | 1,007 |
| `stats/statsNetProfitRoutes.ts` | 1,104 | 1 | 993 |
| `factory/suppliers/supplierStatementRoutes.ts` | 1,053 | 1 | 925 |

In each, the file *is* one handler. Reducing them means extracting logic from
inside that handler, and the manifest says nothing about whether extracted logic
still computes the same numbers — it only proves the route is still registered.
Only tests can carry that, and the coverage is thin exactly where the risk is
highest:

- `GET /api/reports/net-profit-excel`, `GET /api/factory/suppliers/:id/statement`
  and `PATCH /api/purchase-orders/:id` have **no test referencing them at all**.
- The parameterless GETs among them are reached by the smoke sweep, but the
  sweep asserts only "does not return 5xx" — not that the figures are unchanged.

These are net-profit, supplier-statement and purchase-order handlers: a silent
arithmetic change is the worst failure mode this codebase has. So the next step
is **characterization tests first** — pin each endpoint's current response for a
seeded fixture, then extract against that pin, exactly as Phase 0 pinned the
route manifest before any route was touched. Splitting them without that pin
trades a readability win for an unverifiable risk to money figures, which is a
bad trade.

Phases 3b and 4 touch disjoint trees and can run in parallel.



### Where to go next

**Phase 3 is the best remaining value.** It is the largest block of lines, the
recipe is proven twice, and the route manifest verifies each split byte for
byte, so there are no design decisions to make. The factory cluster is most of
it: `factoryBalesRoutes.ts` (3,437) and `factoryDocsUsersRoutes.ts` (3,375)
alone are 5,000 lines over the limit.

**Phase 4's remainder is not mechanical, and that is the important caveat.**
Every compiler-verifiable seam in the client tree has been taken. What is left
in those 54 files is a single component with one very large JSX return.
Reducing them means deciding where component boundaries belong in a screen and
threading twenty or thirty pieces of state through each new boundary — design
work that neither the type-checker nor the render tests can confirm is right.
`AnalyticsLegacy.tsx` (2,695) is the clearest example: it contains no dialogs,
sheets or other self-contained blocks at all.

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

## Phase 4 — the recipe, as applied to `FactoryDaybook.tsx`

There is no route manifest for React, so the safety net has to be built per
page. The order of operations matters more here than on the server.

**A render smoke test goes in first, before any code moves.** `FactoryDaybook`
had zero tests; a case was added to `tests/ui/renders.test.tsx` and confirmed
green against the untouched 3,228-line file. Only then was anything extracted.
Without that, a passing test after the split proves nothing.

Then, strictly safest first:

| Step | Output | Lines | Why this order |
|---|---|---|---|
| 1. Types | `daybook/types.ts` | 52 | Type-only moves cannot change runtime behaviour |
| 2. Pure helpers | `daybook/daybookUtils.ts` | 239 | No React, no I/O — and now unit-testable |
| 3. Storage helpers | `daybook/daybookUiState.ts` | 25 | Small, isolated, no rendering |
| 4. Sub-component | `daybook/ViewEntryModal.tsx` | 766 | The single largest block |
| 5. Sub-sub-components | `daybook/entry-views/*.tsx` | 180–267 | Four per-transaction-type detail views |

`FactoryDaybook.tsx` itself went 3,228 → 1,489 and stays at its original path,
so the lazy import in `lazyPages.ts` and the preload in `offlinePrep.ts` did not
have to change.

Two things worth carrying forward:

- **Extracting helpers is what makes them testable.** `expandBaleEntries` could
  not be exercised without mounting the whole page; it now has direct unit
  tests. The frontend suite went from 147 to 165 tests as a side effect of the
  split, not as separate work.
- **Do not stop at the first extraction if it leaves a new oversized file.**
  Pulling `ViewEntryModal` out produced a 1,483-line file, which the size
  ratchet immediately rejected as a new file over the limit. That was the
  ratchet doing its job. Rather than baseline it, the four largest
  `if (isSomeTxType) { ... return (...) }` branches were extracted into
  `entry-views/`, taking the modal to 766. Those branches declared no hooks, so
  each was a straight move behind a props boundary.

### Scaling that recipe, and where it stops

Doing sixty more pages by hand was not realistic, so two throwaway tools were
written (they live outside the repo, in the session scratchpad — the value is in
what they taught, not in keeping them):

- a **top-level extractor** that moves whole declarations — types, pure helpers,
  context, named sub-components — and rewires the import graph;
- a **JSX-block extractor** that lifts a self-contained `<Dialog>` or `<Sheet>`
  into its own component and discovers the props it needs by asking `tsc` which
  names it cannot find, rather than guessing.

Both were run across the client tree. Between them they moved roughly 22,000
lines, and twenty files dropped under the limit outright — `FactoryImport`
1,403 → 51, `FactoryAdvancesTab` 2,760 → 61, `AccountingCreate` 1,173 → 115,
`PropertyRentalPage` 3,355 → 610.

Every bug either tool had surfaced as a compiler error, never as silently wrong
code. Worth knowing if similar tooling is written again:

- a leading-comment scan that started one line early captured the previous
  declaration's closing brace;
- a generated module imported the symbols it defined itself;
- `async function` declarations were invisible to the scanner, so their bodies
  were swallowed by the preceding declaration;
- `import * as NS` bound the name as `"as NS"`;
- relative specifiers must be **resolved** against the new file's directory, not
  adjusted by a guessed nesting depth;
- an interface declared *inside* a component gets reported as a missing name and
  will be passed as a prop unless type names are filtered out;
- typing props as `any` destroys inference inside callbacks, so `Array.from(set)`
  degrades to `unknown[]`;
- an import trimmer must anchor on word boundaries, or removing an unused `X`
  will match the `X` inside `UserX`.

**Two process mistakes are worth repeating out loud.** Running Prettier across
the touched pages rewrote files that had never been formatted, adding 294 lines
of pure noise to `AccountsLegacy.tsx` and pushing two files past their caps with
nothing actually added; that batch was reverted and redone formatting only
generated files. And extracting `FactoryAdvancesTab`'s bulk into a single
2,147-line `AdvancesView` **relocated** a god file rather than splitting one — it
was baselined explicitly rather than hidden, and cleared in a later pass by
extracting its nine dialogs.

**Where this stops.** The mechanical seams in the client tree are now exhausted.
The 54 files that remain are each a single component with one large JSX return;
what is left is deciding where component boundaries belong and threading state
across them. That is design work, and neither `tsc` nor a render smoke test can
confirm it was done correctly — which is precisely why it was not attempted
blind.

## A note on scope

Not every file over the limit is worth splitting. A 1,200-line route module with
fifteen related endpoints is a module, not a god file, and breaking it up is
churn with real regression risk and little gain. The recommendation is to target
files at **1,500 lines and above** and leave the 900–1,499 band alone — the size
ratchet already stops those growing, which is most of the benefit.

Judged that way the remaining work is considerably smaller than the raw 139-file
count suggests, and it is concentrated in Phase 3, where the route manifest makes
each split provable.

## Observations recorded while building the harness

These were surfaced by the harness and are not yet acted on:

- **130 method+path combinations are registered more than once** (142 shadowed
  registrations, down from 145 after Phase 2). Some are deliberate interceptor
  chains that call `next()`; others are dead duplicates. The manifest makes them
  enumerable, and `MAX_SHADOWED_REGISTRATIONS` in `tests/route-manifest.test.ts`
  stops the number rising.
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
- **CI on `main` was red before this work started, and is now green.** Seven
  backend tests failed deterministically, plus the frontend coverage gate. Five
  were one fixture bug (`factory_mix_batches.total_weight_kg` and `total_cost`
  are NOT NULL with no default, and were omitted). One asserted a state the
  schema forbids and the app cannot produce. One encoded a genuine contradiction
  between two startup migrations, described below. Coverage was lifted past its
  thresholds rather than the thresholds lowered.

- **One open money question, deliberately not decided.** Two migrations disagree
  about `factory_mix_batches.cost_per_kg`: a July 2026 batch raises it to
  `NUMERIC(20,7)` to stop rounding compounding on 20,000 kg batches, and a later
  batch in the same array standardises Factory per-KG columns to `NUMERIC(20,6)`
  and rounds it back down. The later one wins, and `shared/schema/factory.ts`
  agrees with it, so 6 is what the tests now assert. But the sibling columns
  `factory_mix_batch_sources.cost_per_kg` and `factory_bales.cost_per_kg` are
  both still scale 7 — batch cost is aggregated from 7dp inputs and stored at
  6dp. Whether that is correct is a decision for someone who owns the numbers.

The backend suite is now the signal it should be: 1,967 passing, zero failures,
byte-identical across runs. A successor can trust a red build again.
