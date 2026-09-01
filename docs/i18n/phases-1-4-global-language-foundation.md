# Global Translation Foundation — Phases 1–4

## Status

Implemented on `agent/phases-1-4-global-trilingual-foundation`.

## Phase 1 — Contract and safety audit

The application language contract is now centralized in `shared/applicationLanguageContract.ts`.

Supported interface languages are exactly:

- English (`en`)
- Arabic (`ar`)
- French (`fr`)

The UI translation system must not translate persisted business identifiers or user-entered master data implicitly. The protected field contract includes article codes, barcodes, stock item names, stock group names, account codes, container numbers and voucher numbers. Those values continue to come from stored records or explicit multilingual database fields.

## Phase 2 — Shared translation engine

`client/src/i18n/applicationTranslations.ts` provides a typed UI translation catalog and English fallback. `ApplicationLanguageProvider` owns language, direction and the typed `t()` function. Arabic sets document direction to RTL; English and French use LTR.

## Phase 3 — Per-user persistence

Authenticated users load and save their language through:

- `GET /api/language-preference`
- `PUT /api/language-preference`

The server stores one validated `en | ar | fr` preference per user. Browser storage and a same-site cookie provide immediate startup behavior, while the server value synchronizes the preference across devices and sign-ins. Storage events synchronize open tabs.

## Phase 4 — One global switch

`GlobalLanguageSwitch` is mounted once above every authenticated shell. It applies to ERP, Factory, POS and Properties without a refresh. The old Factory language component remains only as a compatibility invalidation hook and renders no second control.

Changing language:

1. updates the visible interface state immediately;
2. updates `<html lang>` and `<html dir>`;
3. stores the browser preference and cookie;
4. emits the application language event;
5. saves the account preference;
6. refetches active queries, including Factory localized responses.

## Verification contracts

`tests/application-language-contract.test.ts` protects the supported language set, fallback behavior, RTL behavior, protected business-data fields and translations in all three languages.
