import { useState, useRef, useEffect, useMemo } from "react";
import { resolveWhatsAppPrompt } from "@/lib/whatsapp-prompt";
import type { WhatsAppPromptState } from "@/lib/whatsapp-prompt";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { ExchangeRateInput } from "@/components/ExchangeRateInput";
import { formatNumber } from "@/lib/formatNumber";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { CreateAccountModal } from "@/components/vouchers/CreateAccountModal";
import { DraftRestorePrompt } from "@/components/DraftRestorePrompt";
import { parseDateLocal } from "@/components/vouchers/PrintTemplate";
import type { CombinedAccount } from "@/components/AccountAutocomplete";
import { Card, CardContent } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient, keyStartsWith } from "@/lib/queryClient";
import { useAppMode, useModePrefix } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { useFormDraft } from "@/hooks/useFormDraft";
import { Plus, X, Search, ChevronDown, FileDown, Loader2, CheckCircle, AlertTriangle } from "lucide-react";
import { utils, writeFile } from "@/lib/excelHelper";
import { cn } from "@/lib/utils";

interface BankAccount {
  id: number;
  accountNumber: string;
  bankName: string;
  accountName: string;
  balance: string;
}
interface LedgerAccount {
  id: number;
  code: string;
  name: string;
  accountType: string;
}
interface Supplier {
  id: number;
  code: string;
  legalName: string;
}
interface Customer {
  id: number;
  code: string;
  legalName: string;
  openingBalance?: string;
}
interface Employee {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  openingBalance?: string;
}
interface FixedAsset {
  id: number;
  code: string;
  name: string;
  openingBalance?: string;
}
interface FactorySupplierBasic {
  id: number;
  name: string;
  parentId: number | null;
}
interface Account {
  id: number;
  name: string;
  type: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset" | "customer" | "factorySupplier";
  code?: string;
  balance?: number;
}

const journalEntrySchema = z.object({
  type: z.enum(["DR", "CR"]),
  accountType: z.enum(["ledger", "bank", "supplier", "employee", "fixedAsset", "customer", "factorySupplier"]),
  accountId: z.number().min(1, "Please select an account"),
  accountName: z.string(),
  amount: z
    .string()
    .min(1, "Amount required")
    .refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, { message: "Amount must be a positive number" }),
  narration: z.string().optional(),
});

const journalFormSchema = z.object({
  voucherDate: z.date(),
  entries: z.array(journalEntrySchema).min(1, "Add at least one entry"),
  notes: z.string().optional(),
  optional: z.boolean().default(false),
});

type JournalFormData = z.infer<typeof journalFormSchema>;

interface JournalFormProps {
  voucherIdToEdit: number | null;
  isPOS: boolean;
}

