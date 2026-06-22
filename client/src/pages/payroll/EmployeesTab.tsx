import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  Receipt, Plus, ChevronDown, ArrowDownCircle, Gift, ArrowUpCircle, 
  TrendingUp, DollarSign, TrendingDown, Pencil, Trash2 
} from "lucide-react";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import type { Employee } from "@shared/schema";
import { getEmpAvatarColor, getEmpInitials } from "./payrollSchemas";

interface EmployeesTabProps {
  empSearch: string;
  setEmpSearch: (val: string) => void;
  empStatusFilter: string;
  setEmpStatusFilter: (val: string) => void;
  setCreateEmployeeDialogOpen: (val: boolean) => void;
  employeeStaff: (Employee & { calculatedBalance: string })[];
  filteredEmployeeStaff: (Employee & { calculatedBalance: string })[];
  pendingBonuses: Record<number, any>;
  setBulkDepositSelections: (val: Record<number, boolean>) => void;
  setBulkDepositDialogOpen: (val: boolean) => void;
  setBulkBonusAmounts: (val: Record<number, string>) => void;
  setBulkBonusStep: (val: "edit" | "preview") => void;
  setBulkBonusDialogOpen: (val: boolean) => void;
  setBulkWithdrawalAmounts: (val: Record<number, string>) => void;
  setBulkWithdrawalAccountId: (val: string) => void;
  setBulkWithdrawalDialogOpen: (val: boolean) => void;
  setStatementEmployee: (val: (Employee & { calculatedBalance?: string }) | null) => void;
  handleDeposit: (emp: Employee) => void;
  handleBonus: (emp: Employee) => void;
  handleWithdrawal: (emp: Employee) => void;
  setEditingEmployee: (emp: Employee | null) => void;
  setEditEmployeeDialogOpen: (val: boolean) => void;
  handleDeleteEmployee: (emp: Employee) => void;
}

