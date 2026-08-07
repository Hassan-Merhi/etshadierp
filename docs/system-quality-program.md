# System quality program

A phased program for the four quality gaps that the god-file split program does
not cover: **type-safety erosion**, **test breadth**, **documentation state**,
and **configuration coherence**.

It is written to the same rule as `docs/god-file-split-program.md`: a harness
that makes progress measurable comes before any cleanup, because a cleanup with
no ratchet behind it refills silently.

**Phases 0 through 4 are complete.** Phase 5 (tightening the ratchets) is
ongoing by nature, and two drawdowns are deliberately left running rather than
finished: type escapes (Phase 1d) and the untested write surface (Phase 2c).
Both have a frozen ceiling, so untouched code cannot get worse while they fall.

## Where things stand

Measured on `main` at the time of writing. Every figure has a command beside it
so it can be re-derived rather than trusted.

| Signal | Now | Command |
|---|---|---|
| Type escapes (AST) | 11,466 total — 8,671 `: any`, 2,793 `as any`, 2 suppressions | `npm run audit:type-escapes` |
| Files carrying escapes | 1,328 of 2,524 (53%) | `npm run audit:type-escapes` |
| Drizzle result casts | 0 (was 344 — Phase 1b) | `npm run audit:type-escapes` |
| Backend coverage floor (lines) | 18% (measured 21.0%) | `config/coverage-thresholds.json` |
| Untested ledger/stock write routes | 283 of 325 | `npm run audit:write-routes` |
| Swept endpoints with a pinned contract | 397 | `npm run test:smoke-sweep` |
| Test files | 363 (330 `tests/`, 33 colocated) | `find tests server client/src shared -name '*.test.ts*'` |
| Registered routes | 1,891 | `config/route-manifest.json` |
| Docs | 48 reference in `docs/`, 131 archived records | `npm run audit:doc-index` |
| God-file backlog | 66 files, 34,833 excess lines | `npm run audit:god-files` |

Every figure above is bound to its source in `config/doc-index.json` and checked
by `npm run audit:doc-index`, so this table fails the build rather than going
stale.

Two of these deserve comment before the phases begin.

**`shared/` contains zero `any`.** The schema layer — the source of truth that
types flow from — is clean. Every `any` in the repository is therefore a place
where a type that *was* known got discarded downstream, not a place where the
type was never available. That makes the problem tractable: this is erosion, not
absence.

**The god-file backlog is much smaller than its own documentation claims.** That
doc opened with "139 files, 74,858 lines over the limit" and later said "82 files
and 45,684". The audit reports **66 and 34,833** — the program is 67% cleared,
not 45%. Three separate figures, all wrong, in a document whose entire purpose is
tracking one number. The first draft of *this* document then repeated the
mistake, citing 66 and 35,729 because those were derived from the frozen
baselines rather than from the files as they are now.

That is the whole argument for Phase 0.3 in one example: a number written by hand
is wrong the moment the code moves, and nobody notices, because nothing checks.
Every figure in the table above is now bound to its source and asserted.

## Why a harness comes first

The existing program learned two lessons the hard way, and both apply here
unchanged.

1. **A cleanup without a ratchet is additive.** `rawStockBalanceRoutes.ts`
   became a 647-byte facade over a 1,106-line legacy file. File count went up;
   the monolith stayed. A type-safety pass without a frozen count will do the
   same thing — some `any`s get removed, others get added in the same week, and
   six months later nobody can say which direction it moved.

2. **A gate that only ever describes the day it was written is worth little.**
   The backend coverage gate sat at 8% while the suite actually covered 19%.
   `audit-coverage-ratchet.mjs` exists because a floor needs a matching audit
   that reports headroom, or it silently stops meaning anything.

So Phase 0 builds measurement. Nothing is cleaned up until the cleanup is
provable.

---

## Phase 0 — measurement

Three audits, each following the shape already established by
`scripts/audit-god-file-boundaries.mjs`: a JSON baseline in `config/`, an audit
script in `scripts/`, an assertion in `tests/`, and an npm script.

### 0.1 Type-escape census (`config/type-escape-boundaries.json`)

