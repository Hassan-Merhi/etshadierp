import type { Express } from "express";
import { registerEmployeeCrudRoutes } from "./employee-pos/employeeCrudRoutes";
import { registerEmployeeAdvancesBonusRoutes } from "./employee-pos/employeeAdvancesBonusRoutes";
import { registerEmployeeLedgerWasteRoutes } from "./employee-pos/employeeLedgerWasteRoutes";
import { registerEmployeePosFinancialRoutes } from "./employee-pos/employeePosFinancialRoutes";
import { registerEmployeeNetPositionRoutes } from "./employee-pos/employeeNetPositionRoutes";
import { registerEmployeeAttendanceRoutes } from "./employee-pos/employeeAttendanceRoutes";

export function registerFactoryEmployeesPosRoutes(app: Express) {
  registerEmployeeCrudRoutes(app);
  registerEmployeeAdvancesBonusRoutes(app);
  registerEmployeeLedgerWasteRoutes(app);
  registerEmployeePosFinancialRoutes(app);
  registerEmployeeNetPositionRoutes(app);
  registerEmployeeAttendanceRoutes(app);
}
