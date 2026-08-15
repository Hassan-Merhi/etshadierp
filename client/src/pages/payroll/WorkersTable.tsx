import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MinusCircle, Pencil, Trash2, ChevronDown, AlertCircle } from "lucide-react";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { cn } from "@/lib/utils";
import type { Employee } from "@shared/schema";
import { getEmpAvatarColor, getEmpInitials } from "./payrollSchemas";

interface WorkersTableProps {
  workers: Employee[];
  workerPayments: Record<number, any>;
  workerGroups: any[];
  handleToggleWorker: (id: number) => void;
  handleUpdateAmount: (id: number, val: string) => void;
  handleDeleteWorker: (worker: Employee) => void;
  setStatementEmployee: (val: Employee | null) => void;
  setWorkerOverrides: (val: any) => void;
  formatAmount: (amt: number) => string;
  addWorkerToWorkerGroupMutation?: any;
  groupId?: number;
  setWorkerDeductionTarget?: (val: Employee | null) => void;
  setSelectedWorkerForEdit?: (val: Employee | null) => void;
  setEditWorkerDialogOpen?: (val: boolean) => void;
}

export function WorkersTable({
  workers,
  workerPayments,
  workerGroups,
  handleToggleWorker,
  handleUpdateAmount,
  handleDeleteWorker,
  setStatementEmployee,
  setWorkerOverrides,
  formatAmount,
  addWorkerToWorkerGroupMutation,
  groupId,
  setWorkerDeductionTarget,
  setSelectedWorkerForEdit,
  setEditWorkerDialogOpen,
}: WorkersTableProps) {
  if (workers.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        No workers in this group
      </div>
    );
  }

  return (
    <div className="space-y-2 p-3">
      {workers.map((worker: Employee) => {
        const advanceInfo = (worker as any).advanceInfo || { total: 0, count: 0 };
        const deductionInfo = (worker as any).deductionInfo || { total: 0, count: 0 };
        const monthlySalary = parseFloat(worker.monthlySalary || "0");
        const balance = parseFloat((worker as any).calculatedBalance || "0");
        const paymentAmount = parseFloat(workerPayments[worker.id]?.amount || "0");
        const isSelected = workerPayments[worker.id]?.selected || false;
        const hasNegativePayment = paymentAmount < 0;
        const initials = getEmpInitials(worker.firstName, worker.lastName);
        const avatarColor = getEmpAvatarColor(`${worker.firstName}${worker.lastName}`);

        return (
          <Card
            key={worker.id}
            data-testid={`card-worker-${worker.id}`}
            className={cn(isSelected && "ring-1 ring-primary/40 bg-primary/5")}
          >
            <CardContent className="p-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">

                {/* Checkbox + Avatar + Name */}
                <div className="flex items-center gap-3 w-52 shrink-0 min-w-0">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => handleToggleWorker(worker.id)}
                    data-testid={`checkbox-worker-${worker.id}`}
                  />
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback className={`text-xs font-bold ${avatarColor}`}>{initials}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <button
                      onClick={() => setStatementEmployee(worker)}
                      className="font-semibold text-sm hover:underline cursor-pointer truncate block text-left"
                      data-testid={`link-worker-statement-${worker.id}`}
                    >
                      {[worker.firstName, worker.lastName].filter(Boolean).join(" ")}
                    </button>
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 flex-1 min-w-0 gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Salary</p>
                    <p className="font-mono text-sm font-medium">{formatAmount(monthlySalary)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Advances</p>
                    <p className={cn("font-mono text-sm", advanceInfo.total > 0 ? "text-destructive" : "text-muted-foreground")}>
                      {advanceInfo.total > 0 ? (
                        <>
                          {formatAmount(advanceInfo.total)}
                          {advanceInfo.count > 0 && (
                            <span className="text-xs ml-1 opacity-70">({advanceInfo.count})</span>
                          )}
                        </>
                      ) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Deductions</p>
                    <p className={cn("font-mono text-sm", deductionInfo.total > 0 ? "text-orange-500" : "text-muted-foreground")}>
                      {deductionInfo.total > 0 ? (
                        <>
                          {formatAmount(deductionInfo.total)}
                          {deductionInfo.count > 0 && (
                            <span className="text-xs ml-1 opacity-70">({deductionInfo.count})</span>
                          )}
                        </>
                      ) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Pay Amount</p>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        step="0.01"
                        value={workerPayments[worker.id]?.amount || "0"}
                        onChange={(e) => handleUpdateAmount(worker.id, e.target.value)}
                        className={cn(
                          "w-24 h-7 text-xs text-right font-mono px-2",
                          hasNegativePayment && "border-destructive"
                        )}
                        data-testid={`input-amount-${worker.id}`}
                      />
                      {hasNegativePayment && <AlertCircle className="h-3 w-3 text-destructive shrink-0" />}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {!groupId && workerGroups.length > 0 && addWorkerToWorkerGroupMutation && (
                    <Select
                      onValueChange={(gid) => addWorkerToWorkerGroupMutation.mutate({ groupId: parseInt(gid), workerId: worker.id })}
                    >
                      <SelectTrigger className="h-8 w-28 text-xs" data-testid={`select-move-group-${worker.id}`}>
                        <SelectValue placeholder="Move to group" />
                      </SelectTrigger>
                      <SelectContent>
                        {workerGroups.map((g) => (
                          <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" data-testid={`button-actions-worker-${worker.id}`}>
                        Actions <ChevronDown className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {setWorkerDeductionTarget && (
                        <DropdownMenuItem
                          onClick={() => setWorkerDeductionTarget(worker)}
                          data-testid={`button-deduction-${worker.id}`}
                        >
                          <MinusCircle className="h-4 w-4 mr-2" /> Add Deduction
                        </DropdownMenuItem>
                      )}
                      {setSelectedWorkerForEdit && setEditWorkerDialogOpen && (
                        <DropdownMenuItem
                          onClick={() => { setSelectedWorkerForEdit(worker); setEditWorkerDialogOpen(true); }}
                          data-testid={`button-edit-worker-${worker.id}`}
                        >
                          <Pencil className="h-4 w-4 mr-2" /> Edit
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <ConfirmationDialog
                    trigger={
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        data-testid={`button-delete-worker-${worker.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    }
                    title="Delete Worker"
                    description={`Are you sure you want to delete ${[worker.firstName, worker.lastName].filter(Boolean).join(" ")}? This action cannot be undone.`}
                    confirmText="Delete"
                    variant="destructive"
                    onConfirm={() => handleDeleteWorker(worker)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