`scripts/audit-type-escapes.mjs` counts type escapes per file and compares
against a frozen baseline.

Counted separately, because they are different problems:

- **`: any` annotations** (6,388) — a declared type that says nothing. Usually
  fixable locally, often mechanically.
- **`as any` casts** (3,115) — an assertion that overrides a type the compiler
  *had*. Higher risk: each one is a place where the schema's guarantee was
  explicitly discarded, and the fix is rarely local.
- **`@ts-ignore` / `@ts-expect-error`** (2) — already effectively zero. Assert
  it stays there.

Baseline semantics match the god-file ratchet exactly: per-file counts frozen at
current value, may fall freely, **any increase fails**. A new file with an escape
fails until it is fixed or explicitly baselined. `typeEscapeTotal` is the backlog
as one number, asserted as a falling ceiling.

```bash
npm run audit:type-escapes
```

The audit reports two extras that make the phases below schedulable: the
distribution by directory (server 7,845 against client 3,969), and the reverse
index of **files where an `as any` sits on a value that came from a Drizzle
query** — 344 of them when the census was taken, the ones actively discarding
schema types. They clustered hard: the ten worst files held 158 of the 344, most
under `server/routes/sp/`. Phase 1b took them to zero.

### 0.2 Money-endpoint characterization pins (`config/report-characterization.json`)

**This already existed.** `tests/report-endpoint-characterization.test.ts` was
written before this program and does exactly what was specified here: it seeds
an ERP and a factory fixture, calls each endpoint with a pinned client date, and
hashes the normalized response against a committed snapshot. The plan's claim
that this was the highest-value unbuilt item was wrong — it was built.

What was missing was **two of the six route files**. The suite's own header said
"the six route files whose bulk is a single handler" while its endpoint list
covered four: both *write* handlers were absent, because a mutating endpoint
cannot share a fixture with the read pins — the rows it writes move the figures
the other pins hash.

Phase 0.2 closed that gap:

- `PATCH /api/purchase-orders/:id` (`containerFreightWriteRoutes.ts`, the
  1,156-line handler the god-file program flagged as having no test referencing
  it at all) — charge totals recomputed against a seeded PO and line item.
- `POST /api/factory/raw-stock/offload` (`rawStockOffloadRoutes.ts`, 972 lines)
  — landed-cost calculation for a container receipt.

Each write endpoint gets its own seed-and-release cycle, so pins stay
independent of the order the suite runs in. Two further guards were added: the
six Phase 3 modules are now asserted against the pin list, so "six" is checked
rather than claimed, and a pin that captured a 5xx fails instead of freezing a
broken endpoint in as correct.

```bash
UPDATE_REPORT_CHARACTERIZATION=1 npm run test:backend -- report-endpoint
```

This is the same instrument as the route manifest, one level deeper: the
manifest proves a route is *registered*, the smoke sweep proves it *responds*,
the pin proves it **still computes the same numbers**.

One lesson from building it, worth keeping: the offload response carries an
`offloadedAt` set to `now()`, so its first pin was flaky. The fix was to add
that one key to the volatile list rather than strip every `*At` field — the
broad rule would also have dropped stable date fields from the other three
pins' hashes, and these hashes are the only thing standing between an
extraction and a silent change to a money figure.

### 0.3 Documentation state index (`config/doc-index.json`)

`scripts/audit-doc-index.mjs` classifies every file in `docs/` as **reference**
(describes current behaviour, must stay accurate) or **record** (describes work
that finished, correct as history). All 178 are now classified — 61 reference,
117 record — seeded by filename heuristic and reviewed in Phase 3a. An
unclassified doc fails, so the choice is made when a doc is written.

The audit cannot detect staleness in general; that is a judgment call. What it
*can* do is check the numbers, and that is the enforced half: `figures[]` binds
a documented figure to its live source — a value in a `config/*.json`, or a
field from one of the audits — and a doc that drifts fails the build. Seven
claims are bound today, across the two program documents.

The first thing it caught was the drift it was written for. It also found that
both programs cited **1,787** registered routes while `config/route-manifest.json`
says **1,871**.

```bash
npm run audit:doc-index
```

