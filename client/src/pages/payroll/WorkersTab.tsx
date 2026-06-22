import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Plus, Users, ChevronDown, Pencil, Trash2, AlertCircle, DollarSign, MinusCircle 
} from "lucide-react";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";
import type { Employee } from "@shared/schema";
import { WorkersTable } from "./WorkersTable";

interface WorkersTabProps {
  setNewWorkerDialogOpen: (val: boolean) => void;
  workerPaymentSummary: any;
  setBulkPaymentDialogOpen: (val: boolean) => void;
  selectedPayments: any[];
  totalAmount: number;
  workerStaff: Employee[];
  workerGroups: any[];
  workerGroupsExpanded: Record<number, boolean>;
  setWorkerGroupsExpanded: (val: any) => void;
  workerPayments: Record<number, any>;
  setWorkerOverrides: (val: any) => void;
  setCreateWorkerGroupDialogOpen: (val: boolean) => void;
  setSelectedWorkerGroupForMembers: (val: any) => void;
  setWorkerGroupMembersDialogOpen: (val: boolean) => void;
  setWorkerGroupMemberSelections: (val: any) => void;
  deleteWorkerGroupMutation: any;
  handleToggleWorker: (id: number) => void;
  handleUpdateAmount: (id: number, val: string) => void;
  handleDeleteWorker: (worker: Employee) => void;
  setStatementEmployee: (val: Employee | null) => void;
  ungroupedWorkers: Employee[];
  addWorkerToWorkerGroupMutation: any;
  setWorkerDeductionTarget: (val: Employee | null) => void;
  setSelectedWorkerForEdit: (val: Employee | null) => void;
  setEditWorkerDialogOpen: (val: boolean) => void;
}

