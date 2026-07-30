# God-file split program

The repository carries 136 files of 1,000+ lines, about 222,000 lines or 38% of
the TypeScript source. This document describes the program for splitting them
and — more importantly — the safety harness that makes those splits verifiable
rather than hopeful.

Phase 0 (the harness) is complete. Phases 1–6 are not started.

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
are recorded in `config/api-smoke-baseline.json` (15 today, all integration-
config dependent: WhatsApp, passkeys, sessions). That list is a ratchet.

Each request has a 15s deadline, because a handler that throws without
responding would otherwise hang CI rather than fail it.

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
| 1 | `server/startupSchema.ts` | 4,312 lines, a single array of 1,212 SQL strings, one import, one export. Order is load-bearing — assert the joined array is unchanged. |
| 2 | Delete before splitting | ~10,300 lines across 7 `*Legacy` / dead-version files. The manifest identifies which server ones are unreachable. |
| 3 | Route monoliths (~71 files) | Split by URL prefix into a directory with an `index.ts` barrel. Start somewhere self-contained, not factory. |
| 4 | Page components (~63 files) | Extract types, then pure helpers, then sub-components, then hooks — strictly safest first. |
| 5 | `shared/schema/*.ts` | Highest blast radius, lowest urgency. Barrel must preserve every export name. |
| 6 | Tighten the ratchet | Lower `softMaxLines` as the backlog empties. |

Phases 3 and 4 touch disjoint trees and can run in parallel.

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
