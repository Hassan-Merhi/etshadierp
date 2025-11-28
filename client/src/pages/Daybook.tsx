import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Book, Filter, X, Eye, Edit, Trash2, Plus, ChevronDown, Check, ChevronsUpDown, FileDown } from "lucide-react";
import { format, parseISO, isToday } from "date-fns";
import { cn } from "@/lib/utils";
import { utils, writeFile } from "xlsx";

// Helper function to format amounts without .00 for whole numbers
const formatAmount = (amount: number | string): string => {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  const formatted = num.toFixed(2);
  return formatted.endsWith(".00") ? formatted.slice(0, -3) : formatted;
};

// Account types
interface LedgerAccount {
  id: number;
  code: string;
  name: string;
  accountType: string;
}

interface BankAccount {
  id: number;
  code: string;
  name: string;
  accountNumber: string;
  bankName: string;
}

interface Supplier {
  id: number;
  code: string;
  legalName: string;
}

interface Employee {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
}

interface FixedAsset {
  id: number;
  assetCode: string;
  assetName: string;
}

// Zod schema for new entry rows
const newEntryRowSchema = z.object({
  accountType: z.enum(["ledger", "bank", "supplier", "employee", "fixedAsset"]),
  accountId: z.number().min(1, "Please select an account"),
  accountName: z.string(),
  debitAmount: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, {
    message: "Must be a valid number",
  }),
  creditAmount: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, {
    message: "Must be a valid number",
  }),
  narration: z.string().optional(),
});

// Zod schema for creating vouchers with entries
const createVoucherSchema = z.object({
  voucherType: z.enum(["Journal", "Payment", "Receipt", "Stock Transfer", "Sales", "Purchase", "Contra"], {
    required_error: "Voucher type is required",
  }),
  voucherDate: z.string().min(1, "Voucher date is required"),
  description: z.string().optional(),
  optional: z.boolean().default(false),
  entries: z.array(newEntryRowSchema).min(2, "At least 2 entries required"),
}).refine((data) => {
  // Calculate total debits and credits
  const totalDebits = data.entries.reduce((sum, entry) => sum + parseFloat(entry.debitAmount || "0"), 0);
  const totalCredits = data.entries.reduce((sum, entry) => sum + parseFloat(entry.creditAmount || "0"), 0);
  return Math.abs(totalDebits - totalCredits) < 0.01; // Allow for floating point precision
}, {
  message: "Total debits must equal total credits",
  path: ["entries"],
});

type CreateVoucherForm = z.infer<typeof createVoucherSchema>;
type EditVoucherForm = CreateVoucherForm;

interface Voucher {
  id: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  description: string | null;
  totalAmount: string;
  optional: boolean;
  createdAt: string;
}

interface VoucherEntry {
  id: number;
  voucherId: number;
  accountType: string;
  accountId: number;
  accountCode: string;
  accountName: string;
  debitAmount: string;
  creditAmount: string;
  narration: string | null;
}

