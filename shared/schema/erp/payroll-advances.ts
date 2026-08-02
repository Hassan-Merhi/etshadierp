import { pgTable, text, serial, integer, decimal, date, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { employees } from "./parties";
import { vouchers } from "./vouchers";

export const salaryAdvances = pgTable(
  "salary_advances",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").notNull(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    advanceDate: date("advance_date").notNull(),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
    remainingBalance: decimal("remaining_balance", { precision: 15, scale: 2 }).notNull(),
    voucherId: integer("voucher_id").references(() => vouchers.id, { onDelete: "restrict" }),
    notes: text("notes"),
    fullyPaid: boolean("fully_paid").notNull().default(false),
    isOpeningBalance: boolean("is_opening_balance").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("salary_advances_company_idx").on(t.companyId),
  })
);

export const insertSalaryAdvanceSchema = createInsertSchema(salaryAdvances)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    companyId: z.number().min(1, "Company is required"),
    employeeId: z.number().min(1, "Employee is required"),
    advanceDate: z.string().min(1, "Advance date is required"),
    amount: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Amount must be positive"),
    remainingBalance: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Remaining balance must be non-negative"),
    isOpeningBalance: z.boolean().optional().default(false),
  });

export type InsertSalaryAdvance = z.infer<typeof insertSalaryAdvanceSchema>;
export type SalaryAdvance = typeof salaryAdvances.$inferSelect;

export const salaryAdvanceDeductions = pgTable("salary_advance_deductions", {
  id: serial("id").primaryKey(),
  salaryAdvanceId: integer("salary_advance_id")
    .notNull()
    .references(() => salaryAdvances.id, { onDelete: "cascade" }),
  payrollMonth: text("payroll_month").notNull(),
  deductionAmount: decimal("deduction_amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSalaryAdvanceDeductionSchema = createInsertSchema(salaryAdvanceDeductions)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    salaryAdvanceId: z.number().min(1, "Salary advance is required"),
    payrollMonth: z.string().min(1, "Payroll month is required"),
    deductionAmount: z
      .string()
      .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Deduction amount must be positive"),
  });

export type InsertSalaryAdvanceDeduction = z.infer<typeof insertSalaryAdvanceDeductionSchema>;
export type SalaryAdvanceDeduction = typeof salaryAdvanceDeductions.$inferSelect;
