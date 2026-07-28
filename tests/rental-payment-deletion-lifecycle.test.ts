import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../server/db";
import { deleteRentalPaymentGroup } from "../server/services/rental/rentalPaymentDeletionService";

let companyId: number;
let unitId: number;
let contractId: number;
let cashAccountId: number;

async function query(text: string, params: unknown[] = []) {
  return (await pool.query(text, params)).rows;
}

beforeAll(async () => {
  const [company] = await query(
    `INSERT INTO companies (code, name, company_type, base_currency)
     VALUES ('RDEL-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
             'RentalDelete-' || gen_random_uuid(), 'erp', 'USD')
     RETURNING id`,
  );
  companyId = company.id;

  const [unit] = await query(
    `INSERT INTO property_units
       (company_id, module, unit_type, location_group, unit_number, active)
     VALUES ($1, 'ERP', 'SHOP', 'Deletion Tests', 'DEL-1', true)
     RETURNING id`,
    [companyId],
  );
  unitId = unit.id;

  const [contract] = await query(
    `INSERT INTO property_contracts
       (company_id, module, unit_id, tenant_name, rental_amount, start_date, status, currency)
     VALUES ($1, 'ERP', $2, 'Deletion Tenant', '500.00', '2026-01-01', 'ACTIVE', 'USD')
     RETURNING id`,
    [companyId, unitId],
  );
  contractId = contract.id;

  const [cashAccount] = await query(
    `INSERT INTO ledger_accounts
       (company_id, name, code, account_type, active)
     VALUES ($1, 'Rental Delete Cash', 'RENT-DEL-CASH', 'Asset', true)
     RETURNING id`,
    [companyId],
  );
  cashAccountId = cashAccount.id;
});

afterAll(async () => {
  await query(`DELETE FROM inter_company_transfers WHERE from_company_id = $1 OR to_company_id = $1`, [companyId]);
  await query(`DELETE FROM property_payments WHERE company_id = $1`, [companyId]);
  await query(`DELETE FROM property_monthly_ledger WHERE company_id = $1`, [companyId]);
  await query(`DELETE FROM voucher_entries WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id = $1)`, [companyId]);
  await query(`DELETE FROM vouchers WHERE company_id = $1`, [companyId]);
  await query(`DELETE FROM property_contracts WHERE id = $1`, [contractId]);
  await query(`DELETE FROM property_units WHERE id = $1`, [unitId]);
  await query(`DELETE FROM ledger_accounts WHERE id = $1`, [cashAccountId]);
  await query(`DELETE FROM companies WHERE id = $1`, [companyId]);
});