**Exit criteria for Phase 0:** met. Three audits green in CI, three baselines
committed, and the response pins extended from four route files to six. No
production source file was changed — the only edits outside `config/`,
`scripts/` and `tests/` are the corrected figures in the two program docs.

---

## Phase 1 — type-safety ratchet

Depends on 0.1. **1a, 1b and 1c are done; 1d is ongoing by design.**

The goal was never zero. It is **a number that only falls**, and a rule that
stops the schema's guarantees being discarded in new code.

**1a. Freeze and enable — done.** `@typescript-eslint/no-explicit-any` is on as
a warning, so `any` is visible in the editor as it is written. The rule is the
feedback loop, not the gate: enforcement stays with the per-file ratchet in
`config/type-escape-boundaries.json`, which is exact and fails CI when a single
file gains an escape. A warning cannot do that.

`npm run lint` now carries `--max-warnings`, frozen at the current total. It is
a coarse ratchet — a warning removed here offsets one added there — but it
covers the ~870 warnings (mostly `react-hooks/exhaustive-deps` and unused vars)
that had no gate of any kind.

The plan also called for turning `no-unused-vars` back on. That was wrong:
`unused-imports/no-unused-vars` already replaces it, and the plugin requires the
base rule disabled to avoid double-reporting. The existing setup was correct.

**1b. Drizzle result casts — done, 344 → 0.** `server/lib/queryResult.ts` adds
`resultRows<TRow>()` / `firstRow<TRow>()`, which return the rows without the
`any` and let a caller name its columns. Both tolerate a result that is itself
an array, because older drizzle releases resolved `execute()` to the rows
directly and many call sites still carried a defensive fallback for it —
preserving that is what makes the replacement behaviour-preserving.

The conversion was a codemod with one rule per expression shape, each chosen to
keep runtime behaviour identical (`.rows?.[0]` became `firstRow(x)`, but
`.rows[0]` became `resultRows(x)[0]`, so an absent row still throws where it
threw before). 260 of the 344 sites compiled untouched; the remaining 84 were
type errors, and **that was the point** — each one was a column value flowing
into a typed slot with nothing checking it. They were fixed by declaring the
query's row shape at the call site, which is the durable artifact: the shape of
a raw SQL result is now written down next to the SQL.

Total escapes fell 11,814 → 11,408. The drop is smaller than 344 because
declaring row types removed some `any`s and the codemod also deleted dead
`?? (x as unknown as any[])` fallbacks that had been unreachable.

**1c. Per-file disable lists — done for 10 of 14.** 39 unused imports removed;
four of the fourteen exemptions were stale (those files had no unused imports at
all).

Four files could not be touched, and the reason generalises to every future PR:
**CI format-checks each changed file, and Prettier reflow pushes each of these
past a size gate.** `FactoryBaleProductHistory` goes 849 → 915 and becomes a new
god file; `FactoryPayrollTab` 1573 → 1610 against a frozen 1575;
`DailyProductionReport` 1328 → 1366 against 1350; `workerStatsAdvancesRoutes`
921 → 928 against 922. Deleting one unused import from any of them fails either
the format gate or the size gate, so they are effectively unmodifiable until
they are split.

Raising a frozen baseline to absorb formatting churn would leave headroom that
silently refills — working rule 4 of the god-file program exists to prevent
exactly that — so the exemption was kept, narrowed to those four, and annotated
in `eslint.config.js` with the numbers and what unblocks it. **This is now the
strongest argument for that program's Phase 4:** the size backlog is not just a
readability debt, it is a set of files nobody can edit.

**1d. Drawdown by ownership — ongoing.** The remaining ~11,400 escapes are
worked per domain alongside whatever else touches that domain. No dedicated
sweep: a mechanical pass at that scale produces an unreviewable diff, and the
ratchet means untouched code is no longer getting worse.

**Exit criteria:** lint rules on ✓, `eslint.config.js` exemptions cleared except
the four blocked by file size ✓, baseline falling ✓ (11,814 → 11,408 in this
change). The "falling for three consecutive months" criterion is calendar-bound
and cannot be closed by a single change; the ratchet is what makes it hold.

---

## Phase 2 — coverage breadth

