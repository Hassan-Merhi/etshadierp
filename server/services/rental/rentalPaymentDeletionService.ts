import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  interCompanyTransfers,
  propertyContracts,
  propertyMonthlyLedger,
  propertyPayments,
  voucherEntries,
  vouchers,
} from "@shared/schema";
import { removeFactoryDaybookMirrorTx } from "../accounting/factoryDaybookMirrorRemoval";

export type RentalModule = "PROPERTIES" | "ERP" | "FACTORY";

export interface DeleteRentalPaymentInput {
  companyId: number;
  module: RentalModule;
  paymentId: number;
}

export interface DeleteRentalPaymentResult {
  found: boolean;
  paymentGroupId: string | null;
  deletedPaymentIds: number[];
  deletedCount: number;
}

/** Must remain identical to rentalPaymentPostingService.hashGroupId. */
function hashPaymentGroupId(groupId: string): bigint {
  let hash = 5381n;
  for (let index = 0; index < groupId.length; index += 1) {
    hash = ((hash << 5n) + hash + BigInt(groupId.charCodeAt(index))) & 0xffffffffffffffffn;
  }
  if (hash > 9223372036854775807n) hash -= 18446744073709551616n;
  return hash;
}

function recognitionVoucherNumber(paymentDate: string, paymentGroupId: string): string {
  return `ADV-REC-${paymentDate.replace(/-/g, "")}-${paymentGroupId.slice(-6)}`;
}

