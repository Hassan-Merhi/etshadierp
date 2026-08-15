import { toArrayBuffer } from "../../../lib/bufferCompatibility";
/**
 * payrollCoreRoutes: PayrollPreview endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import path from "path";
import fs from "fs";
import ExcelJS from "exceljs";
import {
  companies,
  factoryWorkers,
  factoryWorkerAdvances,
  factoryWorkerDeductions,
  factoryAttendance,
} from "@shared/schema";
import { computeMonthlyPay, computeMonthlyPayFromAttendance, getFactoryCompanyId } from "./_helpers";

export function registerPayrollPreviewRoutes(app: Express) {
  // POST /api/factory/payrolls/preview - Preview payroll calculation with attendance breakdown (no DB writes)
  app.post("/api/factory/payrolls/preview", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.body.companyId || getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { workerIds, periodStart, periodEnd, daysCount, bonusPerWorker, transportOverrides } = req.body;
      if (!periodStart || !periodEnd) return res.status(400).json({ message: "Period dates required" });

      const days = daysCount
        ? parseInt(daysCount)
        : Math.floor((new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const bonus = parseFloat(bonusPerWorker || "0");

      let targetWorkers;
      if (workerIds && workerIds.length > 0) {
        targetWorkers = await db
          .select()
          .from(factoryWorkers)
          .where(and(eq(factoryWorkers.companyId, companyId), inArray(factoryWorkers.id, workerIds)));
      } else {
        targetWorkers = await db
          .select()
          .from(factoryWorkers)
          .where(and(eq(factoryWorkers.companyId, companyId), eq(factoryWorkers.active, true)));
      }

      // Fetch all attendance records for the period in one query
      const workerIdList = targetWorkers.map((w) => w.id);
      const attendanceRecords = workerIdList.length
        ? await db
            .select()
            .from(factoryAttendance)
            .where(
              and(
                eq(factoryAttendance.companyId, companyId),
                gte(factoryAttendance.attendanceDate, periodStart),
                lte(factoryAttendance.attendanceDate, periodEnd),
                inArray(factoryAttendance.workerId, workerIdList)
              )
            )
        : [];

      const attendanceByWorker = new Map<number, unknown[]>();
      for (const att of attendanceRecords) {
        const list = attendanceByWorker.get(att.workerId) || [];
        list.push(att);
        attendanceByWorker.set(att.workerId, list);
      }

      // Outstanding advances — all unpaid (both salary_deduction and manual_repayment/loan)
      const allAdvances = await db
        .select()
        .from(factoryWorkerAdvances)
        .where(and(eq(factoryWorkerAdvances.companyId, companyId), eq(factoryWorkerAdvances.fullyPaid, false)))
        .orderBy(factoryWorkerAdvances.advanceDate);
      // Separate salary-deduction advances (auto-deducted from pay) from loans (informational only)
      const advanceByWorker: Record<number, number> = {};
      const advanceListByWorker: Record<number, typeof allAdvances> = {};
      const loanListByWorker: Record<number, typeof allAdvances> = {};
      const loanBalByWorker: Record<number, number> = {};
      for (const adv of allAdvances) {
        if (adv.repaymentType === "salary_deduction") {
          advanceByWorker[adv.workerId] =
            (advanceByWorker[adv.workerId] || 0) + parseFloat(adv.remainingBalance || "0");
          if (!advanceListByWorker[adv.workerId]) advanceListByWorker[adv.workerId] = [];
          advanceListByWorker[adv.workerId].push(adv);
        } else {
          loanBalByWorker[adv.workerId] =
            (loanBalByWorker[adv.workerId] || 0) + parseFloat(adv.remainingBalance || "0");
          if (!loanListByWorker[adv.workerId]) loanListByWorker[adv.workerId] = [];
          loanListByWorker[adv.workerId].push(adv);
        }
      }

      // Pending one-time salary deductions (factoryWorkerDeductions table)
      const allPendingDeductions = await db
        .select()
        .from(factoryWorkerDeductions)
        .where(and(eq(factoryWorkerDeductions.companyId, companyId), eq(factoryWorkerDeductions.applied, false)));
      const pendingDeductionByWorker: Record<number, number> = {};
      const pendingDeductionRecordsByWorker: Record<
        number,
        { id: number; amount: string; reason: string | null; deductionDate: string }[]
      > = {};
      for (const ded of allPendingDeductions) {
        pendingDeductionByWorker[ded.workerId] =
          (pendingDeductionByWorker[ded.workerId] || 0) + parseFloat(ded.amount || "0");
        if (!pendingDeductionRecordsByWorker[ded.workerId]) pendingDeductionRecordsByWorker[ded.workerId] = [];
        pendingDeductionRecordsByWorker[ded.workerId].push({
          id: ded.id,
          amount: ded.amount,
          reason: ded.reason,
          deductionDate: ded.deductionDate,
        });
      }

      // Transport denominator = total days in the MONTH of periodStart.
      // This ensures two half-month runs (e.g. Apr 1-15 + Apr 16-30) add up to
      // exactly the full monthly transport allowance for a fully-present worker.
      // e.g. for April (30 days): daily rate = $80/30 = $2.67 → 15d = $40
      const transportMonthDays = (() => {
        const d = new Date(periodStart);
        return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      })();

      const result = targetWorkers.map((worker) => {
        const baseSal = parseFloat(worker.baseSalary || "0");
        const freq = worker.payFrequency || worker.salaryType || "Monthly";
        let base: number;
        if (freq === "Weekly") base = (days / 7) * baseSal;
        else if (freq === "Bi-Weekly") base = (days / 14) * baseSal;
        else if (freq === "Daily" || worker.salaryType === "Daily") base = days * baseSal;
        else {
          // Monthly: use attendance-based calculation if records exist
          const workerAttRecords = attendanceByWorker.get(worker.id) || [];
          if (workerAttRecords.length === 0) {
            base = computeMonthlyPay(baseSal, periodStart, periodEnd);
          } else {
            base = computeMonthlyPayFromAttendance(baseSal, periodStart, workerAttRecords);
          }
        }

        // Transport allowance — prorated by attendance
        const workerAttRecs = attendanceByWorker.get(worker.id) || [];
        let presentDays = 0;
        let absentDays = 0;
        const presentDates: { date: string; status: string }[] = [];
        const absentDates: { date: string; status: string }[] = [];
        const halfDayDates: { date: string; status: string }[] = [];

        for (const att of workerAttRecs) {
          const entry = { date: att.attendanceDate, status: att.status };
          if (att.status === "Present" || att.status === "Late" || att.status === "Leave") {
            presentDays += 1;
            presentDates.push(entry);
          } else if (att.status === "Half Day") {
            presentDays += 0.5;
            absentDays += 0.5;
            halfDayDates.push(entry);
          } else if (att.status === "Absent") {
            absentDays += 1;
            absentDates.push(entry);
          }
        }

        presentDates.sort((a, b) => a.date.localeCompare(b.date));
        absentDates.sort((a, b) => a.date.localeCompare(b.date));
        halfDayDates.sort((a, b) => a.date.localeCompare(b.date));

        const workerTransportDefault = parseFloat(worker.transportAllowance || "0");
        const transportOverrideAmt = transportOverrides
          ? parseFloat(transportOverrides[String(worker.id)] ?? "-1")
          : -1;
        const transportMonthly = transportOverrideAmt >= 0 ? transportOverrideAmt : workerTransportDefault;

        let transport = 0;
        if (transportMonthly > 0) {
          if (workerAttRecs.length > 0 && transportMonthDays > 0) {
            // dailyRate = monthlyRate / daysInMonth
            // transport = dailyRate * presentDays
            transport = (presentDays / transportMonthDays) * transportMonthly;
          } else {
            transport = transportMonthly;
          }
        }

        const totalAdvanceBalance = advanceByWorker[worker.id] || 0;
        const advanceDeduction = Math.min(totalAdvanceBalance, base + bonus + transport);
        const pendingDeductions = pendingDeductionByWorker[worker.id] || 0;
        const pendingDeductionRecords = pendingDeductionRecordsByWorker[worker.id] || [];
        const net = base + bonus + transport - advanceDeduction - pendingDeductions;
        const pendingAdvances = (advanceListByWorker[worker.id] || []).map((a) => ({
          id: a.id,
          advanceDate: a.advanceDate,
          amount: a.amount,
          remainingBalance: a.remainingBalance,
          notes: a.notes,
          repaymentType: a.repaymentType,
        }));
        const outstandingLoans = (loanListByWorker[worker.id] || []).map((a) => ({
          id: a.id,
          advanceDate: a.advanceDate,
          amount: a.amount,
          remainingBalance: a.remainingBalance,
          notes: a.notes,
          repaymentType: a.repaymentType,
        }));
        const totalLoanBalance = loanBalByWorker[worker.id] || 0;

        return {
          id: worker.id,
          name: worker.fullName,
          position: worker.position || null,
          base,
          bonus,
          transport,
          transportMonthly,
          advanceDeduction,
          totalAdvanceBalance,
          pendingAdvances,
          pendingDeductions,
          pendingDeductionRecords,
          outstandingLoans,
          totalLoanBalance,
          net,
          totalWorkingDays: transportMonthDays, // full month days — denominator used for proration
          presentDays,
          absentDays,
          presentDates,
          absentDates,
          halfDayDates,
        };
      });

      res.json(result);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
  // POST /api/factory/payrolls/preview-excel — styled ExcelJS export of the payroll preview
  app.post("/api/factory/payrolls/preview-excel", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId: number = req.body.companyId || getFactoryCompanyId(req);
      const { periodStart, periodEnd, rows } = req.body as {
        periodStart: string;
        periodEnd: string;
        rows: Array<{
          employeeCode: string | null;
          name: string;
          position: string | null;
          presentDays: number;
          totalWorkingDays: number;
          absentDays: number;
          base: number;
          bonus: number;
          transportMonthly: number;
          transportPaid: number;
          salaryDeduction: number;
          advanceDeduction: number;
          net: number;
        }>;
      };
      if (!companyId || !periodStart || !periodEnd || !Array.isArray(rows)) {
        return res.status(400).json({ message: "companyId, periodStart, periodEnd and rows required" });
      }

      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      const companyName = company?.name || "Company";

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Payroll");

      // ── Logo ─────────────────────────────────────────────────────────────
      const logoPath = path.join(process.cwd(), "server", "hmd-logo.png");
      let logoId: number | null = null;
      try {
        if (fs.existsSync(logoPath)) {
          const buf = fs.readFileSync(logoPath);
          logoId = wb.addImage({ buffer: toArrayBuffer(buf), extension: "jpeg" });
        }
      } catch {
        // Failure here is non-fatal and the surrounding flow continues deliberately.
      }

      const NUM_COLS = 13;

      // Row 1 — logo placeholder
      const logoRow = ws.addRow([]);
      logoRow.height = 72;
      if (logoId !== null) ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 260, height: 72 } });

      // Row 2 — company name
      const rCo = ws.addRow([companyName]);
      rCo.getCell(1).font = { bold: true, size: 15, color: { argb: "FF1F3864" } };
      rCo.getCell(1).alignment = { horizontal: "center" };
      ws.mergeCells(rCo.number, 1, rCo.number, NUM_COLS);

      // Row 3 — report title
      const rTitle = ws.addRow(["Payroll Preview"]);
      rTitle.getCell(1).font = { bold: true, size: 12, color: { argb: "FF1F3864" } };
      rTitle.getCell(1).alignment = { horizontal: "center" };
      ws.mergeCells(rTitle.number, 1, rTitle.number, NUM_COLS);

      // Row 4 — period
      const rPeriod = ws.addRow([`Period: ${periodStart}  →  ${periodEnd}`]);
      rPeriod.getCell(1).font = { size: 10, color: { argb: "FF555555" }, italic: true };
      rPeriod.getCell(1).alignment = { horizontal: "center" };
      ws.mergeCells(rPeriod.number, 1, rPeriod.number, NUM_COLS);

      ws.addRow([]); // spacer

      // ── Column definitions ────────────────────────────────────────────────
      ws.columns = [
        { key: "code", width: 14 },
        { key: "name", width: 28 },
        { key: "position", width: 20 },
        { key: "present", width: 14 },
        { key: "total", width: 13 },
        { key: "absent", width: 13 },
        { key: "base", width: 13 },
        { key: "bonus", width: 12 },
        { key: "transMo", width: 16 },
        { key: "transPaid", width: 16 },
        { key: "salDed", width: 18 },
        { key: "advDed", width: 18 },
        { key: "net", width: 14 },
      ];

      // ── Header row ────────────────────────────────────────────────────────
      const HDR_BG = "FF1F3864";
      const HDR_FG = "FFFFFFFF";
      const hdr = ws.addRow([
        "Code",
        "Name",
        "Position",
        "Present Days",
        "Total Days",
        "Absent Days",
        "Base ($)",
        "Bonus ($)",
        "Transport/mo ($)",
        "Transport Paid ($)",
        "Salary Deduction ($)",
        "Advance Deduction ($)",
        "Net Pay ($)",
      ]);
      hdr.height = 22;
      hdr.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HDR_BG } };
        cell.font = { bold: true, color: { argb: HDR_FG }, size: 10 };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FFB8CCE4" } },
          bottom: { style: "thin", color: { argb: "FFB8CCE4" } },
          left: { style: "thin", color: { argb: "FFB8CCE4" } },
          right: { style: "thin", color: { argb: "FFB8CCE4" } },
        };
      });

      // ── Data rows ─────────────────────────────────────────────────────────
      const MONEY_FMT = "#,##0.00";
      const DAYS_FMT = "#,##0.0";
      const EVEN_BG = "FFFFFFFF";
      const ODD_BG = "FFF0F4FA"; // very light blue

      let totalBase = 0,
        totalBonus = 0,
        totalTransMo = 0,
        totalTransPaid = 0;
      let totalSalDed = 0,
        totalAdvDed = 0,
        totalNet = 0;

      rows.forEach((r, idx) => {
        const bg = idx % 2 === 0 ? EVEN_BG : ODD_BG;
        const dataRow = ws.addRow({
          code: r.employeeCode || "—",
          name: r.name,
          position: r.position || "—",
          present: r.presentDays,
          total: r.totalWorkingDays,
          absent: r.absentDays,
          base: r.base,
          bonus: r.bonus,
          transMo: r.transportMonthly,
          transPaid: r.transportPaid,
          salDed: r.salaryDeduction,
          advDed: r.advanceDeduction,
          net: r.net,
        });
        dataRow.height = 18;
        dataRow.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
          cell.alignment = { vertical: "middle" };
          cell.border = {
            top: { style: "hair", color: { argb: "FFDDDDDD" } },
            bottom: { style: "hair", color: { argb: "FFDDDDDD" } },
            left: { style: "hair", color: { argb: "FFDDDDDD" } },
            right: { style: "hair", color: { argb: "FFDDDDDD" } },
          };
        });

        // Align text cols left, numbers right
        dataRow.getCell("code").alignment = { horizontal: "left", vertical: "middle" };
        dataRow.getCell("name").alignment = { horizontal: "left", vertical: "middle" };
        dataRow.getCell("position").alignment = { horizontal: "left", vertical: "middle" };

        // Money / days formats
        (["present", "total", "absent"] as const).forEach((k) => {
          dataRow.getCell(k).numFmt = DAYS_FMT;
          dataRow.getCell(k).alignment = { horizontal: "center", vertical: "middle" };
        });
        (["base", "bonus", "transMo", "transPaid", "salDed", "advDed", "net"] as const).forEach((k) => {
          dataRow.getCell(k).numFmt = MONEY_FMT;
          dataRow.getCell(k).alignment = { horizontal: "right", vertical: "middle" };
        });

        // Accumulate totals
        totalBase += r.base;
        totalBonus += r.bonus;
        totalTransMo += r.transportMonthly;
        totalTransPaid += r.transportPaid;
        totalSalDed += r.salaryDeduction;
        totalAdvDed += r.advanceDeduction;
        totalNet += r.net;
      });

      // ── Totals row ────────────────────────────────────────────────────────
      ws.addRow([]); // thin gap
      const totRow = ws.addRow({
        code: "",
        name: "TOTAL",
        position: "",
        present: "",
        total: "",
        absent: "",
        base: totalBase,
        bonus: totalBonus,
        transMo: totalTransMo,
        transPaid: totalTransPaid,
        salDed: totalSalDed,
        advDed: totalAdvDed,
        net: totalNet,
      });
      totRow.height = 22;
      totRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
        cell.alignment = { horizontal: "right", vertical: "middle" };
        cell.border = {
          top: { style: "medium", color: { argb: "FF4472C4" } },
          bottom: { style: "medium", color: { argb: "FF4472C4" } },
          left: { style: "thin", color: { argb: "FF4472C4" } },
          right: { style: "thin", color: { argb: "FF4472C4" } },
        };
      });
      totRow.getCell("name").alignment = { horizontal: "left", vertical: "middle" };
      (["base", "bonus", "transMo", "transPaid", "salDed", "advDed", "net"] as const).forEach((k) => {
        totRow.getCell(k).numFmt = MONEY_FMT;
      });

      // ── Worker count sub-label ────────────────────────────────────────────
      const rCount = ws.addRow([`${rows.length} worker${rows.length !== 1 ? "s" : ""}`]);
      rCount.getCell(1).font = { size: 9, italic: true, color: { argb: "FF888888" } };
      ws.mergeCells(rCount.number, 1, rCount.number, NUM_COLS);

      // ── Freeze pane below header ──────────────────────────────────────────
      ws.views = [{ state: "frozen", ySplit: hdr.number, activeCell: "A" + (hdr.number + 1) }];

      // ── Stream out ───────────────────────────────────────────────────────
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="Payroll_${periodStart}_${periodEnd}.xlsx"`);
      res.setHeader("Content-Length", buf.byteLength);
      res.end(buf);
    } catch (err) {
      logger.error("preview-excel error", { error: err });
      if (!res.headersSent) res.status(500).json({ message: getErrorMessage(err) });
    }
  });
}
