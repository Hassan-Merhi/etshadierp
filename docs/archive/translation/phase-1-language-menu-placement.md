# Translation completion Phase 1 — language menu placement

## Problem

The global English/Arabic/French control was mounted as a fixed top-right overlay. It occupied the same visual area as the application top bar and could cover the company selector, especially at reduced browser zoom or narrower viewport widths.

## Completed change

- Removed the fixed global language overlay from the authenticated application root.
- Removed the obsolete `GlobalLanguageSwitch` component so the floating implementation cannot be accidentally mounted again.
- Added a responsive account menu to the normal top-bar layout.
- Moved English, Arabic and French selection into that account menu.
- Preserved immediate same-page language updates and the existing database, cookie and local-storage preference persistence.
- Moved logout into the same account menu, reducing top-bar clutter.
- Kept the company selector as an independent top-bar control that remains visible and clickable.
- Protected usernames and role names from automatic interface translation.

## Responsive behavior

The account-menu trigger remains visible at all viewport widths. Username and role text progressively collapse while the avatar remains available. The language menu is rendered through the existing dropdown portal rather than as a page overlay.

## Regression boundary

`tests/application-language-integration-contract.test.ts` now requires:

- one global application-language provider;
- no floating `GlobalLanguageSwitch` component;
- language choices inside `UserMenu`;
- English, Arabic and French options;
- an independent company-selector trigger;
- no fixed top-right or high-z-index language overlay classes;
- a user-menu trigger that remains available at narrow widths.
