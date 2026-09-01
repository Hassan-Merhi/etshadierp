# Program 2 — Phase 7: Payroll and Employee Accounting

Status: complete

## Protected scope

Payroll remains a specialized accounting workflow rather than a generic voucher cutover.

The protected contract covers:

- company-owned employees, employee groups, locations, salary-expense accounts, bonus-expense accounts, bank accounts, cash ledgers, advances, deductions, payroll runs, and payroll-run items;
- positive amount validation and company-scoped account selection;
- salary deposits and bonuses as expense debit plus employee credit;
- withdrawals and direct payments as employee debit plus bank/cash credit;
- employee balance synchronization from persisted voucher entries;
- preservation of group-specific salary and bonus expense splitting;
- preservation of bale-rate, sales-percentage, bonus, advance, deduction, and net-pay formulas;
- payroll-run lifecycle ownership, including create, update, delete, undo, diagnostic, migration, and summary paths;
- exact employee effect reversal when payroll-created vouchers are edited, deleted, or undone;
- `SAL-*`, payroll-run, advance, and deduction vouchers remaining on payroll-aware lifecycle handlers rather than plain Payment/Receipt deletion;
- migrated and historical payroll records remaining protected from silent reinterpretation;
- no generic accounting route may independently rerun employee, advance, deduction, or payroll-run side effects.

## Replay and transaction boundary

A payroll operation must not duplicate vouchers, employee deposits, withdrawals, advances, deductions, run items, or WhatsApp effects after an uncertain retry. Multi-row payroll operations must commit or roll back as one business operation where the current workflow already provides a transaction boundary.

## Compatibility isolation

The following remain specialized and must not be reclassified by generic voucher logic:

- single and bulk salary deposits;
- employee bonuses;
- salary withdrawals;
- worker direct payments;
- salary advances and advance deductions;
- payroll-run calculation and posting;
- payroll undo and migration tools;
- automatic bale and sales-percentage bonus calculations.

## Safety

No salary, bonus, advance, deduction, net-pay, employee-balance, exchange-rate, bank, cash, or expense formula changes in this phase. No historical payroll record is repaired automatically.