describe("rental payment deletion lifecycle", () => {
  it("deletes a posted split group, its payment voucher, and its recognition journal", async () => {
    const groupId = `delete-group-${Date.now()}`;
    const paymentDate = "2026-07-01";
    const suffix = groupId.slice(-6);

    const [paymentVoucher] = await query(
      `INSERT INTO vouchers
         (company_id, voucher_number, voucher_type, voucher_date, description, total_amount, currency)
       VALUES ($1, $2, 'Payment', $3, 'Rental deletion test', '500.00', 'USD')
       RETURNING id`,
      [companyId, `RENT-20260701-${suffix}`, paymentDate],
    );
    const [recognitionVoucher] = await query(
      `INSERT INTO vouchers
         (company_id, voucher_number, voucher_type, voucher_date, description, total_amount, currency)
       VALUES ($1, $2, 'Journal', $3, 'Advance recognition test', '500.00', 'USD')
       RETURNING id`,
      [companyId, `ADV-REC-20260701-${suffix}`, paymentDate],
    );

    const ledgerRows = await query(
      `INSERT INTO property_monthly_ledger
         (company_id, module, contract_id, unit_id, year, month, expected_amount, paid_amount,
          accrual_voucher_id, used_advance_account)
       VALUES
         ($1, 'ERP', $2, $3, 2026, 7, '300.00', '300.00', $4, true),
         ($1, 'ERP', $2, $3, 2026, 8, '200.00', '200.00', $4, true)
       RETURNING id`,
      [companyId, contractId, unitId, recognitionVoucher.id],
    );

    const payments = await query(
      `INSERT INTO property_payments
         (company_id, module, contract_id, unit_id, ledger_row_id, cash_account_id, voucher_id,
          amount, payment_date, for_year, for_month, posting_status, payment_group_id)
       VALUES
         ($1, 'ERP', $2, $3, $4, $6, $7, '300.00', $8, 2026, 7, 'POSTED', $9),
         ($1, 'ERP', $2, $3, $5, $6, $7, '200.00', $8, 2026, 8, 'POSTED', $9)
       RETURNING id`,
      [
        companyId,
        contractId,
        unitId,
        ledgerRows[0].id,
        ledgerRows[1].id,
        cashAccountId,
        paymentVoucher.id,
        paymentDate,
        groupId,
      ],
    );

    const result = await deleteRentalPaymentGroup({
      companyId,
      module: "ERP",
      paymentId: payments[0].id,
    });

    expect(result.found).toBe(true);
    expect(result.deletedCount).toBe(2);

    const remainingPayments = await query(`SELECT id FROM property_payments WHERE payment_group_id = $1`, [groupId]);
    expect(remainingPayments).toHaveLength(0);

    const ledgerAfter = await query(
      `SELECT paid_amount, accrual_voucher_id, used_advance_account
       FROM property_monthly_ledger
       WHERE id = ANY($1::int[])
       ORDER BY id`,
      [ledgerRows.map((row: any) => row.id)],
    );
    expect(ledgerAfter.map((row: any) => Number(row.paid_amount))).toEqual([0, 0]);
    expect(ledgerAfter.every((row: any) => row.accrual_voucher_id === null)).toBe(true);
    expect(ledgerAfter.every((row: any) => row.used_advance_account === false)).toBe(true);

    const voucherAfter = await query(
      `SELECT id, deleted_at FROM vouchers WHERE id = ANY($1::int[]) ORDER BY id`,
      [[paymentVoucher.id, recognitionVoucher.id]],
    );
    expect(voucherAfter.every((row: any) => row.deleted_at)).toBe(true);
  });

  it("deleting a scheduled group preserves the remaining posted paid amount", async () => {
    const [ledgerRow] = await query(
      `INSERT INTO property_monthly_ledger
         (company_id, module, contract_id, unit_id, year, month, expected_amount, paid_amount)
       VALUES ($1, 'ERP', $2, $3, 2026, 9, '500.00', '100.00')
       RETURNING id`,
      [companyId, contractId, unitId],
    );

    await query(
      `INSERT INTO property_payments
         (company_id, module, contract_id, unit_id, ledger_row_id, cash_account_id,
          amount, payment_date, for_year, for_month, posting_status, payment_group_id)
       VALUES ($1, 'ERP', $2, $3, $4, $5, '100.00', '2026-09-01', 2026, 9, 'POSTED', $6)`,
      [companyId, contractId, unitId, ledgerRow.id, cashAccountId, `posted-${Date.now()}`],
    );

    const [scheduled] = await query(
      `INSERT INTO property_payments
         (company_id, module, contract_id, unit_id, ledger_row_id, cash_account_id,
          amount, payment_date, for_year, for_month, posting_status, payment_group_id)
       VALUES ($1, 'ERP', $2, $3, $4, $5, '200.00', '2026-10-01', 2026, 9, 'SCHEDULED', $6)
       RETURNING id`,
      [companyId, contractId, unitId, ledgerRow.id, cashAccountId, `scheduled-${Date.now()}`],
    );

    const result = await deleteRentalPaymentGroup({
      companyId,
      module: "ERP",
      paymentId: scheduled.id,
    });
    expect(result.deletedCount).toBe(1);

    const [ledgerAfter] = await query(`SELECT paid_amount FROM property_monthly_ledger WHERE id = $1`, [ledgerRow.id]);
    expect(Number(ledgerAfter.paid_amount)).toBe(100);
  });
});
