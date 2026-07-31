/**
 * employeeCrudRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerFactoryEmployeeCrudRoutes } from "./crud";
import { registerFactoryEmployeeCashRoutes } from "./cash";
import { registerFactoryEmployeeBulkPayrollRoutes } from "./bulk-payroll";
import { registerFactoryEmployeeRecalculateRoutes } from "./recalculate";
import { registerFactoryEmployeePayrollPreviewRoutes } from "./payroll-preview";
import { registerFactoryEmployeeAttendanceRoutes } from "./attendance";
import { registerFactoryEmployeeBulkWithdrawRoutes } from "./bulk-withdraw";

export function registerEmployeeCrudRoutes(app: Express) {
  registerFactoryEmployeeCrudRoutes(app);
  registerFactoryEmployeeCashRoutes(app);
  registerFactoryEmployeeBulkPayrollRoutes(app);
  registerFactoryEmployeeRecalculateRoutes(app);
  registerFactoryEmployeePayrollPreviewRoutes(app);
  registerFactoryEmployeeAttendanceRoutes(app);
  registerFactoryEmployeeBulkWithdrawRoutes(app);
}