Depends on 0.2. **2a, 2b and 2c are done. The 35–40% target in the original
plan was wrong and is corrected below.**

Per-file floors were already right: 63–97% on the posting engines, inventory
costing, and tenant isolation. That allocation is correct and this phase did not
touch it.

**2a. Floors raised to measured — done.** Backend measured 21.0% lines, and the
floors were sitting at 17/16/22/11. They are now 18/17/23/12, using the margin
rule the config already documents (10% of measured, capped at 2 points).
Frontend measured 7.5% lines against floors of 5/4/2/3, now 6/6/3/4, plus two
per-file floors on `frontendDataArchitecture.ts` that had drifted 8 and 15
points below measured.

**The plan's exit criterion of "global backend floor ≥35%" was written without
measuring first, and it is not reachable by raising a floor: measured coverage
is 21.0%.** Setting the gate to 35% would fail CI on the first run. Getting
there needs several hundred new tests, which is 2c's work, not 2a's — so the
criterion is corrected to "floors track measured coverage, and measured coverage
rises".

The first measurement of that number carried a caveat, and the caveat turned out
to be the whole story. It was taken in an environment where 15 endpoints 5xx'd
and 64 tests failed — all because `drizzle-kit push` creates the Drizzle schema
but not the tables the *runtime* startup migrations add, and the local database
had never had those migrations run against it. Applying them turned a suite that
had failed 64 tests for four phases into **306 files and 2,463 tests passing,
zero failures**, and lifted `server/inventoryHelper.ts` from 60% back over its
95% per-file floor.

The lesson is worth keeping: every "known environmental failure" in this program
was one missing setup step, and treating it as background noise for that long
meant every verification ran against a lower bound. Coverage is now measured
against a database that matches CI, so the floors track reality rather than a
floor on reality.

**2b. The sweep asserts a contract, not just liveness — done.** It called 401
parameterless GETs and checked only for a non-5xx. It now also records each
route's status and response *structure* in `config/api-smoke-shapes.json` and
fails when either changes. 397 routes are pinned.

Scalar leaves collapse to `scalar` and an empty array matches a populated one,
deliberately: a nullable column that is null in one run and a string in the next
would otherwise fail for no reason, and a check that cries wolf gets regenerated
without being read. Key sets, nesting, and object-versus-array stay exact.

This was worth doing for one number: **169 of the 401 swept endpoints answer
403** under the sweep's admin fixture. The old check could not see any of them
change. A route that silently starts refusing permission, or quietly drops a
field, breaks a client exactly as thoroughly as a crash.

Two rules keep the baseline honest across machines. Routes that 5xx are never
pinned — freezing one environment's missing table into a contract would fail
every other environment — and two workbook endpoints are marked unstable
because their bodies parse into an object keyed by byte offset that shifts with
the zip's timestamps. Verified stable across three consecutive runs.

```bash
UPDATE_API_SMOKE_SHAPES=1 npm run test:smoke-sweep
```

**2c. The write surface is measured and ratcheted — done; closing it is
ongoing.** The sweep excludes mutating endpoints by design, so nothing measured
them at all. `npm run audit:write-routes` now does:

> **953 write routes. 324 touch the ledger or the stock ledger. 42 are
> referenced by any test. 282 are not.**

"Referenced" means a test mentions the path — deliberately weak, because a
mention is not an assertion, but exact and unarguable. The 282 is a frozen
ceiling that may only fall.

The first tests written against that list cover stock-item merge, which rewrites
`inventory` rows for two items and soft-deletes one. They assert conservation:
a merge must move quantity and value onto the kept item without creating or
destroying any.

**Writing them found a live defect.** `stock_item_merge_logs.merged_by_user_id`
is `integer NOT NULL`, but `users.id` is a varchar UUID, so every audit-log
insert fails with `invalid input syntax for type integer` — and the handler
catches it as "non-fatal, merge already committed". The merge commits, the log
row is never written, and `POST /api/stock-items/merge-logs/:logId/unmerge`,
which restores both items from that row's `snapshotBefore`, has nothing to read.
**Every stock-item merge in production is unaudited and irreversible, and
nothing surfaces it.**

