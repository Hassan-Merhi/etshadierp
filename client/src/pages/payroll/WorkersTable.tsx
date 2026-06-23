import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, Trash2, AlertCircle } from "lucide-react";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { cn } from "@/lib/utils";
import type { Employee } from "@shared/schema";

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
}: WorkersTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">
            <Checkbox
              checked={workers.length > 0 && workers.every((m: Employee) => workerPayments[m.id]?.selected)}
              onCheckedChange={(checked) => {
                workers.forEach((member: Employee) => {
                  setWorkerOverrides((prev: any) => ({
                    ...prev,
                    [member.id]: {
                      ...prev[member.id],
                      selected: !!checked,
                    },
                  }));
                });
              }}
              data-testid={groupId ? `checkbox-select-all-group-${groupId}` : "checkbox-select-all-ungrouped"}
            />
          </TableHead>
          <TableHead data-testid="header-name">Name</TableHead>
          <TableHead data-testid="header-monthly-salary" className="text-right">
            Monthly Salary
          </TableHead>
          <TableHead data-testid="header-advances" className="text-right">
            Advances
          </TableHead>
          <TableHead data-testid="header-payment-amount" className="text-right">
            Payment Amount
          </TableHead>
          <TableHead data-testid="header-actions" className="w-16">
            Actions
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {workers.map((worker: Employee) => {
          const advanceInfo = (worker as any).advanceInfo || { total: 0, count: 0 };
          const monthlySalary = parseFloat(worker.monthlySalary || "0");
          const paymentAmount = parseFloat(workerPayments[worker.id]?.amount || "0");
          const hasNegativePayment = paymentAmount < 0;

          return (
            <TableRow
              key={worker.id}
              data-testid={`row-worker-${worker.id}`}
              className={workerPayments[worker.id]?.selected ? "bg-muted/50" : ""}
            >
              <TableCell>
                <Checkbox
                  checked={workerPayments[worker.id]?.selected || false}
                  onCheckedChange={() => handleToggleWorker(worker.id)}
                  data-testid={`checkbox-worker-${worker.id}`}
                />
              </TableCell>
              <TableCell data-testid={`cell-name-${worker.id}`}>
                <button
                  onClick={() => setStatementEmployee(worker)}
                  className="flex items-center gap-1 text-primary hover:underline cursor-pointer whitespace-nowrap"
                  data-testid={`link-worker-statement-${worker.id}`}
                >
                  {[worker.firstName, worker.lastName].filter(Boolean).join(" ")}
                  <DollarSign className="h-3 w-3" />
                </button>
              </TableCell>
              <TableCell
                data-testid={`cell-monthly-salary-${worker.id}`}
                className="text-right font-mono text-muted-foreground"
              >
                {formatAmount(monthlySalary)}
              </TableCell>
              <TableCell data-testid={`cell-advances-${worker.id}`} className="text-right font-mono">
                {advanceInfo.total > 0 ? (
                  <span className="text-destructive">
                    {formatAmount(advanceInfo.total)}
                    {advanceInfo.count > 0 && (
                      <span className="text-xs text-muted-foreground ml-1">({advanceInfo.count})</span>
                    )}
                  </span>
                ) : (
                  "-"
                )}
              </TableCell>
              <TableCell data-testid={`cell-amount-${worker.id}`} className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    value={workerPayments[worker.id]?.amount || "0"}
                    onChange={(e) => handleUpdateAmount(worker.id, e.target.value)}
                    className={cn("w-32 text-right font-mono", hasNegativePayment && "border-destructive")}
                    data-testid={`input-amount-${worker.id}`}
                  />
                  {hasNegativePayment && <AlertCircle className="h-4 w-4 text-destructive" />}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  {!groupId && workerGroups.length > 0 && addWorkerToWorkerGroupMutation && (
                    <Select
                      onValueChange={(gid) => {
                        addWorkerToWorkerGroupMutation.mutate({
                          groupId: parseInt(gid),
                          workerId: worker.id,
                        });
                      }}
                    >
                      <SelectTrigger className="h-8 w-32 text-xs" data-testid={`select-move-group-${worker.id}`}>
                        <SelectValue placeholder="Move to group" />
                      </SelectTrigger>
                      <SelectContent>
                        {workerGroups.map((g) => (
                          <SelectItem key={g.id} value={String(g.id)}>
                            {g.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <ConfirmationDialog
                    trigger={
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
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
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
