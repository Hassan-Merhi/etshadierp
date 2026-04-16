import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";
import type { FactoryCategory } from "@shared/schema";

const formSchema = z.object({
  grade: z.string().min(1, "Grade is required"),
  name: z.string().min(1, "Product name is required"),
  categoryId: z.string().optional(),
  weightPerBaleKg: z.string().optional(),
  description: z.string().optional(),
});

interface CreateBaleProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adminAuth?: { username: string; password: string } | null;
  onClose?: () => void;
}

export function CreateBaleProductDialog({
  open,
  onOpenChange,
  adminAuth,
  onClose,
}: CreateBaleProductDialogProps) {
  const { toast } = useToast();

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
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      const body: any = { name: data.name.trim(), grade: data.grade };
      if (data.categoryId && data.categoryId !== "none") body.categoryId = parseInt(data.categoryId);
      if (data.weightPerBaleKg) body.weightPerBaleKg = data.weightPerBaleKg;
      if (data.description) body.description = data.description;
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Bale Product</DialogTitle>
          <DialogDescription>
            Select a grade to auto-generate the article code.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
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

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Product Name *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="e.g., T-Shirt Mix Grade A"
                      data-testid="input-name"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                        {categories?.filter(c => c.isActive).map((cat) => (
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
                      <Input
                        {...field}
                        placeholder="e.g., 45"
                        type="number"
                        step="0.01"
                        data-testid="input-weight"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Product details..."
                      data-testid="input-description"
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
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                data-testid="button-submit"
              >
                {createMutation.isPending ? "Creating..." : "Create Product"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
