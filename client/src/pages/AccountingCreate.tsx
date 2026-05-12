import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { Plus, MapPin, BookOpen, Users, Truck, FolderTree, Package, type LucideIcon } from "lucide-react";
import {
  insertLocationSchema,
  insertLedgerAccountSchema,
  insertEmployeeSchema,
  insertSupplierSchema,
  insertStockGroupSchema,
  insertStockItemSchema,
} from "@shared/schema";
import { useCompany } from "@/contexts/CompanyContext";
import { formatNumber } from "@/lib/formatNumber";

type EntityType =
  | "location"
  | "ledger"
  | "employee"
  | "supplier"
  | "stockGroup"
  | "stockItem";

const entityConfig = {
  location: {
    label: "Location",
    endpoint: "/api/locations",
    schema: insertLocationSchema,
  },
  ledger: {
    label: "Ledger Account",
    endpoint: "/api/ledger-accounts",
    schema: insertLedgerAccountSchema.omit({ companyId: true }),
  },
  employee: {
    label: "Employee",
    endpoint: "/api/employees",
    schema: insertEmployeeSchema.omit({ companyId: true }),
  },
  supplier: {
    label: "Supplier",
    endpoint: "/api/suppliers",
    schema: insertSupplierSchema,
  },
  stockGroup: {
    label: "Stock Group",
    endpoint: "/api/stock-groups",
    schema: insertStockGroupSchema.omit({ companyId: true }),
  },
  stockItem: {
    label: "Stock Item",
    endpoint: "/api/stock-items",
    schema: insertStockItemSchema.omit({ companyId: true }),
  },
};

// Get default values for each entity type
const getDefaultValues = (entityType: EntityType) => {
  switch (entityType) {
    case "location":
      return { name: "", code: "", active: true };
    case "ledger":
      return {
        name: "",
        accountType: "" as any,
        subType: "",
        parentId: undefined as any,
        openingBalance: "0",
        openingBalanceSide: "" as any,
        active: true,
      };

    case "employee":
      return {
        firstName: "",
        lastName: "",
        phone: "",
        joinDate: "",
        department: "",
        employeeType: "Employee" as any,
        openingBalance: "0",
        active: true,
      };

    case "supplier":
      return { legalName: "", phone: "", active: true };
    case "stockGroup":
      return { name: "", active: true };
    case "stockItem":
      return {
        name: "",
        uom: "",
        openingQty: "0",
        openingRate: "0",
        openingValue: "0",
        sellingPrice: "0",
        reorderLevel: "0",
        active: true,
      };
    default:
      return {};
  }
};

// Wrapper component to properly recreate form when entity changes
function EntityFormWrapper({
  entityType,
  config,
  onCreated,
}: {
  entityType: EntityType;
  config: (typeof entityConfig)[EntityType];
  onCreated?: () => void;
}) {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  const defaultValues = getDefaultValues(entityType);

  const form = useForm({
    resolver: zodResolver(config.schema),
    defaultValues: defaultValues as any,
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      // Only add companyId if not already provided by the form
      const payload = data.companyId
        ? data
        : {
            ...data,
            companyId:
              selectedCompany?.id ||
              (() => {
                throw new Error("No company selected");
              })(),
          };
      const res = await modeApiRequest("POST", config.endpoint, payload);
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Success",
        description: `${config.label} "${data.name || data.legalName || data.code}" created successfully`,
      });
      queryClient.invalidateQueries({ queryKey: [config.endpoint] });

      // invalidate by the companyId that the backend actually stored
      if (data?.companyId != null) {
        queryClient.invalidateQueries({
          queryKey: [config.endpoint, data.companyId],
        });
      } else if (selectedCompany?.id != null) {
        queryClient.invalidateQueries({
          queryKey: [config.endpoint, selectedCompany.id],
        });
      }

      form.reset(getDefaultValues(entityType) as any);
      onCreated?.();
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to create record",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: any) => {
    createMutation.mutate(data);
  };

  const handleCancel = () => {
    form.reset(getDefaultValues(entityType));
  };

  // Render appropriate form based on entity type
  switch (entityType) {
    case "location":
      return (
        <LocationForm
          form={form}
          onSubmit={onSubmit}
          onCancel={handleCancel}
          isPending={createMutation.isPending}
        />
      );
    case "ledger":
      return (
        <LedgerAccountForm
          form={form}
          onSubmit={onSubmit}
          onCancel={handleCancel}
          isPending={createMutation.isPending}
        />
      );
    case "employee":
      return (
        <EmployeeForm
          form={form}
          onSubmit={onSubmit}
          onCancel={handleCancel}
          isPending={createMutation.isPending}
        />
      );
    case "supplier":
      return (
        <SupplierForm
          form={form}
          onSubmit={onSubmit}
          onCancel={handleCancel}
          isPending={createMutation.isPending}
        />
      );
    case "stockGroup":
      return (
        <StockGroupForm
          form={form}
          onSubmit={onSubmit}
          onCancel={handleCancel}
          isPending={createMutation.isPending}
        />
      );
    case "stockItem":
      return (
        <StockItemForm
          form={form}
          onSubmit={onSubmit}
          onCancel={handleCancel}
          isPending={createMutation.isPending}
        />
      );
  }
}