export function JournalForm({ voucherIdToEdit, isPOS }: JournalFormProps) {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const isFactoryCompany = selectedCompany?.companyType === "factory";
  const isPropertiesCompany = selectedCompany?.companyType === "properties";
  const isFactoryMode = appMode === "factory";
  const modePrefix = useModePrefix();
  const [, setLocation] = useLocation();
  const { formatAmount, selectedCurrency, convertToUSD } = useCurrencyContext();
  const [transactionRate, setTransactionRate] = useState<number | null>(null);
  const [journalEffectiveDate, setJournalEffectiveDate] = useState<string>("");
  const [isAutoCreating, setIsAutoCreating] = useState(false);
  const [waPendingPrompt, setWaPendingPrompt] = useState<WhatsAppPromptState>(null);
  const [accountPickersNeeded, setAccountPickersNeeded] = useState(() => !!voucherIdToEdit);
  const hydratedVoucherIdRef = useRef<number | null>(null);

  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({
    queryKey: ["/api/bank-accounts", selectedCompany?.id],
  });
  const { data: ledgerAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger-accounts", selectedCompany?.id],
  });
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers", selectedCompany?.id],
    enabled: accountPickersNeeded && !!selectedCompany && !isPropertiesCompany,
    staleTime: 5 * 60 * 1000,
  });
  const { data: factorySuppliersList = [] } = useQuery<FactorySupplierBasic[]>({
    queryKey: ["/api/factory/suppliers", selectedCompany?.id],
    enabled: isFactoryCompany,
  });
  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", selectedCompany?.id],
    enabled: accountPickersNeeded && !!selectedCompany,
    staleTime: 5 * 60 * 1000,
  });
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees", selectedCompany?.id],
  });
  const { data: fixedAssets = [] } = useQuery<FixedAsset[]>({
    queryKey: ["/api/fixed-assets", selectedCompany?.id],
  });
  const { data: sidebarAccounts = [] } = useQuery<Account[]>({
    queryKey: ["/api/accounts/voucher-sidebar", selectedCompany?.id],
  });

  const [liveAccountSearch, setLiveAccountSearch] = useState("");
  const [debouncedAccountSearch, setDebouncedAccountSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAccountSearch(liveAccountSearch), 300);
    return () => clearTimeout(timer);
  }, [liveAccountSearch]);

  const { data: supplierSearchResults = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers", "live-search", debouncedAccountSearch, selectedCompany?.id],
    enabled: debouncedAccountSearch.length >= 2 && !!selectedCompany && !isPropertiesCompany,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/suppliers?search=${encodeURIComponent(debouncedAccountSearch)}&limit=50`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to search suppliers");
      return res.json();
    },
  });
  const { data: customerSearchResults = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", "live-search", debouncedAccountSearch, selectedCompany?.id],
    enabled: debouncedAccountSearch.length >= 2 && !!selectedCompany,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/customers?search=${encodeURIComponent(debouncedAccountSearch)}&limit=50`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to search customers");
      return res.json();
    },
  });

  const { data: voucherToEdit } = useQuery({
    queryKey: ["/api/vouchers", voucherIdToEdit],
    enabled: !!voucherIdToEdit,
    queryFn: async () => {
      const res = await fetch(`/api/vouchers/${voucherIdToEdit}`);
      if (!res.ok) throw new Error("Failed to fetch voucher");
      return res.json();
    },
  });

  useEffect(() => {
    if (voucherIdToEdit) setAccountPickersNeeded(true);
  }, [voucherIdToEdit]);

  const allAccounts = useMemo<CombinedAccount[]>(() => {
    const accounts: CombinedAccount[] = [
      ...ledgerAccounts.map((a) => ({ type: "ledger" as const, id: a.id, name: a.name, code: a.code })),
      ...bankAccounts.map((a) => ({ type: "bank" as const, id: a.id, name: a.bankName, code: a.accountNumber })),
      ...suppliers.map((s) => ({ type: "supplier" as const, id: s.id, name: s.legalName, code: s.code })),
      ...supplierSearchResults
        .filter((s) => !suppliers.find((p) => p.id === s.id))
        .map((s) => ({ type: "supplier" as const, id: s.id, name: s.legalName, code: s.code })),
      ...employees.map((e) => ({
        type: "employee" as const,
        id: e.id,
        name: `${e.firstName} ${e.lastName}`,
        code: e.code,
        openingBalance: e.openingBalance,
      })),
      ...fixedAssets.map((f) => ({
        type: "fixedAsset" as const,
        id: f.id,
        name: f.name,
        code: f.code,
        openingBalance: f.openingBalance,
      })),
      ...customers.map((c: any) => ({
        type: "customer" as const,
        id: c.id,
        name: c.legalName,
        code: c.code,
        openingBalance: c.openingBalance,
      })),
      ...customerSearchResults
        .filter((c: any) => !customers.find((p: any) => p.id === c.id))
        .map((c: any) => ({ type: "customer" as const, id: c.id, name: c.legalName, code: c.code })),
      ...factorySuppliersList.map((s) => ({
        type: "factorySupplier" as const,
        id: s.id,
        name: s.name,
        code: String(s.id),
      })),
    ];
    return accounts.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [
    ledgerAccounts,
    bankAccounts,
    suppliers,
    supplierSearchResults,
    employees,
    fixedAssets,
    customers,
    customerSearchResults,
    factorySuppliersList,
  ]);

  const journalForm = useForm<JournalFormData>({
    resolver: zodResolver(journalFormSchema),
    defaultValues: {
      voucherDate: new Date(),
      entries: [{ type: "DR", accountType: "ledger", accountId: 0, accountName: "", amount: "" }],
      notes: "",
      optional: false,
    },
  });

  const {
    fields: journalFields,
    append: appendJournal,
    remove: removeJournal,
  } = useFieldArray({
    control: journalForm.control,
    name: "entries",
  });

  const journalEntries = journalForm.watch("entries");
  const totalDebit = journalEntries.reduce((sum, e) => sum + (e.type === "DR" ? parseFloat(e.amount) || 0 : 0), 0);
  const totalCredit = journalEntries.reduce((sum, e) => sum + (e.type === "CR" ? parseFloat(e.amount) || 0 : 0), 0);

  const journalDraftMode = isFactoryMode ? "factory" : "erp";
  const {
    hasDraft: hasJournalDraft,
    draftAge: journalDraftAge,
    draft: journalDraft,
    scheduleSave: scheduleJournalSave,
    discardDraft: discardJournalDraft,
  } = useFormDraft({
    entityType: "voucher-journal",
    mode: journalDraftMode,
    companyId: selectedCompany?.id ?? null,
    enabled: !voucherIdToEdit,
  });

  const allJournalValues = journalForm.watch();
  useEffect(() => {
    if (voucherIdToEdit) return;
    scheduleJournalSave(allJournalValues);
  }, [JSON.stringify(allJournalValues), voucherIdToEdit]);

  const [activeJournalRow, setActiveJournalRow] = useState<number | null>(null);
  const [showAccountSidebar, setShowAccountSidebar] = useState(false);
  const [journalAccountSearchTerm, setJournalAccountSearchTerm] = useState("");
  const [journalAccountHighlightedIndex, setJournalAccountHighlightedIndex] = useState(0);
  const journalSidebarRef = useRef<HTMLDivElement>(null);
  const [showCreateAccountModal, setShowCreateAccountModal] = useState(false);
  const [createAccountContext, setCreateAccountContext] = useState<{
    tab: "payment" | "receipt" | "journal";
    rowIndex?: number;
  } | null>(null);
  const [accountPickersActivated, setAccountPickersActivated] = useState(false);

  useEffect(() => {
    setLiveAccountSearch(journalAccountSearchTerm);
  }, [journalAccountSearchTerm]);

  const filteredJournalAccounts = useMemo(() => {
    if (!journalAccountSearchTerm.trim()) return allAccounts;
    const term = journalAccountSearchTerm.toLowerCase();
    return allAccounts.filter(
      (acc) => (acc.name || "").toLowerCase().includes(term) || (acc.code || "").toLowerCase().includes(term)
    );
  }, [allAccounts, journalAccountSearchTerm]);

  const handleJournalAccountSelect = (account: CombinedAccount) => {
    if (activeJournalRow !== null) {
      journalForm.setValue(`entries.${activeJournalRow}.accountType`, account.type);
      journalForm.setValue(`entries.${activeJournalRow}.accountId`, account.id);
      journalForm.setValue(`entries.${activeJournalRow}.accountName`, account.name);
      setTimeout(() => {
        const amountInput = document.querySelector(
          `[data-testid="input-journal-amount-${activeJournalRow}"]`
        ) as HTMLInputElement;
        if (amountInput) {
          amountInput.focus();
          amountInput.select();
        }
      }, 50);
    }
  };

  const getAccountBalance = (accountType: string, accountId: number): number => {
    const account = sidebarAccounts.find((acc) => acc.type === accountType && acc.id === accountId);
    return account?.balance ?? 0;
  };

  const handleJournalTypeChange = (index: number, newType: "DR" | "CR") => {
    const currentEntries = journalForm.getValues("entries");
    const currentAmount = parseFloat(currentEntries[index]?.amount || "0");
    journalForm.setValue(`entries.${index}.type`, newType);
    if (newType === "CR") {
      const updatedEntries = currentEntries.map((entry, i) => (i === index ? { ...entry, type: newType } : entry));
      const totalDebits = updatedEntries.reduce(
        (sum, entry) => sum + (entry.type === "DR" ? parseFloat(entry.amount) || 0 : 0),
        0
      );
      const otherCredits = updatedEntries.reduce(
        (sum, entry, i) => (i !== index && entry.type === "CR" ? sum + (parseFloat(entry.amount) || 0) : sum),
        0
      );
      const remainingToBalance = totalDebits - otherCredits;
      if (currentAmount === 0 && remainingToBalance > 0) {
        journalForm.setValue(`entries.${index}.amount`, formatNumber(remainingToBalance));
      }
    }
    setTimeout(() => {
      const accountInput = document.querySelector(`[data-testid="input-journal-account-${index}"]`) as HTMLInputElement;
      if (accountInput) accountInput.focus();
    }, 50);
  };

  useEffect(() => {
    if (
      !voucherToEdit ||
      voucherToEdit.voucherType !== "Journal" ||
      !Array.isArray(voucherToEdit.entries) ||
      voucherToEdit.entries.length === 0 ||
      allAccounts.length === 0
    )
      return;
    if (hydratedVoucherIdRef.current === voucherToEdit.id) return;
    const needsFactorySuppliers = voucherToEdit.entries.some((e: any) => e.factorySupplierId);
    if (needsFactorySuppliers && factorySuppliersList.length === 0) return;

    const formEntries = voucherToEdit.entries.map((entry: any) => {
      let accountType: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset" | "customer" | "factorySupplier" =
        "ledger";
      let accountId = 0;
      let accountName = "";
      if (entry.bankAccountId) {
        accountType = "bank";
        accountId = entry.bankAccountId;
        accountName = bankAccounts.find((b) => b.id === accountId)?.bankName || "";
      } else if (entry.ledgerAccountId) {
        accountType = "ledger";
        accountId = entry.ledgerAccountId;
        accountName = ledgerAccounts.find((l) => l.id === accountId)?.name || "";
      } else if (entry.supplierId) {
        accountType = "supplier";
        accountId = entry.supplierId;
        accountName = suppliers.find((s) => s.id === accountId)?.legalName || "";
      } else if (entry.factorySupplierId) {
        accountType = "factorySupplier";
        accountId = entry.factorySupplierId;
        accountName = factorySuppliersList.find((s) => s.id === accountId)?.name || "";
      } else if (entry.employeeId) {
        accountType = "employee";
        accountId = entry.employeeId;
        const emp = employees.find((e) => e.id === accountId);
        accountName = emp ? `${emp.firstName} ${emp.lastName}` : "";
      } else if (entry.fixedAssetId) {
        accountType = "fixedAsset";
        accountId = entry.fixedAssetId;
        accountName = fixedAssets.find((f) => f.id === accountId)?.name || "";
      } else if (entry.customerId) {
        accountType = "customer";
        accountId = entry.customerId;
        accountName = (customers.find((c: any) => c.id === accountId) as any)?.legalName || "";
      }
      const debitAmt = parseFloat(entry.debitAmount || "0");
      const creditAmt = parseFloat(entry.creditAmount || "0");
      const type: "DR" | "CR" = debitAmt > 0 ? "DR" : "CR";
      const amount = debitAmt > 0 ? entry.debitAmount : entry.creditAmount;
      return { type, accountType, accountId, accountName, amount, narration: entry.narration || "" };
    });

    journalForm.reset({
      voucherDate: parseDateLocal(voucherToEdit.voucherDate),
      entries:
        formEntries.length > 0
          ? formEntries
          : [{ type: "DR", accountType: "ledger", accountId: 0, accountName: "", amount: "" }],
      notes: voucherToEdit.notes || "",
      optional: voucherToEdit.optional || false,
    });
    setJournalEffectiveDate(voucherToEdit.effectiveDate || "");
    hydratedVoucherIdRef.current = voucherToEdit.id;
  }, [
    voucherToEdit,
    allAccounts,
    bankAccounts,
    ledgerAccounts,
    suppliers,
    employees,
    fixedAssets,
    customers,
    factorySuppliersList,
    journalForm,
  ]);

  const journalMutation = useMutation({
    mutationFn: async (formData: JournalFormData) => {
      const isEditMode = !!voucherIdToEdit;
      const validEntries = formData.entries.filter((entry) => entry.accountId > 0);
      const payload = {
        voucherDate: format(formData.voucherDate, "yyyy-MM-dd"),
        entries: validEntries,
        notes: formData.notes,
        optional: formData.optional,
        currency: selectedCurrency,
        exchangeRate: transactionRate ? transactionRate.toString() : undefined,
        effectiveDate: journalEffectiveDate || null,
      };
      if (isEditMode) {
        const res = await modeApiRequest("PATCH", `/api/vouchers/${voucherIdToEdit}/journal`, payload);
        return await res.json();
      } else {
        const res = await modeApiRequest("POST", "/api/vouchers/journal", payload);
        return await res.json();
      }
    },
    onSuccess: async (data: any) => {
      const isEditMode = !!voucherIdToEdit;
      toast({ title: "Success", description: `Journal voucher ${isEditMode ? "updated" : "created"} successfully` });
      const waPrompt = resolveWhatsAppPrompt(data);
      if (waPrompt) setWaPendingPrompt(waPrompt);
      discardJournalDraft();
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/voucher-sidebar"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers/stats", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/net-profit"] });
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customers/") });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customers"] });
      queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
      if (isEditMode) {
        setLocation(`${modePrefix}/daybook`);
      } else {
        journalForm.reset({
          voucherDate: new Date(),
          entries: [{ type: "DR", accountType: "ledger", accountId: 0, accountName: "", amount: "" }],
          notes: "",
          optional: false,
        });
      }
    },
    onError: (error: any, formData: JournalFormData) => {
      if (error.name === "OfflineQueued") {
        const syntheticVoucher: any = {
          id: -Date.now(),
          voucherNumber: "PENDING",
          voucherType: "Journal",
          voucherDate: format(formData.voucherDate, "yyyy-MM-dd"),
          description: formData.notes || "Journal (pending sync)",
          totalAmount: formData.entries
            .filter((e: any) => e.type === "DR" && parseFloat(e.amount || "0") > 0)
            .reduce((sum: number, e: any) => sum + parseFloat(e.amount || "0"), 0)
            .toFixed(2),
          optional: formData.optional || false,
          createdAt: new Date().toISOString(),
        };
        queryClient.setQueriesData({ queryKey: ["/api/vouchers"] }, (old: any) =>
          Array.isArray(old) ? [syntheticVoucher, ...old] : old
        );
        discardJournalDraft();
        journalForm.reset({
          voucherDate: new Date(),
          entries: [{ type: "DR", accountType: "ledger", accountId: 0, accountName: "", amount: "" }],
          notes: "",
          optional: false,
        });
        return;
      }
      if ((error as any)._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || `Failed to ${voucherIdToEdit ? "update" : "create"} journal voucher`,
        variant: "destructive",
      });
    },
  });

  const sendWaStatementMutation = useMutation({
    mutationFn: async ({ accountId, month }: { accountId: number; month: string }) => {
      const res = await modeApiRequest("POST", `/api/factory/accounts/${accountId}/send-statement-whatsapp`, { month });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to send WhatsApp");
      return json;
    },
    onSuccess: () => {
      toast({ title: "Statement sent to WhatsApp" });
      setWaPendingPrompt(null);
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "WhatsApp send failed", description: error.message, variant: "destructive" });
      setWaPendingPrompt(null);
    },
  });

  const handleExportJournalVoucher = async (detailed: boolean) => {
    const formData = journalForm.getValues();
    const voucherDate = formData.voucherDate
      ? format(formData.voucherDate, "yyyy-MM-dd")
      : format(new Date(), "yyyy-MM-dd");
    const validEntries = formData.entries.filter((e: any) => e.accountId > 0 && parseFloat(e.amount) > 0);
    if (validEntries.length === 0) {
      toast({
        title: "No data to export",
        description: "Add at least one entry before exporting.",
        variant: "destructive",
      });
      return;
    }
    if (detailed) {
      const exportData = validEntries.map((entry: any) => ({
        "Voucher Type": "Journal",
        Date: voucherDate,
        "DR/CR": entry.type,
        Account: entry.accountName || "",
        "Account Type": entry.accountType || "",
        Amount: parseFloat(entry.amount).toFixed(2),
        Notes: formData.notes || "",
        Optional: formData.optional ? "Yes" : "No",
      }));
      const worksheet = utils.json_to_sheet(exportData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Journal Detailed");
      const fileName = `Journal_Voucher_Detailed_${voucherDate}.xlsx`;
      await writeFile(workbook, fileName);
      toast({ title: "Export successful", description: `Downloaded ${fileName} with ${validEntries.length} entries.` });
    } else {
      const totalDr = validEntries
        .filter((e: any) => e.type === "DR")
        .reduce((sum: number, e: any) => sum + (parseFloat(e.amount) || 0), 0);
      const totalCr = validEntries
        .filter((e: any) => e.type === "CR")
        .reduce((sum: number, e: any) => sum + (parseFloat(e.amount) || 0), 0);
      const exportData = [
        {
          "Voucher Type": "Journal",
          Date: voucherDate,
          "Total Debit": totalDr.toFixed(2),
          "Total Credit": totalCr.toFixed(2),
          "Number of Entries": validEntries.length,
          Notes: formData.notes || "",
          Optional: formData.optional ? "Yes" : "No",
        },
      ];
      const worksheet = utils.json_to_sheet(exportData);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Journal Summary");
      const fileName = `Journal_Voucher_Summary_${voucherDate}.xlsx`;
      await writeFile(workbook, fileName);
      toast({ title: "Export successful", description: `Downloaded ${fileName}.` });
    }
  };

  const onJournalSubmit = async (data: JournalFormData) => {
    const validEntries = data.entries.filter((entry) => entry.accountId > 0 && parseFloat(entry.amount) > 0);
    if (validEntries.length === 0) {
      toast({ title: "Validation Error", description: "Please add at least one valid entry", variant: "destructive" });
      return;
    }
    if (!validEntries.some((e) => e.type === "DR") || !validEntries.some((e) => e.type === "CR")) {
      toast({
        title: "Validation Error",
        description: "Journal must have both DR (debit) and CR (credit) entries",
        variant: "destructive",
      });
      return;
    }
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      toast({
        title: "Validation Error",
        description: `Debits (${formatAmount(totalDebit)}) must equal Credits (${formatAmount(totalCredit)})`,
        variant: "destructive",
      });
      return;
    }
    journalMutation.mutate(data);
  };

  const handleJournalKeyDown = (e: React.KeyboardEvent, rowIndex: number, fieldName: "type" | "account" | "amount") => {
    const isLastRow = rowIndex === journalFields.length - 1;
    if (fieldName === "amount") {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rowIndex > 0)
          setTimeout(() => {
            const el = document.querySelector(
              `[data-testid="input-journal-amount-${rowIndex - 1}"]`
            ) as HTMLInputElement;
            if (el) {
              el.focus();
              el.select();
            }
          }, 50);
        return;
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rowIndex < journalFields.length - 1)
          setTimeout(() => {
            const el = document.querySelector(
              `[data-testid="input-journal-amount-${rowIndex + 1}"]`
            ) as HTMLInputElement;
            if (el) {
              el.focus();
              el.select();
            }
          }, 50);
        return;
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setTimeout(() => {
          const el = document.querySelector(`[data-testid="input-journal-account-${rowIndex}"]`) as HTMLInputElement;
          if (el) el.focus();
        }, 50);
        return;
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (rowIndex < journalFields.length - 1)
          setTimeout(() => {
            const el = document.querySelector(`[data-testid="input-journal-type-${rowIndex + 1}"]`) as HTMLElement;
            if (el) el.focus();
          }, 50);
        return;
      }
    }
    if (fieldName === "amount" && e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      if (isLastRow)
        appendJournal({ type: "DR", accountType: "ledger", accountId: 0, accountName: "", amount: "", narration: "" });
      setTimeout(() => {
        const el = document.querySelector(`[data-testid="input-journal-type-${rowIndex + 1}"]`) as HTMLElement;
        if (el) el.focus();
      }, 100);
    }
    if (fieldName === "amount" && e.key === "Enter") {
      e.preventDefault();
      if (isLastRow) {
        appendJournal({ type: "DR", accountType: "ledger", accountId: 0, accountName: "", amount: "", narration: "" });
        setTimeout(() => {
          const el = document.querySelector(`[data-testid="input-journal-type-${rowIndex + 1}"]`) as HTMLElement;
          if (el) el.focus();
        }, 100);
      } else {
        setTimeout(() => {
          const el = document.querySelector(`[data-testid="input-journal-type-${rowIndex + 1}"]`) as HTMLElement;
          if (el) el.focus();
        }, 50);
      }
    }
  };

  const handleAutoCreateAccount = async (name: string): Promise<Account | null> => {
    if (!selectedCompany?.id || !name.trim()) return null;
    setIsAutoCreating(true);
    try {
      const existing = sidebarAccounts.find((acc) => acc.name.toLowerCase() === name.trim().toLowerCase());
      if (existing) return existing;
      const response = await fetch("/api/ledger-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: name.trim(), accountType: "Indirect Expense", companyId: selectedCompany.id }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to create account");
      }
      const newAccount = await response.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/accounts/voucher-sidebar", selectedCompany.id] });
      await queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts", selectedCompany.id] });
      toast({ title: "Account created", description: `"${newAccount.name}" created as Indirect Expense.` });
      return {
        id: newAccount.id,
        name: newAccount.name,
        type: "ledger" as const,
        code: newAccount.code || "",
        balance: 0,
      };
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to create account" });
      return null;
    } finally {
      setIsAutoCreating(false);
    }
  };

  const handleOpenCreateAccountModal = (tab: "payment" | "receipt" | "journal", rowIndex?: number) => {
    setCreateAccountContext({ tab, rowIndex });
    setShowCreateAccountModal(true);
  };

  const handleAccountCreated = (account: { id: number; name: string; type: string }) => {
    if (!createAccountContext) return;
    if (createAccountContext.tab === "journal" && createAccountContext.rowIndex !== undefined) {
      const rowIndex = createAccountContext.rowIndex;
      journalForm.setValue(`entries.${rowIndex}.accountType`, "ledger");
      journalForm.setValue(`entries.${rowIndex}.accountId`, account.id);
      journalForm.setValue(`entries.${rowIndex}.accountName`, account.name);
      setShowAccountSidebar(false);
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-testid="input-journal-amount-${rowIndex}"]`) as HTMLInputElement;
        if (el) {
          el.focus();
          el.select();
        }
      });
    }
    setCreateAccountContext(null);
  };

  if (isPOS) return null;

  return (
    <div className="space-y-4">
      {selectedCurrency === "CFA" && (
        <div className="flex flex-wrap items-center gap-2 sm:gap-4 p-3 bg-muted/30 rounded-md">
          <span className="text-sm text-muted-foreground">Transaction Rate:</span>
          <ExchangeRateInput
            value={transactionRate}
            onChange={setTransactionRate}
            selectedCurrency={selectedCurrency}
          />
        </div>
      )}
      <div className="flex flex-col lg:flex-row gap-4">
        <Card className="flex-1 min-w-0">
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-5">
              <span className="text-sm font-semibold">Journal Voucher</span>
            </div>
            {hasJournalDraft && !voucherIdToEdit && journalDraftAge && (
              <div className="mb-4">
                <DraftRestorePrompt
                  draftAge={journalDraftAge}
                  label="Unsaved journal draft found"
                  onRestore={() => {
                    if (journalDraft?.data) {
                      const d = journalDraft.data as any;
                      journalForm.reset({ ...d, voucherDate: d.voucherDate ? new Date(d.voucherDate) : new Date() });
                    }
                    discardJournalDraft();
                  }}
                  onDiscard={discardJournalDraft}
                />
              </div>
            )}
            <Form {...journalForm}>
              <form noValidate onSubmit={journalForm.handleSubmit(onJournalSubmit)} className="space-y-5">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold">
                      {voucherToEdit?.voucherNumber ? `#${voucherToEdit.voucherNumber}` : "New Journal Entry"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Debit and credit must balance</p>
                  </div>
                  <FormField
                    control={journalForm.control}
                    name="voucherDate"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2 space-y-0">
                        <FormLabel className="text-sm text-muted-foreground shrink-0">Date</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            value={
                              field.value instanceof Date
                                ? format(field.value, "yyyy-MM-dd")
                                : typeof field.value === "string"
                                  ? field.value
                                  : ""
                            }
                            onChange={(e) =>
                              field.onChange(e.target.value ? new Date(e.target.value + "T00:00:00") : new Date())
                            }
                            className="w-[180px]"
                            data-testid="input-journal-date"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="shrink-0 flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">Eff.</span>
                    <Input
                      type="date"
                      className="w-36"
                      value={journalEffectiveDate}
                      onChange={(e) => setJournalEffectiveDate(e.target.value)}
                      data-testid="input-journal-effective-date"
                      title="Effective Date (optional — used for ledger/accounts)"
                    />
                  </div>
                </div>

                {/* Mobile journal cards */}
                <div className="sm:hidden space-y-2">
                  {journalFields.map((field, index) => {
                    const entry = journalEntries[index];
                    const currentBalance =
                      entry?.accountId > 0 ? getAccountBalance(entry.accountType, entry.accountId) : 0;
                    const entryAmount = parseFloat(entry?.amount || "0");
                    const projectedBalance =
                      entry?.type === "DR" ? currentBalance + entryAmount : currentBalance - entryAmount;
                    return (
                      <div key={field.id} className="border rounded-md p-3 space-y-2 bg-card">
                        <div className="flex items-start gap-2">
                          <FormField
                            control={journalForm.control}
                            name={`entries.${index}.type`}
                            render={({ field }) => (
                              <FormItem className="shrink-0">
                                <Select
                                  value={field.value}
                                  onValueChange={(v: "DR" | "CR") => handleJournalTypeChange(index, v)}
                                >
                                  <FormControl>
                                    <SelectTrigger
                                      className="w-16 text-center font-medium"
                                      data-testid={`input-journal-type-mobile-${index}`}
                                    >
                                      <SelectValue placeholder="DR" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="DR">DR</SelectItem>
                                    <SelectItem value="CR">CR</SelectItem>
                                  </SelectContent>
                                </Select>
                              </FormItem>
                            )}
                          />
                          <div className="flex-1 min-w-0">
                            <Input
                              value={activeJournalRow === index ? journalAccountSearchTerm : entry?.accountName || ""}
                              onChange={(e) => {
                                setJournalAccountSearchTerm(e.target.value);
                                setJournalAccountHighlightedIndex(0);
                              }}
                              onFocus={() => {
                                setAccountPickersActivated(true);
                                setAccountPickersNeeded(true);
                                setActiveJournalRow(index);
                                setShowAccountSidebar(true);
                                setJournalAccountSearchTerm("");
                              }}
                              onBlur={() => {
                                setTimeout(() => {
                                  if (activeJournalRow === index) {
                                    setJournalAccountSearchTerm("");
                                    setActiveJournalRow(null);
                                  }
                                }, 200);
                              }}
                              placeholder="Type to search account..."
                              data-testid={`input-journal-account-mobile-${index}`}
                              className="text-sm"
                            />
                            {activeJournalRow === index && filteredJournalAccounts.length > 0 && (
                              <div className="mt-1 border rounded-md bg-popover shadow-md max-h-44 overflow-y-auto z-20 relative">
                                {filteredJournalAccounts.slice(0, 10).map((account: any) => (
                                  <button
                                    key={`${account.type}-${account.id}`}
                                    type="button"
                                    className="w-full text-left px-3 py-2.5 text-sm hover-elevate border-b last:border-b-0"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      handleJournalAccountSelect(account);
                                      setShowAccountSidebar(false);
                                    }}
                                  >
                                    <div className="font-medium truncate">{account.name}</div>
                                  </button>
                                ))}
                              </div>
                            )}
                            {entry?.accountId > 0 && (
                              <div className="text-xs text-muted-foreground pl-1 mt-0.5">
                                New Bal:{" "}
                                <span
                                  className={cn(
                                    "font-mono",
                                    projectedBalance >= 0
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : "text-red-600 dark:text-red-400"
                                  )}
                                >
                                  {formatAmount(Math.abs(projectedBalance))} {projectedBalance >= 0 ? "Dr" : "Cr"}
                                </span>
                              </div>
                            )}
                          </div>
                          {journalFields.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeJournal(index)}
                              data-testid={`button-journal-remove-mobile-${index}`}
                              className="shrink-0"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        <FormField
                          control={journalForm.control}
                          name={`entries.${index}.amount`}
                          render={({ field }) => (
                            <FormItem>
                              <div className="flex items-center gap-3">
                                <span className="text-xs text-muted-foreground w-14 shrink-0">Amount</span>
                                <FormControl>
                                  <Input
                                    {...field}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder="0.00"
                                    className="font-mono text-right"
                                    data-testid={`input-journal-amount-mobile-${index}`}
                                    onBlur={(e) => {
                                      const v = Number(e.target.value);
                                      if (!isNaN(v) && v > 0 && selectedCurrency !== "USD")
                                        journalForm.setValue(`entries.${index}.amount`, convertToUSD(v).toFixed(2));
                                    }}
                                  />
                                </FormControl>
                              </div>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={journalForm.control}
                          name={`entries.${index}.narration`}
                          render={({ field }) => (
                            <FormItem>
                              <div className="flex items-center gap-3">
                                <span className="text-xs text-muted-foreground w-14 shrink-0">Narration</span>
                                <FormControl>
                                  <Input
                                    {...field}
                                    value={field.value ?? ""}
                                    placeholder="Optional note for this entry"
                                    className="text-sm"
                                    data-testid={`input-journal-narration-mobile-${index}`}
                                  />
                                </FormControl>
                              </div>
                            </FormItem>
                          )}
                        />
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between pt-1 px-0.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        appendJournal({
                          type: "DR",
                          accountType: "ledger",
                          accountId: 0,
                          accountName: "",
                          amount: "",
                          narration: "",
                        })
                      }
                      data-testid="button-journal-add-row-mobile"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Row
                    </Button>
                    <div className="text-right text-xs space-y-0.5">
                      <div className="text-muted-foreground">
                        DR: {formatAmount(totalDebit)} | CR: {formatAmount(totalCredit)}
                      </div>
                    </div>
                  </div>
                  {Math.abs(totalDebit - totalCredit) > 0.01 && (
                    <div className="text-center text-sm text-destructive p-2 bg-destructive/10 rounded-md">
                      DR/CR mismatch: {formatAmount(Math.abs(totalDebit - totalCredit))}
                    </div>
                  )}
                </div>

                {/* Desktop journal table */}
                <div className="hidden sm:block border rounded-xl overflow-hidden overflow-x-auto">
                  <table className="w-full min-w-[500px]">
                    <thead className="bg-muted/40">
                      <tr className="h-9">
                        <th className="text-left px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[10%]">
                          DR/CR
                        </th>
                        <th className="text-left px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[35%]">
                          Account
                        </th>
                        <th className="text-right px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[20%]">
                          Amount
                        </th>
                        <th className="text-left px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[28%]">
                          Narration
                        </th>
                        <th className="w-[7%]"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {journalFields.map((field, index) => {
                        const entry = journalEntries[index];
                        const currentBalance =
                          entry?.accountId > 0 ? getAccountBalance(entry.accountType, entry.accountId) : 0;
                        const entryAmount = parseFloat(entry?.amount || "0");
                        const displayBalance =
                          entry?.type === "DR" ? currentBalance + entryAmount : currentBalance - entryAmount;
                        return (
                          <tr key={field.id} className="border-t hover:bg-muted/20 transition-colors">
                            <td className="p-2">
                              <FormField
                                control={journalForm.control}
                                name={`entries.${index}.type`}
                                render={({ field }) => (
                                  <FormItem>
                                    <Select
                                      value={field.value}
                                      onValueChange={(v: "DR" | "CR") => handleJournalTypeChange(index, v)}
                                    >
                                      <FormControl>
                                        <SelectTrigger
                                          className={cn(
                                            "w-20 text-center font-semibold border",
                                            field.value === "DR"
                                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800"
                                              : "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800"
                                          )}
                                          data-testid={`input-journal-type-${index}`}
                                          onKeyDown={(e) => {
                                            if (e.key === "Tab" && !e.shiftKey) {
                                              e.preventDefault();
                                              setTimeout(() => {
                                                const el = document.querySelector(
                                                  `[data-testid="input-journal-account-${index}"]`
                                                ) as HTMLInputElement;
                                                if (el) el.focus();
                                              }, 50);
                                            } else if (e.key === "ArrowRight") {
                                              e.preventDefault();
                                              setTimeout(() => {
                                                const el = document.querySelector(
                                                  `[data-testid="input-journal-account-${index}"]`
                                                ) as HTMLInputElement;
                                                if (el) el.focus();
                                              }, 50);
                                            } else if (e.key === "ArrowLeft") {
                                              e.preventDefault();
                                              setTimeout(() => {
                                                const el = document.querySelector(
                                                  `[data-testid="input-journal-amount-${index}"]`
                                                ) as HTMLInputElement;
                                                if (el) {
                                                  el.focus();
                                                  el.select();
                                                }
                                              }, 50);
                                            } else if (e.key === "ArrowUp" && index > 0) {
                                              e.preventDefault();
                                              setTimeout(() => {
                                                const el = document.querySelector(
                                                  `[data-testid="input-journal-type-${index - 1}"]`
                                                ) as HTMLElement;
                                                if (el) el.focus();
                                              }, 50);
                                            } else if (e.key === "ArrowDown" && index < journalFields.length - 1) {
                                              e.preventDefault();
                                              setTimeout(() => {
                                                const el = document.querySelector(
                                                  `[data-testid="input-journal-type-${index + 1}"]`
                                                ) as HTMLElement;
                                                if (el) el.focus();
                                              }, 50);
                                            }
                                          }}
                                        >
                                          <SelectValue placeholder="DR" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        <SelectItem value="DR">DR</SelectItem>
                                        <SelectItem value="CR">CR</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </td>
                            <td className="p-2">
                              <FormField
                                control={journalForm.control}
                                name={`entries.${index}.accountId`}
                                render={() => (
                                  <FormItem>
                                    <FormControl>
                                      <div className="space-y-1">
                                        <Input
                                          value={
                                            activeJournalRow === index
                                              ? journalAccountSearchTerm
                                              : entry?.accountName || ""
                                          }
                                          onChange={(e) => {
                                            setJournalAccountSearchTerm(e.target.value);
                                            setJournalAccountHighlightedIndex(0);
                                          }}
                                          onFocus={() => {
                                            setAccountPickersActivated(true);
                                            setAccountPickersNeeded(true);
                                            setActiveJournalRow(index);
                                            setShowAccountSidebar(true);
                                            setJournalAccountSearchTerm("");
                                          }}
                                          onBlur={() => {
                                            setTimeout(() => {
                                              if (activeJournalRow === index) {
                                                setJournalAccountSearchTerm("");
                                                setActiveJournalRow(null);
                                              }
                                            }, 200);
                                          }}
                                          placeholder="Type to search..."
                                          data-testid={`input-journal-account-${index}`}
                                          onKeyDown={(e) => {
                                            if (showAccountSidebar) {
                                              if (e.key === "ArrowUp") {
                                                e.preventDefault();
                                                setJournalAccountHighlightedIndex((p) =>
                                                  p > 0 ? p - 1 : Math.max(0, filteredJournalAccounts.length - 1)
                                                );
                                                return;
                                              }
                                              if (e.key === "ArrowDown") {
                                                e.preventDefault();
                                                setJournalAccountHighlightedIndex((p) =>
                                                  p < filteredJournalAccounts.length - 1 ? p + 1 : 0
                                                );
                                                return;
                                              }
                                              if (e.key === "Enter") {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                const sel = filteredJournalAccounts[journalAccountHighlightedIndex];
                                                if (sel) {
                                                  handleJournalAccountSelect(sel);
                                                  setShowAccountSidebar(false);
                                                }
                                                return;
                                              }
                                            }
                                            if (e.key === "Tab" && !e.shiftKey) {
                                              e.preventDefault();
                                              setTimeout(() => {
                                                const el = document.querySelector(
                                                  `[data-testid="input-journal-amount-${index}"]`
                                                ) as HTMLInputElement;
                                                if (el) {
                                                  el.focus();
                                                  el.select();
                                                }
                                              }, 50);
                                            } else if (e.key === "ArrowUp" && index > 0) {
                                              e.preventDefault();
                                              setTimeout(() => {
                                                const el = document.querySelector(
                                                  `[data-testid="input-journal-account-${index - 1}"]`
                                                ) as HTMLInputElement;
                                                if (el) el.focus();
                                              }, 50);
                                            } else if (e.key === "ArrowDown" && index < journalFields.length - 1) {
                                              e.preventDefault();
                                              setTimeout(() => {
                                                const el = document.querySelector(
                                                  `[data-testid="input-journal-account-${index + 1}"]`
                                                ) as HTMLInputElement;
                                                if (el) el.focus();
                                              }, 50);
                                            } else if (e.key === "ArrowRight") {
                                              e.preventDefault();
                                              setTimeout(() => {
                                                const el = document.querySelector(
                                                  `[data-testid="input-journal-amount-${index}"]`
                                                ) as HTMLInputElement;
                                                if (el) {
                                                  el.focus();
                                                  el.select();
                                                }
                                              }, 50);
                                            } else if (e.key === "ArrowLeft") {
                                              e.preventDefault();
                                              setTimeout(() => {
                                                const el = document.querySelector(
                                                  `[data-testid="input-journal-type-${index}"]`
                                                ) as HTMLElement;
                                                if (el) el.focus();
                                              }, 50);
                                            }
                                          }}
                                        />
                                        {entry?.accountId > 0 && (
                                          <div className="text-xs text-muted-foreground pl-1">
                                            New Bal:{" "}
                                            <span
                                              className={cn(
                                                "font-mono",
                                                displayBalance >= 0
                                                  ? "text-emerald-600 dark:text-emerald-400"
                                                  : "text-red-600 dark:text-red-400"
                                              )}
                                            >
                                              {formatAmount(Math.abs(displayBalance))}{" "}
                                              {displayBalance >= 0 ? "Dr" : "Cr"}
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </td>
                            <td className="p-2">
                              <FormField
                                control={journalForm.control}
                                name={`entries.${index}.amount`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormControl>
                                      <Input
                                        {...field}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        placeholder="0.00"
                                        className="font-mono text-right"
                                        data-testid={`input-journal-amount-${index}`}
                                        onKeyDown={(e) => handleJournalKeyDown(e, index, "amount")}
                                        onBlur={(e) => {
                                          const v = Number(e.target.value);
                                          if (!isNaN(v) && v > 0 && selectedCurrency !== "USD")
                                            journalForm.setValue(`entries.${index}.amount`, convertToUSD(v).toFixed(2));
                                        }}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </td>
                            <td className="p-2">
                              <FormField
                                control={journalForm.control}
                                name={`entries.${index}.narration`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormControl>
                                      <Input
                                        {...field}
                                        value={field.value ?? ""}
                                        placeholder="Optional note…"
                                        className="text-sm h-8"
                                        data-testid={`input-journal-narration-${index}`}
                                      />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />
                            </td>
                            <td className="p-2">
                              {journalFields.length > 1 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeJournal(index)}
                                  data-testid={`button-journal-remove-${index}`}
                                >
                                  <X className="h-4 w-4 text-muted-foreground" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-muted/40 border-t">
                      <tr>
                        <td colSpan={5} className="px-3 py-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              appendJournal({
                                type: "DR",
                                accountType: "ledger",
                                accountId: 0,
                                accountName: "",
                                amount: "",
                                narration: "",
                              })
                            }
                            data-testid="button-journal-add-row"
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Add Row
                          </Button>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Balance indicator */}
                <div className="flex flex-wrap gap-3">
                  <div className="rounded-lg border bg-muted/40 px-4 py-2 flex flex-col gap-0.5">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Total Debit
                    </span>
                    <span className="text-sm font-semibold font-mono text-emerald-600 dark:text-emerald-400">
                      {formatAmount(totalDebit)}
                    </span>
                  </div>
                  <div className="rounded-lg border bg-muted/40 px-4 py-2 flex flex-col gap-0.5">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Total Credit
                    </span>
                    <span className="text-sm font-semibold font-mono text-red-600 dark:text-red-400">
                      {formatAmount(totalCredit)}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "rounded-lg border px-4 py-2 flex items-center gap-2",
                      Math.abs(totalDebit - totalCredit) <= 0.01
                        ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800"
                        : "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800"
                    )}
                  >
                    {Math.abs(totalDebit - totalCredit) <= 0.01 ? (
                      <>
                        <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Balanced</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                        <span className="text-sm font-medium text-red-700 dark:text-red-300">
                          Off by {formatAmount(Math.abs(totalDebit - totalCredit))}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <FormField
                  control={journalForm.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Additional notes..."
                          rows={3}
                          data-testid="input-journal-notes"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <FormField
                    control={journalForm.control}
                    name="optional"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center gap-2.5 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="checkbox-journal-optional"
                          />
                        </FormControl>
                        <FormLabel className="text-sm font-normal cursor-pointer">Mark as Optional</FormLabel>
                      </FormItem>
                    )}
                  />
                  <div className="flex items-center gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={
                            journalEntries.filter((e) => e.accountId > 0 && parseFloat(e.amount) > 0).length === 0
                          }
                          data-testid="button-export-journal-voucher"
                        >
                          <FileDown className="h-4 w-4 mr-2" />
                          Export
                          <ChevronDown className="h-4 w-4 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleExportJournalVoucher(false)}
                          data-testid="export-journal-summary"
                        >
                          Summary Export
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleExportJournalVoucher(true)}
                          data-testid="export-journal-detailed"
                        >
                          Detailed Export
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      type="submit"
                      disabled={journalMutation.isPending || Math.abs(totalDebit - totalCredit) > 0.01}
                      data-testid="button-save-journal-voucher"
                    >
                      {journalMutation.isPending ? "Saving..." : "Save Journal Voucher"}
                    </Button>
                  </div>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* Account Search Sidebar */}
        {showAccountSidebar && (
          <Card className="hidden sm:flex flex-col w-full lg:w-80 lg:sticky lg:top-4 max-h-[60vh] lg:max-h-[calc(100vh-12rem)] self-start">
            <div className="p-4 border-b">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold">Search Accounts</h3>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenCreateAccountModal("journal", activeJournalRow ?? undefined)}
                    data-testid="button-journal-create-account"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    New
                  </Button>
                  <button
                    onClick={() => setShowAccountSidebar(false)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                    data-testid="button-close-account-sidebar"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="relative">
                {isAutoCreating ? (
                  <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
                ) : (
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                )}
                <Input
                  placeholder="Search by name or code..."
                  value={journalAccountSearchTerm}
                  onChange={(e) => {
                    setJournalAccountSearchTerm(e.target.value);
                    setJournalAccountHighlightedIndex(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      if (filteredJournalAccounts.length > 0)
                        setJournalAccountHighlightedIndex((p) => Math.min(p + 1, filteredJournalAccounts.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      if (filteredJournalAccounts.length > 0)
                        setJournalAccountHighlightedIndex((p) => Math.max(p - 1, 0));
                    } else if (e.key === "Enter") {
                      if (
                        filteredJournalAccounts.length > 0 &&
                        journalAccountHighlightedIndex >= 0 &&
                        journalAccountHighlightedIndex < filteredJournalAccounts.length
                      ) {
                        e.preventDefault();
                        handleJournalAccountSelect(filteredJournalAccounts[journalAccountHighlightedIndex]);
                      }
                    }
                  }}
                  className="pl-9"
                  data-testid="input-journal-sidebar-search"
                  disabled={isAutoCreating}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2" ref={journalSidebarRef}>
              <div className="space-y-1">
                {filteredJournalAccounts.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">No accounts found</div>
                ) : (
                  filteredJournalAccounts.map((account, idx) => {
                    const isHighlighted = idx === journalAccountHighlightedIndex && activeJournalRow !== null;
                    const isSelected =
                      journalEntries[activeJournalRow ?? 0]?.accountId === account.id &&
                      journalEntries[activeJournalRow ?? 0]?.accountType === account.type;
                    const balance = getAccountBalance(account.type, account.id);
                    return (
                      <button
                        key={`${account.type}-${account.id}`}
                        type="button"
                        onClick={() => handleJournalAccountSelect(account)}
                        className={cn(
                          "w-full text-left px-3 py-2 rounded-md text-sm hover-elevate active-elevate-2 flex items-center justify-between gap-2",
                          isHighlighted && "bg-accent",
                          isSelected && "bg-primary/10"
                        )}
                        data-testid={`journal-account-option-${idx}`}
                      >
                        <div className="flex-1 truncate">
                          <div className="font-medium truncate">{account.name}</div>
                        </div>
                        <div
                          className={cn(
                            "text-xs font-mono",
                            account.type === "employee" || account.type === "supplier"
                              ? balance >= 0
                                ? "text-red-600 dark:text-red-400"
                                : "text-emerald-600 dark:text-emerald-400"
                              : balance >= 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-red-600 dark:text-red-400"
                          )}
                        >
                          {formatAmount(Math.abs(balance))}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </Card>
        )}
      </div>

      <CreateAccountModal
        open={showCreateAccountModal}
        onClose={() => {
          setShowCreateAccountModal(false);
          setCreateAccountContext(null);
        }}
        companyId={selectedCompany?.id || 0}
        onAccountCreated={handleAccountCreated}
        apiRequestFn={modeApiRequest}
      />

      <AlertDialog
        open={!!waPendingPrompt}
        onOpenChange={(open) => {
          if (!open) setWaPendingPrompt(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-whatsapp-prompt">
          <AlertDialogHeader>
            <AlertDialogTitle>Send Statement via WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              A WhatsApp statement is configured for this account. Would you like to send the{" "}
              <strong>{waPendingPrompt?.month}</strong> statement now, or skip and send it manually later?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-whatsapp-skip" onClick={() => setWaPendingPrompt(null)}>
              Skip for Now
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-whatsapp-send"
              disabled={sendWaStatementMutation.isPending}
              onClick={() => waPendingPrompt && sendWaStatementMutation.mutate(waPendingPrompt)}
            >
              {sendWaStatementMutation.isPending ? "Sending..." : "Send Now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
