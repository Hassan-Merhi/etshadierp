import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, Users, ChevronDown, Pencil, Trash2, AlertCircle } from "lucide-react";
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

  const allSelected = workerStaff.length > 0 && workerStaff.every((w) => workerPayments[w.id]?.selected);

  const handleSelectAll = () => {
    const shouldSelectAll = !allSelected;
    setWorkerOverrides((prev: any) => {
      const next = { ...prev };
      workerStaff.forEach((w) => {
        next[w.id] = { ...next[w.id], selected: shouldSelectAll };
      });
      return next;
    });
  };

  return (
    <div className="space-y-4 pt-2">
      {/* Top toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setNewWorkerDialogOpen(true)} data-testid="button-create-worker">
            <Plus className="h-4 w-4 mr-1" />
            New Worker
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreateWorkerGroupDialogOpen(true)}
            data-testid="button-create-worker-group"
          >
            <Plus className="h-4 w-4 mr-1" />
            Create Group
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSelectAll}
            disabled={workerStaff.length === 0}
            data-testid="button-select-all-workers"
          >
            {allSelected ? "Deselect All" : "Select All"}
          </Button>
        </div>
        <Button
          size="sm"
          onClick={() => setBulkPaymentDialogOpen(true)}
          disabled={selectedPayments.length === 0}
          data-testid="button-bulk-payment"
        >
          <Users className="h-4 w-4 mr-1" />
          Pay ({selectedPayments.length})
        </Button>
      </div>

      {/* Selection summary */}
      {selectedPayments.length > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>{selectedPayments.length} workers selected</strong> — Total payment: {formatAmount(totalAmount)}
          </AlertDescription>
        </Alert>
      )}

      {workerStaff.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p>No workers found</p>
          <p className="text-sm mt-2">Click "New Worker" to add your first worker</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Worker Groups */}
          {workerGroups.map((group) => {
            const isExpanded = workerGroupsExpanded[group.id] ?? true;
            const groupMembers: Employee[] = group.members || [];
            const groupSelected = groupMembers.filter((m) => workerPayments[m.id]?.selected).length;
            const groupPayTotal = groupMembers.reduce((sum, m) => {
              const p = workerPayments[m.id];
              return sum + (p?.selected ? parseFloat(p.amount || "0") : 0);
            }, 0);

            return (
              <Collapsible
                key={group.id}
                open={isExpanded}
                onOpenChange={(open) =>
                  setWorkerGroupsExpanded((prev: any) => ({ ...prev, [group.id]: open }))
                }
              >
                <Card>
                  <CollapsibleTrigger asChild>
                    <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover-elevate rounded-t-md">
                      <div className="flex items-center gap-3">
                        <ChevronDown
                          className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")}
                        />
                        <div>
                          <h3 className="font-semibold">{group.name}</h3>
                          <p className="text-xs text-muted-foreground">
                            {groupMembers.length} workers
                            {groupSelected > 0 && (
                              <> · <span className="text-primary font-medium">{groupSelected} selected · {formatAmount(groupPayTotal)}</span></>
                            )}
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
                            const selections: Record<number, boolean> = {};
                            groupMembers.forEach((m) => { selections[m.id] = true; });
                            setWorkerGroupMemberSelections(selections);
                          }}
                          data-testid={`button-manage-group-${group.id}`}
                        >
                          <Pencil className="h-3.5 w-3.5 mr-1" />
                          Manage
                        </Button>
                        <ConfirmationDialog
                          trigger={
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive"
                              data-testid={`button-delete-group-${group.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          }
                          title="Delete Worker Group"
                          description={`Delete "${group.name}"? Workers will become ungrouped.`}
                          confirmText="Delete"
                          variant="destructive"
                          onConfirm={() => deleteWorkerGroupMutation.mutate(group.id)}
                        />
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border-t">
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
                        setWorkerDeductionTarget={setWorkerDeductionTarget}
                        setSelectedWorkerForEdit={setSelectedWorkerForEdit}
                        setEditWorkerDialogOpen={setEditWorkerDialogOpen}
                      />
                    </div>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })}

          {/* Ungrouped Workers */}
          {ungroupedWorkers.length > 0 && (
            <Card>
              <div className="px-4 py-3 border-b">
                <h3 className="font-semibold text-muted-foreground">Ungrouped Workers</h3>
                <p className="text-xs text-muted-foreground">{ungroupedWorkers.length} workers not in any group</p>
              </div>
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
                setWorkerDeductionTarget={setWorkerDeductionTarget}
                setSelectedWorkerForEdit={setSelectedWorkerForEdit}
                setEditWorkerDialogOpen={setEditWorkerDialogOpen}
              />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