interface SidebarItem {
  key: EntityType;
  label: string;
  icon: LucideIcon;
}

interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

export default function AccountingCreate() {
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [, navigate] = useLocation();
  const [selectedEntity, setSelectedEntity] = useState<EntityType>("location");
  const isFactory = appMode === "factory";
  const handleCreated = () => navigate(isFactory ? "/factory/accounts" : "/accounting");
  const config = entityConfig[selectedEntity];

  const sidebarGroups: SidebarGroup[] = [
    {
      label: "Accounts",
      items: [
        { key: "location", label: "Location", icon: MapPin },
        { key: "ledger", label: "Ledger", icon: BookOpen },
        { key: "employee", label: "Employee", icon: Users },
        { key: "supplier", label: "Supplier", icon: Truck },
      ],
    },
    {
      label: "Inventory",
      items: [
        { key: "stockGroup", label: "Stock Group", icon: FolderTree },
        { key: "stockItem", label: "Stock Item", icon: Package },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Create Master Data" />

      {/* Mobile entity selector */}
      <div className="md:hidden">
        <Select value={selectedEntity} onValueChange={(v) => setSelectedEntity(v as EntityType)}>
          <SelectTrigger className="w-full" data-testid="select-entity-mobile">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sidebarGroups.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SelectItem key={item.key} value={item.key}>
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-6">
        <nav className="hidden md:block w-56 shrink-0 space-y-4">
          {sidebarGroups.map((group) => (
            <div key={group.label}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">
                {group.label}
              </h3>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = selectedEntity === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => setSelectedEntity(item.key)}
                      data-testid={`tab-${item.key === "stockGroup" ? "stock-group" : item.key === "stockItem" ? "stock-item" : item.key}`}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors ${
                        isActive
                          ? "bg-background shadow-sm font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="flex-1 min-w-0">
          <EntityFormWrapper
            key={selectedEntity}
            entityType={selectedEntity}
            config={config}
            onCreated={handleCreated}
          />
        </div>
      </div>
    </div>
  );
}

// Location Form Component
function LocationForm({
  form,
  onSubmit,
  onCancel,
  isPending,
}: {
  form: any;
  onSubmit: (data: any, saveAndNew?: boolean) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const { data: companies = [] } = useQuery<any[]>({
    queryKey: ["/api/companies"],
  });

  return (
    <Card className="p-4 md:p-6">
      <Form {...form}>
        <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="companyId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company *</FormLabel>
                  <Select
                    onValueChange={(v) => field.onChange(parseInt(v))}
                    value={field.value?.toString() || ""}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-company">
                        <SelectValue placeholder="Select company" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {companies.map((company: any) => (
                        <SelectItem
                          key={company.id}
                          value={company.id.toString()}
                        >
                          {company.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Main Warehouse"
                      data-testid="input-name"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0 pt-8">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="checkbox-active"
                    />
                  </FormControl>
                  <FormLabel className="!mt-0">Active</FormLabel>
                </FormItem>
              )}
            />
          </div>

          <FormButtons onCancel={onCancel} isPending={isPending} />
        </form>
      </Form>
    </Card>
  );
}

// Ledger Account Form Component
function LedgerAccountForm({
  form,
  onSubmit,
  onCancel,
  isPending,
}: {
  form: any;
  onSubmit: (data: any, saveAndNew?: boolean) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const accountType = form.watch("accountType");
  const openingBalance = form.watch("openingBalance");
  const [isParentDialogOpen, setIsParentDialogOpen] = useState(false);

  // Get available subtypes based on account type
  const getSubTypes = () => {
    switch (accountType) {
      case "Income":
        return ["Direct Income", "Indirect Income"];
      case "Expense":
        return ["Direct Expense", "Indirect Expense"];
      case "Liability":
        return [
          "Current Liability",
          "Long-term Liability",
          "Loans Payable",
          "Output Tax",
          "Tax Payable",
        ];
      case "Asset":
        return ["Current Asset", "Fixed Asset", "Input Tax", "Tax Receivable"];
      default:
        return [];
    }
  };

  const subTypes = getSubTypes();

  // Fetch parent ledger accounts for dropdown
  const { data: allLedgerAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts"],
  });

  // Filter to show only parent accounts (accounts with no parent themselves)
  // Use strict comparison to handle 0, null, undefined correctly
  const ledgerAccounts = allLedgerAccounts.filter(
    (acc: any) => acc.parentId === null || acc.parentId === undefined,
  );

  // Form for creating parent account
  const parentForm = useForm({
    resolver: zodResolver(insertLedgerAccountSchema.omit({ companyId: true })),
    defaultValues: {
      code: "",
      name: "",
      accountType: "" as any,
      active: true,
    },
  });

  // Mutation for creating parent account
  const createParentMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!selectedCompany?.id) {
        throw new Error("No company selected");
      }
      const res = await modeApiRequest("POST", "/api/ledger-accounts", {
        ...data,
        companyId: selectedCompany.id,
      });
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Success",
        description: `Parent account "${data.name}" created successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      form.setValue("parentId", data.id);
      setIsParentDialogOpen(false);
      parentForm.reset({ name: "", accountType: "" as any, active: true });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to create parent account",
        variant: "destructive",
      });
    },
  });

  const handleCreateParent = (data: any) => {
    createParentMutation.mutate(data);
  };

  return (
    <Card className="p-4 md:p-6">
      <Form {...form}>
        <form noValidate
          onSubmit={form.handleSubmit((data: any) => onSubmit(data, false))}
          className="space-y-6"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Sales Revenue"
                      data-testid="input-name"
                    />
                  </FormControl>
                  <FormDescription>
                    Code will be auto-generated from the name
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="accountType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account Type *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ""}>
                    <FormControl>
                      <SelectTrigger data-testid="select-account-type">
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
                      <SelectItem value="Indirect Expense">
                        Indirect Expense
                      </SelectItem>
                      <SelectItem value="Direct Expense">
                        Direct Expense
                      </SelectItem>
                      <SelectItem value="Government Taxes">
                        Government Taxes
                      </SelectItem>
                      <SelectItem value="Loans">Loans</SelectItem>
                      <SelectItem value="Duty Agent">Duty Agent</SelectItem>
                      <SelectItem value="Transporter Agent">
                        Transporter Agent
                      </SelectItem>
                      <SelectItem value="Accounts Payable">
                        Accounts Payable
                      </SelectItem>
                      <SelectItem value="Profit">Profit</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {subTypes.length > 0 && (
              <FormField
                control={form.control}
                name="subType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sub Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl>
                        <SelectTrigger data-testid="select-sub-type">
                          <SelectValue placeholder="Select sub type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {subTypes.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
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
              control={form.control}
              name="parentId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Parent Account</FormLabel>
                  <div className="flex gap-2">
                    <Select
                      onValueChange={(v) =>
                        field.onChange(v === "none" ? undefined : parseInt(v))
                      }
                      value={field.value?.toString() || "none"}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-parent">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {ledgerAccounts.map((acc: any) => (
                          <SelectItem key={acc.id} value={acc.id.toString()}>
                            {acc.name} ({acc.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Dialog
                      open={isParentDialogOpen}
                      onOpenChange={setIsParentDialogOpen}
                    >
                      <DialogTrigger asChild>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          data-testid="button-add-parent"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="w-[95vw] max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>Create Parent Account</DialogTitle>
                        </DialogHeader>
                        <Form {...parentForm}>
                          <form noValidate
                            onSubmit={parentForm.handleSubmit(
                              handleCreateParent,
                            )}
                            className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <FormField
                                control={parentForm.control}
                                name="name"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Name *</FormLabel>
                                    <FormControl>
                                      <Input
                                        {...field}
                                        placeholder="Purchases"
                                        data-testid="input-parent-name"
                                      />
                                    </FormControl>
                                    <FormDescription>
                                      Code will be auto-generated
                                    </FormDescription>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={parentForm.control}
                                name="accountType"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Account Type *</FormLabel>
                                    <Select
                                      onValueChange={field.onChange}
                                      value={field.value}
                                    >
                                      <FormControl>
                                        <SelectTrigger data-testid="select-parent-account-type">
                                          <SelectValue placeholder="Select type" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        <SelectItem value="Asset">
                                          Asset
                                        </SelectItem>
                                        <SelectItem value="Liability">
                                          Liability
                                        </SelectItem>
                                        <SelectItem value="Equity">
                                          Equity
                                        </SelectItem>
                                        <SelectItem value="Income">
                                          Income
                                        </SelectItem>
                                        <SelectItem value="Expense">
                                          Expense
                                        </SelectItem>
                                        <SelectItem value="Bank">
                                          Bank
                                        </SelectItem>
                                        <SelectItem value="Cash">
                                          Cash
                                        </SelectItem>
                                        <SelectItem value="Indirect Expense">
                                          Indirect Expense
                                        </SelectItem>
                                        <SelectItem value="Direct Expense">
                                          Direct Expense
                                        </SelectItem>
                                        <SelectItem value="Government Taxes">
                                          Government Taxes
                                        </SelectItem>
                                        <SelectItem value="Loans">
                                          Loans
                                        </SelectItem>
                                        <SelectItem value="Duty Agent">
                                          Duty Agent
                                        </SelectItem>
                                        <SelectItem value="Transporter Agent">
                                          Transporter Agent
                                        </SelectItem>
                                        <SelectItem value="Accounts Payable">
                                          Accounts Payable
                                        </SelectItem>
                                        <SelectItem value="Profit">
                                          Profit
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>
                            <div className="flex flex-wrap gap-2 justify-end border-t pt-4">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => setIsParentDialogOpen(false)}
                                disabled={createParentMutation.isPending}
                                data-testid="button-cancel-parent"
                              >
                                Cancel
                              </Button>
                              <Button
                                type="submit"
                                disabled={createParentMutation.isPending}
                                data-testid="button-save-parent"
                              >
                                {createParentMutation.isPending
                                  ? "Creating..."
                                  : "Create"}
                              </Button>
                            </div>
                          </form>
                        </Form>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="openingBalance"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Opening Balance</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      data-testid="input-opening-balance"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {openingBalance && parseFloat(openingBalance) !== 0 && (
              <FormField
                control={form.control}
                name="openingBalanceSide"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dr/Cr Side</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl>
                        <SelectTrigger data-testid="select-balance-side">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Dr">Debit (Dr)</SelectItem>
                        <SelectItem value="Cr">Credit (Cr)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0 pt-8">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="checkbox-active"
                    />
                  </FormControl>
                  <FormLabel className="!mt-0">Active</FormLabel>
                </FormItem>
              )}
            />
          </div>

          <FormButtons onCancel={onCancel} isPending={isPending} />
        </form>
      </Form>
    </Card>
  );
}

// Employee Form Component
function EmployeeForm({
  form,
  onSubmit,
  onCancel,
  isPending,
}: {
  form: any;
  onSubmit: (data: any, saveAndNew?: boolean) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <Card className="p-4 md:p-6">
      <Form {...form}>
        <form noValidate
          onSubmit={form.handleSubmit((data: any) => onSubmit(data, false))}
          className="space-y-6"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>First Name *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="John"
                      data-testid="input-first-name"
                    />
                  </FormControl>
                  <FormDescription>
                    Code will be auto-generated from name
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="lastName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Last Name *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Doe"
                      data-testid="input-last-name"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="joinDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Starting Date *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="text"
                      placeholder="YYYY-MM-DD"
                      data-testid="input-join-date"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="employeeType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type *</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-employee-type">
                        <SelectValue placeholder="Select employee type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Employee">
                        Employee (Warehouse Staff)
                      </SelectItem>
                      <SelectItem value="Worker">
                        Worker (Shop Floor Staff)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="openingBalance"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Opening Balance</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      data-testid="input-opening-balance"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0 pt-8">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="checkbox-active"
                    />
                  </FormControl>
                  <FormLabel className="!mt-0">Active</FormLabel>
                </FormItem>
              )}
            />
          </div>

          <FormButtons onCancel={onCancel} isPending={isPending} />
        </form>
      </Form>
    </Card>
  );
}

// Supplier Form Component
function SupplierForm({
  form,
  onSubmit,
  onCancel,
  isPending,
}: {
  form: any;
  onSubmit: (data: any, saveAndNew?: boolean) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <Card className="p-4 md:p-6">
      <Form {...form}>
        <form noValidate
          onSubmit={form.handleSubmit((data: any) => onSubmit(data, false))}
          className="space-y-6"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="legalName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Legal Name *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="ABC Suppliers Inc."
                      data-testid="input-legal-name"
                    />
                  </FormControl>
                  <FormDescription>
                    Code will be auto-generated from name
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="openingBalance"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Opening Balance</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      data-testid="input-opening-balance"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0 pt-8">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="checkbox-active"
                    />
                  </FormControl>
                  <FormLabel className="!mt-0">Active</FormLabel>
                </FormItem>
              )}
            />
          </div>

          <FormButtons onCancel={onCancel} isPending={isPending} />
        </form>
      </Form>
    </Card>
  );
}

// Stock Group Form Component
function StockGroupForm({
  form,
  onSubmit,
  onCancel,
  isPending,
}: {
  form: any;
  onSubmit: (data: any, saveAndNew?: boolean) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <Card className="p-4 md:p-6">
      <Form {...form}>
        <form noValidate
          onSubmit={form.handleSubmit((data: any) => onSubmit(data, false))}
          className="space-y-6"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="GRP001"
                      data-testid="input-code"
                    />
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
                  <FormLabel>Name *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Cotton Bales"
                      data-testid="input-name"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0 pt-8">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="checkbox-active"
                    />
                  </FormControl>
                  <FormLabel className="!mt-0">Active</FormLabel>
                </FormItem>
              )}
            />
          </div>

          <FormButtons onCancel={onCancel} isPending={isPending} />
        </form>
      </Form>
    </Card>
  );
}

// Stock Item Form Component
function StockItemForm({
  form,
  onSubmit,
  onCancel,
  isPending,
}: {
  form: any;
  onSubmit: (data: any, saveAndNew?: boolean) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const { data: stockGroups = [] } = useQuery<any[]>({
    queryKey: ["/api/stock-groups"],
  });

  const openingQty = form.watch("openingQty");
  const openingRate = form.watch("openingRate");

  // Auto-calculate opening value
  useEffect(() => {
    if (openingQty && openingRate) {
      const value = formatNumber(
        parseFloat(openingQty) * parseFloat(openingRate),
      );
      form.setValue("openingValue", value);
    }
  }, [openingQty, openingRate]);

  return (
    <Card className="p-4 md:p-6">
      <Form {...form}>
        <form noValidate
          onSubmit={form.handleSubmit((data: any) => onSubmit(data, false))}
          className="space-y-6"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="ITEM001"
                      data-testid="input-code"
                    />
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
                  <FormLabel>Name *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Premium Cotton Bale"
                      data-testid="input-name"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="stockGroupId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stock Group</FormLabel>
                  <Select
                    onValueChange={(v) =>
                      field.onChange(v ? parseInt(v) : undefined)
                    }
                    value={field.value?.toString() || ""}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-stock-group">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {stockGroups.map((grp: any) => (
                        <SelectItem key={grp.id} value={grp.id.toString()}>
                          {grp.name} ({grp.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="uom"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Unit of Measure *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Kg, Pcs, Bale"
                      data-testid="input-uom"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="openingQty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Opening Quantity</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      step="0.001"
                      placeholder="0.000"
                      data-testid="input-opening-qty"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="openingRate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Opening Rate</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      data-testid="input-opening-rate"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="openingValue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Opening Value (Auto)</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      readOnly
                      className="bg-muted"
                      data-testid="input-opening-value"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reorderLevel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reorder Level</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      step="0.001"
                      placeholder="10.000"
                      data-testid="input-reorder-level"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sellingPrice"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Selling Price</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      data-testid="input-selling-price"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0 pt-8">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="checkbox-active"
                    />
                  </FormControl>
                  <FormLabel className="!mt-0">Active</FormLabel>
                </FormItem>
              )}
            />
          </div>

          <FormButtons onCancel={onCancel} isPending={isPending} />
        </form>
      </Form>
    </Card>
  );
}

// Reusable Form Buttons Component
function FormButtons({
  onCancel,
  isPending,
}: {
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2 justify-end border-t pt-4">
      <Button
        type="button"
        variant="outline"
        onClick={onCancel}
        disabled={isPending}
        data-testid="button-cancel"
      >
        Cancel
      </Button>
      <Button type="submit" disabled={isPending} data-testid="button-save">
        {isPending ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}
