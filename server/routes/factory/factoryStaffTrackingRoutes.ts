import type { Express, Request, Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { factoryStaffTrackingMessages } from "../../i18n/factoryStaffTrackingMessages";
import { getErrorMessage } from "../../lib/httpHandlers";
import { resultRows } from "../../lib/queryResult";
import { sqlArray } from "../../lib/sqlArray";
import { employees, factoryAttendance, factoryWorkers } from "@shared/schema";

type TrackingPage = "production" | "attendance";
type PeriodType = "daily" | "weekly" | "monthly";
type PersonType = "worker" | "employee";
type TrackingStatus = "Present" | "Absent" | "New";

const PAGE_TYPES = new Set<TrackingPage>(["production", "attendance"]);
const PERIOD_TYPES = new Set<PeriodType>(["daily", "weekly", "monthly"]);
const STATUSES = new Set<TrackingStatus>(["Present", "Absent", "New"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function getFactoryCompanyId(req: Request): number | undefined {
  return req.session.factoryCompanyId || req.session.currentCompanyId;
}

function parseTrackingQuery(req: Request): {
  page: TrackingPage;
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
} | null {
  const page = String(req.query.page || "") as TrackingPage;
  const periodType = String(req.query.periodType || "") as PeriodType;
  const periodStart = String(req.query.periodStart || "");
  const periodEnd = String(req.query.periodEnd || "");
  if (!PAGE_TYPES.has(page) || !PERIOD_TYPES.has(periodType)) return null;
  if (!ISO_DATE.test(periodStart) || !ISO_DATE.test(periodEnd) || periodEnd < periodStart) return null;
  return { page, periodType, periodStart, periodEnd };
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function isNew(joinDate: string | null | undefined, start: string, end: string): boolean {
  return Boolean(joinDate && joinDate >= start && joinDate <= end);
}

function joinedByPeriodEnd(joinDate: string | null | undefined, periodEnd: string): boolean {
  return !joinDate || joinDate <= periodEnd;
}

export function registerFactoryStaffTrackingRoutes(app: Express): void {
  app.get("/api/factory/staff-tracking", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: factoryStaffTrackingMessages.noFactoryCompany });
      const query = parseTrackingQuery(req);
      if (!query) return res.status(400).json({ message: factoryStaffTrackingMessages.invalidPeriod });

      const savedResult = await db.execute(sql`
        SELECT
          person_type AS "personType",
          person_id AS "personId",
          category,
          target_bales AS "targetBales",
          produced_bales AS "producedBales",
          status,
          notes
        FROM factory_staff_tracking_entries
        WHERE company_id = ${companyId}
          AND page_type = ${query.page}
          AND period_type = ${query.periodType}
          AND period_start = ${query.periodStart}
          AND period_end = ${query.periodEnd}
      `);
      const saved = resultRows(savedResult) as Array<{
        personType: PersonType;
        personId: number;
        category: string | null;
        targetBales: string | null;
        producedBales: string | null;
        status: TrackingStatus;
        notes: string | null;
      }>;
      const savedMap = new Map(saved.map((row) => [`${row.personType}:${row.personId}`, row]));

      const workers = await db
        .select({
          id: factoryWorkers.id,
          fullName: factoryWorkers.fullName,
          employeeCode: factoryWorkers.employeeCode,
          department: factoryWorkers.department,
          position: factoryWorkers.position,
          dateJoined: factoryWorkers.dateJoined,
          active: factoryWorkers.active,
        })
        .from(factoryWorkers)
        .where(eq(factoryWorkers.companyId, companyId))
        .orderBy(factoryWorkers.fullName);

      const emps = await db
        .select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          code: employees.code,
          department: employees.department,
          joinDate: employees.joinDate,
          active: employees.active,
        })
        .from(employees)
        .where(and(eq(employees.companyId, companyId), eq(employees.employeeType, "Employee"), sql`${employees.deletedAt} IS NULL`))
        .orderBy(employees.firstName, employees.lastName);

      const includedWorkers = workers.filter(
        (person) =>
          savedMap.has(`worker:${person.id}`) || (person.active && joinedByPeriodEnd(person.dateJoined, query.periodEnd))
      );
      const includedEmployees = emps.filter(
        (person) =>
          savedMap.has(`employee:${person.id}`) || (person.active && joinedByPeriodEnd(person.joinDate, query.periodEnd))
      );

      const workerAttendance = new Map<number, string>();
      const employeeAttendance = new Map<number, string>();
      if (query.periodType === "daily") {
        const workerIds = includedWorkers.map((worker) => worker.id);
        if (workerIds.length > 0) {
          const rows = await db
            .select({ workerId: factoryAttendance.workerId, status: factoryAttendance.status })
            .from(factoryAttendance)
            .where(
              and(
                eq(factoryAttendance.companyId, companyId),
                eq(factoryAttendance.attendanceDate, query.periodStart),
                inArray(factoryAttendance.workerId, workerIds)
              )
            );
          rows.forEach((row) => workerAttendance.set(row.workerId, row.status));
        }

        const employeeIds = includedEmployees.map((employee) => employee.id);
        if (employeeIds.length > 0) {
          const attendanceResult = await db.execute(sql`
            SELECT employee_id AS "employeeId", status
            FROM employee_attendance
            WHERE company_id = ${companyId}
              AND attendance_date = ${query.periodStart}
              AND employee_id = ANY(${sqlArray(employeeIds)})
          `);
          const rows = resultRows(attendanceResult) as Array<{ employeeId: number; status: string }>;
          rows.forEach((row) => employeeAttendance.set(Number(row.employeeId), row.status));
        }
      }

      const workerRows = includedWorkers.map((worker) => {
        const savedRow = savedMap.get(`worker:${worker.id}`);
        const attendanceStatus = workerAttendance.get(worker.id);
        const defaultStatus: TrackingStatus = isNew(worker.dateJoined, query.periodStart, query.periodEnd)
          ? "New"
          : attendanceStatus === "Absent"
            ? "Absent"
            : "Present";
        return {
          personType: "worker" as const,
          personId: worker.id,
          name: worker.fullName,
          code: worker.employeeCode,
          category: savedRow?.category ?? worker.position ?? worker.department ?? "",
          targetBales: savedRow?.targetBales === null || savedRow?.targetBales === undefined ? null : Number(savedRow.targetBales),
          producedBales: savedRow?.producedBales === null || savedRow?.producedBales === undefined ? null : Number(savedRow.producedBales),
          status: savedRow?.status ?? defaultStatus,
          notes: savedRow?.notes ?? "",
          active: worker.active,
        };
      });

      const employeeRows = includedEmployees.map((employee) => {
        const savedRow = savedMap.get(`employee:${employee.id}`);
        const attendanceStatus = employeeAttendance.get(employee.id);
        const defaultStatus: TrackingStatus = isNew(employee.joinDate, query.periodStart, query.periodEnd)
          ? "New"
          : attendanceStatus === "Absent"
            ? "Absent"
            : "Present";
        return {
          personType: "employee" as const,
          personId: employee.id,
          name: `${employee.firstName} ${employee.lastName}`.trim(),
          code: employee.code,
          category: savedRow?.category ?? employee.department ?? "",
          targetBales: savedRow?.targetBales === null || savedRow?.targetBales === undefined ? null : Number(savedRow.targetBales),
          producedBales: savedRow?.producedBales === null || savedRow?.producedBales === undefined ? null : Number(savedRow.producedBales),
          status: savedRow?.status ?? defaultStatus,
          notes: savedRow?.notes ?? "",
          active: employee.active,
        };
      });

      res.json({
        page: query.page,
        periodType: query.periodType,
        periodStart: query.periodStart,
        periodEnd: query.periodEnd,
        rows: [...workerRows, ...employeeRows],
      });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/factory/staff-tracking/bulk", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getFactoryCompanyId(req);
      if (!companyId) return res.status(400).json({ message: factoryStaffTrackingMessages.noFactoryCompany });

      const page = String(req.body?.page || "") as TrackingPage;
      const periodType = String(req.body?.periodType || "") as PeriodType;
      const periodStart = String(req.body?.periodStart || "");
      const periodEnd = String(req.body?.periodEnd || "");
      const records = Array.isArray(req.body?.records) ? req.body.records : [];
      if (!PAGE_TYPES.has(page) || !PERIOD_TYPES.has(periodType) || !ISO_DATE.test(periodStart) || !ISO_DATE.test(periodEnd) || periodEnd < periodStart) {
        return res.status(400).json({ message: factoryStaffTrackingMessages.invalidPeriod });
      }
      if (records.length === 0 || records.length > 500) {
        return res.status(400).json({ message: factoryStaffTrackingMessages.invalidRecordCount });
      }

      const allWorkers = await db.select({ id: factoryWorkers.id }).from(factoryWorkers).where(eq(factoryWorkers.companyId, companyId));
      const allEmployees = await db
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.companyId, companyId), eq(employees.employeeType, "Employee"), sql`${employees.deletedAt} IS NULL`));
      const workerIds = new Set(allWorkers.map((row) => row.id));
      const employeeIds = new Set(allEmployees.map((row) => row.id));

      for (const raw of records) {
        const personType = String(raw?.personType || "") as PersonType;
        const personId = Number(raw?.personId);
        const status = String(raw?.status || "Present") as TrackingStatus;
        if (!Number.isInteger(personId) || personId <= 0 || !STATUSES.has(status)) {
          return res.status(400).json({ message: factoryStaffTrackingMessages.invalidRow });
        }
        if ((personType === "worker" && !workerIds.has(personId)) || (personType === "employee" && !employeeIds.has(personId))) {
          return res.status(400).json({ message: factoryStaffTrackingMessages.personOutsideFactory });
        }
        if (personType !== "worker" && personType !== "employee") {
          return res.status(400).json({ message: factoryStaffTrackingMessages.invalidPersonType });
        }

        const category = String(raw?.category || "").trim().slice(0, 150) || null;
        const notes = String(raw?.notes || "").trim().slice(0, 4000) || null;
        const targetBales = numberOrNull(raw?.targetBales);
        const producedBales = numberOrNull(raw?.producedBales);
        if ((raw?.targetBales !== null && raw?.targetBales !== undefined && raw?.targetBales !== "" && targetBales === null) ||
            (raw?.producedBales !== null && raw?.producedBales !== undefined && raw?.producedBales !== "" && producedBales === null)) {
          return res.status(400).json({ message: factoryStaffTrackingMessages.invalidBaleNumbers });
        }

        await db.execute(sql`
          INSERT INTO factory_staff_tracking_entries (
            company_id, page_type, period_type, period_start, period_end,
            person_type, person_id, category, target_bales, produced_bales,
            status, notes, created_by, updated_at
          ) VALUES (
            ${companyId}, ${page}, ${periodType}, ${periodStart}, ${periodEnd},
            ${personType}, ${personId}, ${category}, ${targetBales}, ${producedBales},
            ${status}, ${notes}, ${req.session.userId || null}, now()
          )
          ON CONFLICT (company_id, page_type, period_type, period_start, period_end, person_type, person_id)
          DO UPDATE SET
            category = EXCLUDED.category,
            target_bales = EXCLUDED.target_bales,
            produced_bales = EXCLUDED.produced_bales,
            status = EXCLUDED.status,
            notes = EXCLUDED.notes,
            updated_at = now()
        `);
      }

      res.json({ success: true, saved: records.length });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
