import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Banknote, ArrowDownCircle, MinusCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { queryClient } from "@/lib/queryClient";
import { getApiRequest } from "@/lib/factoryApi";
import { useAppMode } from "@/contexts/AppModeContext";
import type { Employee } from "@shared/schema";
import {
  salaryAdvanceSchema,
  deductionSchema,
  type SalaryAdvanceFormData,
  type DeductionFormData,
  type SalaryAdvance,
} from "./payrollSchemas";

export function AdvancesTab() {
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const { formatDisplayDate } = useDateFormat();
  const { formatAmount } = useCurrencyContext();

  const [advanceDialogOpen, setAdvanceDialogOpen] = useState(false);
  const [deductionDialogOpen, setDeductionDialogOpen] = useState(false);
  const [selectedAdvance, setSelectedAdvance] = useState<SalaryAdvance | null>(null);

  const { data: workerStaff = [] } = useQuery<Employee[]>({
    queryKey: ["/api/payroll/employees-with-balances", selectedCompany?.id],
    enabled: !!selectedCompany,
    select: (data: any[]) => data.filter((e) => e.employeeType === "Worker"),
  });

  const { data: salaryAdvances = [], isLoading: advancesLoading } = useQuery<SalaryAdvance[]>({
    queryKey: ["/api/salary-advances", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const { data: cashAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/cash-accounts"],
    enabled: !!selectedCompany,
  });

  const advanceForm = useForm<SalaryAdvanceFormData>({
    resolver: zodResolver(salaryAdvanceSchema),
    defaultValues: {
      employeeId: "",
      amount: "",
      advanceDate: new Date(),
      notes: "",
      isOpeningBalance: false,
    },
  });

  const deductionForm = useForm<DeductionFormData>({
    resolver: zodResolver(deductionSchema),
    defaultValues: {
      deductionAmount: "",
      payrollMonth: format(new Date(), "yyyy-MM"),
    },
  });

  const advanceMutation = useMutation({
    mutationFn: async (data: SalaryAdvanceFormData) => {
      return await modeApiRequest("POST", "/api/salary-advances", {
        employeeId: parseInt(data.employeeId),
        amount: data.amount,
        advanceDate: format(data.advanceDate, "yyyy-MM-dd"),
        cashAccountId: data.isOpeningBalance ? undefined : parseInt(data.cashAccountId || "0"),
        notes: data.notes,
        isOpeningBalance: data.isOpeningBalance,
      });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Salary advance created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/net-profit"] });
      setAdvanceDialogOpen(false);
      advanceForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteAdvanceMutation = useMutation({
    mutationFn: async (advanceId: number) => {
      return await modeApiRequest("DELETE", `/api/salary-advances/${advanceId}`, undefined);
    },
    onSuccess: () => {
      toast({ title: "Deleted", description: "Salary advance deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances", selectedCompany?.id] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deductionMutation = useMutation({
    mutationFn: async (data: DeductionFormData) => {
      if (!selectedAdvance) throw new Error("No advance selected");
      return await modeApiRequest("POST", `/api/salary-advances/${selectedAdvance.id}/deduction`, data);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Deduction recorded successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances", selectedCompany?.id] });
      setDeductionDialogOpen(false);
      deductionForm.reset();
      setSelectedAdvance(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (advancesLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Salary Advances</h2>
          <p className="text-muted-foreground">Manage and track worker salary advances and repayments</p>
        </div>
        <Button onClick={() => setAdvanceDialogOpen(true)} data-testid="button-create-advance">
          <Plus className="mr-2 h-4 w-4" />
          New Advance
        </Button>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Worker</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {salaryAdvances.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No salary advances found
                </TableCell>
              </TableRow>
            ) : (
              salaryAdvances.map((advance) => (
                <TableRow key={advance.id}>
                  <TableCell>{formatDisplayDate(advance.advanceDate)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{advance.employeeName}</span>
                      <span className="text-xs text-muted-foreground">{advance.employeeCode}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatAmount(parseFloat(advance.amount))}</TableCell>
                  <TableCell className="text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                    {formatAmount(parseFloat(advance.remainingBalance))}
                  </TableCell>
                  <TableCell>
                    {advance.fullyPaid ? (
                      <Badge variant="default" className="bg-green-500 hover:bg-green-600">
                        Fully Paid
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-500 text-amber-500">
                        Outstanding
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {!advance.fullyPaid && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setSelectedAdvance(advance);
                            deductionForm.setValue("deductionAmount", advance.remainingBalance);
                            setDeductionDialogOpen(true);
                          }}
                          title="Record Repayment"
                        >
                          <ArrowDownCircle className="h-4 w-4 text-green-600" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => {
                          if (confirm("Are you sure you want to delete this advance?")) {
                            deleteAdvanceMutation.mutate(advance.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={advanceDialogOpen} onOpenChange={setAdvanceDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Salary Advance</DialogTitle>
            <DialogDescription>Record a cash advance given to a worker.</DialogDescription>
          </DialogHeader>
          <Form {...advanceForm}>
            <form onSubmit={advanceForm.handleSubmit((data) => advanceMutation.mutate(data))} className="space-y-4">
              <FormField
                control={advanceForm.control}
                name="employeeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Worker</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select worker" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {workerStaff.map((w) => (
                          <SelectItem key={w.id} value={String(w.id)}>
                            {w.code} - {w.firstName} {w.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={advanceForm.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" placeholder="0.00" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={advanceForm.control}
                  name="advanceDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          value={field.value ? format(field.value, "yyyy-MM-dd") : ""}
                          onChange={(e) => field.onChange(new Date(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={advanceForm.control}
                name="isOpeningBalance"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Opening Balance</FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Tick if this is an existing balance from before system startup.
                      </p>
                    </div>
                  </FormItem>
                )}
              />
              {!advanceForm.watch("isOpeningBalance") && (
                <FormField
                  control={advanceForm.control}
                  name="cashAccountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cash Account</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select account" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {cashAccounts.map((acc) => (
                            <SelectItem key={acc.id} value={String(acc.id)}>
                              {acc.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={advanceForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={advanceMutation.isPending}>
                {advanceMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Advance
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={deductionDialogOpen} onOpenChange={setDeductionDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Repayment</DialogTitle>
            <DialogDescription>Manually record a repayment for {selectedAdvance?.employeeName}.</DialogDescription>
          </DialogHeader>
          <Form {...deductionForm}>
            <form onSubmit={deductionForm.handleSubmit((data) => deductionMutation.mutate(data))} className="space-y-4">
              <FormField
                control={deductionForm.control}
                name="deductionAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Repayment Amount</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={deductionForm.control}
                name="payrollMonth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reference Month (YYYY-MM)</FormLabel>
                    <FormControl>
                      <Input type="month" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={deductionMutation.isPending}>
                {deductionMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit Repayment
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { Checkbox } from "@/components/ui/checkbox";
