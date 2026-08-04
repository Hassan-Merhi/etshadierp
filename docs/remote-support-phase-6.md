# Remote support Phase 6 — guarded keyboard and form editing

## Scope

Phase 6 adds controlled keyboard input to the exact authenticated ERP browser tab already bound by Phases 4 and 5. Keyboard control depends on active mouse control and cannot operate independently.

It does not add clipboard transfer, file transfer, desktop control, operating-system control, access to another browser tab, password entry, or unrestricted form submission.

## Activation

- Passive screen viewing remains silent and read-only.
- Mouse control must be active first.
- Keyboard control is disabled by default behind the existing `keyboardControl` runtime flag.
- The controller explicitly selects **Enable keyboard** and confirms their own password.
- Password confirmation is accepted for no more than five minutes.
- Keyboard authorization is bound to the controller, support session, target user, and exact ERP browser-tab identifier.
- The employee sees the persistent active-support indicator while mouse or keyboard control is active and can stop the whole session immediately.

## Safe editable fields

The target ERP tab evaluates every field locally and fails closed.

Allowed fields are:

- search and filter inputs;
- date or reference filters that are not financial or sensitive;
- fields explicitly marked `data-remote-control-editable="true"` after review;
- non-form text fields that do not match a sensitive category.

Blocked fields include:

- passwords, passcodes, one-time codes, secrets, tokens and API keys;
- card, bank-account, IBAN, SWIFT and routing information;
- payroll, salary, payment, debit, credit, amount, price, cost, exchange-rate and currency fields;
- voucher, transfer, offload, approval, permission, role, company, supplier, customer and employee fields;
- hidden, file and protected inputs;
- disabled or read-only controls;
- unknown form fields that are not explicitly approved.

The sensitive-field classifier covers English, Arabic and French labels and attributes.

## Keyboard commands

Allowed semantic commands are:

- text insertion, limited to 64 Unicode code points per command;
- Backspace and Delete;
- Tab and Shift+Tab between safe editable fields;
- Escape;
- arrow keys, Home and End;
- Enter only for a textarea line break;
- Space;
- bounded select navigation;
- checkbox/radio activation only when explicitly approved;
- number stepping only on explicitly approved numeric fields.

Blocked behavior includes:

- Enter-based form submission;
- Ctrl, Alt, Meta and clipboard shortcuts;
- copy, cut and paste;
- control characters;
- unsupported keys and unknown commands.

## Local-user priority

Trusted local pointer, keyboard, before-input or input activity immediately clears remote field focus and blocks remote keyboard execution for a short conflict window. Remote input never overwrites an employee who is actively using the tab.

## Transport and rollback

- Commands and results use authenticated Server-Sent Events and CSRF-protected POST routes.
- Commands are sequenced, rate-limited, short-lived and rejected when the exact target stream is unavailable.
- Results contain only `executed`, `blocked` or `ignored` and a bounded reason; field values are never returned.
- Disabling mouse, keyboard runtime support, remote control or the full screen feed revokes keyboard capability.
- Session expiry, target disconnect, controller disconnect, restore-defaults and emergency stop terminate keyboard access.

## Storage

Phase 6 authorization and command state is transient and in memory. No SQL or migration is required. Permanent metadata-only auditing is introduced in Phase 7 using the existing audit-log infrastructure.

## Verification

Focused backend coverage validates password freshness, mouse dependency, exact target-tab ownership, bounded text and keys, command sequencing, result ownership, rate limits, stream failures, revocation and listener isolation.

Focused frontend coverage validates safe-field classification, credential and financial blocking, React-compatible input/change events, text insertion, deletion, caret movement, textarea line breaks, safe Tab navigation, select and explicit checkbox handling, local-user priority, max-length enforcement and fail-closed behavior.
