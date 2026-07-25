import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import { writeDaybookEntry } from "../../routes/factory/_helpers";
import {
  factoryAttendance,
  factoryBales,
  factoryPayrolls,
  factoryWorkerAdvances,
  factoryAdvanceRepayments,
  factoryWorkers,
} from "@shared/schema";
import {
  buildFactoryPayrollGenerationLockKey,
  calculateFactoryPayroll,
  validateFactoryPayrollGenerationDates,
} from "./factoryPayrollGenerationPolicy";

export interface FactoryPayrollGenerationInput {
  companyId: number;
  startDate: string;
  endDate: string;
  txDate: string;
  createdBy?: string | null;
}

export interface FactoryPayrollGenerationResult {
  payrolls: Array<typeof factoryPayrolls.$inferSelect>;
  createdCount: number;
  replayed: boolean;
}

export async function generateFactoryPayrollBatch(
  input: FactoryPayrollGenerationInput
): Promise<FactoryPayrollGenerationResult> {
  const companyId = Number(input.companyId);
  if (!Number.isInteger(companyId) || companyId <= 0) throw new Error("companyId is required");
  validateFactoryPayrollGenerationDates(input.startDate, input.endDate, input.txDate);

  return db.transaction(async (tx) => {
    const lockKey = buildFactoryPayrollGenerationLockKey(companyId, input.startDate, input.endDate);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);

    const workers = await tx
      .select()
      .from(factoryWorkers)
      .where(and(eq(factoryWorkers.companyId, companyId), eq(factoryWorkers.active, true)))
      .orderBy(factoryWorkers.id);
    if (workers.length === 0) throw new Error("No active workers found for this company");

    const existingPayrolls = await tx
      .select()
      .from(factoryPayrolls)
      .where(
        and(
          eq(factoryPayrolls.companyId, companyId),
          eq(factoryPayrolls.periodStart, input.startDate),
          eq(factoryPayrolls.periodEnd, input.endDate)
        )
      )
      .orderBy(factoryPayrolls.workerId)
      .for("update");

    const existingWorkerIds = new Set(existingPayrolls.map((row) => row.workerId));
    const missingWorkers = workers.filter((worker) => !existingWorkerIds.has(worker.id));
    if (missingWorkers.length === 0) {
      return { payrolls: existingPayrolls, createdCount: 0, replayed: true };
    }

    const missingWorkerIds = missingWorkers.map((worker) => worker.id);
    const bales = await tx
      .select({ finalizedBy: factoryBales.finalizedBy, weightKg: factoryBales.weightKg })
      .from(factoryBales)
      .where(
        and(
          eq(factoryBales.companyId, companyId),
          inArray(factoryBales.finalizedBy, missingWorkerIds),
          inArray(factoryBales.status, ["IN_STOCK", "FINALIZED", "SOLD"]),
          gte(factoryBales.createdAt, new Date(`${input.startDate}T00:00:00.000Z`)),
          lte(factoryBales.createdAt, new Date(`${input.endDate}T23:59:59.999Z`))
        )
      );

    const attendance = await tx
      .select({ workerId: factoryAttendance.workerId, status: factoryAttendance.status })
      .from(factoryAttendance)
      .where(
        and(
          eq(factoryAttendance.companyId, companyId),
          inArray(factoryAttendance.workerId, missingWorkerIds),
          gte(factoryAttendance.attendanceDate, input.startDate),
          lte(factoryAttendance.attendanceDate, input.endDate)
        )
      );

    const advances = await tx
      .select()
      .from(factoryWorkerAdvances)
      .where(
        and(
          eq(factoryWorkerAdvances.companyId, companyId),
          inArray(factoryWorkerAdvances.workerId, missingWorkerIds),
          eq(factoryWorkerAdvances.fullyPaid, false),
          eq(factoryWorkerAdvances.repaymentType, "salary_deduction")
        )
      )
      .orderBy(factoryWorkerAdvances.workerId, factoryWorkerAdvances.id)
      .for("update");

    const baleWeightsByWorker = new Map<number, number[]>();
    for (const bale of bales) {
      if (!bale.finalizedBy) continue;
      const weights = baleWeightsByWorker.get(bale.finalizedBy) ?? [];
      weights.push(Number(bale.weightKg ?? 0));
      baleWeightsByWorker.set(bale.finalizedBy, weights);
    }

    const attendanceByWorker = new Map<number, Array<string | null>>();
    for (const row of attendance) {
      const statuses = attendanceByWorker.get(row.workerId) ?? [];
      statuses.push(row.status);
      attendanceByWorker.set(row.workerId, statuses);
    }

    const advancesByWorker = new Map<number, typeof advances>();
    for (const advance of advances) {
      const rows = advancesByWorker.get(advance.workerId) ?? [];
      rows.push(advance);
      advancesByWorker.set(advance.workerId, rows);
    }

    const createdPayrolls: Array<typeof factoryPayrolls.$inferSelect> = [];
    for (const worker of missingWorkers) {
      const workerAdvances = advancesByWorker.get(worker.id) ?? [];
      const outstandingAdvance = workerAdvances.reduce(
        (sum, advance) => sum + Number(advance.remainingBalance ?? 0),
        0
      );
      const calculation = calculateFactoryPayroll({
        salaryType: worker.salaryType,
        baseSalary: Number(worker.baseSalary ?? 0),
        perBaleRate: Number(worker.perBaleRate ?? 0),
        perKgRate: Number(worker.perKgRate ?? 0),
        overtimeRate: Number(worker.overtimeRate ?? 0),
        startDate: input.startDate,
        endDate: input.endDate,
        attendanceStatuses: attendanceByWorker.get(worker.id) ?? [],
        baleWeightsKg: baleWeightsByWorker.get(worker.id) ?? [],
        outstandingAdvance,
      });

      const [record] = await tx
        .insert(factoryPayrolls)
        .values({
          companyId,
          workerId: worker.id,
          periodStart: input.startDate,
          periodEnd: input.endDate,
          baseSalary: calculation.basePay.toFixed(2),
          baleEarnings: calculation.baleEarnings.toFixed(2),
          kgEarnings: calculation.kgEarnings.toFixed(2),
          overtimePay: calculation.overtimePay.toFixed(2),
          bonuses: calculation.bonuses.toFixed(2),
          deductions: calculation.deductions.toFixed(2),
          advances: calculation.advances.toFixed(2),
          netSalary: calculation.netSalary.toFixed(2),
          balesCount: calculation.balesCount,
          kgProcessed: calculation.kgProcessed.toFixed(3),
          overtimeHours: calculation.overtimeHours.toFixed(2),
          totalWorkingDays: calculation.totalWorkingDays,
          presentDays: calculation.presentDays.toFixed(1),
          absentDays: calculation.absentDays.toFixed(1),
          status: "DRAFT",
        })
        .returning();

      let toSettle = calculation.advances;
      for (const advance of workerAdvances) {
        if (toSettle <= 0) break;
        const currentBalance = Number(advance.remainingBalance ?? 0);
        const repayment = Math.min(currentBalance, toSettle);
        const newBalance = currentBalance - repayment;
        await tx
          .update(factoryWorkerAdvances)
          .set({ remainingBalance: newBalance.toFixed(2), fullyPaid: newBalance <= 0 })
          .where(eq(factoryWorkerAdvances.id, advance.id));
        await tx.insert(factoryAdvanceRepayments).values({
          companyId,
          advanceId: advance.id,
          workerId: worker.id,
          payrollId: record.id,
          repaymentDate: input.startDate,
          amount: repayment.toFixed(2),
          notes: `Payroll deduction for ${input.startDate} – ${input.endDate}`,
        });
        toSettle -= repayment;
      }

      await writeDaybookEntry(tx, {
        companyId,
        txDate: input.txDate,
        txType: "PAYROLL_GENERATED",
        referenceId: record.id,
        referenceTable: "factory_payrolls",
        description: `Payroll generated — Worker #${worker.id} (${worker.fullName || worker.employeeCode || ""}). Period: ${input.startDate} to ${input.endDate}. Net: $${calculation.netSalary.toFixed(2)}`,
        amountCurrency: calculation.netSalary,
        amountUsd: calculation.netSalary,
        createdBy: input.createdBy ?? null,
      });

      createdPayrolls.push(record);
    }

    const payrolls = [...existingPayrolls, ...createdPayrolls].sort((a, b) => a.workerId - b.workerId);
    return { payrolls, createdCount: createdPayrolls.length, replayed: false };
  });
}
