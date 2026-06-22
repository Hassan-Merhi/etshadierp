import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, Users, HardHat, ChevronRight, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { getApiRequest } from "@/lib/factoryApi";
import { useAppMode } from "@/contexts/AppModeContext";
import { useCompany } from "@/contexts/CompanyContext";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import type { Employee } from "@shared/schema";

interface WorkerGroupWithMembers {
  id: number;
  name: string;
  description?: string;
  members: Employee[];
}

export function GroupsTab() {
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const { selectedCompany } = useCompany();
  const { toast } = useToast();

  const [workerGroupsExpanded, setWorkerGroupsExpanded] = useState<Record<number, boolean>>({});
  const [newWorkerGroupName, setNewWorkerGroupName] = useState("");
  const [newWorkerGroupDescription, setNewWorkerGroupDescription] = useState("");
  const [createWorkerGroupDialogOpen, setCreateWorkerGroupDialogOpen] = useState(false);
  const [selectedWorkerGroupForMembers, setSelectedWorkerGroupForMembers] = useState<WorkerGroupWithMembers | null>(null);
  const [workerGroupMembersDialogOpen, setWorkerGroupMembersDialogOpen] = useState(false);

  const { data: workerGroups = [] } = useQuery<WorkerGroupWithMembers[]>({
    queryKey: ["/api/worker-groups/with-members", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const { data: workerStaff = [] } = useQuery<Employee[]>({
    queryKey: ["/api/payroll/employees-with-balances", selectedCompany?.id],
    enabled: !!selectedCompany,
    select: (data: any[]) => data.filter(e => e.employeeType === "Worker"),
  });

  const createWorkerGroupMutation = useMutation({
    mutationFn: async () => {
      const res = await modeApiRequest("POST", "/api/worker-groups", {
        name: newWorkerGroupName,
        description: newWorkerGroupDescription,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Worker group created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/worker-groups/with-members", selectedCompany?.id] });
      setNewWorkerGroupName("");
      setNewWorkerGroupDescription("");
      setCreateWorkerGroupDialogOpen(false);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create worker group", variant: "destructive" });
    },
  });

  const deleteWorkerGroupMutation = useMutation({
    mutationFn: async (groupId: number) => {
      await modeApiRequest("DELETE", `/api/worker-groups/${groupId}`);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Worker group deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/worker-groups/with-members", selectedCompany?.id] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete worker group", variant: "destructive" });
    },
  });

  const addWorkerToWorkerGroupMutation = useMutation({
    mutationFn: async ({ groupId, workerId }: { groupId: number; workerId: number }) => {
      await modeApiRequest("POST", `/api/worker-groups/${groupId}/members/${workerId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-groups/with-members", selectedCompany?.id] });
      toast({ title: "Success", description: "Worker added to group" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to add worker to group", variant: "destructive" });
    },
  });

  const removeWorkerFromWorkerGroupMutation = useMutation({
    mutationFn: async ({ groupId, workerId }: { groupId: number; workerId: number }) => {
      await modeApiRequest("DELETE", `/api/worker-groups/${groupId}/members/${workerId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-groups/with-members", selectedCompany?.id] });
      toast({ title: "Success", description: "Worker removed from group" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to remove worker from group", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Worker Groups</h2>
          <p className="text-muted-foreground">Manage production worker teams and group assignments</p>
        </div>
        <Button onClick={() => setCreateWorkerGroupDialogOpen(true)} data-testid="button-create-worker-group">
          <Plus className="mr-2 h-4 w-4" />
          Create Group
        </Button>
      </div>

      <div className="grid gap-4">
        {workerGroups.map((group) => {
          const isExpanded = !!workerGroupsExpanded[group.id];
          return (
            <Card key={group.id} className="overflow-hidden">
              <CardHeader className="py-4 px-6 flex flex-row items-center justify-between space-y-0 bg-muted/30">
                <div 
                  className="flex items-center gap-3 cursor-pointer" 
                  onClick={() => setWorkerGroupsExpanded(prev => ({ ...prev, [group.id]: !isExpanded }))}
                >
                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <Users className="h-5 w-5 text-primary" />
                  <div>
                    <CardTitle className="text-lg">{group.name}</CardTitle>
                    {group.description && <CardDescription>{group.description}</CardDescription>}
                  </div>
                  <div className="ml-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                      {group.members.length} members
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedWorkerGroupForMembers(group);
                      setWorkerGroupMembersDialogOpen(true);
                    }}
                    data-testid={`button-manage-members-${group.id}`}
                  >
                    Manage Members
                  </Button>
                  <ConfirmationDialog
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        data-testid={`button-delete-group-${group.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    }
                    title="Delete Group"
                    description={`Are you sure you want to delete the group "${group.name}"? Members will not be deleted but will become ungrouped.`}
                    confirmText="Delete"
                    variant="destructive"
                    onConfirm={() => deleteWorkerGroupMutation.mutate(group.id)}
                  />
                </div>
              </CardHeader>
              {isExpanded && (
                <CardContent className="p-0 border-t">
                  {group.members.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground italic">
                      No members assigned to this group yet.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[100px]">Code</TableHead>
                          <TableHead>Worker Name</TableHead>
                          <TableHead>Department</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.members.map((member) => (
                          <TableRow key={member.id}>
                            <TableCell className="font-medium">{member.code}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <HardHat className="h-4 w-4 text-muted-foreground" />
                                {[member.firstName, member.lastName].filter(Boolean).join(" ")}
                              </div>
                            </TableCell>
                            <TableCell>{member.department || "—"}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() => removeWorkerFromWorkerGroupMutation.mutate({ groupId: group.id, workerId: member.id })}
                                data-testid={`button-remove-member-${member.id}`}
                              >
                                Remove
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}

        {workerGroups.length === 0 && (
          <Card className="border-dashed border-2">
            <CardContent className="py-12 flex flex-col items-center justify-center text-center">
              <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold">No worker groups found</h3>
              <p className="text-muted-foreground mb-6">Create groups to organize your production workers.</p>
              <Button variant="outline" onClick={() => setCreateWorkerGroupDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create First Group
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={createWorkerGroupDialogOpen} onOpenChange={setCreateWorkerGroupDialogOpen}>
        <DialogContent data-testid="dialog-create-worker-group">
          <DialogHeader>
            <DialogTitle>Create Worker Group</DialogTitle>
            <DialogDescription>Define a new production group/team.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="group-name">Group Name</Label>
              <Input
                id="group-name"
                value={newWorkerGroupName}
                onChange={(e) => setNewWorkerGroupName(e.target.value)}
                placeholder="e.g. Night Shift Team A"
                data-testid="input-group-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-desc">Description (Optional)</Label>
              <Input
                id="group-desc"
                value={newWorkerGroupDescription}
                onChange={(e) => setNewWorkerGroupDescription(e.target.value)}
                placeholder="Briefly describe the group's role"
                data-testid="input-group-desc"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="outline" onClick={() => setCreateWorkerGroupDialogOpen(false)} data-testid="button-cancel-group">
              Cancel
            </Button>
            <Button
              onClick={() => createWorkerGroupMutation.mutate()}
              disabled={!newWorkerGroupName || createWorkerGroupMutation.isPending}
              data-testid="button-submit-group"
            >
              Create Group
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={workerGroupMembersDialogOpen} onOpenChange={setWorkerGroupMembersDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage Group Members: {selectedWorkerGroupForMembers?.name}</DialogTitle>
            <DialogDescription>Add or remove workers from this group</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="max-h-[400px] overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Member</TableHead>
                    <TableHead>Worker Name</TableHead>
                    <TableHead>Department</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workerStaff.map((worker: Employee) => {
                    const isMember = selectedWorkerGroupForMembers?.members.some((m: any) => m.id === worker.id);
                    return (
                      <TableRow key={worker.id}>
                        <TableCell>
                          <Checkbox
                            checked={isMember}
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
                            data-testid={`checkbox-member-${worker.id}`}
                          />
                        </TableCell>
                        <TableCell>{[worker.firstName, worker.lastName].filter(Boolean).join(" ")}</TableCell>
                        <TableCell>{worker.department || "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setWorkerGroupMembersDialogOpen(false)} data-testid="button-close-members">
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