export function WorkersTab({
  setNewWorkerDialogOpen,
  workerPaymentSummary,
  setBulkPaymentDialogOpen,
  selectedPayments,
  totalAmount,
  workerStaff,
  workerGroups,
  workerGroupsExpanded,
  setWorkerGroupsExpanded,
  workerPayments,
  setWorkerOverrides,
  setCreateWorkerGroupDialogOpen,
  setSelectedWorkerGroupForMembers,
  setWorkerGroupMembersDialogOpen,
  setWorkerGroupMemberSelections,
  deleteWorkerGroupMutation,
  handleToggleWorker,
  handleUpdateAmount,
  handleDeleteWorker,
  setStatementEmployee,
  ungroupedWorkers,
  addWorkerToWorkerGroupMutation,
  setWorkerDeductionTarget,
  setSelectedWorkerForEdit,
  setEditWorkerDialogOpen,
}: WorkersTabProps) {
  const { formatAmount } = useCurrencyContext();

  return (
    <div className="space-y-4">
      {/* Worker Payment Summary */}
      <Card className="p-6 mb-4">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-4">
          <h3 className="text-lg font-semibold">Worker Payment Summary</h3>
          <Button
            onClick={() => setNewWorkerDialogOpen(true)}
            data-testid="button-create-worker"
          >
            <Plus className="h-4 w-4 mr-1" />
            Create Workers
          </Button>
        </div>
        {workerPaymentSummary ? (
          <div className="space-y-4">
            <div className="max-h-60 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Worker Name</TableHead>
                    <TableHead className="text-right">Total Paid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workerPaymentSummary.workerPayments.map((wp: any) => (
                    <TableRow key={wp.workerId} data-testid={`worker-payment-${wp.workerId}`}>
                      <TableCell className="font-mono">{wp.workerCode}</TableCell>
                      <TableCell>{wp.workerName}</TableCell>
                      <TableCell className="text-right font-mono" data-testid={`text-paid-${wp.workerId}`}>
                        {formatAmount(parseFloat(wp.totalPaid))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between pt-4 border-t">
              <span className="text-lg font-semibold">Grand Total Paid:</span>
              <span className="text-lg font-semibold font-mono" data-testid="text-grand-total">
                {formatAmount(parseFloat(workerPaymentSummary.grandTotal))}
              </span>
            </div>
          </div>
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </Card>

      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-semibold">Bulk Worker Payments</h2>
              <p className="text-sm text-muted-foreground">
                Select workers and adjust amounts to process bulk salary payments
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setCreateWorkerGroupDialogOpen(true)}
                data-testid="button-create-worker-group"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Group
              </Button>
              <Button
                onClick={() => setBulkPaymentDialogOpen(true)}
                disabled={selectedPayments.length === 0}
                data-testid="button-bulk-payment"
              >
                <Users className="h-4 w-4 mr-2" />
                Pay Selected ({selectedPayments.length})
              </Button>
            </div>
          </div>

          {selectedPayments.length > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>{selectedPayments.length} workers selected</strong> - Total payment: {formatAmount(totalAmount)}
              </AlertDescription>
            </Alert>
          )}

          {workerStaff.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No workers found</p>
              <p className="text-sm mt-2">Create workers from the Create Master Data page</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Worker Groups */}
              {workerGroups.map((group) => {
                const isExpanded = workerGroupsExpanded[group.id] ?? true;
                const groupMembers = group.members || [];
                const groupTotal = groupMembers.reduce((sum: number, member: Employee) => {
                  const payment = workerPayments[member.id];
                  return sum + (payment?.selected ? parseFloat(payment.amount || "0") : 0);
                }, 0);
                const selectedCount = groupMembers.filter((m: Employee) => workerPayments[m.id]?.selected).length;
                
                return (
                  <Collapsible
                    key={group.id}
                    open={isExpanded}
                    onOpenChange={(open) => setWorkerGroupsExpanded((prev: any) => ({ ...prev, [group.id]: open }))}
                  >
                    <Card className="border">
                      <CollapsibleTrigger asChild>
                        <div className="flex items-center justify-between p-4 cursor-pointer hover-elevate">
                          <div className="flex items-center gap-3">
                            <ChevronDown className={cn("h-5 w-5 transition-transform", isExpanded && "rotate-180")} />
                            <div>
                              <h3 className="font-semibold">{group.name}</h3>
                              <p className="text-sm text-muted-foreground">
                                {groupMembers.length} workers - {selectedCount} selected - Total: {formatAmount(groupTotal)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedWorkerGroupForMembers(group);
                                setWorkerGroupMembersDialogOpen(true);
                                // Initialize selections
                                const selections: Record<number, boolean> = {};
                                groupMembers.forEach((m: Employee) => { selections[m.id] = true; });
                                setWorkerGroupMemberSelections(selections);
                              }}
                              data-testid={`button-manage-group-${group.id}`}
                            >
                              <Pencil className="h-4 w-4 mr-1" />
                              Manage
                            </Button>
                            <ConfirmationDialog
                              trigger={
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  data-testid={`button-delete-group-${group.id}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              }
                              title="Delete Worker Group"
                              description={`Are you sure you want to delete the group "${group.name}"? Workers will not be deleted but will become ungrouped.`}
                              confirmText="Delete"
                              variant="destructive"
                              onConfirm={() => deleteWorkerGroupMutation.mutate(group.id)}
                            />
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="border-t overflow-x-auto">
                          <WorkersTable
                            workers={groupMembers}
                            workerPayments={workerPayments}
                            workerGroups={workerGroups}
                            handleToggleWorker={handleToggleWorker}
                            handleUpdateAmount={handleUpdateAmount}
                            handleDeleteWorker={handleDeleteWorker}
                            setStatementEmployee={setStatementEmployee}
                            setWorkerOverrides={setWorkerOverrides}
                            formatAmount={formatAmount}
                            groupId={group.id}
                          />
                        </div>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>
                );
              })}

              {/* Ungrouped Workers */}
              {ungroupedWorkers.length > 0 && (
                <Card className="border">
                  <div className="p-4">
                    <h3 className="font-semibold text-muted-foreground">Ungrouped Workers</h3>
                    <p className="text-sm text-muted-foreground">
                      {ungroupedWorkers.length} workers not assigned to any group
                    </p>
                  </div>
                  <div className="border-t overflow-x-auto">
                    <WorkersTable
                      workers={ungroupedWorkers}
                      workerPayments={workerPayments}
                      workerGroups={workerGroups}
                      handleToggleWorker={handleToggleWorker}
                      handleUpdateAmount={handleUpdateAmount}
                      handleDeleteWorker={handleDeleteWorker}
                      setStatementEmployee={setStatementEmployee}
                      setWorkerOverrides={setWorkerOverrides}
                      formatAmount={formatAmount}
                      addWorkerToWorkerGroupMutation={addWorkerToWorkerGroupMutation}
                    />
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
