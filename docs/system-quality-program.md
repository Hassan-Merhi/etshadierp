# System quality program

A phased program for the four quality gaps that the god-file split program does
not cover: **type-safety erosion**, **test breadth**, **documentation state**,
and **configuration coherence**.

It is written to the same rule as `docs/god-file-split-program.md`: a harness
that makes progress measurable comes before any cleanup, because a cleanup with
no ratchet behind it refills silently.

## Where things stand

Measured on `main` at the time of writing. Every figure has a command beside it
so it can be re-derived rather than trusted.

| Signal | Now | Command |
|---|---|---|
| Type escapes (AST) | 11,814 total — 8,669 `: any`, 3,143 `as any`, 2 suppressions | `npm run audit:type-escapes` |
| Files carrying escapes | 1,329 of 2,523 (53%) | `npm run audit:type-escapes` |
| Drizzle result casts | 344 | `npm run audit:type-escapes` |
| Backend coverage floor (lines) | 17% | `config/coverage-thresholds.json` |
| Test files | 363 (330 `tests/`, 33 colocated) | `find tests server client/src shared -name '*.test.ts*'` |
| Registered routes | 1,871 | `config/route-manifest.json` |
| Docs | 177 files, 116 phase-named (65%) | `npm run audit:doc-index` |
| God-file backlog | 64 files, 33,432 excess lines | `npm run audit:god-files` |

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
and 45,684". The audit reports **64 and 33,432** — the program is 67% cleared,
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
query** — 344 of them, the ones actively discarding schema types, and the
highest-value targets. They cluster hard: the ten worst files hold 158 of the
344, most under `server/routes/sp/`.

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

Depends on 0.1.

The goal is not zero. It is **a number that only falls**, and a rule that stops
the schema's guarantees being discarded in new code.

**1a. Freeze and enable.** Turn on `@typescript-eslint/no-explicit-any` as
`warn` and `no-unused-vars` back on, with the baseline absorbing every existing
violation. CI fails on new ones only. This is the whole point of the phase; the
rest is drawdown.

**1b. Drizzle result casts.** Work the 0.1 reverse index: `(result as any).rows`
appears throughout the storage and route layers, discarding a type the query
already knew. These are mechanical, high-count, and low-risk — a typed
`execute()` helper in `server/lib/` fixes them in bulk rather than one at a time.

**1c. Per-file disable lists.** `eslint.config.js` carries two blocks disabling
`unused-imports/no-unused-imports` for 14 named files. Each is a deferred
cleanup with no owner and no expiry. Clear the list; delete the blocks.

**1d. Drawdown by ownership.** Remaining escapes, worked per domain alongside
whatever else touches that domain. No dedicated sweep — a 6,000-item mechanical
pass produces an unreviewable diff, and the ratchet means untouched code is no
longer getting worse.

**Exit criteria:** lint rules on, baseline falling for three consecutive months,
`eslint.config.js` free of per-file exemptions.

---

## Phase 2 — coverage breadth

Depends on 0.2.

Per-file floors are already correct: 63–97% on the posting engines, inventory
costing, and tenant isolation — the modules where a regression costs real money.
That allocation is right and this phase does not touch it.

The gap is the long tail. A 17% global floor against 1,787 routes means most of
the surface is defended only by "does not return 5xx".

**2a. Raise the global floor to what is already true.** `audit:coverage-ratchet`
reports the headroom; the floor was written under measured coverage by design.
Lock in what the suite already covers before writing a single new test.

**2b. Extend the smoke sweep's assertion.** It currently calls 380 parameterless
`GET` endpoints and checks for non-5xx. Adding response-shape assertions — top
level keys and types, not values — turns it from a liveness check into a
contract check across a third of the API, for far less effort than per-endpoint
tests.

**2c. Close the mutating-endpoint gap.** The sweep deliberately excludes
mutating endpoints, which is correct for a sweep and leaves them uncovered.
Prioritise by blast radius: anything that writes to `vouchers`, `inventory`, or
`voucher_entries` first.

**2d. Raise the global floor toward 35–40%** as 2b and 2c land.

**Exit criteria:** global backend floor ≥35%, smoke sweep asserting shape,
no `vouchers`/`inventory` write path without a test.

---

## Phase 3 — documentation state

Depends on 0.3.

116 of 177 docs are phase-named. Most are records of completed work — correct as
history, misleading as reference, and indistinguishable from reference at a
glance. A newcomer opening `docs/` cannot tell which files describe the system
as it is today.

**3a. Move records to `docs/archive/`.** Mechanical, guided by the 0.3
classification. The `translation/` subtree alone is 16 phase files describing
finished work.

**3b. Fix the numbers the audit flags.** Starting with the god-file program
header, which is wrong by a factor of two in a document whose entire purpose is
tracking a number.

**3c. Give `docs/` an index** that names the current-state references —
`architecture.md`, `onboarding.md`, the flow docs — and says plainly that
everything under `archive/` is history.

**3d. Stop the recurrence.** Phase docs are written during the work, which is
right. The rule is that they are *born* in `docs/archive/`, and only material
that describes lasting behaviour is promoted out of it.

**Exit criteria:** `docs/` root is reference-only, doc-index audit green.

---

## Phase 4 — configuration coherence

Small, independent of every other phase, and safe to do first if someone wants a
quick win.

**4a. Node version.** Four sources disagree: `.node-version` says `20.19.2`,
`.nvmrc` says `22`, `package.json` engines says `>=22.0.0`, CI runs `22` and
`22.14`, and `README.md` line 24 tells a new contributor to install Node 20 and
cites `.node-version` as authority. A fresh clone followed literally produces an
environment that violates the engines constraint. Pick 22, set all five.

**4b. npm script naming.** 40+ scripts named after programs and phase numbers —
`verify:program1-observability`, `audit:program-6c:stock-items`,
`audit:program-6d:validate`. The name says when the work happened, not what the
script checks, so nobody can tell which to run without opening it. Rename by
subject, keeping the old names as aliases for one release.

**4c. CI workflow consolidation.** Ten workflows, six named for phases
(`phase8-rtl-accessibility`, `phase9-final-release`,
`mobile-responsive-phase11`, `readable-logging-phase-10`,
`sp-phases-9-10-release-verification`). Same problem as 4b, with the extra cost
that a release-gate workflow for a finished phase either runs forever or is
quietly ignored. Fold the still-meaningful checks into `ci.yml`; delete the
gates whose phase is closed.

**Exit criteria:** one Node version everywhere, no phase numbers in script or
workflow names.

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
