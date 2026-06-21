import type { Express } from "express";
import { registerEmployeeCrudRoutes } from "./employeeCrudRoutes";
import { registerEmployeeAdvancesBonusRoutes } from "./employeeAdvancesBonusRoutes";
import { registerEmployeeLedgerWasteRoutes } from "./employeeLedgerWasteRoutes";
import { registerEmployeePosFinancialRoutes } from "./employeePosFinancialRoutes";
import { registerEmployeeNetPositionRoutes } from "./employeeNetPositionRoutes";
import { registerEmployeeAttendanceRoutes } from "./employeeAttendanceRoutes";

export function registerFactoryEmployeesPosRoutes(app: Express) {
  registerEmployeeCrudRoutes(app);
  registerEmployeeAdvancesBonusRoutes(app);
  registerEmployeeLedgerWasteRoutes(app);
  registerEmployeePosFinancialRoutes(app);
  registerEmployeeNetPositionRoutes(app);
  registerEmployeeAttendanceRoutes(app);
}
