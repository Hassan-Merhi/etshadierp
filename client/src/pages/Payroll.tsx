import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Employee } from "@shared/schema";
import { DollarSign, TrendingDown, TrendingUp } from "lucide-react";

const depositSchema = z.object({
  amount: z.string().min(1, "Amount is required"),
  date: z.string().min(1, "Date is required"),
  notes: z.string().optional(),
});

const withdrawalSchema = z.object({
  amount: z.string().min(1, "Amount is required"),
  bankAccountId: z.string().min(1, "Bank account is required"),
  date: z.string().min(1, "Date is required"),
  notes: z.string().optional(),
});

const workerPaymentSchema = z.object({
  amount: z.string().min(1, "Amount is required"),
  bankAccountId: z.string().min(1, "Bank account is required"),
  date: z.string().min(1, "Date is required"),
  notes: z.string().optional(),
});

type DepositFormData = z.infer<typeof depositSchema>;
type WithdrawalFormData = z.infer<typeof withdrawalSchema>;
type WorkerPaymentFormData = z.infer<typeof workerPaymentSchema>;

export default function Payroll() {
  const [selectedTab, setSelectedTab] = useState("employees");
  const [depositDialogOpen, setDepositDialogOpen] = useState(false);
  const [withdrawalDialogOpen, setWithdrawalDialogOpen] = useState(false);
  const [workerPaymentDialogOpen, setWorkerPaymentDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const { selectedCompany } = useCompany();
  const { toast } = useToast();

  const { data: employees, isLoading: employeesLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
    enabled: !!selectedCompany,
  });

  const { data: bankAccounts, isLoading: bankAccountsLoading } = useQuery<any[]>({
    queryKey: ["/api/bank-accounts"],
    enabled: !!selectedCompany,
  });

  const depositForm = useForm<DepositFormData>({
    resolver: zodResolver(depositSchema),
    defaultValues: {
      amount: "",
      date: new Date().toISOString().split("T")[0],
      notes: "",
    },
  });

  const withdrawalForm = useForm<WithdrawalFormData>({
    resolver: zodResolver(withdrawalSchema),
    defaultValues: {
      amount: "",
      bankAccountId: "",
      date: new Date().toISOString().split("T")[0],
      notes: "",
    },
  });

  const workerPaymentForm = useForm<WorkerPaymentFormData>({
    resolver: zodResolver(workerPaymentSchema),
    defaultValues: {
      amount: "",
      bankAccountId: "",
      date: new Date().toISOString().split("T")[0],
      notes: "",
    },
  });

  const depositMutation = useMutation({
    mutationFn: async (data: DepositFormData) => {
      return await apiRequest("/api/payroll/deposit-employee", "POST", {
        employeeId: selectedEmployee?.id,
        ...data,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Salary deposited successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setDepositDialogOpen(false);
      depositForm.reset();
      setSelectedEmployee(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const withdrawalMutation = useMutation({
    mutationFn: async (data: WithdrawalFormData) => {
      return await apiRequest("/api/payroll/withdraw-employee", "POST", {
        employeeId: selectedEmployee?.id,
        ...data,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Withdrawal processed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setWithdrawalDialogOpen(false);
      withdrawalForm.reset();
      setSelectedEmployee(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const workerPaymentMutation = useMutation({
    mutationFn: async (data: WorkerPaymentFormData) => {
      return await apiRequest("/api/payroll/pay-worker", "POST", {
        employeeId: selectedEmployee?.id,
        ...data,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Payment processed successfully",
      });
      setWorkerPaymentDialogOpen(false);
      workerPaymentForm.reset();
      setSelectedEmployee(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDeposit = (employee: Employee) => {
    setSelectedEmployee(employee);
    setDepositDialogOpen(true);
  };

  const handleWithdrawal = (employee: Employee) => {
    setSelectedEmployee(employee);
    setWithdrawalDialogOpen(true);
  };

  const handleWorkerPayment = (worker: Employee) => {
    setSelectedEmployee(worker);
    setWorkerPaymentDialogOpen(true);
  };

  const employeeStaff = employees?.filter((emp) => emp.employeeType === "Employee") || [];
  const workerStaff = employees?.filter((emp) => emp.employeeType === "Worker") || [];

  if (employeesLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Payroll</h1>
        <Card className="p-6">
          <Skeleton className="h-[400px] w-full" />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Payroll</h1>

      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid grid-cols-2 w-[400px]">
          <TabsTrigger value="employees" data-testid="tab-employees">
            Employees ({employeeStaff.length})
          </TabsTrigger>
          <TabsTrigger value="workers" data-testid="tab-workers">
            Workers ({workerStaff.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="employees">
          <Card className="p-6">
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Warehouse Staff (Employees)</h2>
                <p className="text-sm text-muted-foreground">
                  Employees maintain running balance accounts. Deposit salary to increase balance, withdraw to decrease.
                </p>
              </div>

              {employeeStaff.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No employees found</p>
                  <p className="text-sm mt-2">Create employees from the Create Master Data page</p>
                </div>
              ) : (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead data-testid="header-code">Code</TableHead>
                        <TableHead data-testid="header-name">Name</TableHead>
                        <TableHead data-testid="header-balance" className="text-right">Balance</TableHead>
                        <TableHead data-testid="header-total-deposits" className="text-right">Total Deposits</TableHead>
                        <TableHead data-testid="header-total-withdrawals" className="text-right">Total Withdrawals</TableHead>
                        <TableHead data-testid="header-status">Status</TableHead>
                        <TableHead data-testid="header-actions" className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employeeStaff.map((employee) => (
                        <TableRow key={employee.id} data-testid={`row-employee-${employee.id}`}>
                          <TableCell data-testid={`cell-code-${employee.id}`}>
                            {employee.code}
                          </TableCell>
                          <TableCell data-testid={`cell-name-${employee.id}`}>
                            {employee.firstName} {employee.lastName}
                          </TableCell>
                          <TableCell data-testid={`cell-balance-${employee.id}`} className="text-right font-mono">
                            {parseFloat(employee.currentBalance).toFixed(2)}
                          </TableCell>
                          <TableCell data-testid={`cell-deposits-${employee.id}`} className="text-right font-mono text-muted-foreground">
                            {parseFloat(employee.totalDeposits).toFixed(2)}
                          </TableCell>
                          <TableCell data-testid={`cell-withdrawals-${employee.id}`} className="text-right font-mono text-muted-foreground">
                            {parseFloat(employee.totalWithdrawals).toFixed(2)}
                          </TableCell>
                          <TableCell data-testid={`cell-status-${employee.id}`}>
                            <Badge variant={employee.active ? "default" : "secondary"}>
                              {employee.active ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell data-testid={`cell-actions-${employee.id}`} className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDeposit(employee)}
                                data-testid={`button-deposit-${employee.id}`}
                              >
                                <TrendingUp className="h-4 w-4 mr-1" />
                                Deposit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleWithdrawal(employee)}
                                disabled={parseFloat(employee.currentBalance) <= 0}
                                data-testid={`button-withdraw-${employee.id}`}
                              >
                                <TrendingDown className="h-4 w-4 mr-1" />
                                Withdraw
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="workers">
          <Card className="p-6">
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Shop Floor Staff (Workers)</h2>
                <p className="text-sm text-muted-foreground">
                  Workers receive direct salary payments without balance tracking. Each payment is recorded as an expense.
                </p>
              </div>

              {workerStaff.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No workers found</p>
                  <p className="text-sm mt-2">Create workers from the Create Master Data page</p>
                </div>
              ) : (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead data-testid="header-code">Code</TableHead>
                        <TableHead data-testid="header-name">Name</TableHead>
                        <TableHead data-testid="header-email">Email</TableHead>
                        <TableHead data-testid="header-phone">Phone</TableHead>
                        <TableHead data-testid="header-department">Department</TableHead>
                        <TableHead data-testid="header-status">Status</TableHead>
                        <TableHead data-testid="header-actions" className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {workerStaff.map((worker) => (
                        <TableRow key={worker.id} data-testid={`row-worker-${worker.id}`}>
                          <TableCell data-testid={`cell-code-${worker.id}`}>
                            {worker.code}
                          </TableCell>
                          <TableCell data-testid={`cell-name-${worker.id}`}>
                            {worker.firstName} {worker.lastName}
                          </TableCell>
                          <TableCell data-testid={`cell-email-${worker.id}`}>
                            {worker.email}
                          </TableCell>
                          <TableCell data-testid={`cell-phone-${worker.id}`}>
                            {worker.phone || "-"}
                          </TableCell>
                          <TableCell data-testid={`cell-department-${worker.id}`}>
                            {worker.department || "-"}
                          </TableCell>
                          <TableCell data-testid={`cell-status-${worker.id}`}>
                            <Badge variant={worker.active ? "default" : "secondary"}>
                              {worker.active ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell data-testid={`cell-actions-${worker.id}`} className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleWorkerPayment(worker)}
                              data-testid={`button-pay-${worker.id}`}
                            >
                              <DollarSign className="h-4 w-4 mr-1" />
                              Pay Salary
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Employee Deposit Dialog */}
      <Dialog open={depositDialogOpen} onOpenChange={setDepositDialogOpen}>
        <DialogContent data-testid="dialog-deposit">
          <DialogHeader>
            <DialogTitle>Deposit Salary</DialogTitle>
            <DialogDescription>
              Add salary to {selectedEmployee?.firstName} {selectedEmployee?.lastName}'s balance account
            </DialogDescription>
          </DialogHeader>

          <Form {...depositForm}>
            <form onSubmit={depositForm.handleSubmit((data) => depositMutation.mutate(data))} className="space-y-4">
              <FormField
                control={depositForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        data-testid="input-deposit-amount"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={depositForm.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-deposit-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={depositForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Additional notes..."
                        {...field}
                        data-testid="input-deposit-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDepositDialogOpen(false)}
                  data-testid="button-cancel-deposit"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={depositMutation.isPending} data-testid="button-submit-deposit">
                  {depositMutation.isPending ? "Processing..." : "Deposit"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Employee Withdrawal Dialog */}
      <Dialog open={withdrawalDialogOpen} onOpenChange={setWithdrawalDialogOpen}>
        <DialogContent data-testid="dialog-withdrawal">
          <DialogHeader>
            <DialogTitle>Withdraw Salary</DialogTitle>
            <DialogDescription>
              Withdraw from {selectedEmployee?.firstName} {selectedEmployee?.lastName}'s balance: {selectedEmployee?.currentBalance}
            </DialogDescription>
          </DialogHeader>

          <Form {...withdrawalForm}>
            <form onSubmit={withdrawalForm.handleSubmit((data) => withdrawalMutation.mutate(data))} className="space-y-4">
              <FormField
                control={withdrawalForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        data-testid="input-withdrawal-amount"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={withdrawalForm.control}
                name="bankAccountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bank Account</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-withdrawal-bank">
                          <SelectValue placeholder="Select bank account" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {bankAccountsLoading ? (
                          <SelectItem value="loading" disabled>
                            Loading...
                          </SelectItem>
                        ) : (
                          bankAccounts?.map((account) => (
                            <SelectItem key={account.id} value={account.id.toString()}>
                              {account.name} ({account.accountNumber})
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={withdrawalForm.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-withdrawal-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={withdrawalForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Additional notes..."
                        {...field}
                        data-testid="input-withdrawal-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setWithdrawalDialogOpen(false)}
                  data-testid="button-cancel-withdrawal"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={withdrawalMutation.isPending} data-testid="button-submit-withdrawal">
                  {withdrawalMutation.isPending ? "Processing..." : "Withdraw"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Worker Payment Dialog */}
      <Dialog open={workerPaymentDialogOpen} onOpenChange={setWorkerPaymentDialogOpen}>
        <DialogContent data-testid="dialog-worker-payment">
          <DialogHeader>
            <DialogTitle>Pay Worker Salary</DialogTitle>
            <DialogDescription>
              Direct salary payment to {selectedEmployee?.firstName} {selectedEmployee?.lastName}
            </DialogDescription>
          </DialogHeader>

          <Form {...workerPaymentForm}>
            <form onSubmit={workerPaymentForm.handleSubmit((data) => workerPaymentMutation.mutate(data))} className="space-y-4">
              <FormField
                control={workerPaymentForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        data-testid="input-worker-amount"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={workerPaymentForm.control}
                name="bankAccountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bank Account</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-worker-bank">
                          <SelectValue placeholder="Select bank account" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {bankAccountsLoading ? (
                          <SelectItem value="loading" disabled>
                            Loading...
                          </SelectItem>
                        ) : (
                          bankAccounts?.map((account) => (
                            <SelectItem key={account.id} value={account.id.toString()}>
                              {account.name} ({account.accountNumber})
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={workerPaymentForm.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-worker-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={workerPaymentForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Additional notes..."
                        {...field}
                        data-testid="input-worker-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setWorkerPaymentDialogOpen(false)}
                  data-testid="button-cancel-worker"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={workerPaymentMutation.isPending} data-testid="button-submit-worker">
                  {workerPaymentMutation.isPending ? "Processing..." : "Pay"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
