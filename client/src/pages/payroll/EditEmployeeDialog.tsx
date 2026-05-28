import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";

interface EditEmployeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setEditingEmployee: (v: any) => void;
  editEmployeeForm: any;
  editEmployeeMutation: any;
  employeeGroups: any[];
  otherCompanies: any[];
  selectedCompany: any;
  locations: any[];
  allCompanyLocations: any[];
  editBaleRates: any[];
  setEditBaleRates: (fn: (prev: any[]) => any[]) => void;
  editBalePctRates: any[];
  setEditBalePctRates: (fn: (prev: any[]) => any[]) => void;
  pctLocations: any[];
}

export function EditEmployeeDialog({
  open, onOpenChange, setEditingEmployee, editEmployeeForm, editEmployeeMutation,
  employeeGroups, otherCompanies, selectedCompany, locations, allCompanyLocations,
  editBaleRates, setEditBaleRates, editBalePctRates, setEditBalePctRates, pctLocations,
}: EditEmployeeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { onOpenChange(isOpen); if (!isOpen) setEditingEmployee(null); }}>
      <DialogContent data-testid="dialog-edit-employee">
        <DialogHeader>
          <DialogTitle>Edit Employee</DialogTitle>
          <DialogDescription>Update employee details and monthly salary</DialogDescription>
        </DialogHeader>

        <Form {...editEmployeeForm}>
          <form noValidate onSubmit={editEmployeeForm.handleSubmit((data: any) => editEmployeeMutation.mutate(data))} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={editEmployeeForm.control} name="firstName" render={({ field }) => (
                <FormItem><FormLabel>First Name</FormLabel><FormControl><Input {...field} data-testid="input-edit-first-name" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={editEmployeeForm.control} name="lastName" render={({ field }) => (
                <FormItem><FormLabel>Last Name</FormLabel><FormControl><Input {...field} data-testid="input-edit-last-name" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={editEmployeeForm.control} name="monthlySalary" render={({ field }) => (
                <FormItem><FormLabel>Monthly Salary</FormLabel><FormControl><Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-edit-monthly-salary" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={editEmployeeForm.control} name="code" render={({ field }) => (
                <FormItem><FormLabel>Employee Code</FormLabel><FormControl><Input {...field} value={field.value || ""} data-testid="input-edit-code" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={editEmployeeForm.control} name="department" render={({ field }) => (
                <FormItem><FormLabel>Department</FormLabel><FormControl><Input placeholder="e.g., Warehouse" {...field} value={field.value || ""} data-testid="input-edit-department" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={editEmployeeForm.control} name="joinDate" render={({ field }) => (
                <FormItem><FormLabel>Starting Date</FormLabel><FormControl><Input type="date" {...field} data-testid="input-edit-join-date" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={editEmployeeForm.control} name="active" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={(val) => field.onChange(val === "true")} value={field.value ? "true" : "false"}>
                    <FormControl><SelectTrigger data-testid="select-edit-active"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="true">Active</SelectItem>
                      <SelectItem value="false">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={editEmployeeForm.control} name="employeeGroupId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Employee Group</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ""}>
                    <FormControl><SelectTrigger data-testid="select-edit-employee-group"><SelectValue placeholder="No Group" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="none">No Group</SelectItem>
                      {employeeGroups.map((group: any) => (<SelectItem key={group.id} value={group.id.toString()}>{group.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="border-t pt-4 space-y-3">
              <p className="text-sm font-medium text-muted-foreground">Bonus Configuration (Optional)</p>
              <FormField
                control={editEmployeeForm.control}
                name="salesBonusPct"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sales Bonus %</FormLabel>
                    <div className="flex gap-2 items-center flex-wrap">
                      <FormControl>
                        <Input type="number" step="0.0001" placeholder="e.g. 0.2" {...field} value={field.value || ""} className="w-28" data-testid="input-edit-sales-bonus-pct" />
                      </FormControl>
                      {otherCompanies.length > 0 && (
                        <FormField
                          control={editEmployeeForm.control}
                          name="salesBonusPctSourceCompanyId"
                          render={({ field: scField }) => (
                            <Select value={scField.value || ""} onValueChange={(v) => { scField.onChange(v === "__current__" ? "" : v); editEmployeeForm.setValue("salesBonusPctLocationId", ""); }}>
                              <SelectTrigger className="w-32 text-xs" data-testid="select-edit-bonus-pct-source-company">
                                <SelectValue placeholder={selectedCompany?.name || "This company"} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__current__">{selectedCompany?.name || "This company"}</SelectItem>
                                {otherCompanies.map((c: any) => (<SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      )}
                      <FormField
                        control={editEmployeeForm.control}
                        name="salesBonusPctLocationId"
                        render={({ field: locField }) => (
                          <Select value={locField.value || ""} onValueChange={locField.onChange}>
                            <SelectTrigger className="flex-1 min-w-[120px]" data-testid="select-edit-bonus-pct-location">
                              <SelectValue placeholder="Select location" />
                            </SelectTrigger>
                            <SelectContent>
                              {pctLocations.map((loc: any) => (<SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Bale Bonus Rates by Location</Label>
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditBaleRates(prev => [...prev, { locationId: "", rate: "", sourceCompanyId: "" }])} data-testid="button-add-bale-rate">
                    <Plus className="h-3 w-3 mr-1" />Add Location
                  </Button>
                </div>
                {editBaleRates.length === 0 && (<p className="text-xs text-muted-foreground">No per-location rates configured. Add locations to enable auto-calculation.</p>)}
                {editBaleRates.map((row, idx) => {
                  const rowCompanyId = row.sourceCompanyId || "";
                  const locationsForRow = rowCompanyId ? allCompanyLocations.filter((l: any) => String(l.companyId) === rowCompanyId) : locations;
                  return (
                    <div key={idx} className="flex gap-2 items-start flex-wrap">
                      {otherCompanies.length > 0 && (
                        <Select value={rowCompanyId} onValueChange={(v) => setEditBaleRates(prev => prev.map((r, i) => i === idx ? { ...r, sourceCompanyId: v === "__current__" ? "" : v, locationId: "" } : r))}>
                          <SelectTrigger className="w-32 text-xs" data-testid={`select-bale-rate-company-${idx}`}>
                            <SelectValue placeholder={selectedCompany?.name || "This company"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__current__">{selectedCompany?.name || "This company"}</SelectItem>
                            {otherCompanies.map((c: any) => (<SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      )}
                      <Select value={row.locationId} onValueChange={(v) => setEditBaleRates(prev => prev.map((r, i) => i === idx ? { ...r, locationId: v } : r))}>
                        <SelectTrigger className="flex-1 min-w-[120px]" data-testid={`select-bale-rate-location-${idx}`}><SelectValue placeholder="Select location" /></SelectTrigger>
                        <SelectContent>{locationsForRow.map((loc: any) => (<SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>))}</SelectContent>
                      </Select>
                      <Input type="number" step="0.01" placeholder="Rate/unit" className="w-28 text-right" value={row.rate} onChange={(e) => setEditBaleRates(prev => prev.map((r, i) => i === idx ? { ...r, rate: e.target.value } : r))} data-testid={`input-bale-rate-${idx}`} />
                      <Button type="button" size="icon" variant="ghost" onClick={() => setEditBaleRates(prev => prev.filter((_, i) => i !== idx))} data-testid={`button-remove-bale-rate-${idx}`}><X className="h-4 w-4" /></Button>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <Label className="text-sm">Bales % by Location</Label>
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditBalePctRates(prev => [...prev, { locationId: "", pct: "", sourceCompanyId: "" }])} data-testid="button-add-bale-pct-rate">
                    <Plus className="h-3 w-3 mr-1" />Add Location
                  </Button>
                </div>
                {editBalePctRates.length === 0 && (<p className="text-xs text-muted-foreground">No per-location % rates configured. Add locations to enable % auto-calculation.</p>)}
                {editBalePctRates.map((row, idx) => {
                  const rowCompanyId = row.sourceCompanyId || "";
                  const locationsForRow = rowCompanyId ? allCompanyLocations.filter((l: any) => String(l.companyId) === rowCompanyId) : locations;
                  return (
                    <div key={idx} className="flex gap-2 items-start flex-wrap">
                      {otherCompanies.length > 0 && (
                        <Select value={rowCompanyId} onValueChange={(v) => setEditBalePctRates(prev => prev.map((r, i) => i === idx ? { ...r, sourceCompanyId: v === "__current__" ? "" : v, locationId: "" } : r))}>
                          <SelectTrigger className="w-32 text-xs" data-testid={`select-bale-pct-rate-company-${idx}`}>
                            <SelectValue placeholder={selectedCompany?.name || "This company"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__current__">{selectedCompany?.name || "This company"}</SelectItem>
                            {otherCompanies.map((c: any) => (<SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      )}
                      <Select value={row.locationId} onValueChange={(v) => setEditBalePctRates(prev => prev.map((r, i) => i === idx ? { ...r, locationId: v } : r))}>
                        <SelectTrigger className="flex-1 min-w-[120px]" data-testid={`select-bale-pct-rate-location-${idx}`}><SelectValue placeholder="Select location" /></SelectTrigger>
                        <SelectContent>{locationsForRow.map((loc: any) => (<SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>))}</SelectContent>
                      </Select>
                      <Input type="number" step="0.01" placeholder="% rate" className="w-24 text-right" value={row.pct} onChange={(e) => setEditBalePctRates(prev => prev.map((r, i) => i === idx ? { ...r, pct: e.target.value } : r))} data-testid={`input-bale-pct-rate-${idx}`} />
                      <Button type="button" size="icon" variant="ghost" onClick={() => setEditBalePctRates(prev => prev.filter((_, i) => i !== idx))} data-testid={`button-remove-bale-pct-rate-${idx}`}><X className="h-4 w-4" /></Button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={editEmployeeMutation.isPending} data-testid="button-save-employee">
                {editEmployeeMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