That is characterized in a test rather than fixed here, because the fix alters a
column type in a live table and belongs in its own reviewed change. The test
will fail the day the type is corrected, which is the intent — the fix should
replace it with the unmerge-conservation assertions the file was written to make.

**Exit criteria:** floors track measured coverage ✓; sweep asserts shape ✓;
write surface measured and ratcheted ✓. "No vouchers/inventory write path
without a test" remains open at 282 — that is a program, not a change, and the
ratchet is what stops it growing meanwhile.

---

## Phase 3 — documentation state

Depends on 0.3. **Done.**

116 of 178 docs were phase-named. Most were records of completed work — correct
as history, misleading as reference, and indistinguishable from reference at a
glance.

**3a. Records moved to `docs/archive/` — done.** 131 documents moved; 48 remain
in `docs/` and every one of them describes current behaviour.

The filename heuristic that seeded the classification was not good enough to
act on, which is why it was only ever data for this review. It had classified
**16 records as references**, including every `program-N-*` write-up: they open
with "Program status: complete", "Baseline commit: …", or "Status: implemented
by scope; draft and unmerged", and the filenames say none of that. It also got
one wrong in the other direction — `i18n/phases-1-4-global-language-foundation.md`
is phase-named but is the *active* language foundation, linked as such from
`i18n/README.md`. Moving it would have archived a live document.

The move itself was not just `git mv`. About 30 `scripts/verify-*.mjs` files
call `fs.existsSync` and `fs.readFileSync` on these exact paths, and four
workflows pass them as CLI arguments, so 40 files needed their references
rewritten. What made it tractable was that the docs contain **zero markdown
links to each other** — cross-references are backticked paths — so no relative
link had to be recomputed. Verified afterwards by scanning every tracked file
for `docs/**.md` paths that no longer resolve: one hit, and it is a
pre-existing reference to a file that never existed in git history.

**3b. Numbers the audit flagged — done.** Fixed as they surfaced, in the phases
that surfaced them: the god-file backlog header (wrong by a factor of two in
two places), the type-escape ceiling, and the 1,787 route count both programs
cited against a manifest holding 1,871.

**3c. `docs/README.md` — done.** An index of the 48 reference documents grouped
by what a reader is trying to do, plus an explicit statement of what `archive/`
is. Linked from the root `README.md`, which previously pointed people at a
directory of 178 files with no way to tell which were current.

**3d. Recurrence stopped — done, and enforced rather than documented.** The
audit now fails when classification and location disagree: a record outside
`docs/archive/` fails, and a reference inside it fails. Phase documents are
written straight into `archive/`; the seeding heuristic treats anything filed
there as a record. Promoting one out means editing its classification in
`config/doc-index.json`, which is exactly the moment to check it is still true.

That last part is what makes this phase stick. Every previous attempt at
documentation hygiene in this repository was a convention, and conventions here
have a track record: the god-file program's own backlog figure drifted to double
the real number in a document whose entire purpose was tracking it.

**Exit criteria:** `docs/` root is reference-only ✓; doc-index audit green ✓;
the split is enforced in CI ✓.

---

## Phase 4 — configuration coherence

**Done.**

**4a. Node version — one, asserted.** Seven sources disagreed: `.node-version`
said 20.19.2, `.nvmrc` said 22, `.replit` provisioned nodejs-20, `package.json`
required >=22.0.0, the workflows mixed "22" and "22.14", CircleCI pinned
`cimg/node:22.14`, and `README.md` told a new contributor to install Node 20 —
citing `.node-version` as the authority. A fresh clone followed literally
produced an environment violating the engines constraint.

All of them now say **22.14**, anchored on CircleCI's image tag because that is
the one this repository does not control. `npm run audit:toolchain` checks all
15 sources on every CI run, so this cannot drift again — which matters more than
the fix, since nobody was going to notice by reading.

**4b. Scripts — triaged first, renamed second.** The renaming was the smaller
half. Classifying every `verify-*.mjs` and `audit-*.mjs` by whether anything
invokes it, and whether it can pass, gave:

| | passes | fails |
|---|---|---|
| **wired** (CI, package.json, CircleCI) | 26 | 12 |
| **chained** (another script or a test) | 16 | 16 |
| **orphan** (nothing invokes it) | 15 | 16 |

