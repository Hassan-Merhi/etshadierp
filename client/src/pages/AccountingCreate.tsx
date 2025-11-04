import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  SelectItem,
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus } from "lucide-react";
import {
  insertLocationSchema,
  insertLedgerAccountSchema,
  insertEmployeeSchema,
  insertSupplierSchema,
  insertStockGroupSchema,
  insertStockItemSchema,
} from "@shared/schema";
import { useCompany } from "@/contexts/CompanyContext";

type EntityType =
  | "location"
  | "ledger"
  | "employee"
  | "supplier"
  | "stockGroup"
  | "stockItem";

const entityConfig = {
  location: { label: "Location", endpoint: "/api/locations", schema: insertLocationSchema },
  ledger: { label: "Ledger Account", endpoint: "/api/ledger-accounts", schema: insertLedgerAccountSchema.omit({ companyId: true }) },
  employee: { label: "Employee", endpoint: "/api/employees", schema: insertEmployeeSchema.omit({ companyId: true }) },
  supplier: { label: "Supplier", endpoint: "/api/suppliers", schema: insertSupplierSchema },
  stockGroup: { label: "Stock Group", endpoint: "/api/stock-groups", schema: insertStockGroupSchema.omit({ companyId: true }) },
  stockItem: { label: "Stock Item", endpoint: "/api/stock-items", schema: insertStockItemSchema.omit({ companyId: true }) },
};

// Wrapper component to properly recreate form when entity changes
function EntityFormWrapper({ 
  entityType, 
  config,
}: { 
  entityType: EntityType; 
  config: typeof entityConfig[EntityType];
}) {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  
  const form = useForm({
    resolver: zodResolver(config.schema),
    defaultValues: {},
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      // Only add companyId if not already provided by the form
      const payload = data.companyId ? data : {
        ...data,
        companyId: selectedCompany?.id || (() => { throw new Error("No company selected"); })()
      };
      const res = await apiRequest("POST", config.endpoint, payload);
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Success",
        description: `${config.label} "${data.name || data.legalName || data.code}" created successfully`,
      });
      queryClient.invalidateQueries({ queryKey: [config.endpoint] });
      queryClient.invalidateQueries({ queryKey: [config.endpoint, selectedCompany?.id] });
      form.reset({});
    },
    onError: (error: any) => {
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
    form.reset({});
  };

  // Render appropriate form based on entity type
  switch (entityType) {
    case "location":
      return <LocationForm form={form} onSubmit={onSubmit} onCancel={handleCancel} isPending={createMutation.isPending} />;
    case "ledger":
      return <LedgerAccountForm form={form} onSubmit={onSubmit} onCancel={handleCancel} isPending={createMutation.isPending} />;
    case "employee":
      return <EmployeeForm form={form} onSubmit={onSubmit} onCancel={handleCancel} isPending={createMutation.isPending} />;
    case "supplier":
      return <SupplierForm form={form} onSubmit={onSubmit} onCancel={handleCancel} isPending={createMutation.isPending} />;
    case "stockGroup":
      return <StockGroupForm form={form} onSubmit={onSubmit} onCancel={handleCancel} isPending={createMutation.isPending} />;
    case "stockItem":
      return <StockItemForm form={form} onSubmit={onSubmit} onCancel={handleCancel} isPending={createMutation.isPending} />;
  }
}