// Account Combobox Component
function AccountCombobox({
  value,
  onChange,
  ledgerAccounts,
  bankAccounts,
  suppliers,
  employees,
  fixedAssets,
  rowIndex,
  testIdPrefix = "button-account",
}: {
  value: { type: string; id: number; name: string } | null;
  onChange: (type: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset", id: number, name: string) => void;
  ledgerAccounts: LedgerAccount[];
  bankAccounts: BankAccount[];
  suppliers: Supplier[];
  employees: Employee[];
  fixedAssets: FixedAsset[];
  rowIndex: number;
  testIdPrefix?: string;
}) {
  const [open, setOpen] = useState(false);

  const allAccounts = [
    ...ledgerAccounts.map((a) => ({
      type: "ledger" as const,
      id: a.id,
      name: a.name,
    })),
    ...bankAccounts.map((a) => ({
      type: "bank" as const,
      id: a.id,
      name: a.bankName,
    })),
    ...suppliers.map((s) => ({
      type: "supplier" as const,
      id: s.id,
      name: s.legalName,
    })),
    ...employees.map((e) => ({
      type: "employee" as const,
      id: e.id,
      name: `${e.firstName} ${e.lastName}`,
    })),
    ...fixedAssets.map((f) => ({
      type: "fixedAsset" as const,
      id: f.id,
      name: f.assetName,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid={`${testIdPrefix}-${rowIndex}`}
        >
          {value ? value.name : "Select account..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0 bg-popover text-popover-foreground">
        <Command className="bg-popover text-popover-foreground">
          <CommandInput placeholder="Search accounts..." className="bg-popover text-popover-foreground" />
          <CommandList className="bg-popover text-popover-foreground">
            <CommandEmpty>No account found.</CommandEmpty>
            <CommandGroup>
              {allAccounts.map((account) => (
                <CommandItem
                  key={`${account.type}-${account.id}`}
                  value={account.name}
                  onSelect={() => {
                    onChange(account.type, account.id, account.name);
                    setOpen(false);
                  }}
                  data-testid={`option-account-${account.type}-${account.id}`}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value?.type === account.type && value?.id === account.id
                        ? "opacity-100"
                        : "opacity-0"
                    )}
                  />
                  {account.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function Daybook({ user }: { user?: any } = {}) {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const [, navigate] = useLocation();
  const [filters, setFilters] = useState({
    startDate: format(new Date(), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    voucherType: "all",
    searchQuery: "",
  });
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState<Voucher | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [voucherToEdit, setVoucherToEdit] = useState<Voucher | null>(null);
  const [editFormInitialized, setEditFormInitialized] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [voucherToDelete, setVoucherToDelete] = useState<Voucher | null>(null);

  // Fetch ledger accounts, bank accounts, and suppliers for dropdowns
  const { data: ledgerAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger-accounts"],
  });

  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({
    queryKey: ["/api/bank-accounts"],
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: fixedAssets = [] } = useQuery<FixedAsset[]>({
    queryKey: ["/api/fixed-assets"],
  });

  // State for purchase order data (for Purchase vouchers)
  const [purchaseOrderData, setPurchaseOrderData] = useState<any>(null);

  // Fetch voucher entries when viewing (includes account names and stock items)
  const { data: viewVoucherEntriesRaw, isLoading: viewEntriesLoading } = useQuery<any>({
    queryKey: selectedVoucher ? [`/api/vouchers/${selectedVoucher.id}/view-entries`] : [],
    enabled: !!selectedVoucher && viewDialogOpen,
  });
  
  // Handle the response which can be either array (most types) or object with entries/purchaseOrder (Purchase type)
  const viewVoucherEntries = useMemo(() => {
    if (!viewVoucherEntriesRaw) return [];
    if (Array.isArray(viewVoucherEntriesRaw)) {
      return viewVoucherEntriesRaw;
    }
    if (viewVoucherEntriesRaw.entries) {
      return viewVoucherEntriesRaw.entries;
    }
    return [];
  }, [viewVoucherEntriesRaw]);
  
  // Update purchaseOrderData when response changes (avoid setState in useMemo)
  useEffect(() => {
    if (!viewVoucherEntriesRaw) {
      setPurchaseOrderData(null);
    } else if (!Array.isArray(viewVoucherEntriesRaw) && viewVoucherEntriesRaw.purchaseOrder) {
      setPurchaseOrderData(viewVoucherEntriesRaw.purchaseOrder);
    } else {
      setPurchaseOrderData(null);
    }
  }, [viewVoucherEntriesRaw]);

  // Extract cash account ID for fetching balance
  const cashAccountId = useMemo(() => {
    if (!selectedVoucher || selectedVoucher.voucherType !== "Sales") return null;
    const ledgerEntries = viewVoucherEntries.filter(e => !e.isStockItem && !e.stockItemId);
    const cashEntry = ledgerEntries.find(e => parseFloat(e.debitAmount || "0") > 0);
    return cashEntry?.accountId || null;
  }, [selectedVoucher, viewVoucherEntries]);

  // Fetch cash account transactions for balance calculation
  const { data: cashAccountTransactions = [], refetch: refetchCashAccount } = useQuery<any>({
    queryKey: cashAccountId ? [`/api/accounts/ledger/${cashAccountId}/transactions`] : null,
    queryFn: async ({ queryKey }) => {
      if (!queryKey[0]) return [];
      const res = await fetch(queryKey[0] as string, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!cashAccountId && viewDialogOpen,
    staleTime: 0,
  });

  // Calculate current balance from all transactions
  const cashAccountBalance = useMemo(() => {
    let balance = 0;
    
    // Add debits and subtract credits
    (Array.isArray(cashAccountTransactions) ? cashAccountTransactions : []).forEach((tx: any) => {
      balance += parseFloat(tx.debitAmount || "0");
      balance -= parseFloat(tx.creditAmount || "0");
    });
    
    return balance.toString();
  }, [cashAccountTransactions]);

  // Refetch cash account when vouchers change
  useEffect(() => {
    if (cashAccountId && viewDialogOpen) {
      refetchCashAccount();
    }
  }, [cashAccountId, viewDialogOpen, refetchCashAccount]);

  // Fetch voucher entries when editing
  const { data: voucherEntries = [], isLoading: entriesLoading } = useQuery<VoucherEntry[]>({
    queryKey: voucherToEdit ? [`/api/vouchers/${voucherToEdit.id}/entries`] : [],
    enabled: !!voucherToEdit && editDialogOpen,
  });
  
  // Edit form with react-hook-form and zod
  const editForm = useForm<EditVoucherForm>({
    resolver: zodResolver(createVoucherSchema),
    defaultValues: {
      voucherType: "Journal",
      voucherDate: format(new Date(), "yyyy-MM-dd"),
      description: "",
      optional: false,
      entries: [],
    },
  });

  const { fields: editFields, append: editAppend, remove: editRemove } = useFieldArray({
    control: editForm.control,
    name: "entries",
  });

  // Populate form with entries when they're loaded (only once per voucher)
  useEffect(() => {
    if (voucherToEdit && voucherEntries.length > 0 && !entriesLoading && !editFormInitialized) {
      editForm.reset({
        voucherType: voucherToEdit.voucherType as any,
        voucherDate: voucherToEdit.voucherDate,
        description: voucherToEdit.description || "",
        optional: voucherToEdit.optional,
        entries: voucherEntries.map(entry => ({
          accountType: entry.accountType as "ledger" | "bank" | "supplier" | "employee" | "fixedAsset",
          accountId: entry.accountId,
          accountName: entry.accountName,
          debitAmount: entry.debitAmount || "0",
          creditAmount: entry.creditAmount || "0",
          narration: entry.narration || "",
        })),
      });
      setEditFormInitialized(true);
    }
  }, [voucherToEdit, voucherEntries, entriesLoading, editFormInitialized, editForm]);

  // Fetch all vouchers
  const { data: vouchers = [], isLoading } = useQuery<Voucher[]>({
    queryKey: ["/api/vouchers"],
  });

  // Apply filters
  const filteredVouchers = useMemo(() => {
    return vouchers.filter((voucher) => {
      // Date range filter
      if (filters.startDate && voucher.voucherDate < filters.startDate) {
        return false;
      }
      if (filters.endDate && voucher.voucherDate > filters.endDate) {
        return false;
      }

      // Voucher type filter
      if (filters.voucherType !== "all" && voucher.voucherType !== filters.voucherType) {
        return false;
      }

      // Search query filter
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        return (
          voucher.voucherNumber.toLowerCase().includes(query) ||
          voucher.description?.toLowerCase().includes(query) ||
          voucher.voucherType.toLowerCase().includes(query)
        );
      }

      return true;
    }).sort((a, b) => {
      // Sort by date (newest first), then by voucher number
      const dateCompare = b.voucherDate.localeCompare(a.voucherDate);
      if (dateCompare !== 0) return dateCompare;
      return b.voucherNumber.localeCompare(a.voucherNumber);
    });
  }, [vouchers, filters]);

  // Check if user can edit a voucher based on role and date
  const canEdit = (voucher: Voucher): boolean => {
    if (!user) return false;
    
    // Admin and Owner can edit all transactions
    if (user.role === "Admin" || user.role === "Owner") {
      return true;
    }

    // Manager can edit only today's transactions
    if (user.role === "Manager") {
      return isToday(parseISO(voucher.voucherDate));
    }

    return false;
  };

  // Check if user can delete a voucher (only Admin)
  const canDelete = (): boolean => {
    return user?.role === "Admin";
  };

  // Edit voucher mutation
  const editMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: EditVoucherForm }) => {
      // Transform entries to match API format
      const transformedEntries = updates.entries.map(entry => ({
        ledgerAccountId: entry.accountType === "ledger" ? entry.accountId : null,
        bankAccountId: entry.accountType === "bank" ? entry.accountId : null,
        supplierId: entry.accountType === "supplier" ? entry.accountId : null,
        employeeId: entry.accountType === "employee" ? entry.accountId : null,
        fixedAssetId: entry.accountType === "fixedAsset" ? entry.accountId : null,
        debitAmount: entry.debitAmount,
        creditAmount: entry.creditAmount,
        narration: entry.narration || null,
      }));

      // Update entire voucher with entries
      return await apiRequest("PUT", `/api/vouchers/${id}/with-entries`, {
        voucher: {
          voucherType: updates.voucherType,
          voucherDate: updates.voucherDate,
          description: updates.description,
          optional: updates.optional,
        },
        entries: transformedEntries,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      if (cashAccountId) {
        queryClient.invalidateQueries({ queryKey: [`/api/ledger-accounts/${cashAccountId}`] });
      }
      toast({
        title: "Success",
        description: "Voucher updated successfully",
      });
      setEditDialogOpen(false);
      setVoucherToEdit(null);
      setEditFormInitialized(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update voucher",
        variant: "destructive",
      });
    },
  });

  // Delete voucher mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/vouchers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      if (cashAccountId) {
        queryClient.invalidateQueries({ queryKey: [`/api/ledger-accounts/${cashAccountId}`] });
      }
      toast({
        title: "Success",
        description: "Voucher deleted successfully",
      });
      setDeleteDialogOpen(false);
      setVoucherToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete voucher",
        variant: "destructive",
      });
    },
  });

  // Handler functions
  const handleView = (voucher: Voucher) => {
    setSelectedVoucher(voucher);
    setViewDialogOpen(true);
  };

  const handleEdit = (voucher: Voucher) => {
    // Sales vouchers use the dedicated edit page
    if (voucher.voucherType === "Sales") {
      navigate(`/vouchers/${voucher.id}/edit`);
      return;
    }
    
    // Purchase vouchers should be edited via the Containers page
    if (voucher.voucherType === "Purchase") {
      // Navigate to containers page - the PO can be edited there
      navigate(`/containers`);
      toast({
        title: "Edit Purchase Order",
        description: "Please find and edit the purchase order in the container that this voucher is linked to.",
      });
      return;
    }
    
    // Other voucher types navigate to vouchers page with edit mode
    const voucherTypeMap: Record<string, string> = {
      "Payment": "payment",
      "Receipt": "receipt",
      "Journal": "journal",
      "Consumption": "adjustment",
      "Production": "adjustment",
      "Mixed": "adjustment",
      "StockTransfer": "transfer",
      "Stock Transfer": "transfer",
    };
    
    const tabName = voucherTypeMap[voucher.voucherType];
    if (tabName) {
      navigate(`/vouchers?edit=${voucher.id}&tab=${tabName}`);
    } else {
      // Fallback for unsupported types
      toast({
        title: "Info",
        description: `Editing ${voucher.voucherType} vouchers is not yet supported. Please contact support.`,
        variant: "destructive",
      });
    }
  };

  const handleSaveEdit = (data: EditVoucherForm) => {
    if (!voucherToEdit) return;
    
    editMutation.mutate({
      id: voucherToEdit.id,
      updates: data,
    });
  };

  const handleDelete = (voucher: Voucher) => {
    setVoucherToDelete(voucher);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (voucherToDelete) {
      deleteMutation.mutate(voucherToDelete.id);
    }
  };

  const handleExportToExcel = () => {
    if (filteredVouchers.length === 0) {
      toast({
        title: "No data to export",
        description: "There are no vouchers to export based on current filters.",
        variant: "destructive",
      });
      return;
    }

    const exportData = filteredVouchers.map((voucher) => ({
      "Voucher Number": voucher.voucherNumber,
      "Date": format(parseISO(voucher.voucherDate), "yyyy-MM-dd"),
      "Type": voucher.voucherType,
      "Description": voucher.description || "",
      "Total Amount": formatAmount(voucher.totalAmount),
      "Optional": voucher.optional ? "Yes" : "No",
    }));

    const worksheet = utils.json_to_sheet(exportData);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, "Daybook");

    const fileName = `Daybook_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
    writeFile(workbook, fileName);

    toast({
      title: "Export successful",
      description: `Downloaded ${fileName} with ${filteredVouchers.length} records.`,
    });
  };

  const clearFilters = () => {
    setFilters({
      startDate: "",
      endDate: "",
      voucherType: "all",
      searchQuery: "",
    });
  };

  const hasActiveFilters = filters.startDate || filters.endDate || filters.voucherType !== "all" || filters.searchQuery;

  const getVoucherTypeBadgeVariant = (type: string) => {
    switch (type) {
      case "Sales":
        return "default";
      case "Purchase":
        return "secondary";
      case "Payment":
        return "destructive";
      case "Receipt":
        return "default";
      case "Journal":
        return "outline";
      case "Contra":
        return "secondary";
      default:
        return "outline";
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Book className="w-8 h-8" />
            Daybook
          </h1>
          <p className="text-muted-foreground mt-1">
            View all accounting transactions chronologically
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleExportToExcel}
            disabled={filteredVouchers.length === 0}
            data-testid="button-export-excel"
            className="gap-2"
          >
            <FileDown className="w-4 h-4" />
            Export to Excel
          </Button>
          <Button 
            onClick={() => navigate("/vouchers")}
            data-testid="button-new-voucher" 
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            New Voucher
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5" />
              <CardTitle>Filters</CardTitle>
            </div>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                data-testid="button-clear-filters"
                className="gap-1"
              >
                <X className="w-4 h-4" />
                Clear Filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                data-testid="input-start-date"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-date">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                data-testid="input-end-date"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voucher-type">Voucher Type</Label>
              <Select
                value={filters.voucherType}
                onValueChange={(value) => setFilters({ ...filters, voucherType: value })}
              >
                <SelectTrigger id="voucher-type" data-testid="select-voucher-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="Sales">Sales</SelectItem>
                  <SelectItem value="Purchase">Purchase</SelectItem>
                  <SelectItem value="Payment">Payment</SelectItem>
                  <SelectItem value="Receipt">Receipt</SelectItem>
                  <SelectItem value="Journal">Journal</SelectItem>
                  <SelectItem value="Contra">Contra</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="search">Search</Label>
              <Input
                id="search"
                placeholder="Voucher # or description..."
                value={filters.searchQuery}
                onChange={(e) => setFilters({ ...filters, searchQuery: e.target.value })}
                data-testid="input-search"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vouchers Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Transactions
            {filteredVouchers.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({filteredVouchers.length} {filteredVouchers.length === 1 ? "entry" : "entries"})
              </span>
            )}
          </CardTitle>
          <CardDescription>
            All accounting vouchers and transactions
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredVouchers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {hasActiveFilters ? (
                <div>
                  <p className="mb-2">No transactions found matching your filters.</p>
                  <Button
                    variant="outline"
                    onClick={clearFilters}
                    data-testid="button-clear-filters-empty"
                  >
                    Clear Filters
                  </Button>
                </div>
              ) : (
                <p>No transactions found. Create your first voucher to get started.</p>
              )}
            </div>
          ) : (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredVouchers.map((voucher) => (
                    <TableRow
                      key={voucher.id}
                      data-testid={`row-voucher-${voucher.id}`}
                    >
                      <TableCell className="font-medium">
                        {format(parseISO(voucher.voucherDate), "MMM dd, yyyy")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={getVoucherTypeBadgeVariant(voucher.voucherType)}
                            data-testid={`badge-type-${voucher.id}`}
                          >
                            {voucher.voucherType}
                          </Badge>
                          {voucher.optional && (
                            <Badge
                              variant="outline"
                              data-testid={`badge-optional-${voucher.id}`}
                              className="text-xs"
                            >
                              Optional
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-md truncate">
                        {voucher.description || "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        ${formatAmount(voucher.totalAmount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleView(voucher)}
                            data-testid={`button-view-${voucher.id}`}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {canEdit(voucher) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEdit(voucher)}
                              data-testid={`button-edit-${voucher.id}`}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          )}
                          {canDelete() && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(voucher)}
                              data-testid={`button-delete-${voucher.id}`}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* View Voucher Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Voucher Details</DialogTitle>
            <DialogDescription>
              View voucher information
            </DialogDescription>
          </DialogHeader>
          {selectedVoucher && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Date</p>
                  <p className="font-medium">
                    {format(parseISO(selectedVoucher.voucherDate), "MMM dd, yyyy")}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Type</p>
                  <div className="flex gap-2 items-center">
                    <Badge variant={getVoucherTypeBadgeVariant(selectedVoucher.voucherType)}>
                      {selectedVoucher.voucherType}
                    </Badge>
                    {selectedVoucher.optional && (
                      <Badge variant="outline" className="text-xs">
                        Optional
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              {selectedVoucher.description && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Description</p>
                  <p className="text-sm">{selectedVoucher.description}</p>
                </div>
              )}
              {selectedVoucher.locationName && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Location</p>
                  <p className="text-sm">{selectedVoucher.locationName}</p>
                </div>
              )}
              
              {/* Payment/Receipt Source Account Summary */}
              {(selectedVoucher.voucherType === "Payment" || selectedVoucher.voucherType === "Receipt") && !viewEntriesLoading && viewVoucherEntries.length > 0 && (() => {
                // For Payment: credit entry is the source (cash/bank account where money comes FROM)
                // For Receipt: debit entry is the source (cash/bank account where money goes INTO)
                const sourceEntry = selectedVoucher.voucherType === "Payment"
                  ? viewVoucherEntries.find((e: any) => parseFloat(e.creditAmount || "0") > 0)
                  : viewVoucherEntries.find((e: any) => parseFloat(e.debitAmount || "0") > 0);
                
                // Total = sum of the opposite side entries
                const totalAmount = selectedVoucher.voucherType === "Payment"
                  ? viewVoucherEntries.reduce((sum: number, e: any) => sum + parseFloat(e.debitAmount || "0"), 0)
                  : viewVoucherEntries.reduce((sum: number, e: any) => sum + parseFloat(e.creditAmount || "0"), 0);
                
                if (!sourceEntry) return null;
                
                return (
                  <div className="p-4 bg-muted/50 rounded-md mb-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">
                          {selectedVoucher.voucherType === "Payment" ? "Paid From" : "Received In"}
                        </p>
                        <div className="font-medium text-lg">{sourceEntry.accountName}</div>
                        <div className="text-xs text-muted-foreground font-mono">{sourceEntry.accountCode}</div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground mb-1">Total Amount</p>
                        <div className="text-2xl font-bold font-mono">
                          ${formatAmount(totalAmount)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Voucher Entries Table */}
              <div>
                <h3 className="font-semibold mb-3">Entries</h3>
                {viewEntriesLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : viewVoucherEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No entries found
                  </p>
                ) : selectedVoucher.voucherType === "Sales" ? (
                  // Special rendering for Sales vouchers
                  (() => {
                    // Separate ledger entries (cash/revenue) from sales items
                    const ledgerEntries = viewVoucherEntries.filter(e => !e.isStockItem && !e.stockItemId);
                    const salesItems = viewVoucherEntries.filter(e => e.isStockItem || e.stockItemId);
                    
                    // Find cash entry (debit) and revenue entry (credit)
                    const cashEntry = ledgerEntries.find(e => parseFloat(e.debitAmount || "0") > 0);
                    const revenueEntry = ledgerEntries.find(e => parseFloat(e.creditAmount || "0") > 0);
                    
                    return (
                      <div className="space-y-4">
                        {/* Cash Account Summary */}
                        {cashEntry && (
                          <div className="p-3 bg-muted/50 rounded-md">
                            <div className="flex justify-between items-center">
                              <div>
                                <div className="font-medium">{cashEntry.accountName}</div>
                              </div>
                              <div className="text-right font-mono font-bold">
                                ${formatAmount(cashAccountBalance)}
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Sales Items Table */}
                        {salesItems.length > 0 && (
                          <div className="border rounded-md">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Item Name</TableHead>
                                  <TableHead className="text-right">Qty</TableHead>
                                  <TableHead className="text-right">Rate</TableHead>
                                  <TableHead className="text-right">Total Amount</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {salesItems.map((item) => {
                                  const qty = parseFloat(item.quantity || "0");
                                  const rate = parseFloat(item.rate || item.sellingPrice || "0");
                                  const totalAmount = parseFloat(item.totalSales || item.creditAmount || "0");
                                  return (
                                    <TableRow key={item.id}>
                                      <TableCell>
                                        <div className="font-medium">{item.stockItemName || item.accountName}</div>
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        {formatAmount(qty)}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        ${formatAmount(rate)}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        ${formatAmount(totalAmount)}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                                {/* Totals Row */}
                                <TableRow className="font-bold bg-muted/50">
                                  <TableCell>Total</TableCell>
                                  <TableCell className="text-right font-mono">
                                    {formatAmount(salesItems.reduce((sum, item) => sum + parseFloat(item.quantity || "0"), 0))}
                                  </TableCell>
                                  <TableCell></TableCell>
                                  <TableCell className="text-right font-mono">
                                    ${formatAmount(salesItems.reduce((sum, item) => sum + parseFloat(item.totalSales || item.creditAmount || "0"), 0))}
                                  </TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : selectedVoucher.voucherType === "Purchase" ? (
                  // Special rendering for Purchase vouchers - show items with supplier info
                  (() => {
                    // SECURITY: Hide cost prices for POS users (default to hiding if user is undefined during load)
                    const isPOSUser = !user || user?.role?.startsWith("POS");
                    
                    // Separate ledger entries from purchase items
                    const ledgerEntries = viewVoucherEntries.filter(e => !e.isPurchaseItem && !e.isStockItem);
                    const purchaseItems = viewVoucherEntries.filter(e => e.isPurchaseItem || e.isStockItem);
                    
                    return (
                      <div className="space-y-4">
                        {/* Purchase Order Info */}
                        {purchaseOrderData && (
                          <div className="p-3 bg-muted/50 rounded-md space-y-2">
                            <div className="flex justify-between items-center">
                              <div>
                                <div className="font-medium">{purchaseOrderData.supplierName}</div>
                                <div className="text-xs text-muted-foreground">
                                  {purchaseOrderData.supplierCode && <span>{purchaseOrderData.supplierCode} | </span>}
                                  PO: {purchaseOrderData.poNumber} | Container: {purchaseOrderData.containerNumber}
                                </div>
                              </div>
                              <div className="text-right">
                                {!isPOSUser && purchaseOrderData.itemsTotal && (
                                  <div className="font-mono font-bold">
                                    ${parseFloat(purchaseOrderData.itemsTotal || "0").toFixed(2)}
                                  </div>
                                )}
                                <Badge variant={purchaseOrderData.status === "Closed" ? "secondary" : "default"}>
                                  {purchaseOrderData.status}
                                </Badge>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setViewDialogOpen(false);
                                    navigate(`/purchase-orders/${purchaseOrderData.id}/edit`);
                                  }}
                                  data-testid="button-edit-po"
                                >
                                  Edit PO
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Purchase Items Table */}
                        {purchaseItems.length > 0 ? (
                          <div className="border rounded-md">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Item Name</TableHead>
                                  <TableHead className="text-right">Qty</TableHead>
                                  {!isPOSUser && (
                                    <>
                                      <TableHead className="text-right">Rate</TableHead>
                                      <TableHead className="text-right">Total</TableHead>
                                    </>
                                  )}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {purchaseItems.map((item) => {
                                  const qty = parseFloat(item.quantity || "0");
                                  const rate = item.rate != null ? parseFloat(item.rate) : 0;
                                  const totalAmount = item.totalAmount != null ? parseFloat(item.totalAmount) : 0;
                                  return (
                                    <TableRow key={item.id}>
                                      <TableCell>
                                        <div className="font-medium">{item.stockItemName || item.accountName}</div>
                                        {item.stockItemCode && (
                                          <div className="text-xs text-muted-foreground font-mono">{item.stockItemCode}</div>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        {qty.toFixed(3)}
                                      </TableCell>
                                      {!isPOSUser && (
                                        <>
                                          <TableCell className="text-right font-mono">
                                            ${rate.toFixed(2)}
                                          </TableCell>
                                          <TableCell className="text-right font-mono">
                                            ${totalAmount.toFixed(2)}
                                          </TableCell>
                                        </>
                                      )}
                                    </TableRow>
                                  );
                                })}
                                {/* Totals Row */}
                                <TableRow className="font-bold bg-muted/50">
                                  <TableCell>Total</TableCell>
                                  <TableCell className="text-right font-mono">
                                    {purchaseItems.reduce((sum, item) => sum + parseFloat(item.quantity || "0"), 0).toFixed(3)}
                                  </TableCell>
                                  {!isPOSUser && (
                                    <>
                                      <TableCell></TableCell>
                                      <TableCell className="text-right font-mono">
                                        ${purchaseItems.reduce((sum, item) => sum + (item.totalAmount != null ? parseFloat(item.totalAmount) : 0), 0).toFixed(2)}
                                      </TableCell>
                                    </>
                                  )}
                                </TableRow>
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          // Fallback to ledger entries if no purchase items found
                          <div className="border rounded-md">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Account</TableHead>
                                  {!isPOSUser && (
                                    <>
                                      <TableHead className="text-right">Debit</TableHead>
                                      <TableHead className="text-right">Credit</TableHead>
                                    </>
                                  )}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {ledgerEntries.map((entry) => (
                                  <TableRow key={entry.id}>
                                    <TableCell>
                                      <div className="font-medium">{entry.accountName}</div>
                                      <div className="text-xs text-muted-foreground font-mono">{entry.accountCode}</div>
                                    </TableCell>
                                    {!isPOSUser && (
                                      <>
                                        <TableCell className="text-right font-mono">
                                          {parseFloat(entry.debitAmount) > 0 ? `$${formatAmount(entry.debitAmount)}` : "-"}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                          {parseFloat(entry.creditAmount) > 0 ? `$${formatAmount(entry.creditAmount)}` : "-"}
                                        </TableCell>
                                      </>
                                    )}
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div className="border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {(selectedVoucher.voucherType === "Consumption" || 
                            selectedVoucher.voucherType === "Production" || 
                            selectedVoucher.voucherType === "Mixed" ||
                            selectedVoucher.voucherType === "Stock Transfer" ||
                            selectedVoucher.voucherType === "StockTransfer") ? (
                            <>
                              <TableHead>Item Name</TableHead>
                              {selectedVoucher.voucherType === "Mixed" && (
                                <TableHead>Type</TableHead>
                              )}
                              <TableHead className="text-right">Qty</TableHead>
                              {user && !user?.role?.startsWith("POS") && (
                                <>
                                  <TableHead className="text-right">Amount</TableHead>
                                  <TableHead className="text-right">Total Amount</TableHead>
                                </>
                              )}
                            </>
                          ) : (selectedVoucher.voucherType === "Payment" || selectedVoucher.voucherType === "Receipt") ? (
                            <>
                              <TableHead>Account</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                            </>
                          ) : (
                            <>
                              <TableHead>Account</TableHead>
                              <TableHead className="text-right">Debit</TableHead>
                              <TableHead className="text-right">Credit</TableHead>
                              <TableHead>Narration</TableHead>
                            </>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(() => {
                          const isPOSUser = !user || user?.role?.startsWith("POS");
                          
                          // For Consumption/Production/Mixed/Stock Transfer, show stock items
                          if (selectedVoucher.voucherType === "Consumption" || 
                              selectedVoucher.voucherType === "Production" || 
                              selectedVoucher.voucherType === "Mixed" ||
                              selectedVoucher.voucherType === "Stock Transfer" ||
                              selectedVoucher.voucherType === "StockTransfer") {
                            return viewVoucherEntries.map((entry) => {
                              const qty = parseFloat(entry.quantity || "0");
                              const rate = entry.rate != null ? parseFloat(entry.rate) : 0;
                              const totalAmount = entry.totalAmount != null ? parseFloat(entry.totalAmount) : (qty * rate);
                              return (
                                <TableRow key={entry.id}>
                                  <TableCell>
                                    <div className="font-medium">{entry.stockItemName || entry.accountName}</div>
                                  </TableCell>
                                  {selectedVoucher.voucherType === "Mixed" && (
                                    <TableCell>
                                      <Badge variant={entry.adjustmentType === "Production" ? "default" : "secondary"}>
                                        {entry.adjustmentType || (qty > 0 ? "Production" : "Consumption")}
                                      </Badge>
                                    </TableCell>
                                  )}
                                  <TableCell className="text-right font-mono">
                                    {Math.abs(qty).toFixed(3)}
                                  </TableCell>
                                  {!isPOSUser && (
                                    <>
                                      <TableCell className="text-right font-mono">
                                        ${rate.toFixed(2)}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        ${totalAmount.toFixed(2)}
                                      </TableCell>
                                    </>
                                  )}
                                </TableRow>
                              );
                            });
                          }
                          
                          // For Payment/Receipt, filter out the cash source entries
                          const displayEntries = (selectedVoucher.voucherType === "Payment" || selectedVoucher.voucherType === "Receipt")
                            ? viewVoucherEntries.filter(entry => {
                                // Payment: show only debit entries (accounts being paid)
                                // Receipt: show only credit entries (accounts receiving)
                                if (selectedVoucher.voucherType === "Payment") {
                                  return parseFloat(entry.debitAmount || "0") > 0;
                                } else {
                                  return parseFloat(entry.creditAmount || "0") > 0;
                                }
                              })
                            : viewVoucherEntries;
                          
                          return displayEntries.map((entry) => (
                            <TableRow key={entry.id}>
                              <TableCell>
                                <div className="font-medium">{entry.accountName}</div>
                                <div className="text-xs text-muted-foreground font-mono">
                                  {entry.accountCode}
                                </div>
                              </TableCell>
                              {(selectedVoucher.voucherType === "Payment" || selectedVoucher.voucherType === "Receipt") ? (
                                <TableCell className="text-right font-mono">
                                  ${formatAmount(Math.max(parseFloat(entry.debitAmount || "0"), parseFloat(entry.creditAmount || "0")))}
                                </TableCell>
                              ) : (
                                <>
                                  <TableCell className="text-right font-mono">
                                    {parseFloat(entry.debitAmount) > 0
                                      ? `$${formatAmount(entry.debitAmount)}`
                                      : "-"}
                                  </TableCell>
                                  <TableCell className="text-right font-mono">
                                    {parseFloat(entry.creditAmount) > 0
                                      ? `$${formatAmount(entry.creditAmount)}`
                                      : "-"}
                                  </TableCell>
                                  <TableCell className="text-sm text-muted-foreground">
                                    {entry.narration || "-"}
                                  </TableCell>
                                </>
                              )}
                            </TableRow>
                          ));
                        })()}
                        {/* Totals Row */}
                        <TableRow className="font-bold bg-muted/50">
                          {(selectedVoucher.voucherType === "Consumption" || 
                            selectedVoucher.voucherType === "Production" || 
                            selectedVoucher.voucherType === "Stock Transfer" ||
                            selectedVoucher.voucherType === "StockTransfer") ? (
                            <>
                              <TableCell>Total</TableCell>
                              <TableCell className="text-right font-mono">
                                {viewVoucherEntries
                                  .reduce((sum, e) => sum + Math.abs(parseFloat(e.quantity || "0")), 0)
                                  .toFixed(3)}
                              </TableCell>
                              {user && !user?.role?.startsWith("POS") && (
                                <>
                                  <TableCell></TableCell>
                                  <TableCell className="text-right font-mono">
                                    ${viewVoucherEntries
                                      .reduce((sum, e) => {
                                        if (e.totalAmount != null) {
                                          return sum + Math.abs(parseFloat(e.totalAmount));
                                        }
                                        const qty = Math.abs(parseFloat(e.quantity || "0"));
                                        const rate = e.rate != null ? parseFloat(e.rate) : 0;
                                        return sum + (qty * rate);
                                      }, 0)
                                      .toFixed(2)}
                                  </TableCell>
                                </>
                              )}
                            </>
                          ) : (selectedVoucher.voucherType === "Payment" || selectedVoucher.voucherType === "Receipt") ? (
                            <>
                              <TableCell>Total</TableCell>
                              <TableCell className="text-right font-mono">
                                ${formatAmount(Math.max(
                                  viewVoucherEntries.reduce((sum, e) => sum + parseFloat(e.debitAmount || "0"), 0),
                                  viewVoucherEntries.reduce((sum, e) => sum + parseFloat(e.creditAmount || "0"), 0)
                                ))}
                              </TableCell>
                            </>
                          ) : (
                            <>
                              <TableCell>Total</TableCell>
                              <TableCell className="text-right font-mono">
                                ${formatAmount(viewVoucherEntries
                                  .reduce((sum, e) => sum + parseFloat(e.debitAmount || "0"), 0))}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                ${formatAmount(viewVoucherEntries
                                  .reduce((sum, e) => sum + parseFloat(e.creditAmount || "0"), 0))}
                              </TableCell>
                              <TableCell></TableCell>
                            </>
                          )}
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Voucher Dialog */}
      <Dialog 
        open={editDialogOpen} 
        onOpenChange={(open) => {
          setEditDialogOpen(open);
          if (!open) {
            setEditFormInitialized(false);
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Voucher</DialogTitle>
            <DialogDescription>
              Edit all voucher details. Debits must equal credits.
            </DialogDescription>
          </DialogHeader>
          {voucherToEdit && !entriesLoading && (
            <Form {...editForm}>
              <form onSubmit={editForm.handleSubmit(handleSaveEdit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Voucher Number</p>
                    <p className="font-mono font-medium">{voucherToEdit.voucherNumber}</p>
                  </div>
                  
                  <FormField
                    control={editForm.control}
                    name="voucherDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            {...field}
                            data-testid="input-edit-voucher-date"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={editForm.control}
                    name="voucherType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-edit-voucher-type">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Journal">Journal</SelectItem>
                            <SelectItem value="Payment">Payment</SelectItem>
                            <SelectItem value="Receipt">Receipt</SelectItem>
                            <SelectItem value="Stock Transfer">Stock Transfer</SelectItem>
                            <SelectItem value="Sales">Sales</SelectItem>
                            <SelectItem value="Purchase">Purchase</SelectItem>
                            <SelectItem value="Contra">Contra</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={editForm.control}
                    name="optional"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-md border p-3 space-y-0">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm">Optional</FormLabel>
                          <div className="text-xs text-muted-foreground">
                            Does not affect books
                          </div>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-edit-optional"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={editForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Enter voucher description (optional)"
                          rows={2}
                          data-testid="textarea-edit-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Entry Rows */}
                <div className="border rounded-md p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Voucher Entries</h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => editAppend({ 
                        accountType: "ledger", 
                        accountId: 0, 
                        accountName: "", 
                        debitAmount: "0", 
                        creditAmount: "0", 
                        narration: "" 
                      })}
                      data-testid="button-edit-add-entry"
                      className="gap-1"
                    >
                      <Plus className="w-4 h-4" />
                      Add Entry
                    </Button>
                  </div>

                  {editFields.map((field, index) => (
                    <div key={field.id} className="border rounded-md p-4 space-y-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-muted-foreground">
                          Entry {index + 1}
                        </span>
                        {editFields.length > 2 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => editRemove(index)}
                            data-testid={`button-edit-remove-entry-${index}`}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>

                      <FormField
                        control={editForm.control}
                        name={`entries.${index}.accountType`}
                        render={({ field: typeField }) => (
                          <FormItem>
                            <FormLabel>Account</FormLabel>
                            <FormControl>
                              <AccountCombobox
                                value={
                                  editForm.watch(`entries.${index}.accountId`)
                                    ? {
                                        type: typeField.value,
                                        id: editForm.watch(`entries.${index}.accountId`),
                                        name: editForm.watch(`entries.${index}.accountName`),
                                      }
                                    : null
                                }
                                onChange={(type, id, name) => {
                                  editForm.setValue(`entries.${index}.accountType`, type);
                                  editForm.setValue(`entries.${index}.accountId`, id);
                                  editForm.setValue(`entries.${index}.accountName`, name);
                                }}
                                ledgerAccounts={ledgerAccounts}
                                bankAccounts={bankAccounts}
                                suppliers={suppliers}
                                employees={employees}
                                fixedAssets={fixedAssets}
                                rowIndex={index}
                                testIdPrefix="button-edit-account"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {(editForm.watch("voucherType") === "Payment" || editForm.watch("voucherType") === "Receipt") ? (
                        <FormItem>
                          <FormLabel>Amount</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              className="font-mono"
                              data-testid={`input-edit-amount-${index}`}
                              value={
                                parseFloat(editForm.watch(`entries.${index}.debitAmount`) || "0") > 0
                                  ? editForm.watch(`entries.${index}.debitAmount`)
                                  : editForm.watch(`entries.${index}.creditAmount`) || ""
                              }
                              onChange={(e) => {
                                const voucherType = editForm.watch("voucherType");
                                if (voucherType === "Payment") {
                                  editForm.setValue(`entries.${index}.debitAmount`, e.target.value);
                                  editForm.setValue(`entries.${index}.creditAmount`, "0");
                                } else {
                                  editForm.setValue(`entries.${index}.creditAmount`, e.target.value);
                                  editForm.setValue(`entries.${index}.debitAmount`, "0");
                                }
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      ) : (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <FormField
                              control={editForm.control}
                              name={`entries.${index}.debitAmount`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Debit Amount</FormLabel>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      className="font-mono"
                                      data-testid={`input-edit-debit-${index}`}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={editForm.control}
                              name={`entries.${index}.creditAmount`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Credit Amount</FormLabel>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      className="font-mono"
                                      data-testid={`input-edit-credit-${index}`}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>

                          <FormField
                            control={editForm.control}
                            name={`entries.${index}.narration`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Narration (Optional)</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="Enter narration"
                                    data-testid={`input-edit-narration-${index}`}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </>
                      )}
                    </div>
                  ))}

                  {/* Totals Display */}
                  {editForm.watch("entries") && editForm.watch("entries").length > 0 && (
                    <div className="mt-4 pt-4 border-t">
                      {(editForm.watch("voucherType") === "Payment" || editForm.watch("voucherType") === "Receipt") ? (
                        <div className="text-right text-sm font-mono">
                          <span className="text-muted-foreground mr-2">Total:</span>
                          <span className="font-bold">
                            ${formatAmount(Math.max(
                              editForm.watch("entries").reduce((sum, e) => sum + parseFloat(e?.debitAmount || "0"), 0),
                              editForm.watch("entries").reduce((sum, e) => sum + parseFloat(e?.creditAmount || "0"), 0)
                            ))}
                          </span>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-4 text-sm font-mono">
                          <div className="text-right">
                            <span className="text-muted-foreground mr-2">Total Debits:</span>
                            <span className="font-bold">
                              ${formatAmount(editForm.watch("entries").reduce((sum, e) => sum + parseFloat(e?.debitAmount || "0"), 0))}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-muted-foreground mr-2">Total Credits:</span>
                            <span className="font-bold">
                              ${formatAmount(editForm.watch("entries").reduce((sum, e) => sum + parseFloat(e?.creditAmount || "0"), 0))}
                            </span>
                          </div>
                        </div>
                      )}
                      {editForm.formState.errors.entries && (
                        <p className="text-sm text-destructive mt-2 text-center">
                          {editForm.formState.errors.entries.message}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditDialogOpen(false)}
                    data-testid="button-cancel-edit"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={editMutation.isPending}
                    data-testid="button-save-edit"
                  >
                    {editMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </form>
            </Form>
          )}
          {entriesLoading && (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete voucher{" "}
              <span className="font-mono font-semibold">{voucherToDelete?.voucherNumber}</span>.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