**Sixteen scripts were invoked by nothing and could not pass.** Before deleting
them I checked why they failed, because a "must retain server-side pagination"
assertion failing could equally mean the pagination was gone. It did not: every
one asserts literal source text that the god-file split legitimately moved.
`verify-program6c` looks for `.limit(pageSizeNum)` in `inventoryRoutes.ts`; the
pagination is alive in `inventory/inventoryRequestContext.ts` and
`stock/groups-items/items.ts`. `verify-phase9-type-safety-contracts` looks for
`removeCompanySessionQueries(queryClient)`; the call is there, with a second
argument, across a line break. Three others crash outright reading
`server/routesLegacy.ts` — a file the god-file program deliberately deleted and
asserts stays deleted.

This is the same source-coupling the god-file program documents for tests (61
tests, 713 assertions), one layer out — and worse, because nothing runs these,
so nothing ever reported it. All sixteen deleted.

`npm run audit:scripts` now enforces two rules: **a wired script must pass**,
and **the orphan count may only fall**. Five gates were already red when it was
written and are listed in `config/script-inventory.json` with reasons — most
notably `audit-i18n-phase14`, wired into four workflows, whose actionable-literal
ratchet is breached on `origin/main` itself. The list may only shrink, and a
script that starts passing has to come off it.

Ten npm scripts named after programs were renamed by subject —
`audit:program-6d` → `audit:query-risks`, `check:program-6-security` →
`check:security`, and so on — with every invoker in CI, CircleCI and the docs
updated.

**4c. Workflows — two deleted, three renamed.** `readable-logging-phase-10.yml`
and `sp-phases-9-10-release-verification.yml` triggered only on pull requests to
branches that no longer exist. They could not fire at all, which is why nobody
noticed the checks inside them had stopped running; `verify-readable-logging`
was re-homed into `ci.yml`, where it passes.

The other three were renamed to what they check: `mobile-responsive.yml`,
`rtl-accessibility.yml`, `release-verification.yml`. Two of them fire on ordinary
frontend pull requests to `main`, so their phase names were actively misleading
about what a red check meant.

**Exit criteria:** one Node version everywhere ✓, asserted in CI ✓; no phase
numbers in npm script or workflow names ✓; and the dead weight that made the
naming confusing in the first place is gone rather than renamed ✓.

---

## Phase 5 — tighten

Once the ratchets have been falling for a while, lower them: the type-escape
ceiling, the coverage floors, and `softMaxLines` in the god-file config. Same
step the existing program lists as its own Phase 6, for the same reason — a
ratchet that never tightens stops being one.

---

## Working rules

1. **Baseline in the same change.** Removing escapes without lowering the
   ceiling leaves headroom that refills. This is rule 4 of the god-file program
   and it applies verbatim.
2. **No new baseline entries without a comment** saying why the escape survives.
3. **Pins are regenerated only for intentional behaviour changes.** Regenerating
   a response pin during a refactor defeats its purpose, exactly as regenerating
   the route manifest during a split does.
4. **Phases 1–4 touch disjoint trees** and can run in parallel. Only Phase 0
   blocks.

## Phase table

| Phase | Scope | Blocked by | Size |
|---|---|---|---|
| 0.1 | Type-escape census | — | Small |
| 0.2 | Money-endpoint pins | — | Medium |
| 0.3 | Doc state index | — | Small |
| 1 | Type-safety ratchet + drawdown | 0.1 | Large |
| 2 | Coverage breadth | 0.2 | Large |
| 3 | Documentation state | 0.3 | Medium |
| 4 | Configuration coherence | — | Small |
| 5 | Tighten ratchets | 1, 2, 3 | Ongoing |

## What this program does not cover

File size. `docs/god-file-split-program.md` owns that, and its remaining phases
(3b, 4, 5) stand as written. The one dependency runs from **0.2 to that
program's Phase 3**: the six route files it stalled on are stalled precisely
because they compute money and have no behavioural pin. Phase 0.2 builds that
pin. It is the single highest-value item in this document, because it unblocks
work that is already scoped and waiting.
