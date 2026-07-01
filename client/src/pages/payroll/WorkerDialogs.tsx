import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import type { Employee } from "@shared/schema";

interface WorkerDialogsProps {
  newWorkerDialogOpen: boolean;
  setNewWorkerDialogOpen: (open: boolean) => void;
  newWorkerForm: any;
  createWorkerMutation: any;
  editWorkerDialogOpen: boolean;
  setEditWorkerDialogOpen: (open: boolean) => void;
  selectedWorkerForEdit: any;
  editWorkerForm: any;
  updateWorkerMutation: any;
  deleteWorkerConflict: any;
  setDeleteWorkerConflict: (v: any) => void;
  handleForceDeleteWorker: () => void;
  workerGroupMembersDialogOpen: boolean;
  setWorkerGroupMembersDialogOpen: (open: boolean) => void;
  selectedWorkerGroupForMembers: any;
  allWorkers: Employee[];
  addWorkerToWorkerGroupMutation: any;
  removeWorkerFromWorkerGroupMutation: any;
}

export function WorkerDialogs({
  newWorkerDialogOpen,
  setNewWorkerDialogOpen,
  newWorkerForm,
  createWorkerMutation,
  editWorkerDialogOpen,
  setEditWorkerDialogOpen,
  selectedWorkerForEdit,
  editWorkerForm,
  updateWorkerMutation,
  deleteWorkerConflict,
  setDeleteWorkerConflict,
  handleForceDeleteWorker,
  workerGroupMembersDialogOpen,
  setWorkerGroupMembersDialogOpen,
  selectedWorkerGroupForMembers,
  allWorkers,
  addWorkerToWorkerGroupMutation,
  removeWorkerFromWorkerGroupMutation,
}: WorkerDialogsProps) {
  const { formatAmount } = useCurrencyContext();

  return (
    <>
      {/* New Worker Dialog */}
      <Dialog open={newWorkerDialogOpen} onOpenChange={setNewWorkerDialogOpen}>
        <DialogContent data-testid="dialog-new-worker">
          <DialogHeader>
            <DialogTitle>Add New Worker</DialogTitle>
            <DialogDescription>Create a new worker for this company</DialogDescription>
          </DialogHeader>

          <Form {...newWorkerForm}>
            <form
              noValidate
              onSubmit={newWorkerForm.handleSubmit((data: any) => createWorkerMutation.mutate(data))}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={newWorkerForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-new-worker-firstname" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={newWorkerForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-new-worker-lastname" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={newWorkerForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Worker Code (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Auto-generated if left blank"
                        {...field}
                        data-testid="input-new-worker-code"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={newWorkerForm.control}
                name="monthlySalary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly Salary</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} data-testid="input-new-worker-salary" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={newWorkerForm.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department (Optional)</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-new-worker-department" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={newWorkerForm.control}
                name="active"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-new-worker-active"
                      />
                    </FormControl>
                    <FormLabel className="!mt-0">Active</FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setNewWorkerDialogOpen(false)}
                  data-testid="button-cancel-new-worker"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createWorkerMutation.isPending} data-testid="button-submit-new-worker">
                  {createWorkerMutation.isPending ? "Creating..." : "Create Worker"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Worker Dialog */}
      <Dialog open={editWorkerDialogOpen} onOpenChange={setEditWorkerDialogOpen}>
        <DialogContent data-testid="dialog-edit-worker">
          <DialogHeader>
            <DialogTitle>Edit Worker</DialogTitle>
            <DialogDescription>
              Update worker information for {selectedWorkerForEdit?.firstName} {selectedWorkerForEdit?.lastName}
            </DialogDescription>
          </DialogHeader>

          <Form {...editWorkerForm}>
            <form
              noValidate
              onSubmit={editWorkerForm.handleSubmit((data: any) => {
                if (selectedWorkerForEdit) {
                  updateWorkerMutation.mutate({ ...data, id: selectedWorkerForEdit.id });
                }
              })}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={editWorkerForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-worker-firstname" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editWorkerForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-worker-lastname" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={editWorkerForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Worker Code</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-edit-worker-code" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editWorkerForm.control}
                name="monthlySalary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly Salary</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} data-testid="input-edit-worker-salary" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editWorkerForm.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department (Optional)</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-edit-worker-department" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editWorkerForm.control}
                name="active"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-edit-worker-active"
                      />
                    </FormControl>
                    <FormLabel className="!mt-0">Active</FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditWorkerDialogOpen(false)}
                  data-testid="button-cancel-edit-worker"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={updateWorkerMutation.isPending} data-testid="button-submit-edit-worker">
                  {updateWorkerMutation.isPending ? "Updating..." : "Update Worker"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Manage Group Members Dialog */}
      <Dialog open={workerGroupMembersDialogOpen} onOpenChange={setWorkerGroupMembersDialogOpen}>
        <DialogContent className="max-w-lg" data-testid="dialog-worker-group-members">
          <DialogHeader>
            <DialogTitle>Manage Group: {selectedWorkerGroupForMembers?.name}</DialogTitle>
            <DialogDescription>
              Toggle workers in or out of this group.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">In Group</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Department</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allWorkers.map((worker) => {
                  const isMember = selectedWorkerGroupForMembers?.members?.some((m: any) => m.id === worker.id);
                  return (
                    <TableRow key={worker.id}>
                      <TableCell>
                        <Checkbox
                          checked={!!isMember}
                          onCheckedChange={(checked) => {
                            if (!selectedWorkerGroupForMembers) return;
                            if (checked) {
                              addWorkerToWorkerGroupMutation.mutate({
                                groupId: selectedWorkerGroupForMembers.id,
                                workerId: worker.id,
                              });
                            } else {
                              removeWorkerFromWorkerGroupMutation.mutate({
                                groupId: selectedWorkerGroupForMembers.id,
                                workerId: worker.id,
                              });
                            }
                          }}
                          data-testid={`checkbox-group-member-${worker.id}`}
                        />
                      </TableCell>
                      <TableCell>{[worker.firstName, worker.lastName].filter(Boolean).join(" ")}</TableCell>
                      <TableCell className="text-muted-foreground">{worker.department || "—"}</TableCell>
                    </TableRow>
                  );
                })}
                {allWorkers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                      No workers found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-end pt-2">
            <Button onClick={() => setWorkerGroupMembersDialogOpen(false)} data-testid="button-close-group-members">
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Worker Balance Conflict Alert */}
      <AlertDialog open={!!deleteWorkerConflict} onOpenChange={(open) => !open && setDeleteWorkerConflict(null)}>
        <AlertDialogContent data-testid="dialog-delete-worker-conflict">
          <AlertDialogHeader>
            <AlertDialogTitle>Worker Has Non-Zero Balance</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteWorkerConflict && (
                <>
                  <span className="font-semibold">
                    {deleteWorkerConflict.employee.firstName} {deleteWorkerConflict.employee.lastName}
                  </span>{" "}
                  has a non-zero balance:
                  <div className="mt-2 space-y-1 font-mono text-sm">
                    <div>Employee Balance: {formatAmount(deleteWorkerConflict.employeeBalance)}</div>
                    <div>Ledger Balance: {formatAmount(deleteWorkerConflict.ledgerBalance)}</div>
                  </div>
                  <p className="mt-3">
                    Deleting this worker will also delete their linked ledger account. This action cannot be undone.
                  </p>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setDeleteWorkerConflict(null)}
              data-testid="button-cancel-force-delete-worker"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleForceDeleteWorker}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-force-delete-worker"
            >
              Delete Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
