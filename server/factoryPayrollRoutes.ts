import type { Express } from "express";
import { eq, and, sql, gte, lte, desc, inArray, isNull } from "drizzle-orm";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import {
  factoryWorkers,
  factoryPayrolls,
  factoryBales,
  factoryDaybookEntries,
  factoryAttendance,
  factoryWorkerAdvances,
  companies,
  insertFactoryPayrollSchema,
} from "@shared/schema";

export function registerFactoryPayrollRoutes(app: Express, requireAuth: any, db: any) {

  async function writeDaybookEntry(dbOrTx: any, opts: {
    companyId: number; txDate: string; txType: string;
    referenceId?: number; referenceTable?: string; description: string;
    metaJson?: string; currencyCode?: string; amountCurrency?: number;
    fxRateToUsd?: number; amountUsd?: number; createdBy?: number;
  }) {
    const currency = opts.currencyCode || "USD";
    const fxRate = opts.fxRateToUsd || 1;
    const amtCurrency = opts.amountCurrency || 0;
    const amtUsd = opts.amountUsd !== undefined ? opts.amountUsd : (currency === "USD" ? amtCurrency : amtCurrency * fxRate);
    await dbOrTx.insert(factoryDaybookEntries).values({
      companyId: opts.companyId, txDate: opts.txDate, txType: opts.txType,
      referenceId: opts.referenceId || null, referenceTable: opts.referenceTable || null,
      description: opts.description, metaJson: opts.metaJson || null,
      currencyCode: currency, amountCurrency: String(amtCurrency),
      fxRateToUsd: String(fxRate), amountUsd: String(amtUsd), createdBy: opts.createdBy || null,
    });
  }

  function countWeekdays(start: string, end: string): number {
    const s = new Date(start);
    const e = new Date(end);
    let count = 0;
    const current = new Date(s);
    while (current <= e) {
      const day = current.getDay();
      if (day !== 0 && day !== 6) count++;
      current.setDate(current.getDate() + 1);
    }
    return count;
  }

  function daysInPeriod(start: string, end: string): number {
    const s = new Date(start);
    const e = new Date(end);
    return Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  }

  function daysInMonth(dateStr: string): number {
    const d = new Date(dateStr);
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  }

  function computeMonthlyPay(salary: number, startStr: string, endStr: string): number {
    const start = new Date(startStr + "T00:00:00");
    const end   = new Date(endStr   + "T00:00:00");
    let total = 0;
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      const year  = cur.getFullYear();
      const month = cur.getMonth();
      const monthLastDay    = new Date(year, month + 1, 0);
      const daysInThisMonth = monthLastDay.getDate();
      const segStart = new Date(Math.max(cur.getTime(), start.getTime()));
      const segEnd   = new Date(Math.min(monthLastDay.getTime(), end.getTime()));
      const daysInSeg = Math.floor((segEnd.getTime() - segStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      total += salary * (daysInSeg / daysInThisMonth);
      cur = new Date(year, month + 1, 1);
    }
    return total;
  }

  app.post("/api/factory/payroll/generate", requireAuth, async (req: any, res: any) => {
    try {
      const { companyId, startDate, endDate } = req.body;
      if (!companyId || !startDate || !endDate) {
        return res.status(400).json({ message: "companyId, startDate, and endDate are required" });
      }

      const workers = await db
        .select()
        .from(factoryWorkers)
        .where(and(eq(factoryWorkers.companyId, companyId), eq(factoryWorkers.active, true)));

      if (workers.length === 0) {
        return res.status(400).json({ message: "No active workers found for this company" });
      }

      const workerIds = workers.map((w: any) => w.id);

      const balesInRange = await db
        .select()
        .from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          inArray(factoryBales.status, ["IN_STOCK", "FINALIZED", "SOLD"]),
          gte(factoryBales.createdAt, new Date(startDate)),
          lte(factoryBales.createdAt, new Date(endDate + "T23:59:59.999Z")),
        ));

      const balesByWorker = new Map<number, any[]>();
      for (const bale of balesInRange) {
        if (bale.finalizedBy) {
          const existing = balesByWorker.get(bale.finalizedBy) || [];
          existing.push(bale);
          balesByWorker.set(bale.finalizedBy, existing);
        }
      }

      // Fetch attendance records for the period
      const attendanceInRange = await db
        .select()
        .from(factoryAttendance)
        .where(
          and(
            eq(factoryAttendance.companyId, companyId),
            gte(factoryAttendance.attendanceDate, startDate),
            lte(factoryAttendance.attendanceDate, endDate)
          )
        );
      const attendanceByWorker = new Map<number, any[]>();
      for (const att of attendanceInRange) {
        const existing = attendanceByWorker.get(att.workerId) || [];
        existing.push(att);
        attendanceByWorker.set(att.workerId, existing);
      }

      const undeductedAdvances = await db
        .select()
        .from(factoryWorkerAdvances)
        .where(
          and(
            eq(factoryWorkerAdvances.companyId, companyId),
            isNull(factoryWorkerAdvances.payrollId),
            eq(factoryWorkerAdvances.repaymentType, "salary_deduction"),
            gte(factoryWorkerAdvances.advanceDate, startDate),
            lte(factoryWorkerAdvances.advanceDate, endDate)
          )
        );
      const advancesByWorker = new Map<number, any[]>();
      for (const adv of undeductedAdvances) {
        const existing = advancesByWorker.get(adv.workerId) || [];
        existing.push(adv);
        advancesByWorker.set(adv.workerId, existing);
      }

      const periodDays = daysInPeriod(startDate, endDate);
      const weekdays = countWeekdays(startDate, endDate);
      const monthDays = daysInMonth(startDate);
      const payrollRecords: any[] = [];

      for (const worker of workers) {
        let basePay = 0;
        let baleEarnings = 0;
        let kgEarnings = 0;
        let balesCount = 0;
        let kgProcessed = 0;

        const workerBaseSalary = parseFloat(worker.baseSalary || "0");
        const workerPerBaleRate = parseFloat(worker.perBaleRate || "0");
        const workerPerKgRate = parseFloat(worker.perKgRate || "0");
        const workerOvertimeRate = parseFloat(worker.overtimeRate || "0");
        const workerBales = balesByWorker.get(worker.id) || [];

        // Calculate attendance metrics
        const workerAttendance = attendanceByWorker.get(worker.id) || [];
        const hasAttendance = workerAttendance.length > 0;
        let presentDays = 0;
        let absentDays = 0;
        const totalWorkingDays = weekdays;

        if (hasAttendance) {
          for (const att of workerAttendance) {
            if (att.status === "Present" || att.status === "Late" || att.status === "Leave") {
              presentDays += 1;
            } else if (att.status === "Half Day") {
              presentDays += 0.5;
              absentDays += 0.5;
            } else if (att.status === "Absent") {
              absentDays += 1;
            }
          }
        }

        switch (worker.salaryType) {
          case "Monthly":
            basePay = computeMonthlyPay(workerBaseSalary, startDate, endDate);
            break;
          case "Daily":
            if (hasAttendance) {
              basePay = workerBaseSalary * presentDays;
            } else {
              basePay = workerBaseSalary * weekdays;
            }
            break;
          case "Per Bale":
            balesCount = workerBales.length;
            baleEarnings = balesCount * workerPerBaleRate;
            break;
          case "Per KG":
            kgProcessed = workerBales.reduce((sum: number, b: any) => sum + parseFloat(b.weightKg || "0"), 0);
            kgEarnings = kgProcessed * workerPerKgRate;
            break;
        }

        const overtimeHours = 0;
        const overtimePay = overtimeHours * workerOvertimeRate;
        const bonuses = 0;
        const deductions = 0;
        const workerAdvances = advancesByWorker.get(worker.id) || [];
        const advances = workerAdvances.reduce((sum: number, a: any) => sum + parseFloat(a.amount || "0"), 0);
        const netSalary = basePay + baleEarnings + kgEarnings + overtimePay + bonuses - deductions - advances;

        const [record] = await db.insert(factoryPayrolls).values({
          companyId,
          workerId: worker.id,
          periodStart: startDate,
          periodEnd: endDate,
          baseSalary: String(basePay.toFixed(2)),
          baleEarnings: String(baleEarnings.toFixed(2)),
          kgEarnings: String(kgEarnings.toFixed(2)),
          overtimePay: String(overtimePay.toFixed(2)),
          bonuses: String(bonuses.toFixed(2)),
          deductions: String(deductions.toFixed(2)),
          advances: String(advances.toFixed(2)),
          netSalary: String(netSalary.toFixed(2)),
          balesCount,
          kgProcessed: String(kgProcessed.toFixed(3)),
          overtimeHours: String(overtimeHours.toFixed(2)),
          totalWorkingDays,
          presentDays: String(presentDays.toFixed(1)),
          absentDays: String(absentDays.toFixed(1)),
          status: "DRAFT",
        }).returning();

        if (workerAdvances.length > 0) {
          const advanceIds = workerAdvances.map((a: any) => a.id);
          await db.update(factoryWorkerAdvances)
            .set({ payrollId: record.id })
            .where(inArray(factoryWorkerAdvances.id, advanceIds));
        }

        payrollRecords.push(record);
      }

      const today = new Date().toISOString().split("T")[0];
      const totalNet = payrollRecords.reduce((sum: number, r: any) => sum + parseFloat(r.netSalary || "0"), 0);
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "PAYROLL_GENERATED",
        description: `Payroll generated for ${payrollRecords.length} workers. Period: ${startDate} to ${endDate}. Total: $${totalNet.toFixed(2)}`,
        amountCurrency: totalNet,
        amountUsd: totalNet,
      });

      res.json(payrollRecords);
    } catch (error: any) {
      console.error("Error generating payroll:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/payroll", requireAuth, async (req: any, res: any) => {
    try {
      const { companyId, startDate, endDate, status } = req.query;
      if (!companyId) {
        return res.status(400).json({ message: "companyId is required" });
      }

      const conditions: any[] = [eq(factoryPayrolls.companyId, parseInt(companyId as string))];
      if (startDate) conditions.push(gte(factoryPayrolls.periodStart, startDate as string));
      if (endDate) conditions.push(lte(factoryPayrolls.periodEnd, endDate as string));
      if (status) conditions.push(eq(factoryPayrolls.status, status as string));

      const results = await db
        .select({
          payroll: factoryPayrolls,
          workerName: factoryWorkers.fullName,
          workerCode: factoryWorkers.employeeCode,
          workerPosition: factoryWorkers.position,
          workerSalaryType: factoryWorkers.salaryType,
          workerDepartment: factoryWorkers.department,
        })
        .from(factoryPayrolls)
        .leftJoin(factoryWorkers, eq(factoryPayrolls.workerId, factoryWorkers.id))
        .where(and(...conditions))
        .orderBy(desc(factoryPayrolls.createdAt));

      const formatted = results.map((r: any) => ({
        ...r.payroll,
        workerName: r.workerName,
        workerCode: r.workerCode,
        workerPosition: r.workerPosition,
        workerSalaryType: r.workerSalaryType,
        workerDepartment: r.workerDepartment,
      }));

      res.json(formatted);
    } catch (error: any) {
      console.error("Error fetching payroll:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/payroll/:id", requireAuth, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      const { bonuses, deductions, advances, overtimeHours, overtimePay, notes, status, paymentSource, paymentDate, paymentReference } = req.body;

      const [existing] = await db
        .select()
        .from(factoryPayrolls)
        .where(eq(factoryPayrolls.id, id));

      if (!existing) {
        return res.status(404).json({ message: "Payroll record not found" });
      }

      const updatedBonuses = bonuses !== undefined ? parseFloat(bonuses) : parseFloat(existing.bonuses || "0");
      const updatedDeductions = deductions !== undefined ? parseFloat(deductions) : parseFloat(existing.deductions || "0");
      const updatedAdvances = advances !== undefined ? parseFloat(advances) : parseFloat(existing.advances || "0");
      const updatedOvertimeHours = overtimeHours !== undefined ? parseFloat(overtimeHours) : parseFloat(existing.overtimeHours || "0");
      const updatedOvertimePay = overtimePay !== undefined ? parseFloat(overtimePay) : parseFloat(existing.overtimePay || "0");

      const base = parseFloat(existing.baseSalary || "0");
      const baleEarn = parseFloat(existing.baleEarnings || "0");
      const kgEarn = parseFloat(existing.kgEarnings || "0");
      const netSalary = base + baleEarn + kgEarn + updatedOvertimePay + updatedBonuses - updatedDeductions - updatedAdvances;

      const updateData: any = {
        bonuses: String(updatedBonuses.toFixed(2)),
        deductions: String(updatedDeductions.toFixed(2)),
        advances: String(updatedAdvances.toFixed(2)),
        overtimeHours: String(updatedOvertimeHours.toFixed(2)),
        overtimePay: String(updatedOvertimePay.toFixed(2)),
        netSalary: String(netSalary.toFixed(2)),
      };

      if (notes !== undefined) updateData.notes = notes;
      if (status !== undefined) updateData.status = status;

      if (status === "APPROVED") {
        updateData.approvedAt = new Date();
      }

      const [updated] = await db
        .update(factoryPayrolls)
        .set(updateData)
        .where(eq(factoryPayrolls.id, id))
        .returning();

      if (status && status !== existing.status) {
        const entryDate = (status === "PAID" && paymentDate) ? paymentDate : new Date().toISOString().split("T")[0];

        if (status === "PAID") {
          const source = paymentSource || "Cash";
          const ref = paymentReference ? ` | Ref: ${paymentReference}` : "";
          await writeDaybookEntry(db, {
            companyId: existing.companyId,
            txDate: entryDate,
            txType: "PAYROLL_PAYMENT",
            referenceId: id,
            referenceTable: "factory_payrolls",
            description: `Payroll payment via ${source}${ref} — Payroll #${id}`,
            amountCurrency: netSalary,
            amountUsd: netSalary,
            metaJson: JSON.stringify({ paymentSource: source, paymentReference: paymentReference || null }),
          });
        } else {
          await writeDaybookEntry(db, {
            companyId: existing.companyId,
            txDate: entryDate,
            txType: "PAYROLL_STATUS_CHANGE",
            referenceId: id,
            referenceTable: "factory_payrolls",
            description: `Payroll #${id} status changed from ${existing.status} to ${status}`,
            amountCurrency: netSalary,
            amountUsd: netSalary,
          });
        }
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating payroll:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/payroll/export-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const { companyId, startDate, endDate } = req.body;
      if (!companyId || !startDate || !endDate) {
        return res.status(400).json({ message: "companyId, startDate, and endDate are required" });
      }

      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      const companyName = company?.name || "Company";

      const payrollData = await db
        .select({
          payroll: factoryPayrolls,
          workerName: factoryWorkers.fullName,
          workerCode: factoryWorkers.employeeCode,
          workerPosition: factoryWorkers.position,
        })
        .from(factoryPayrolls)
        .leftJoin(factoryWorkers, eq(factoryPayrolls.workerId, factoryWorkers.id))
        .where(and(
          eq(factoryPayrolls.companyId, companyId),
          gte(factoryPayrolls.periodStart, startDate),
          lte(factoryPayrolls.periodEnd, endDate),
        ))
        .orderBy(factoryWorkers.fullName);

      const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=payroll_${startDate}_${endDate}.pdf`);
      doc.pipe(res);

      doc.fontSize(16).text(companyName, { align: "center" });
      doc.fontSize(12).text("Factory Payroll Report", { align: "center" });
      doc.fontSize(10).text(`Period: ${startDate} to ${endDate}`, { align: "center" });
      doc.moveDown(1);

      // Columns: Code | Name | Days(P/T) | Absent | Base | Bale | KG | OT | Bonus | Deduct | Net
      const headers = ["Code", "Name", "Days", "Absent", "Base", "Bale", "KG", "OT", "Bonus", "Deduct", "Net"];
      const colWidths = [50, 110, 55, 50, 62, 55, 55, 50, 50, 52, 65];
      const startX = 30;
      let y = doc.y;

      doc.fontSize(8).font("Helvetica-Bold");
      let x = startX;
      headers.forEach((h, i) => {
        doc.text(h, x, y, { width: colWidths[i], align: i >= 2 ? "right" : "left" });
        x += colWidths[i];
      });

      y += 15;
      doc.moveTo(startX, y).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), y).stroke();
      y += 5;

      doc.font("Helvetica").fontSize(7);

      let totals = { base: 0, bale: 0, kg: 0, ot: 0, bonus: 0, deduct: 0, net: 0 };

      for (const row of payrollData) {
        const p = row.payroll;
        const base = parseFloat(p.baseSalary || "0");
        const bale = parseFloat(p.baleEarnings || "0");
        const kg = parseFloat(p.kgEarnings || "0");
        const ot = parseFloat(p.overtimePay || "0");
        const bonus = parseFloat(p.bonuses || "0");
        const deduct = parseFloat(p.deductions || "0");
        const net = parseFloat(p.netSalary || "0");
        const totalDays = p.totalWorkingDays || 0;
        const present = parseFloat(p.presentDays || "0");
        const absent = parseFloat(p.absentDays || "0");

        totals.base += base;
        totals.bale += bale;
        totals.kg += kg;
        totals.ot += ot;
        totals.bonus += bonus;
        totals.deduct += deduct;
        totals.net += net;

        if (y > 550) {
          doc.addPage();
          y = 30;
        }

        const daysLabel = totalDays > 0 ? `${present % 1 === 0 ? present.toFixed(0) : present}/${totalDays}` : "—";
        const absentLabel = totalDays > 0 ? (absent % 1 === 0 ? absent.toFixed(0) : String(absent)) : "—";

        const values = [
          row.workerCode || "-",
          row.workerName || "-",
          daysLabel,
          absentLabel,
          base.toFixed(2),
          bale.toFixed(2),
          kg.toFixed(2),
          ot.toFixed(2),
          bonus.toFixed(2),
          deduct.toFixed(2),
          net.toFixed(2),
        ];

        x = startX;
        values.forEach((v, i) => {
          doc.text(v, x, y, { width: colWidths[i], align: i >= 2 ? "right" : "left" });
          x += colWidths[i];
        });
        y += 12;
      }

      y += 5;
      doc.moveTo(startX, y).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), y).stroke();
      y += 5;

      doc.font("Helvetica-Bold").fontSize(8);
      const totalValues = [
        "", "TOTALS", "", "",
        totals.base.toFixed(2), totals.bale.toFixed(2), totals.kg.toFixed(2),
        totals.ot.toFixed(2), totals.bonus.toFixed(2), totals.deduct.toFixed(2),
        totals.net.toFixed(2),
      ];
      x = startX;
      totalValues.forEach((v, i) => {
        doc.text(v, x, y, { width: colWidths[i], align: i >= 2 ? "right" : "left" });
        x += colWidths[i];
      });

      doc.end();
    } catch (error: any) {
      console.error("Error exporting payroll PDF:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/payroll/export-excel", requireAuth, async (req: any, res: any) => {
    try {
      const { companyId, startDate, endDate } = req.body;
      if (!companyId || !startDate || !endDate) {
        return res.status(400).json({ message: "companyId, startDate, and endDate are required" });
      }

      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      const companyName = company?.name || "Company";

      const payrollData = await db
        .select({
          payroll: factoryPayrolls,
          worker: factoryWorkers,
        })
        .from(factoryPayrolls)
        .leftJoin(factoryWorkers, eq(factoryPayrolls.workerId, factoryWorkers.id))
        .where(and(
          eq(factoryPayrolls.companyId, companyId),
          gte(factoryPayrolls.periodStart, startDate),
          lte(factoryPayrolls.periodEnd, endDate),
        ))
        .orderBy(factoryWorkers.fullName);

      const workbook = new ExcelJS.Workbook();

      const summarySheet = workbook.addWorksheet("Payroll Summary");
      summarySheet.columns = [
        { header: "Employee Code", key: "code", width: 15 },
        { header: "Name", key: "name", width: 25 },
        { header: "Position", key: "position", width: 18 },
        { header: "Salary Type", key: "salaryType", width: 14 },
        { header: "Working Days", key: "totalDays", width: 13 },
        { header: "Present Days", key: "presentDays", width: 13 },
        { header: "Absent Days", key: "absentDays", width: 13 },
        { header: "Base Salary", key: "base", width: 14 },
        { header: "Bale Earnings", key: "bale", width: 14 },
        { header: "KG Earnings", key: "kg", width: 14 },
        { header: "Overtime Pay", key: "ot", width: 14 },
        { header: "Bonuses", key: "bonus", width: 12 },
        { header: "Deductions", key: "deduct", width: 12 },
        { header: "Advances", key: "advance", width: 12 },
        { header: "Net Salary", key: "net", width: 14 },
        { header: "Bales Count", key: "balesCount", width: 12 },
        { header: "KG Processed", key: "kgProcessed", width: 14 },
        { header: "Status", key: "status", width: 12 },
      ];

      const headerRow = summarySheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.alignment = { horizontal: "center" };

      for (const row of payrollData) {
        const p = row.payroll;
        const w = row.worker;
        summarySheet.addRow({
          code: w?.employeeCode || "-",
          name: w?.fullName || "-",
          position: w?.position || "-",
          salaryType: w?.salaryType || "-",
          totalDays: p.totalWorkingDays || 0,
          presentDays: parseFloat(p.presentDays || "0"),
          absentDays: parseFloat(p.absentDays || "0"),
          base: parseFloat(p.baseSalary || "0"),
          bale: parseFloat(p.baleEarnings || "0"),
          kg: parseFloat(p.kgEarnings || "0"),
          ot: parseFloat(p.overtimePay || "0"),
          bonus: parseFloat(p.bonuses || "0"),
          deduct: parseFloat(p.deductions || "0"),
          advance: parseFloat(p.advances || "0"),
          net: parseFloat(p.netSalary || "0"),
          balesCount: p.balesCount || 0,
          kgProcessed: parseFloat(p.kgProcessed || "0"),
          status: p.status,
        });
      }

      ["base", "bale", "kg", "ot", "bonus", "deduct", "advance", "net", "kgProcessed", "presentDays", "absentDays"].forEach((key) => {
        const col = summarySheet.getColumn(key);
        col.numFmt = "#,##0.0";
      });

      const detailsSheet = workbook.addWorksheet("Worker Details");
      detailsSheet.columns = [
        { header: "Employee Code", key: "code", width: 15 },
        { header: "Full Name", key: "name", width: 25 },
        { header: "Position", key: "position", width: 18 },
        { header: "Department", key: "department", width: 18 },
        { header: "Salary Type", key: "salaryType", width: 14 },
        { header: "Base Salary", key: "baseSalary", width: 14 },
        { header: "Per Bale Rate", key: "perBaleRate", width: 14 },
        { header: "Per KG Rate", key: "perKgRate", width: 14 },
        { header: "Overtime Rate", key: "overtimeRate", width: 14 },
        { header: "Phone", key: "phone", width: 16 },
        { header: "Date Joined", key: "dateJoined", width: 14 },
        { header: "Payment Method", key: "paymentMethod", width: 16 },
      ];

      const detailsHeaderRow = detailsSheet.getRow(1);
      detailsHeaderRow.font = { bold: true };
      detailsHeaderRow.alignment = { horizontal: "center" };

      const seenWorkers = new Set<number>();
      for (const row of payrollData) {
        const w = row.worker;
        if (!w || seenWorkers.has(w.id)) continue;
        seenWorkers.add(w.id);
        detailsSheet.addRow({
          code: w.employeeCode || "-",
          name: w.fullName || "-",
          position: w.position || "-",
          department: w.department || "-",
          salaryType: w.salaryType || "-",
          baseSalary: parseFloat(w.baseSalary || "0"),
          perBaleRate: parseFloat(w.perBaleRate || "0"),
          perKgRate: parseFloat(w.perKgRate || "0"),
          overtimeRate: parseFloat(w.overtimeRate || "0"),
          phone: w.phone1 || "-",
          dateJoined: w.dateJoined || "-",
          paymentMethod: w.paymentMethod || "-",
        });
      }

      ["baseSalary", "perBaleRate", "perKgRate", "overtimeRate"].forEach((key) => {
        const col = detailsSheet.getColumn(key);
        col.numFmt = "#,##0.00";
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=payroll_${startDate}_${endDate}.xlsx`);

      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting payroll Excel:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
