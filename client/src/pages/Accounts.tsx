import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Search, Calendar, DollarSign, TrendingUp, TrendingDown, X, Plus, Edit, ChevronRight, ChevronDown, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertLedgerAccountSchema, updateLedgerAccountSchema, insertBankAccountSchema } from "@shared/schema";
import type { InsertLedgerAccount, UpdateLedgerAccount, LedgerAccount, BankAccount } from "@shared/schema";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCompany } from "@/contexts/CompanyContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Account {
  id: string;
  accountId: number;
  type: string;
  code: string;
  name: string;
  balance: number;
  balanceSide: string | null;
  active: boolean;
}

interface Transaction {
  entryId: number;
  voucherId: number;
  debitAmount: string;
  creditAmount: string;
  narration: string;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  voucherDescription: string;
}

export default function Accounts() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const { formatDisplayDate } = useDateFormat();
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [accountToEdit, setAccountToEdit] = useState<LedgerAccount | null>(null);
  const [editSearchTerm, setEditSearchTerm] = useState("");
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const [isBankDialogOpen, setIsBankDialogOpen] = useState(false);
  const [bankToEdit, setBankToEdit] = useState<BankAccount | null>(null);

  const { data: allAccounts = [], isLoading: accountsLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts/all"],
    enabled: !!selectedCompany,
  });

  // Filter out suppliers and inventory accounts - they have their own dedicated page
  const accounts = allAccounts.filter(account => 
    account.type !== "Supplier" && 
    account.code !== "PURCHASES" && 
    account.code !== "IMPORT_CHARGES"
  );

  const { data: ledgerAccounts = [], isLoading: ledgerAccountsLoading } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger-accounts", selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany) return [];
      const response = await fetch(`/api/ledger-accounts?companyId=${selectedCompany.id}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch ledger accounts");
      return await response.json();
    },
    enabled: !!selectedCompany,
  });

  const { data: bankAccounts = [], isLoading: bankAccountsLoading } = useQuery<BankAccount[]>({
    queryKey: ["/api/bank-accounts", selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany) return [];
      const response = await fetch(`/api/bank-accounts?companyId=${selectedCompany.id}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch bank accounts");
      return await response.json();
    },
    enabled: !!selectedCompany,
  });

  const { data: transactions = [], isLoading: transactionsLoading } = useQuery<Transaction[]>({
    queryKey: selectedAccount
      ? [
          `/api/accounts/${selectedAccount.type.toLowerCase().replace(" ", "-")}/${selectedAccount.accountId}/transactions`,
          { startDate, endDate },
        ]
      : [],
    queryFn: async () => {
      if (!selectedAccount) return [];
      
      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      
      let accountType = selectedAccount.type.toLowerCase();
      if (accountType === "fixed asset") {
        accountType = "fixed-asset";
      } else if (accountType === "supplier") {
        accountType = "supplier";
      }
      
      const url = `/api/accounts/${accountType}/${selectedAccount.accountId}/transactions${
        params.toString() ? `?${params.toString()}` : ""
      }`;
      
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch transactions");
      return await response.json();
    },
    enabled: !!selectedAccount,
  });

  const handleAccountChange = (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    setSelectedAccount(account || null);
    setSearchTerm("");
  };

  const handleMonthChange = (month: string) => {
    setSelectedMonth(month);
    if (month && selectedYear) {
      const monthIndex = parseInt(month) - 1;
      const year = parseInt(selectedYear);
      const start = startOfMonth(new Date(year, monthIndex, 1));
      const end = endOfMonth(new Date(year, monthIndex, 1));
      setStartDate(format(start, "yyyy-MM-dd"));
      setEndDate(format(end, "yyyy-MM-dd"));
    } else {
      setStartDate("");
      setEndDate("");
    }
  };

  const handleYearChange = (year: string) => {
    setSelectedYear(year);
    if (year && selectedMonth) {
      const monthIndex = parseInt(selectedMonth) - 1;
      const yearNum = parseInt(year);
      const start = startOfMonth(new Date(yearNum, monthIndex, 1));
      const end = endOfMonth(new Date(yearNum, monthIndex, 1));
      setStartDate(format(start, "yyyy-MM-dd"));
      setEndDate(format(end, "yyyy-MM-dd"));
    } else {
      setStartDate("");
      setEndDate("");
    }
  };

  const clearDateFilters = () => {
    setStartDate("");
    setEndDate("");
    setSelectedMonth("");
    setSelectedYear("");
  };

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);
  const months = [
    { value: "1", label: "January" },
    { value: "2", label: "February" },
    { value: "3", label: "March" },
    { value: "4", label: "April" },
    { value: "5", label: "May" },
    { value: "6", label: "June" },
    { value: "7", label: "July" },
    { value: "8", label: "August" },
    { value: "9", label: "September" },
    { value: "10", label: "October" },
    { value: "11", label: "November" },
    { value: "12", label: "December" },
  ];

  // Build account hierarchy
  const buildAccountHierarchy = () => {
    const accountMap = new Map<string, Account & { children: Account[] }>();
    const rootAccounts: (Account & { children: Account[] })[] = [];
    
    // First pass: create map of all accounts
    accounts.forEach(account => {
      accountMap.set(account.id, { ...account, children: [] });
    });
    
    // Second pass: build hierarchy
    accounts.forEach(account => {
      const mappedAccount = accountMap.get(account.id);
      if (!mappedAccount) return;
      
      // Find parent in ledgerAccounts if it has one
      const ledgerAccount = ledgerAccounts.find(la => la.id === account.accountId);
      if (ledgerAccount?.parentId) {
        // Find parent in account map
        const parentAccount = Array.from(accountMap.values()).find(
          a => a.accountId === ledgerAccount.parentId
        );
        if (parentAccount) {
          parentAccount.children.push(mappedAccount);
        } else {
          rootAccounts.push(mappedAccount);
        }
      } else {
        rootAccounts.push(mappedAccount);
      }
    });
    
    return rootAccounts;
  };

  const accountHierarchy = buildAccountHierarchy();

  const filteredAccounts = accountHierarchy.filter((account) => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = (acc: Account): boolean => {
      return (
        acc.name.toLowerCase().includes(searchLower) ||
        acc.code.toLowerCase().includes(searchLower) ||
        acc.type.toLowerCase().includes(searchLower)
      );
    };
    
    // Show account if it matches or any of its children match
    const accountMatches = matchesSearch(account);
    const childMatches = account.children.some(matchesSearch);
    return accountMatches || childMatches;
  });

  const toggleParent = (accountId: string) => {
    const newExpanded = new Set(expandedParents);
    if (newExpanded.has(accountId)) {
      newExpanded.delete(accountId);
    } else {
      newExpanded.add(accountId);
    }
    setExpandedParents(newExpanded);
  };

  const calculateRunningBalance = () => {
    let runningBalance = selectedAccount?.balance || 0;
    return transactions.map((transaction) => {
      const debit = parseFloat(transaction.debitAmount || "0");
      const credit = parseFloat(transaction.creditAmount || "0");
      runningBalance += debit - credit;
      return {
        ...transaction,
        runningBalance,
      };
    });
  };

  const transactionsWithBalance = calculateRunningBalance();

  const form = useForm<InsertLedgerAccount>({
    resolver: zodResolver(insertLedgerAccountSchema.omit({ companyId: true })),
    defaultValues: {
      code: "",
      name: "",
      accountType: "Asset",
      openingBalance: "0",
      openingBalanceSide: "Dr",
      active: true,
    },
  });

  const bankForm = useForm<Omit<z.infer<typeof insertBankAccountSchema>, "companyId">>({
    resolver: zodResolver(insertBankAccountSchema.omit({ companyId: true })),
    defaultValues: {
      code: "",
      name: "",
      bankName: "",
      accountNumber: "",
      routingCode: "",
      openingBalance: "0",
      openingBalanceSide: "Dr",
      active: true,
    },
  });

  const createLedgerMutation = useMutation({
    mutationFn: async (data: Omit<InsertLedgerAccount, "companyId">) => {
      if (!selectedCompany?.id) {
        throw new Error("No company selected");
      }
      return await apiRequest("POST", "/api/ledger-accounts", {
        ...data,
        companyId: selectedCompany.id,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Ledger account created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts", selectedCompany?.id] });
      setIsCreateDialogOpen(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create ledger account",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InsertLedgerAccount) => {
    createLedgerMutation.mutate(data);
  };

  const editForm = useForm<UpdateLedgerAccount>({
    resolver: zodResolver(updateLedgerAccountSchema.omit({ id: true, companyId: true })),
    defaultValues: {
      code: "",
      name: "",
      accountType: "Asset",
      openingBalance: "0",
      openingBalanceSide: "Dr",
      active: true,
    },
  });

  const updateLedgerMutation = useMutation({
    mutationFn: async (data: UpdateLedgerAccount) => {
      if (!accountToEdit) {
        throw new Error("No account selected");
      }
      return await apiRequest("PUT", `/api/ledger-accounts/${accountToEdit.id}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Account updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      setAccountToEdit(null);
      editForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update account",
        variant: "destructive",
      });
    },
  });

  const deleteLedgerMutation = useMutation({
    mutationFn: async (accountId: number) => {
      return await apiRequest("DELETE", `/api/ledger-accounts/${accountId}`);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Ledger account deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      setAccountToEdit(null);
      editForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete account",
        variant: "destructive",
      });
    },
  });

  const createBankMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!selectedCompany?.id) {
        throw new Error("No company selected");
      }
      return await apiRequest("POST", "/api/bank-accounts", {
        ...data,
        companyId: selectedCompany.id,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Bank account created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-accounts", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      setIsBankDialogOpen(false);
      bankForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create bank account",
        variant: "destructive",
      });
    },
  });

  const updateBankMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!bankToEdit) {
        throw new Error("No bank account selected");
      }
      return await apiRequest("PUT", `/api/bank-accounts/${bankToEdit.id}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Bank account updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-accounts", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      setBankToEdit(null);
      bankForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update bank account",
        variant: "destructive",
      });
    },
  });

  const deleteBankMutation = useMutation({
    mutationFn: async (accountId: number) => {
      return await apiRequest("DELETE", `/api/bank-accounts/${accountId}`);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Bank account deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-accounts", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      setBankToEdit(null);
      bankForm.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete bank account",
        variant: "destructive",
      });
    },
  });

  const handleDeleteAccount = () => {
    if (!accountToEdit) return;
    
    if (window.confirm(`Are you sure you want to delete "${accountToEdit.name}"? This action cannot be undone.`)) {
      deleteLedgerMutation.mutate(accountToEdit.id);
    }
  };

  const onEditSubmit = (data: UpdateLedgerAccount) => {
    updateLedgerMutation.mutate(data);
  };

  const handleSelectAccountForEdit = (account: LedgerAccount) => {
    setAccountToEdit(account);
    editForm.reset({
      code: account.code,
      name: account.name,
      accountType: account.accountType as any,
      subType: account.subType || undefined,
      openingBalance: account.openingBalance || "0",
      openingBalanceSide: account.openingBalanceSide as "Dr" | "Cr" || undefined,
      active: account.active,
    });
  };

  const filteredAccountsForEdit = accounts.filter((account) => {
    const searchLower = editSearchTerm.toLowerCase();
    return (
      account.name.toLowerCase().includes(searchLower) ||
      account.code.toLowerCase().includes(searchLower) ||
      account.type.toLowerCase().includes(searchLower)
    );
  });

  const onBankSubmit = (data: any) => {
    if (bankToEdit) {
      updateBankMutation.mutate(data);
    } else {
      createBankMutation.mutate(data);
    }
  };

  const handleSelectBankForEdit = (bank: BankAccount) => {
    setBankToEdit(bank);
    bankForm.reset({
      code: bank.code,
      name: bank.name,
      bankName: bank.bankName,
      accountNumber: bank.accountNumber,
      routingCode: bank.routingCode || "",
      openingBalance: bank.openingBalance || "0",
      openingBalanceSide: bank.openingBalanceSide as "Dr" | "Cr" || "Dr",
      active: bank.active,
    });
  };

  const handleDeleteBankAccount = () => {
    if (!bankToEdit) return;
    
    if (window.confirm(`Are you sure you want to delete "${bankToEdit.name}"? This action cannot be undone.`)) {
      deleteBankMutation.mutate(bankToEdit.id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Accounts Overview</h1>
          <p className="text-sm text-muted-foreground mt-1">
            View all accounts, balances, and transaction history
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button 
                data-testid="button-create-ledger"
                disabled={!selectedCompany}
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Ledger Account
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create Ledger Account</DialogTitle>
              <DialogDescription>
                Add a new ledger account to your chart of accounts
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account Code</FormLabel>
                      <FormControl>
                        <Input placeholder="ACC001" {...field} data-testid="input-account-code" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Cash in Hand" {...field} data-testid="input-account-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="accountType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-account-type">
                            <SelectValue placeholder="Select account type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Asset">Asset</SelectItem>
                          <SelectItem value="Liability">Liability</SelectItem>
                          <SelectItem value="Equity">Equity</SelectItem>
                          <SelectItem value="Income">Income</SelectItem>
                          <SelectItem value="Expense">Expense</SelectItem>
                          <SelectItem value="Bank">Bank</SelectItem>
                          <SelectItem value="Cash">Cash</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="openingBalance"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Opening Balance</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            {...field}
                            data-testid="input-opening-balance"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="openingBalanceSide"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Balance Side</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-balance-side">
                              <SelectValue placeholder="Dr/Cr" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Dr">Dr (Debit)</SelectItem>
                            <SelectItem value="Cr">Cr (Credit)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsCreateDialogOpen(false)}
                    data-testid="button-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createLedgerMutation.isPending}
                    data-testid="button-submit-ledger"
                  >
                    {createLedgerMutation.isPending ? "Creating..." : "Create Account"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        <Dialog open={isBankDialogOpen || !!bankToEdit} onOpenChange={(open) => {
          setIsBankDialogOpen(open);
          if (!open) {
            setBankToEdit(null);
            bankForm.reset();
          }
        }}>
          <DialogTrigger asChild>
            <Button 
              data-testid="button-create-bank"
              disabled={!selectedCompany}
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Bank Account
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{bankToEdit ? "Edit Bank Account" : "Create Bank Account"}</DialogTitle>
              <DialogDescription>
                {bankToEdit ? "Update bank account details" : "Add a new bank account"}
              </DialogDescription>
            </DialogHeader>
            <Form {...bankForm}>
              <form onSubmit={bankForm.handleSubmit(onBankSubmit)} className="space-y-4">
                <FormField
                  control={bankForm.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account Code</FormLabel>
                      <FormControl>
                        <Input placeholder="BANK001" {...field} data-testid="input-bank-code" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={bankForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Main Account" {...field} data-testid="input-bank-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={bankForm.control}
                  name="bankName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bank Name</FormLabel>
                      <FormControl>
                        <Input placeholder="ABC Bank" {...field} data-testid="input-bank-bankname" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={bankForm.control}
                  name="accountNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account Number</FormLabel>
                      <FormControl>
                        <Input placeholder="1234567890" {...field} data-testid="input-bank-accountnumber" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={bankForm.control}
                  name="routingCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Routing Code (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="ABCD0123456" {...field} value={field.value || ""} data-testid="input-bank-routingcode" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={bankForm.control}
                    name="openingBalance"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Opening Balance</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            {...field}
                            value={field.value || "0"}
                            data-testid="input-bank-opening-balance"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={bankForm.control}
                    name="openingBalanceSide"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Balance Side</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-bank-balance-side">
                              <SelectValue placeholder="Dr/Cr" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Dr">Dr (Debit)</SelectItem>
                            <SelectItem value="Cr">Cr (Credit)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={bankForm.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Active</FormLabel>
                      </div>
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-bank-active"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  {bankToEdit ? (
                    <div className="flex w-full gap-2 justify-between">
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={handleDeleteBankAccount}
                        disabled={deleteBankMutation.isPending}
                        data-testid="button-delete-bank"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        {deleteBankMutation.isPending ? "Deleting..." : "Delete"}
                      </Button>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setBankToEdit(null);
                            bankForm.reset();
                          }}
                          data-testid="button-cancel-bank"
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          disabled={updateBankMutation.isPending}
                          data-testid="button-submit-bank"
                        >
                          {updateBankMutation.isPending ? "Saving..." : "Save Changes"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsBankDialogOpen(false)}
                        data-testid="button-cancel-bank"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={createBankMutation.isPending}
                        data-testid="button-submit-bank"
                      >
                        {createBankMutation.isPending ? "Creating..." : "Create Account"}
                      </Button>
                    </>
                  )}
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <Tabs defaultValue="view" className="space-y-6">
        <TabsList>
          <TabsTrigger value="view" data-testid="tab-view">View Accounts</TabsTrigger>
          <TabsTrigger value="alter" data-testid="tab-alter">Alter Account</TabsTrigger>
        </TabsList>

        <TabsContent value="view" className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Select Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="account-search">Search & Select Account</Label>
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="account-search"
                  placeholder="Search by name or type..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                  disabled={accountsLoading || !selectedCompany}
                  data-testid="input-account-search"
                />
              </div>
              
              {accountsLoading || !selectedCompany ? (
                <div className="p-4">
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto border rounded-md">
                  {filteredAccounts.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      No accounts found
                    </div>
                  ) : (
                    filteredAccounts.map((account) => (
                      <div key={account.id}>
                        <div className="flex items-center border-b last:border-b-0">
                          {account.children.length > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleParent(account.id);
                              }}
                              className="p-2 hover-elevate"
                              data-testid={`button-toggle-${account.id}`}
                            >
                              {expandedParents.has(account.id) ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => handleAccountChange(account.id)}
                            disabled={accountsLoading || !selectedCompany}
                            className={`flex-1 p-3 text-left hover-elevate ${
                              selectedAccount?.id === account.id
                                ? "bg-accent"
                                : ""
                            } ${account.children.length === 0 ? 'ml-8' : ''}`}
                            data-testid={`button-select-account-${account.id}`}
                          >
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {account.type}
                              </Badge>
                              <span className="text-sm">{account.name}</span>
                            </div>
                          </button>
                        </div>
                        {expandedParents.has(account.id) && account.children.map((child) => (
                          <div key={child.id} className="border-b last:border-b-0">
                            <button
                              onClick={() => handleAccountChange(child.id)}
                              disabled={accountsLoading || !selectedCompany}
                              className={`w-full p-3 pl-16 text-left hover-elevate ${
                                selectedAccount?.id === child.id
                                  ? "bg-accent"
                                  : ""
                              }`}
                              data-testid={`button-select-account-${child.id}`}
                            >
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs">
                                  {child.type}
                                </Badge>
                                <span className="text-sm">{child.name}</span>
                              </div>
                            </button>
                          </div>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {selectedAccount && (
            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Account Type</p>
                    <Badge variant="outline" data-testid="badge-account-type">
                      {selectedAccount.type}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Balance</p>
                    <div className="flex items-center gap-2">
                      {selectedAccount.balanceSide === "Dr" ? (
                        <TrendingUp className="w-4 h-4 text-green-600" />
                      ) : selectedAccount.balanceSide === "Cr" ? (
                        <TrendingDown className="w-4 h-4 text-red-600" />
                      ) : (
                        <DollarSign className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="font-mono font-semibold" data-testid="text-account-balance">
                        ${Math.abs(selectedAccount.balance).toFixed(2)}{" "}
                        {selectedAccount.balanceSide || ""}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      {selectedAccount && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Filter by Date Range
                </CardTitle>
                {(startDate || endDate) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearDateFilters}
                    data-testid="button-clear-filters"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-sm font-medium mb-2 block">Quick Filter by Month</Label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="filter-year">Year</Label>
                    <Select value={selectedYear} onValueChange={handleYearChange}>
                      <SelectTrigger id="filter-year" data-testid="select-year">
                        <SelectValue placeholder="Select year" />
                      </SelectTrigger>
                      <SelectContent>
                        {years.map((year) => (
                          <SelectItem key={year} value={year.toString()}>
                            {year}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="filter-month">Month</Label>
                    <Select value={selectedMonth} onValueChange={handleMonthChange}>
                      <SelectTrigger id="filter-month" data-testid="select-month">
                        <SelectValue placeholder="Select month" />
                      </SelectTrigger>
                      <SelectContent>
                        {months.map((month) => (
                          <SelectItem key={month.value} value={month.value}>
                            {month.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              
              <div className="pt-4 border-t">
                <Label className="text-sm font-medium mb-2 block">Or Set Custom Date Range</Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="start-date">Start Date</Label>
                    <Input
                      id="start-date"
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value);
                        setSelectedMonth("");
                        setSelectedYear("");
                      }}
                      data-testid="input-start-date"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="end-date">End Date</Label>
                    <Input
                      id="end-date"
                      type="date"
                      value={endDate}
                      onChange={(e) => {
                        setEndDate(e.target.value);
                        setSelectedMonth("");
                        setSelectedYear("");
                      }}
                      data-testid="input-end-date"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Transaction History</CardTitle>
            </CardHeader>
            <CardContent>
              {transactionsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : transactionsWithBalance.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No transactions found for this account</p>
                  {(startDate || endDate) && (
                    <p className="text-sm mt-1">Try adjusting the date range</p>
                  )}
                </div>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Voucher #</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactionsWithBalance.map((transaction, index) => (
                        <TableRow
                          key={transaction.entryId}
                          data-testid={`row-transaction-${transaction.entryId}`}
                        >
                          <TableCell className="font-mono text-sm">
                            {transaction.voucherDate
                              ? formatDisplayDate(new Date(transaction.voucherDate))
                              : "-"}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {transaction.voucherNumber}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{transaction.voucherType}</Badge>
                          </TableCell>
                          <TableCell className="max-w-xs truncate">
                            {transaction.narration || transaction.voucherDescription || "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {parseFloat(transaction.debitAmount || "0") > 0
                              ? `$${parseFloat(transaction.debitAmount).toFixed(2)}`
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {parseFloat(transaction.creditAmount || "0") > 0
                              ? `$${parseFloat(transaction.creditAmount).toFixed(2)}`
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            ${Math.abs(transaction.runningBalance).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
        </TabsContent>

        <TabsContent value="alter" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Alter Account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-account-search">Search & Select Account to Edit</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="edit-account-search"
                    placeholder="Search by name or type..."
                    value={editSearchTerm}
                    onChange={(e) => setEditSearchTerm(e.target.value)}
                    className="pl-9"
                    disabled={accountsLoading || ledgerAccountsLoading || !selectedCompany}
                    data-testid="input-edit-account-search"
                  />
                </div>
                
                {accountsLoading || ledgerAccountsLoading || !selectedCompany ? (
                  <div className="p-4">
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto border rounded-md">
                    {filteredAccountsForEdit.length === 0 ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        No accounts found
                      </div>
                    ) : (
                      filteredAccountsForEdit.map((account) => {
                        const isLedger = account.type === "ledger";
                        const isBank = account.type === "bank";
                        const isEditable = isLedger || isBank;
                        const isLedgerSelected = accountToEdit?.id === account.accountId && isLedger;
                        const isBankSelected = bankToEdit?.id === account.accountId && isBank;
                        const isSelected = isLedgerSelected || isBankSelected;
                        
                        return (
                          <button
                            key={account.id}
                            type="button"
                            disabled={ledgerAccountsLoading || bankAccountsLoading || !selectedCompany}
                            onClick={() => {
                              if (isLedger) {
                                const ledgerAccount = ledgerAccounts.find(la => la.id === account.accountId);
                                if (ledgerAccount) {
                                  setBankToEdit(null);
                                  handleSelectAccountForEdit(ledgerAccount);
                                } else {
                                  toast({
                                    title: "Error",
                                    description: `Ledger account not found.`,
                                    variant: "destructive",
                                  });
                                }
                              } else if (isBank) {
                                const bankAccount = bankAccounts.find(ba => ba.id === account.accountId);
                                if (bankAccount) {
                                  setAccountToEdit(null);
                                  handleSelectBankForEdit(bankAccount);
                                } else {
                                  toast({
                                    title: "Error",
                                    description: `Bank account not found.`,
                                    variant: "destructive",
                                  });
                                }
                              } else {
                                toast({
                                  title: "Not Editable",
                                  description: "Only ledger and bank accounts can be edited",
                                });
                              }
                            }}
                            className={`w-full p-3 text-left border-b last:border-b-0 ${
                              isSelected ? "bg-accent" : "hover-elevate"
                            } ${!isEditable ? "opacity-60" : ""}`}
                            data-testid={`button-select-account-edit-${account.id}`}
                          >
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {account.type}
                              </Badge>
                              <span className="font-mono text-xs text-muted-foreground">
                                {account.code}
                              </span>
                              <span className="text-sm">{account.name}</span>
                              {!isEditable && (
                                <span className="ml-auto text-xs text-muted-foreground italic">
                                  (View only)
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              {accountToEdit && (
                <Card className="bg-muted/50">
                  <CardHeader>
                    <CardTitle className="text-sm">Edit Account Details</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Form {...editForm}>
                      <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
                        <FormField
                          control={editForm.control}
                          name="code"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Account Code</FormLabel>
                              <FormControl>
                                <Input {...field} readOnly className="bg-muted" data-testid="input-edit-code" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={editForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Account Name</FormLabel>
                              <FormControl>
                                <Input {...field} data-testid="input-edit-name" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={editForm.control}
                          name="accountType"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Account Type</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger data-testid="select-edit-type">
                                    <SelectValue placeholder="Select type" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="Asset">Asset</SelectItem>
                                  <SelectItem value="Liability">Liability</SelectItem>
                                  <SelectItem value="Equity">Equity</SelectItem>
                                  <SelectItem value="Income">Income</SelectItem>
                                  <SelectItem value="Expense">Expense</SelectItem>
                                  <SelectItem value="Bank">Bank</SelectItem>
                                  <SelectItem value="Cash">Cash</SelectItem>
                                  <SelectItem value="Indirect Expense">Indirect Expense</SelectItem>
                                  <SelectItem value="Direct Expense">Direct Expense</SelectItem>
                                  <SelectItem value="Government Taxes">Government Taxes</SelectItem>
                                  <SelectItem value="Loans">Loans</SelectItem>
                                  <SelectItem value="Duty Agent">Duty Agent</SelectItem>
                                  <SelectItem value="Transporter Agent">Transporter Agent</SelectItem>
                                  <SelectItem value="Accounts Payable">Accounts Payable</SelectItem>
                                  <SelectItem value="Profit">Profit</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={editForm.control}
                          name="subType"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Sub Type (Optional)</FormLabel>
                              <FormControl>
                                <Input {...field} value={field.value || ""} placeholder="Leave blank or enter sub type" data-testid="input-edit-subtype" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={editForm.control}
                            name="openingBalance"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Opening Balance</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    {...field}
                                    data-testid="input-edit-balance"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={editForm.control}
                            name="openingBalanceSide"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Balance Side</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger data-testid="select-edit-balance-side">
                                      <SelectValue placeholder="Dr/Cr" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="Dr">Dr (Debit)</SelectItem>
                                    <SelectItem value="Cr">Cr (Credit)</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <div className="flex gap-2 justify-between">
                          <Button
                            type="button"
                            variant="destructive"
                            onClick={handleDeleteAccount}
                            disabled={deleteLedgerMutation.isPending}
                            data-testid="button-delete-account"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {deleteLedgerMutation.isPending ? "Deleting..." : "Delete"}
                          </Button>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setAccountToEdit(null);
                                editForm.reset();
                              }}
                              data-testid="button-cancel-edit"
                            >
                              Cancel
                            </Button>
                            <Button
                              type="submit"
                              disabled={updateLedgerMutation.isPending}
                              data-testid="button-save-edit"
                            >
                              <Edit className="w-4 h-4 mr-2" />
                              {updateLedgerMutation.isPending ? "Saving..." : "Save Changes"}
                            </Button>
                          </div>
                        </div>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              )}

              {bankToEdit && (
                <Card className="bg-muted/50">
                  <CardHeader>
                    <CardTitle className="text-sm">Edit Bank Account Details</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Form {...bankForm}>
                      <form onSubmit={bankForm.handleSubmit(onBankSubmit)} className="space-y-4">
                        <FormField
                          control={bankForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Account Name</FormLabel>
                              <FormControl>
                                <Input {...field} data-testid="input-edit-bank-name" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={bankForm.control}
                          name="bankName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Bank Name</FormLabel>
                              <FormControl>
                                <Input {...field} data-testid="input-edit-bank-bankname" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={bankForm.control}
                          name="accountNumber"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Account Number</FormLabel>
                              <FormControl>
                                <Input {...field} data-testid="input-edit-bank-accountnumber" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={bankForm.control}
                          name="routingCode"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Routing Code (Optional)</FormLabel>
                              <FormControl>
                                <Input {...field} value={field.value || ""} data-testid="input-edit-bank-routingcode" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={bankForm.control}
                            name="openingBalance"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Opening Balance</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    {...field}
                                    value={field.value || "0"}
                                    data-testid="input-edit-bank-balance"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={bankForm.control}
                            name="openingBalanceSide"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Balance Side</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger data-testid="select-edit-bank-balance-side">
                                      <SelectValue placeholder="Dr/Cr" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="Dr">Dr (Debit)</SelectItem>
                                    <SelectItem value="Cr">Cr (Credit)</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <div className="flex gap-2 justify-between">
                          <Button
                            type="button"
                            variant="destructive"
                            onClick={handleDeleteBankAccount}
                            disabled={deleteBankMutation.isPending}
                            data-testid="button-delete-bank-account"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {deleteBankMutation.isPending ? "Deleting..." : "Delete"}
                          </Button>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setBankToEdit(null);
                                bankForm.reset();
                              }}
                              data-testid="button-cancel-bank-edit"
                            >
                              Cancel
                            </Button>
                            <Button
                              type="submit"
                              disabled={updateBankMutation.isPending}
                              data-testid="button-save-bank-edit"
                            >
                              <Edit className="w-4 h-4 mr-2" />
                              {updateBankMutation.isPending ? "Saving..." : "Save Changes"}
                            </Button>
                          </div>
                        </div>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
