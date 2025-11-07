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

// Zod schema for new entry rows
const newEntryRowSchema = z.object({
  accountType: z.enum(["ledger", "bank", "supplier"]),
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
  rowIndex,
  testIdPrefix = "button-account",
}: {
  value: { type: string; id: number; name: string } | null;
  onChange: (type: "ledger" | "bank" | "supplier", id: number, name: string) => void;
  ledgerAccounts: LedgerAccount[];
  bankAccounts: BankAccount[];
  suppliers: Supplier[];
  rowIndex: number;
  testIdPrefix?: string;
}) {
  const [open, setOpen] = useState(false);

  const allAccounts = [
    ...ledgerAccounts.map((a) => ({
      type: "ledger" as const,
      id: a.id,
      name: `${a.code} - ${a.name}`,
    })),
    ...bankAccounts.map((a) => ({
      type: "bank" as const,
      id: a.id,
      name: `${a.code} - ${a.name}`,
    })),
    ...suppliers.map((s) => ({
      type: "supplier" as const,
      id: s.id,
      name: `${s.code} - ${s.legalName}`,
    })),
  ];

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
  const [filters, setFilters] = useState({
    startDate: format(new Date(), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    voucherType: "all",
    searchQuery: "",
  });
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState<Voucher | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createFormInitialized, setCreateFormInitialized] = useState(false);
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

  // Fetch voucher entries when viewing (includes account names and stock items)
  const { data: viewVoucherEntries = [], isLoading: viewEntriesLoading } = useQuery<any[]>({
    queryKey: selectedVoucher ? [`/api/vouchers/${selectedVoucher.id}/view-entries`] : [],
    enabled: !!selectedVoucher && viewDialogOpen,
  });

  // Fetch voucher entries when editing
  const { data: voucherEntries = [], isLoading: entriesLoading } = useQuery<VoucherEntry[]>({
    queryKey: voucherToEdit ? [`/api/vouchers/${voucherToEdit.id}/entries`] : [],
    enabled: !!voucherToEdit && editDialogOpen,
  });
  
  // Create form with react-hook-form and zod
  const createForm = useForm<CreateVoucherForm>({
    resolver: zodResolver(createVoucherSchema),
    defaultValues: {
      voucherType: "Journal",
      voucherDate: format(new Date(), "yyyy-MM-dd"),
      description: "",
      optional: false,
      entries: [
        { accountType: "ledger", accountId: 0, accountName: "", debitAmount: "0", creditAmount: "0", narration: "" },
        { accountType: "ledger", accountId: 0, accountName: "", debitAmount: "0", creditAmount: "0", narration: "" },
      ],
    },
  });

  const { fields: createFields, append: createAppend, remove: createRemove } = useFieldArray({
    control: createForm.control,
    name: "entries",
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
          accountType: entry.accountType as "ledger" | "bank" | "supplier",
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

  // Create voucher mutation
  const createMutation = useMutation({
    mutationFn: async (data: CreateVoucherForm) => {
      if (!selectedCompany) {
        throw new Error("No company selected");
      }

      const voucherNumber = `${data.voucherType.toUpperCase().replace(/\s+/g, '')}-${Date.now()}`;
      const totalAmount = data.entries.reduce((sum, entry) => 
        sum + Math.max(parseFloat(entry.debitAmount || "0"), parseFloat(entry.creditAmount || "0")), 0
      );

      const voucher = {
        companyId: selectedCompany,
        voucherNumber,
        voucherType: data.voucherType,
        voucherDate: data.voucherDate,
        description: data.description,
        optional: data.optional,
        totalAmount: totalAmount.toString(),
      };

      const entries = data.entries.map(entry => ({
        ledgerAccountId: entry.accountType === "ledger" ? entry.accountId : null,
        bankAccountId: entry.accountType === "bank" ? entry.accountId : null,
        supplierId: entry.accountType === "supplier" ? entry.accountId : null,
        debitAmount: entry.debitAmount,
        creditAmount: entry.creditAmount,
        narration: entry.narration || null,
      }));

      return await apiRequest("POST", "/api/vouchers/with-entries", { voucher, entries });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      toast({
        title: "Success",
        description: "Voucher created successfully",
      });
      setCreateDialogOpen(false);
      createForm.reset({
        voucherType: "Journal",
        voucherDate: format(new Date(), "yyyy-MM-dd"),
        description: "",
        optional: false,
        entries: [
          { accountType: "ledger", accountId: 0, accountName: "", debitAmount: "0", creditAmount: "0", narration: "" },
          { accountType: "ledger", accountId: 0, accountName: "", debitAmount: "0", creditAmount: "0", narration: "" },
        ],
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create voucher",
        variant: "destructive",
      });
    },
  });

  // Edit voucher mutation
  const editMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: EditVoucherForm }) => {
      // Transform entries to match API format
      const transformedEntries = updates.entries.map(entry => ({
        ledgerAccountId: entry.accountType === "ledger" ? entry.accountId : null,
        bankAccountId: entry.accountType === "bank" ? entry.accountId : null,
        supplierId: entry.accountType === "supplier" ? entry.accountId : null,
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

  const handleNewEntry = (voucherType: string) => {
    createForm.setValue("voucherType", voucherType as any);
    setCreateDialogOpen(true);
  };

  const handleSaveCreate = (data: CreateVoucherForm) => {
    createMutation.mutate(data);
  };

  const [_location, setLocation] = useLocation();

  const handleEdit = (voucher: Voucher) => {
    // Navigate to appropriate editing interface based on voucher type
    const editableTypes = ["Payment", "Receipt", "Journal", "Sales", "Purchase", "Consumption", "Production", "Mixed", "Stock Transfer"];
    if (editableTypes.includes(voucher.voucherType)) {
      setLocation(`/vouchers/${voucher.id}/edit`);
    } else {
      // For other types, show the generic dialog (temporary fallback)
      setVoucherToEdit(voucher);
      setEditDialogOpen(true);
      toast({
        title: "Info",
        description: `Editing ${voucher.voucherType} vouchers is not fully supported yet.`,
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
      "Total Amount": parseFloat(voucher.totalAmount).toFixed(2),
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button data-testid="button-new-entry" className="gap-2">
                <Plus className="w-4 h-4" />
                New Entry
                <ChevronDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => handleNewEntry("Journal")}
                data-testid="menu-item-journal"
              >
                Journal
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleNewEntry("Payment")}
                data-testid="menu-item-payment"
              >
                Payment
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleNewEntry("Receipt")}
                data-testid="menu-item-receipt"
              >
                Receipt
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleNewEntry("Stock Transfer")}
                data-testid="menu-item-stock-transfer"
              >
                Stock Transfer
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleNewEntry("Sales")}
                data-testid="menu-item-sales"
              >
                Sales
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleNewEntry("Purchase")}
                data-testid="menu-item-purchase"
              >
                Purchase
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleNewEntry("Contra")}
                data-testid="menu-item-contra"
              >
                Contra
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
                        ${parseFloat(voucher.totalAmount).toFixed(2)}
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

      {/* Create Voucher Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Voucher</DialogTitle>
            <DialogDescription>
              Create a new accounting voucher with multiple entries. Debits must equal credits.
            </DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(handleSaveCreate)} className="space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={createForm.control}
                  name="voucherType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Voucher Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-create-voucher-type">
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
                  control={createForm.control}
                  name="voucherDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          {...field}
                          data-testid="input-create-voucher-date"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={createForm.control}
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
                          data-testid="switch-create-optional"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={createForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Enter voucher description (optional)"
                        rows={2}
                        data-testid="textarea-create-description"
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
                    onClick={() => createAppend({ 
                      accountType: "ledger", 
                      accountId: 0, 
                      accountName: "", 
                      debitAmount: "0", 
                      creditAmount: "0", 
                      narration: "" 
                    })}
                    data-testid="button-add-entry"
                    className="gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Add Entry
                  </Button>
                </div>

                {createFields.map((field, index) => (
                  <div key={field.id} className="border rounded-md p-4 space-y-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-muted-foreground">
                        Entry {index + 1}
                      </span>
                      {createFields.length > 2 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => createRemove(index)}
                          data-testid={`button-remove-entry-${index}`}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>

                    <FormField
                      control={createForm.control}
                      name={`entries.${index}.accountType`}
                      render={({ field: typeField }) => (
                        <FormItem>
                          <FormLabel>Account</FormLabel>
                          <FormControl>
                            <AccountCombobox
                              value={
                                createForm.watch(`entries.${index}.accountId`)
                                  ? {
                                      type: typeField.value,
                                      id: createForm.watch(`entries.${index}.accountId`),
                                      name: createForm.watch(`entries.${index}.accountName`),
                                    }
                                  : null
                              }
                              onChange={(type, id, name) => {
                                createForm.setValue(`entries.${index}.accountType`, type);
                                createForm.setValue(`entries.${index}.accountId`, id);
                                createForm.setValue(`entries.${index}.accountName`, name);
                              }}
                              ledgerAccounts={ledgerAccounts}
                              bankAccounts={bankAccounts}
                              suppliers={suppliers}
                              rowIndex={index}
                              testIdPrefix="button-create-account"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={createForm.control}
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
                                data-testid={`input-create-debit-${index}`}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={createForm.control}
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
                                data-testid={`input-create-credit-${index}`}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={createForm.control}
                      name={`entries.${index}.narration`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Narration (Optional)</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="Enter narration"
                              data-testid={`input-create-narration-${index}`}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                ))}

                {/* Totals Display */}
                {createForm.watch("entries") && createForm.watch("entries").length > 0 && (
                  <div className="mt-4 pt-4 border-t">
                    <div className="grid grid-cols-2 gap-4 text-sm font-mono">
                      <div className="text-right">
                        <span className="text-muted-foreground mr-2">Total Debits:</span>
                        <span className="font-bold">
                          ${createForm.watch("entries").reduce((sum, e) => sum + parseFloat(e?.debitAmount || "0"), 0).toFixed(2)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-muted-foreground mr-2">Total Credits:</span>
                        <span className="font-bold">
                          ${createForm.watch("entries").reduce((sum, e) => sum + parseFloat(e?.creditAmount || "0"), 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                    {createForm.formState.errors.entries && (
                      <p className="text-sm text-destructive mt-2 text-center">
                        {createForm.formState.errors.entries.message}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateDialogOpen(false)}
                  data-testid="button-cancel-create"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  data-testid="button-save-create"
                >
                  {createMutation.isPending ? "Creating..." : "Create Voucher"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

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
                ) : (
                  <div className="border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Account</TableHead>
                          <TableHead className="text-right">Debit</TableHead>
                          <TableHead className="text-right">Credit</TableHead>
                          <TableHead>Narration</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {viewVoucherEntries.map((entry) => (
                          <TableRow key={entry.id}>
                            <TableCell>
                              <div className="font-medium">{entry.accountName}</div>
                              <div className="text-xs text-muted-foreground font-mono">
                                {entry.accountCode}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {parseFloat(entry.debitAmount) > 0
                                ? `$${parseFloat(entry.debitAmount).toFixed(2)}`
                                : "-"}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {parseFloat(entry.creditAmount) > 0
                                ? `$${parseFloat(entry.creditAmount).toFixed(2)}`
                                : "-"}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {entry.narration || "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totals Row */}
                        <TableRow className="font-bold bg-muted/50">
                          <TableCell>Total</TableCell>
                          <TableCell className="text-right font-mono">
                            ${viewVoucherEntries
                              .reduce((sum, e) => sum + parseFloat(e.debitAmount || "0"), 0)
                              .toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            ${viewVoucherEntries
                              .reduce((sum, e) => sum + parseFloat(e.creditAmount || "0"), 0)
                              .toFixed(2)}
                          </TableCell>
                          <TableCell></TableCell>
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
                                rowIndex={index}
                                testIdPrefix="button-edit-account"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

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
                    </div>
                  ))}

                  {/* Totals Display */}
                  {editForm.watch("entries") && editForm.watch("entries").length > 0 && (
                    <div className="mt-4 pt-4 border-t">
                      <div className="grid grid-cols-2 gap-4 text-sm font-mono">
                        <div className="text-right">
                          <span className="text-muted-foreground mr-2">Total Debits:</span>
                          <span className="font-bold">
                            ${editForm.watch("entries").reduce((sum, e) => sum + parseFloat(e?.debitAmount || "0"), 0).toFixed(2)}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-muted-foreground mr-2">Total Credits:</span>
                          <span className="font-bold">
                            ${editForm.watch("entries").reduce((sum, e) => sum + parseFloat(e?.creditAmount || "0"), 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
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
