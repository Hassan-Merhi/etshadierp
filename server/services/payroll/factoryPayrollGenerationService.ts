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

export interface FactoryPayrollGenerationInput {
  companyId: number;
  startDate: string;
  endDate: string;
  txDate: string;
  createdBy?: string | null;
}

export interface FactoryPayrollCalculationInput {
  salaryType: string | null;
  baseSalary: number;
  perBaleRate: number;
  perKgRate: number;
  overtimeRate: number;
  startDate: string;
  endDate: string;
  attendanceStatuses: Array<string | null | undefined>;
  baleWeightsKg: number[];
  outstandingAdvance: number;
}

export interface FactoryPayrollCalculationResult {
  basePay: number;
  baleEarnings: number;
  kgEarnings: number;
  overtimeHours: number;
  overtimePay: number;
  bonuses: number;
  deductions: number;
  advances: number;
  netSalary: number;
  balesCount: number;
  kgProcessed: number;
  totalWorkingDays: number;
  presentDays: number;
  absentDays: number;
}

export interface FactoryPayrollGenerationResult {
  payrolls: Array<typeof factoryPayrolls.$inferSelect>;
  createdCount: number;
  replayed: boolean;
}

function assertDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is invalid`);
  }
}

function countWeekdays(start: string, end: string): number {
  const current = new Date(`${start}T00:00:00Z`);
  const finalDate = new Date(`${end}T00:00:00Z`);
  let count = 0;
  while (current <= finalDate) {
    const day = current.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return count;
}

function computeMonthlyPay(salary: number, start: string, end: string): number {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  let total = 0;
  let cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));

  while (cursor <= endDate) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const monthLastDay = new Date(Date.UTC(year, month + 1, 0));
    const daysInMonth = monthLastDay.getUTCDate();
    const segmentStart = new Date(Math.max(cursor.getTime(), startDate.getTime()));
    const segmentEnd = new Date(Math.min(monthLastDay.getTime(), endDate.getTime()));
    const segmentDays = Math.floor((segmentEnd.getTime() - segmentStart.getTime()) / 86_400_000) + 1;
    total += salary * (segmentDays / daysInMonth);
    cursor = new Date(Date.UTC(year, month + 1, 1));
  }

  return total;
}

function computeMonthlyPayFromAttendance(baseSalary: number, startDate: string, statuses: Array<string | null | undefined>): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  let attendedDays = 0;
  for (const status of statuses) {
    if (status === "Present" || status === "Late" || status === "Leave") attendedDays += 1;
    else if (status === "Half Day") attendedDays += 0.5;
  }
  return attendedDays * (baseSalary / daysInMonth);
}

export function buildFactoryPayrollGenerationLockKey(companyId: number, startDate: string, endDate: string): string {
  return `factory-payroll-generation:${companyId}:${startDate}:${endDate}`;
}

export function calculateFactoryPayroll(input: FactoryPayrollCalculationInput): FactoryPayrollCalculationResult {
  const attendanceStatuses = input.attendanceStatuses;
  const hasAttendance = attendanceStatuses.length > 0;
  let presentDays = 0;
  let absentDays = 0;

  for (const status of attendanceStatuses) {
    if (status === "Present" || status === "Late" || status === "Leave") presentDays += 1;
    else if (status === "Half Day") {
      presentDays += 0.5;
      absentDays += 0.5;
    } else if (status === "Absent") absentDays += 1;
  }

  let basePay = 0;
  let baleEarnings = 0;
  let kgEarnings = 0;
  let balesCount = 0;
  let kgProcessed = 0;

  switch (input.salaryType) {
    case "Monthly":
      basePay = hasAttendance
        ? computeMonthlyPayFromAttendance(input.baseSalary, input.startDate, attendanceStatuses)
        : computeMonthlyPay(input.baseSalary, input.startDate, input.endDate);
      break;
    case "Daily":
      basePay = input.baseSalary * (hasAttendance ? presentDays : countWeekdays(input.startDate, input.endDate));
      break;
    case "Per Bale":
      balesCount = input.baleWeightsKg.length;
      baleEarnings = balesCount * input.perBaleRate;
      break;
    case "Per KG":
      kgProcessed = input.baleWeightsKg.reduce((sum, weight) => sum + weight, 0);
      kgEarnings = kgProcessed * input.perKgRate;
      break;
    default:
      break;
  }

  const overtimeHours = 0;
  const overtimePay = overtimeHours * input.overtimeRate;
  const bonuses = 0;
  const deductions = 0;
  const grossPay = basePay + baleEarnings + kgEarnings + overtimePay + bonuses;
  const advances = Math.min(Math.max(0, input.outstandingAdvance), grossPay);
  const netSalary = grossPay - deductions - advances;

  return {
    basePay,
    baleEarnings,
    kgEarnings,
    overtimeHours,
    overtimePay,
    bonuses,
    deductions,
    advances,
    netSalary,
    balesCount,
    kgProcessed,
    totalWorkingDays: countWeekdays(input.startDate, input.endDate),
    presentDays,
    absentDays,
  };
}

export async function generateFactoryPayrollBatch(
  input: FactoryPayrollGenerationInput
): Promise<FactoryPayrollGenerationResult> {
  const companyId = Number(input.companyId);
  if (!Number.isInteger(companyId) || companyId <= 0) throw new Error("companyId is required");
  assertDate(input.startDate, "startDate");
  assertDate(input.endDate, "endDate");
  assertDate(input.txDate, "txDate");
  if (input.startDate > input.endDate) throw new Error("startDate cannot be after endDate");

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