export function EmployeesTab({
  empSearch,
  setEmpSearch,
  empStatusFilter,
  setEmpStatusFilter,
  setCreateEmployeeDialogOpen,
  employeeStaff,
  filteredEmployeeStaff,
  pendingBonuses,
  setBulkDepositSelections,
  setBulkDepositDialogOpen,
  setBulkBonusAmounts,
  setBulkBonusStep,
  setBulkBonusDialogOpen,
  setBulkWithdrawalAmounts,
  setBulkWithdrawalAccountId,
  setBulkWithdrawalDialogOpen,
  setStatementEmployee,
  handleDeposit,
  handleBonus,
  handleWithdrawal,
  setEditingEmployee,
  setEditEmployeeDialogOpen,
  handleDeleteEmployee,
}: EmployeesTabProps) {
  const { formatAmount } = useCurrencyContext();

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Receipt className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search employees..."
            value={empSearch}
            onChange={(e) => setEmpSearch(e.target.value)}
            className="pl-9"
            data-testid="input-employee-search"
          />
        </div>
        <div className="flex gap-1">
          {["Active", "Inactive", "All"].map((s) => (
            <Button
              key={s}
              size="sm"
              variant={empStatusFilter === s ? "default" : "outline"}
              onClick={() => setEmpStatusFilter(s)}
              data-testid={`button-emp-filter-${s.toLowerCase()}`}
            >
              {s}
            </Button>
          ))}
        </div>
        <Button size="sm" onClick={() => setCreateEmployeeDialogOpen(true)} data-testid="button-create-employee">
          <Plus className="h-4 w-4 mr-2" />
          New Employee
        </Button>
      </div>

      <div className="space-y-4">
        {/* Payroll Actions */}
        {employeeStaff.length > 0 && (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" data-testid="button-open-payroll-actions">
                  Payroll Actions
                  {Object.keys(pendingBonuses).length > 0 && (
                    <Badge className="ml-2" variant="default">
                      {Object.keys(pendingBonuses).length}
                    </Badge>
                  )}
                  <ChevronDown className="h-3.5 w-3.5 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => { setBulkDepositSelections({}); setBulkDepositDialogOpen(true); }}
                  data-testid="button-open-bulk-deposit"
                >
                  <ArrowDownCircle className="h-4 w-4 mr-2" /> Bulk Deposit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    const fromPending: Record<number, string> = {};
                    for (const [empId, pb] of Object.entries(pendingBonuses)) {
                      fromPending[parseInt(empId)] = (pb as any).amount.toFixed(2);
                    }
                    setBulkBonusAmounts(fromPending);
                    setBulkBonusStep("edit");
                    setBulkBonusDialogOpen(true);
                  }}
                  data-testid="button-open-bulk-bonus"
                >
                  <Gift className="h-4 w-4 mr-2" /> Bulk Bonus Deposit
                  {Object.keys(pendingBonuses).length > 0 && (
                    <Badge className="ml-2" variant="default">
                      {Object.keys(pendingBonuses).length}
                    </Badge>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => { setBulkWithdrawalAmounts({}); setBulkWithdrawalAccountId(""); setBulkWithdrawalDialogOpen(true); }}
                  data-testid="button-open-bulk-withdrawal"
                >
                  <ArrowUpCircle className="h-4 w-4 mr-2" /> Bulk Withdrawal
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {employeeStaff.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No employees found</p>
            <p className="text-sm mt-2">Create employees from the Create Master Data page</p>
          </div>
        ) : filteredEmployeeStaff.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No employees match your search</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredEmployeeStaff.map((employee) => {
              const balance = parseFloat(employee.calculatedBalance || "0");
              const initials = getEmpInitials(employee.firstName, employee.lastName);
              const avatarColor = getEmpAvatarColor(`${employee.firstName}${employee.lastName}`);
              return (
                <Card key={employee.id} data-testid={`card-employee-${employee.id}`}>
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      {/* Avatar + Name — fixed width so stats align across all cards */}
                      <div className="flex items-center gap-3 w-56 shrink-0 min-w-0">
                        <Avatar className="h-10 w-10 shrink-0">
                          <AvatarFallback className={`text-sm font-bold ${avatarColor}`}>
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              onClick={() => setStatementEmployee(employee)}
                              className="font-semibold text-base hover:underline cursor-pointer truncate"
                              data-testid={`link-employee-statement-${employee.id}`}
                            >
                              {employee.firstName} {employee.lastName}
                            </button>
                            {!employee.active && (
                              <Badge variant="secondary" className="text-xs">Inactive</Badge>
                            )}
                          </div>
                          {employee.department && (
                            <p className="text-xs text-muted-foreground truncate">{employee.department}</p>
                          )}
                        </div>
                      </div>

                      {/* Stats — equal-width columns, fills remaining space */}
                      <div className="grid grid-cols-4 flex-1 min-w-0">
                        <div>
                          <p className="text-xs text-muted-foreground">Salary</p>
                          <p className="font-mono text-sm font-medium">{formatAmount(parseFloat(employee.monthlySalary))}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Balance</p>
                          <p className={`font-mono text-sm font-bold ${balance >= 0 ? "text-green-500 dark:text-green-400" : "text-destructive"}`}>
                            {formatAmount(balance)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Deposits</p>
                          <p className="font-mono text-sm text-muted-foreground">{formatAmount(parseFloat(employee.totalDeposits || "0"))}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Withdrawals</p>
                          <p className="font-mono text-sm text-muted-foreground">{formatAmount(parseFloat(employee.totalWithdrawals || "0"))}</p>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" data-testid={`button-actions-${employee.id}`}>
                              Actions <ChevronDown className="h-3.5 w-3.5 ml-1" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleDeposit(employee)} data-testid={`button-deposit-${employee.id}`}>
                              <TrendingUp className="h-4 w-4 mr-2" /> Deposit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleBonus(employee)} data-testid={`button-bonus-${employee.id}`}>
                              <DollarSign className="h-4 w-4 mr-2" /> Bonus
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleWithdrawal(employee)} data-testid={`button-withdraw-${employee.id}`}>
                              <TrendingDown className="h-4 w-4 mr-2" /> Withdraw
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button size="icon" variant="ghost" onClick={() => { setEditingEmployee(employee); setEditEmployeeDialogOpen(true); }} data-testid={`button-edit-${employee.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <ConfirmationDialog
                          trigger={
                            <Button size="icon" variant="ghost" className="text-destructive" data-testid={`button-delete-${employee.id}`}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          }
                          title="Delete Employee"
                          description={`Are you sure you want to delete ${[employee.firstName, employee.lastName].filter(Boolean).join(" ")}? This action cannot be undone.`}
                          confirmText="Delete"
                          variant="destructive"
                          onConfirm={() => handleDeleteEmployee(employee)}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
