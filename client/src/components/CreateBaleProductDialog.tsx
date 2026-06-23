import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Palette } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";
import { useLabelDesignColors } from "@/hooks/useLabelDesignColors";
import type { FactoryCategory } from "@shared/schema";

const formSchema = z.object({
  grade: z.string().min(1, "Grade is required"),
  name: z.string().min(1, "Product name is required"),
  categoryId: z.string().optional(),
  weightPerBaleKg: z.string().optional(),
  description: z.string().optional(),
  productionPrice: z.string().optional(),
  sellingPrice: z.string().optional(),
  labelDesignColor: z.string().optional(),
});

interface CreateBaleProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adminAuth?: { username: string; password: string } | null;
  onClose?: () => void;
}

export function CreateBaleProductDialog({ open, onOpenChange, adminAuth, onClose }: CreateBaleProductDialogProps) {
  const { toast } = useToast();
  const { colors } = useLabelDesignColors();

  const { data: categories } = useQuery<FactoryCategory[]>({
    queryKey: ["/api/factory/categories"],
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      grade: "",
      name: "",
      categoryId: "",
      weightPerBaleKg: "",
      description: "",
      productionPrice: "",
      sellingPrice: "",
      labelDesignColor: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      const body: any = { name: data.name.trim(), grade: data.grade };
      if (data.categoryId && data.categoryId !== "none") body.categoryId = parseInt(data.categoryId);
      if (data.weightPerBaleKg) body.weightPerBaleKg = data.weightPerBaleKg;
      if (data.description) body.description = data.description;
      if (data.productionPrice) body.productionPrice = data.productionPrice;
      if (data.sellingPrice) body.sellingPrice = data.sellingPrice;
      if (data.labelDesignColor) body.labelDesignColor = data.labelDesignColor;
      if (adminAuth) body.adminAuth = adminAuth;
      const response = await factoryApiRequest("POST", "/api/factory/bale-products", body);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to create product");
      }
      return await response.json();
    },
    onSuccess: (product: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bale-products"] });
      toast({
        title: "Product Created",
        description: `"${product.name}" created with article code ${product.articleCode}`,
      });
      form.reset();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    createMutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Bale Product</DialogTitle>
          <DialogDescription>Select a grade to auto-generate the article code.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            {/* Grade */}
            <FormField
              control={form.control}
              name="grade"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Grade *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-create-grade">
                        <SelectValue placeholder="Select grade..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="#1">#1 (HMD11...)</SelectItem>
                      <SelectItem value="#2">#2 (HMD12...)</SelectItem>
                      <SelectItem value="#3">#3 (HMD13...)</SelectItem>
                      <SelectItem value="#4">#4 (HMD14...)</SelectItem>
                      <SelectItem value="CREAM">CREAM (HMD10...)</SelectItem>
                      <SelectItem value="Garbage">Garbage (HMD16...)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Product Name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Product Name *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., T-Shirt Mix Grade A" data-testid="input-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Category + Weight */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-category">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Uncategorized</SelectItem>
                        {categories
                          ?.filter((c) => c.isActive)
                          .map((cat) => (
                            <SelectItem key={cat.id} value={String(cat.id)}>
                              {cat.name}
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
                name="weightPerBaleKg"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Weight/Bale (kg)</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., 45" type="number" step="0.01" data-testid="input-weight" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Production Price + Selling Price */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="productionPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prod. Price</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., 80"
                        type="number"
                        step="0.01"
                        min="0"
                        data-testid="input-production-price"
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
                    <FormLabel>Sell Price</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., 120"
                        type="number"
                        step="0.01"
                        min="0"
                        data-testid="input-selling-price"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Description */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (Optional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Product details..." data-testid="input-description" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Label Design Color */}
            <FormField
              control={form.control}
              name="labelDesignColor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5">
                    <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                    Label Design Color
                  </FormLabel>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      data-testid="button-label-color-none"
                      onClick={() => field.onChange("")}
                      className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${!field.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover-elevate"}`}
                    >
                      No Design
                    </button>
                    {colors.map((opt) => (
                      <button
                        type="button"
                        key={opt.value}
                        data-testid={`button-label-color-${opt.value}`}
                        onClick={() => field.onChange(opt.value)}
                        className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${field.value === opt.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover-elevate"}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {field.value && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Labels will print with the{" "}
                      <span className="font-medium">{colors.find((o) => o.value === field.value)?.label}</span> design
                      automatically.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel">
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit">
                {createMutation.isPending ? "Creating..." : "Create Product"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
