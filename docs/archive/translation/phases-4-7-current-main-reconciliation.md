# Multilingual Phases 4–7 — current-main reconciliation

## Result

Supplier Partner, Properties and Rentals, Reports and Exports, and reviewed backend messages are reconciled on the current application code without restoring older page implementations.

The original phase branches are fully contained in `main`; none has a commit that is missing from current `main`. Their translation bundles, runtime translator wiring, protected-value rules, and focused source contracts remain the basis of this reconciliation.

## Reviewed coverage

| Phase | Area | English/Arabic/French entries |
| --- | --- | ---: |
| 4 | Supplier Partner | 230 |
| 5 | Properties and Rentals | 182 |
| 6 | Reports and Exports | 248 |
| 7 | Backend and operational messages | 405 |
|  | **Total** | **1,065** |

Each bundle preserves dynamic identifiers and values rather than translating stored business data such as company names, stock names and groups, account names and codes, article codes, container numbers, voucher numbers, property/unit/tenant names, and contract references.

## Current-main repair

The backend-message translator previously translated the outer daily WhatsApp ZIP sentence but preserved nested English fragments such as `start`, `today`, `full history`, and `skipped` inside dynamic captures.

The reconciliation adds reviewed English/Arabic/French fragment entries and recursively translates only recognized captured interface fragments. Unknown captures remain unchanged, so business references, dates, amounts, names, and identifiers continue to pass through safely.

Examples now covered include:

- `Daily ZIP sent to WhatsApp — 3 companies (start → today) (1 skipped).`
- `Daily ZIP sent to WhatsApp — 3 companies (full history).`

## Runtime integration

`ApplicationInterfaceTranslator` continues to apply the four reviewed translation bundles to eligible interface text and attributes. It excludes stored business-value selectors and does not overwrite newer page code.

The Phase 14 multilingual audit now includes the new backend fragment bundle, and `scripts/verify-multilingual-phases-4-7-current-main.mjs` records the current-main wiring and reviewed-count contracts.

## Database and rollout

No schema change, migration, or SQL is required. The changes are translation data, translation matching logic, documentation, and source-level verification contracts only.

No CI, build, lint, TypeScript, or automated test command was run during this reconciliation.
