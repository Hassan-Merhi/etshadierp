# Mobile, Tablet, and Desktop Web Regression Verification

This checklist validates the ordinary browser version of the ERP. It does not test the installed Capacitor application.

## Automated viewport matrix

The repository includes `scripts/run-responsive-browser-smoke.mjs`, which uses the existing Puppeteer dependency and does not require an additional browser-testing package.

It checks:

- Phone portrait: 390 × 844
- Phone landscape: 844 × 390
- Tablet portrait: 768 × 1024
- Tablet landscape: 1024 × 768
- Desktop: 1440 × 900
- Wide desktop: 1920 × 1080

For every viewport it verifies the login screen, root horizontal overflow, visible controls, minimum login-button touch height, stale-cache recovery overlays, failed document/script/stylesheet requests, and browser runtime errors.

When credentials are supplied, it also verifies that the authenticated app shell and `#main-content` are visible, that the shell fills the viewport, and that selected ERP routes do not return to login.

## Run against a local or preview deployment

The target URL must serve a build of the pull-request branch. Testing the current production deployment does not validate unmerged code.

Login-only smoke:

```bash
ERP_SMOKE_BASE_URL=http://127.0.0.1:5000 \
node scripts/run-responsive-browser-smoke.mjs
```

Authenticated smoke:

```bash
ERP_SMOKE_BASE_URL=https://preview.example.com \
ERP_SMOKE_USERNAME='your-test-user' \
ERP_SMOKE_PASSWORD='your-test-password' \
ERP_SMOKE_ROUTES='/tracking,/transaction-journal,/daybook,/accounts,/inventory,/pos,/vouchers' \
node scripts/run-responsive-browser-smoke.mjs
```

Use a non-production test account. Never commit credentials or place them in an environment file tracked by Git.

To require every requested route to remain on that exact route rather than allowing a permission redirect:

```bash
ERP_SMOKE_REQUIRE_EXACT_ROUTES=1
```

The command writes screenshots and a JSON report to `artifacts/responsive-smoke` by default. Override this with `ERP_SMOKE_OUTPUT_DIR` when required.

## Required authenticated route coverage

Use a test user and company that can open the relevant screens. At minimum, cover:

- Tracking or dashboard
- Daybook
- Transaction journal
- Accounts
- Inventory
- POS
- Vouchers
- One factory route when testing a factory company

If a role lacks access to one of these pages, use another test role or run a separate route set. A permission redirect is not proof that the requested page itself is responsive.

## Manual phone and tablet checks

Perform these checks in both portrait and landscape orientation:

1. Sign in and sign out.
2. Open and close the mobile sidebar.
3. Switch company and location.
4. Scroll the main page without the body becoming frozen.
5. Open and close a dialog, dropdown, date picker, and searchable selector.
6. Confirm tables remain inside their horizontal scroll region instead of widening the entire page.
7. Confirm fixed buttons, toasts, and chat controls do not cover required form actions.
8. Put the browser in the background, return to it, and confirm the session and page remain usable.
9. Rotate the device while a page and while a dialog are open.
10. Refresh after a deployment and confirm there is at most one automatic recovery reload.

## Desktop non-regression checks

Verify at 1440 × 900 and 1920 × 1080:

- Sidebar width and collapsed state are unchanged.
- Main content fills the remaining width.
- Header, search, company selector, and location selector remain aligned.
- Daybook, accounts, inventory, POS, vouchers, and factory pages still scroll and open dialogs normally.
- No new full-page horizontal scrollbar appears.
- Keyboard shortcuts and desktop sidebar controls still work.

## Service-worker deployment check

After deploying a new build:

1. Open the previous version in a browser tab.
2. Deploy the new version.
3. Return to the old tab.
4. Confirm the service worker updates and the app reloads no more than once for that version.
5. Confirm a missing hashed asset triggers one controlled recovery attempt.
6. Confirm a repeated failure shows the recovery message rather than entering a reload loop.
7. Confirm offline mutation queues and IndexedDB data remain present; only ERP CacheStorage entries are cleared.

## Merge gate

Do not merge the mobile-web compatibility pull request until:

- The automated matrix passes against a build of the pull-request branch.
- Authenticated routes have been tested with a suitable test account.
- Phone and tablet portrait/landscape checks pass.
- Desktop checks pass at both desktop sizes.
- No service-worker reload loop occurs.
- The pull request is current enough with `main` to merge without conflicting edits.
