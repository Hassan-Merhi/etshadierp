---
name: SP Intercompany Agent Charges
description: How SP offload agent charges create cross-company journals without affecting Net Position.
---

## The Pattern

When SP Test Co offloads a container with agent charges handled by HADI L'SHI:

**SP Test Co — Voucher B (existing, extended):**
- Dr Stock on Floor (full landed cost including agent)
- Cr Prepaid Expenses (SP-PREEXP, Asset, opening $21,300) ← for each `parent_agent` charge line

**HADI L'SHI — Voucher C (new, non-optional, shows in Daybook):**
- Dr Agent Account (e.g. HUSSAIN NAHLI id=40, AFEPRO id=607, etc.) — "Loans" type
- Cr SP Test Co — Intercompany (SP-IC, Intercompany type) ← excluded from Net Position

## Account Codes

| Company | Code | Name | Type | Purpose |
|---|---|---|---|---|
| SP Test Co (14) | SP-PREEXP | Prepaid Expenses | Asset | Opening $21,300; decreases on each offload |
| SP Test Co (14) | SP-HADI-IC | HADI L'SHI — Intercompany | Intercompany | Excluded from Net Position |
| HADI L'SHI (1) | SP-IC | SP Test Co — Intercompany | Intercompany | Excluded from Net Position |

## Net Position

`netPositionHelper.ts` `excludedAccountTypes` includes "Intercompany" → these accounts are skipped entirely in Net Position math. Change is on line ~70.

## API

- `GET /api/sp/parent-agents` — returns HADI L'SHI agents (from `agent_accounts` joined to `ledger_accounts`) using `parent_company_id` from companies table (14→1).
- `POST /api/sp/offload` — accepts `chargeLines` with `chargeType: "parent_agent"` + `parentAgentAccountId` (ledger_account_id in HADI L'SHI). Runs everything in one DB transaction.

## Frontend

`SpOffloadDialog.tsx` — "Agent via HADI L'SHI" charge type added to CHARGE_TYPES. Shows agent dropdown (from `/api/sp/parent-agents`). Accounting preview shows Voucher C block when agent charges exist.

**Why:** Intercompany balances should NOT bloat individual company Net Positions. Using a dedicated account type ("Intercompany") is cleaner than optional vouchers (which are invisible in Daybook) and avoids special-casing by account code.

**How to apply:** Any future cross-company posting where the tracking account should be invisible to Net Position → use account type "Intercompany".