export async function deleteRentalPaymentGroup(input: DeleteRentalPaymentInput): Promise<DeleteRentalPaymentResult> {
  return db.transaction(async (tx) => {
    const [initialSeed] = await tx
      .select()
      .from(propertyPayments)
      .where(
        and(
          eq(propertyPayments.id, input.paymentId),
          eq(propertyPayments.companyId, input.companyId),
          eq(propertyPayments.module, input.module)
        )
      );

    if (!initialSeed) {
      return {
        found: false,
        paymentGroupId: null,
        deletedPaymentIds: [],
        deletedCount: 0,
      };
    }

    const lifecycleKey =
      initialSeed.paymentGroupId ?? `legacy-rental-payment:${input.companyId}:${input.module}:${input.paymentId}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${hashPaymentGroupId(lifecycleKey)})`);

    const [seed] = await tx
      .select()
      .from(propertyPayments)
      .where(
        and(
          eq(propertyPayments.id, input.paymentId),
          eq(propertyPayments.companyId, input.companyId),
          eq(propertyPayments.module, input.module)
        )
      )
      .for("update");

    if (!seed) {
      return {
        found: false,
        paymentGroupId: initialSeed.paymentGroupId ?? null,
        deletedPaymentIds: [],
        deletedCount: 0,
      };
    }

    const groupRows = seed.paymentGroupId
      ? await tx
          .select()
          .from(propertyPayments)
          .where(
            and(
              eq(propertyPayments.companyId, input.companyId),
              eq(propertyPayments.module, input.module),
              eq(propertyPayments.paymentGroupId, seed.paymentGroupId)
            )
          )
          .orderBy(propertyPayments.id)
          .for("update")
      : [seed];

    const paymentIds = groupRows.map((row) => row.id);
    const ledgerRowIds = [...new Set(groupRows.map((row) => row.ledgerRowId).filter((id): id is number => !!id))];
    const voucherIds = [...new Set(groupRows.map((row) => row.voucherId).filter((id): id is number => !!id))];

    const linkedTransfers = await tx
      .select()
      .from(interCompanyTransfers)
      .where(inArray(interCompanyTransfers.sourcePaymentId, paymentIds));

    for (const transfer of linkedTransfers) {
      const fromVoucherId = transfer.fromVoucherId;
      const toVoucherId = transfer.toVoucherId;
      await tx.delete(interCompanyTransfers).where(eq(interCompanyTransfers.id, transfer.id));
      // Each leg of an intercompany transfer is removed outright, so a Daybook
      // mirror left behind would reference a voucher that no longer exists in
      // any company.
      if (fromVoucherId) {
        await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, fromVoucherId));
        await tx.delete(vouchers).where(eq(vouchers.id, fromVoucherId));
        await removeFactoryDaybookMirrorTx({ tx, voucherId: fromVoucherId });
      }
      if (toVoucherId) {
        await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, toVoucherId));
        await tx.delete(vouchers).where(eq(vouchers.id, toVoucherId));
        await removeFactoryDaybookMirrorTx({ tx, voucherId: toVoucherId });
      }
    }

    for (const voucherId of voucherIds) {
      const [outsideReference] = await tx
        .select({ id: propertyPayments.id })
        .from(propertyPayments)
        .where(and(eq(propertyPayments.voucherId, voucherId), notInArray(propertyPayments.id, paymentIds)))
        .limit(1);

      if (!outsideReference) {
        await tx.update(vouchers).set({ deletedAt: new Date() }).where(eq(vouchers.id, voucherId));
        // Cancelling the rent payment withdraws its Daybook mirror with it, the
        // same way the central Payment/Receipt cancellation does.
        await removeFactoryDaybookMirrorTx({ tx, companyId: input.companyId, voucherId });
        await tx
          .update(vouchers)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(vouchers.companyId, input.companyId),
              eq(vouchers.voucherNumber, `AP-CLEAR-${voucherId}`),
              isNull(vouchers.deletedAt)
            )
          );
      }
    }

    if (seed.paymentGroupId) {
      const recNumber = recognitionVoucherNumber(String(seed.paymentDate), seed.paymentGroupId);
      const recognitionRows = await tx
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, input.companyId),
            eq(vouchers.voucherNumber, recNumber),
            isNull(vouchers.deletedAt)
          )
        )
        .for("update");

      for (const recognition of recognitionRows) {
        await tx.update(vouchers).set({ deletedAt: new Date() }).where(eq(vouchers.id, recognition.id));
        if (ledgerRowIds.length > 0) {
          await tx
            .update(propertyMonthlyLedger)
            .set({ accrualVoucherId: null, usedAdvanceAccount: false })
            .where(
              and(
                inArray(propertyMonthlyLedger.id, ledgerRowIds),
                eq(propertyMonthlyLedger.accrualVoucherId, recognition.id)
              )
            );
        }
      }
    }

    const guaranteeContractIds = [
      ...new Set(
        groupRows
          .filter((row) => row.notes?.includes("[Guarantee release]"))
          .map((row) => row.contractId)
          .filter((id): id is number => !!id)
      ),
    ];
    if (guaranteeContractIds.length > 0) {
      await tx
        .update(propertyContracts)
        .set({ guaranteePostedToStatement: false })
        .where(inArray(propertyContracts.id, guaranteeContractIds));
    }

    await tx.delete(propertyPayments).where(inArray(propertyPayments.id, paymentIds));

    for (const ledgerRowId of ledgerRowIds) {
      await tx.execute(sql`
        WITH remaining AS (
          SELECT COALESCE(SUM(pp.amount::numeric), 0) AS posted_total
          FROM property_payments pp
          WHERE pp.ledger_row_id = ${ledgerRowId}
            AND pp.posting_status = 'POSTED'
        )
        UPDATE property_monthly_ledger ml
        SET paid_amount = remaining.posted_total,
            used_prepaid_account = CASE
              WHEN remaining.posted_total = 0 THEN false
              ELSE ml.used_prepaid_account
            END,
            used_advance_account = CASE
              WHEN remaining.posted_total = 0 THEN false
              ELSE ml.used_advance_account
            END
        FROM remaining
        WHERE ml.id = ${ledgerRowId}
      `);
    }

    return {
      found: true,
      paymentGroupId: seed.paymentGroupId ?? null,
      deletedPaymentIds: paymentIds,
      deletedCount: paymentIds.length,
    };
  });
}