export default function AccountingCreate() {
  const [selectedEntity, setSelectedEntity] = useState<EntityType>("location");
  const config = entityConfig[selectedEntity];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Create Master Data</h1>

      <Tabs value={selectedEntity} onValueChange={(v) => setSelectedEntity(v as EntityType)}>
        <TabsList className="grid grid-cols-3 lg:grid-cols-6">
          <TabsTrigger value="location" data-testid="tab-location">Location</TabsTrigger>
          <TabsTrigger value="ledger" data-testid="tab-ledger">Ledger</TabsTrigger>
          <TabsTrigger value="employee" data-testid="tab-employee">Employee</TabsTrigger>
          <TabsTrigger value="supplier" data-testid="tab-supplier">Supplier</TabsTrigger>
          <TabsTrigger value="stockGroup" data-testid="tab-stock-group">Stock Group</TabsTrigger>
          <TabsTrigger value="stockItem" data-testid="tab-stock-item">Stock Item</TabsTrigger>
        </TabsList>

        <TabsContent value={selectedEntity}>
          <EntityFormWrapper key={selectedEntity} entityType={selectedEntity} config={config} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Location Form Component
function LocationForm({ form, onSubmit, onCancel, isPending }: { form: any; onSubmit: (data: any, saveAndNew?: boolean) => void; onCancel: () => void; isPending: boolean }) {
  const { data: companies = [] } = useQuery<any[]>({
    queryKey: ["/api/companies"],
  });
  
  return (
    <Card className="p-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
                        <SelectItem key={company.id} value={company.id.toString()}>
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
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="LOC001" data-testid="input-code" />
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
                    <Input {...field} placeholder="Main Warehouse" data-testid="input-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="city"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>City</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="New York" data-testid="input-city" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="state"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>State</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="NY" data-testid="input-state" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="country"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Country</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="USA" data-testid="input-country" />
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
function LedgerAccountForm({ form, onSubmit, onCancel, isPending }: { form: any; onSubmit: (data: any, saveAndNew?: boolean) => void; onCancel: () => void; isPending: boolean }) {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
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
        return ["Current Liability", "Long-term Liability", "Loans Payable", "Output Tax", "Tax Payable"];
      case "Asset":
        return ["Current Asset", "Fixed Asset", "Input Tax", "Tax Receivable"];
      default:
        return [];
    }
  };

  const subTypes = getSubTypes();

  // Fetch parent ledger accounts for dropdown
  const { data: ledgerAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts"],
  });

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
      const res = await apiRequest("POST", "/api/ledger-accounts", { ...data, companyId: selectedCompany.id });
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
    <Card className="p-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit((data: any) => onSubmit(data, false))} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Sales Revenue" data-testid="input-name" />
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
                  <Select onValueChange={field.onChange} value={field.value}>
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

            {subTypes.length > 0 && (
              <FormField
                control={form.control}
                name="subType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sub Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
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
                    <Select onValueChange={(v) => field.onChange(v ? parseInt(v) : undefined)} value={field.value?.toString() || ""}>
                      <FormControl>
                        <SelectTrigger data-testid="select-parent">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ledgerAccounts.map((acc: any) => (
                          <SelectItem key={acc.id} value={acc.id.toString()}>
                            {acc.name} ({acc.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Dialog open={isParentDialogOpen} onOpenChange={setIsParentDialogOpen}>
                      <DialogTrigger asChild>
                        <Button type="button" size="icon" variant="outline" data-testid="button-add-parent">
                          <Plus className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>Create Parent Account</DialogTitle>
                        </DialogHeader>
                        <Form {...parentForm}>
                          <form onSubmit={parentForm.handleSubmit(handleCreateParent)} className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <FormField
                                control={parentForm.control}
                                name="name"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Name *</FormLabel>
                                    <FormControl>
                                      <Input {...field} placeholder="Purchases" data-testid="input-parent-name" />
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
                                    <Select onValueChange={field.onChange} value={field.value}>
                                      <FormControl>
                                        <SelectTrigger data-testid="select-parent-account-type">
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
                            </div>
                            <div className="flex gap-2 justify-end border-t pt-4">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => setIsParentDialogOpen(false)}
                                disabled={createParentMutation.isPending}
                                data-testid="button-cancel-parent"
                              >
                                Cancel
                              </Button>
                              <Button type="submit" disabled={createParentMutation.isPending} data-testid="button-save-parent">
                                {createParentMutation.isPending ? "Creating..." : "Create"}
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
                    <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-opening-balance" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {openingBalance && parseFloat(openingBalance) > 0 && (
              <FormField
                control={form.control}
                name="openingBalanceSide"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dr/Cr Side *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
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
function EmployeeForm({ form, onSubmit, onCancel, isPending }: { form: any; onSubmit: (data: any, saveAndNew?: boolean) => void; onCancel: () => void; isPending: boolean }) {
  return (
    <Card className="p-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit((data: any) => onSubmit(data, false))} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>First Name *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="John" data-testid="input-first-name" />
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
                    <Input {...field} placeholder="Doe" data-testid="input-last-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="+1 234 567 8900" data-testid="input-phone" />
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
                    <Input {...field} type="text" placeholder="YYYY-MM-DD" data-testid="input-join-date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="department"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Department</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Sales" data-testid="input-department" />
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
                  <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-employee-type">
                        <SelectValue placeholder="Select employee type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Employee">Employee (Warehouse Staff)</SelectItem>
                      <SelectItem value="Worker">Worker (Shop Floor Staff)</SelectItem>
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
                    <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-opening-balance" />
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
function SupplierForm({ form, onSubmit, onCancel, isPending }: { form: any; onSubmit: (data: any, saveAndNew?: boolean) => void; onCancel: () => void; isPending: boolean }) {
  return (
    <Card className="p-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit((data: any) => onSubmit(data, false))} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="SUP001" data-testid="input-code" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="legalName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Legal Name *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="ABC Suppliers Inc." data-testid="input-legal-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email *</FormLabel>
                  <FormControl>
                    <Input {...field} type="email" placeholder="contact@supplier.com" data-testid="input-email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="+1 234 567 8900" data-testid="input-phone" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="123 Business St, City, State" data-testid="input-address" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="taxId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tax ID (GST/VAT)</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="GST123456" data-testid="input-tax-id" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="paymentTerms"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Terms</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Net 30" data-testid="input-payment-terms" />
                  </FormControl>
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
                    <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-opening-balance" />
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
function StockGroupForm({ form, onSubmit, onCancel, isPending }: { form: any; onSubmit: (data: any, saveAndNew?: boolean) => void; onCancel: () => void; isPending: boolean }) {
  return (
    <Card className="p-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit((data: any) => onSubmit(data, false))} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="GRP001" data-testid="input-code" />
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
                    <Input {...field} placeholder="Cotton Bales" data-testid="input-name" />
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
function StockItemForm({ form, onSubmit, onCancel, isPending }: { form: any; onSubmit: (data: any, saveAndNew?: boolean) => void; onCancel: () => void; isPending: boolean }) {
  const { data: stockGroups = [] } = useQuery<any[]>({
    queryKey: ["/api/stock-groups"],
  });

  const openingQty = form.watch("openingQty");
  const openingRate = form.watch("openingRate");

  // Auto-calculate opening value
  useEffect(() => {
    if (openingQty && openingRate) {
      const value = (parseFloat(openingQty) * parseFloat(openingRate)).toFixed(2);
      form.setValue("openingValue", value);
    }
  }, [openingQty, openingRate]);

  return (
    <Card className="p-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit((data: any) => onSubmit(data, false))} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="ITEM001" data-testid="input-code" />
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
                    <Input {...field} placeholder="Premium Cotton Bale" data-testid="input-name" />
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
                  <Select onValueChange={(v) => field.onChange(v ? parseInt(v) : undefined)} value={field.value?.toString() || ""}>
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
                    <Input {...field} placeholder="Kg, Pcs, Bale" data-testid="input-uom" />
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
                    <Input {...field} type="number" step="0.001" placeholder="0.000" data-testid="input-opening-qty" />
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
                    <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-opening-rate" />
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
                    <Input {...field} readOnly className="bg-muted" data-testid="input-opening-value" />
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
                    <Input {...field} type="number" step="0.001" placeholder="10.000" data-testid="input-reorder-level" />
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
                    <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-selling-price" />
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
function FormButtons({ onCancel, isPending }: { onCancel: () => void; isPending: boolean }) {
  return (
    <div className="flex gap-2 justify-end border-t pt-4">
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
