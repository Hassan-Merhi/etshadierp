import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, CalendarIcon, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useDateFormat } from "@/contexts/DateFormatContext";

interface AdvanceDialogsProps {
  advanceDialogOpen: boolean;
  setAdvanceDialogOpen: (open: boolean) => void;
  advanceForm: any;
  advanceMutation: any;
  advanceWorkerComboOpen: boolean;
  setAdvanceWorkerComboOpen: (open: boolean) => void;
  workerStaff: any[];
  cashAccounts: any[];
  deductionDialogOpen: boolean;
  setDeductionDialogOpen: (open: boolean) => void;
  selectedAdvance: any;
  deductionForm: any;
  deductionMutation: any;
  advanceToDelete: number | null;
  setAdvanceToDelete: (v: number | null) => void;
  deleteAdvanceMutation: any;
}

export function AdvanceDialogs({
  advanceDialogOpen, setAdvanceDialogOpen, advanceForm, advanceMutation,
  advanceWorkerComboOpen, setAdvanceWorkerComboOpen, workerStaff, cashAccounts,
  deductionDialogOpen, setDeductionDialogOpen, selectedAdvance, deductionForm, deductionMutation,
  advanceToDelete, setAdvanceToDelete, deleteAdvanceMutation,
}: AdvanceDialogsProps) {
  const { formatAmount } = useCurrencyContext();
  const { formatDisplayDate } = useDateFormat() as any;

  return (
    <>
      {/* New Salary Advance Dialog */}
      <Dialog open={advanceDialogOpen} onOpenChange={setAdvanceDialogOpen}>
        <DialogContent data-testid="dialog-new-advance" className="max-w-lg w-[95vw] md:w-auto">
          <DialogHeader>
            <DialogTitle>New Salary Advance</DialogTitle>
            <DialogDescription>Record a salary advance given to a worker</DialogDescription>
          </DialogHeader>

          <Form {...advanceForm}>
            <form noValidate onSubmit={advanceForm.handleSubmit((data: any) => advanceMutation.mutate(data))} className="space-y-4">
              <FormField
                control={advanceForm.control}
                name="employeeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Worker</FormLabel>
                    <Popover open={advanceWorkerComboOpen} onOpenChange={setAdvanceWorkerComboOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            data-testid="select-advance-employee"
                            className={cn("w-full justify-between font-normal", !field.value && "text-muted-foreground")}
                          >
                            {field.value
                              ? (() => {
                                  const w = workerStaff.find((w) => w.id.toString() === field.value);
                                  return w ? `${w.firstName} ${w.lastName} (${w.code})` : "Select worker";
                                })()
                              : "Select worker"}
                            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-full p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search workers..." />
                          <CommandList>
                            <CommandEmpty>No workers found.</CommandEmpty>
                            <CommandGroup>
                              {workerStaff.map((worker) => (
                                <CommandItem
                                  key={worker.id}
                                  value={`${worker.firstName} ${worker.lastName} ${worker.code}`}
                                  onSelect={() => {
                                    field.onChange(worker.id.toString());
                                    setAdvanceWorkerComboOpen(false);
                                  }}
                                >
                                  <Check className={cn("mr-2 h-4 w-4", field.value === worker.id.toString() ? "opacity-100" : "opacity-0")} />
                                  {worker.firstName} {worker.lastName} ({worker.code})
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField control={advanceForm.control} name="amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Advance Amount</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-advance-amount" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField
                control={advanceForm.control}
                name="advanceDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Advance Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}
                            data-testid="button-advance-date"
                          >
                            {field.value ? formatDisplayDate(field.value) : <span>Pick a date</span>}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={advanceForm.control}
                name="isOpeningBalance"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 bg-muted/50">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} data-testid="checkbox-opening-balance" />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Opening Balance (from Tally)</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Check this if importing an existing balance from your old system. This will not create any cash transaction.
                      </p>
                    </div>
                  </FormItem>
                )}
              />

              {!advanceForm.watch("isOpeningBalance") && (
                <FormField control={advanceForm.control} name="cashAccountId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cash Account</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-advance-cash-account">
                          <SelectValue placeholder="Select cash account" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {cashAccounts.length === 0 ? (
                          <SelectItem value="none" disabled>No cash accounts available</SelectItem>
                        ) : (
                          cashAccounts.map((account) => (
                            <SelectItem key={account.id} value={account.id.toString()}>
                              {account.name} ({account.code})
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              <FormField control={advanceForm.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes / Reason (Optional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Reason for advance..." {...field} data-testid="input-advance-notes" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setAdvanceDialogOpen(false)} data-testid="button-cancel-advance">Cancel</Button>
                <Button type="submit" disabled={advanceMutation.isPending} data-testid="button-submit-advance">
                  {advanceMutation.isPending ? "Processing..." : "Create Advance"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Record Deduction Dialog */}
      <Dialog open={deductionDialogOpen} onOpenChange={setDeductionDialogOpen}>
        <DialogContent data-testid="dialog-record-deduction">
          <DialogHeader>
            <DialogTitle>Record Salary Deduction</DialogTitle>
            <DialogDescription>Record a deduction from this salary advance</DialogDescription>
          </DialogHeader>

          {selectedAdvance && (
            <div className="border rounded-md p-4 mb-4 bg-muted/30 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Employee:</span>
                <span className="font-medium">{selectedAdvance.employeeName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Original Amount:</span>
                <span className="font-mono">{formatAmount(parseFloat(selectedAdvance.amount))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Remaining Balance:</span>
                <span className="font-mono font-semibold" data-testid="text-deduction-remaining">
                  {formatAmount(parseFloat(selectedAdvance.remainingBalance))}
                </span>
              </div>
            </div>
          )}

          <Form {...deductionForm}>
            <form noValidate onSubmit={deductionForm.handleSubmit((data: any) => deductionMutation.mutate(data))} className="space-y-4">
              <FormField control={deductionForm.control} name="deductionAmount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Deduction Amount</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-deduction-amount" />
                  </FormControl>
                  <FormMessage />
                  {selectedAdvance && (
                    <p className="text-sm text-muted-foreground">
                      Maximum: {formatAmount(parseFloat(selectedAdvance.remainingBalance))}
                    </p>
                  )}
                </FormItem>
              )} />

              <FormField control={deductionForm.control} name="payrollMonth" render={({ field }) => (
                <FormItem>
                  <FormLabel>Payroll Month</FormLabel>
                  <FormControl>
                    <Input type="text" placeholder="YYYY-MM (e.g., 2024-01)" {...field} data-testid="input-payroll-month" />
                  </FormControl>
                  <FormMessage />
                  <p className="text-sm text-muted-foreground">Format: YYYY-MM (e.g., 2024-01 for January 2024)</p>
                </FormItem>
              )} />

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setDeductionDialogOpen(false)} data-testid="button-cancel-deduction">Cancel</Button>
                <Button type="submit" disabled={deductionMutation.isPending} data-testid="button-submit-deduction">
                  {deductionMutation.isPending ? "Processing..." : "Record Deduction"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Salary Advance Confirmation */}
      <AlertDialog open={advanceToDelete !== null} onOpenChange={(open) => !open && setAdvanceToDelete(null)}>
        <AlertDialogContent data-testid="dialog-delete-advance">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Salary Advance</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the advance and all associated deduction records. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (advanceToDelete !== null) {
                  deleteAdvanceMutation.mutate(advanceToDelete);
                  setAdvanceToDelete(null);
                }
              }}
              data-testid="button-confirm-delete-advance"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
