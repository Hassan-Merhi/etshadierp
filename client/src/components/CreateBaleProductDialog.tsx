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
  FormDescription,
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
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { BaleProductCategory } from "@shared/schema";

const formSchema = z.object({
  articleCode: z.string().min(1, "Article code is required"),
  name: z.string().min(1, "Product name is required"),
  description: z.string().optional(),
  itemNumber: z.string().optional(),
  categoryId: z.string().optional(),
  weightPerBaleKg: z.string().optional(),
});

interface CreateBaleProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateBaleProductDialog({
  open,
  onOpenChange,
}: CreateBaleProductDialogProps) {
  const { toast } = useToast();

  const { data: categories } = useQuery<BaleProductCategory[]>({
    queryKey: ["/api/bale-product-categories"],
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      articleCode: "",
      name: "",
      description: "",
      itemNumber: "",
      categoryId: "",
      weightPerBaleKg: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      let articleCode = data.articleCode;
      if (!articleCode && data.itemNumber) {
        const num = parseInt(data.itemNumber);
        if (!isNaN(num) && num >= 1 && num <= 99) {
          articleCode = `HMD${String(num).padStart(2, "0")}000`;
        }
      }
      const categoryId = data.categoryId && data.categoryId !== "none" ? parseInt(data.categoryId) : undefined;
      const response = await apiRequest("POST", "/api/bale-products", {
        articleCode,
        name: data.name,
        description: data.description,
        categoryId: categoryId || undefined,
        weightPerBaleKg: data.weightPerBaleKg || undefined,
      });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bale-products"] });
      toast({
        title: "Success",
        description: "Product created successfully",
      });
      form.reset();
      onOpenChange(false);
    },
    onError: (error: Error) => {
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
            Add a new product type that can be assigned to bales
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="articleCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Article Code *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="e.g., HMD01000"
                      className="font-mono"
                      data-testid="input-article-code"
                    />
                  </FormControl>
                  <FormDescription>
                    Unique identifier for this product type
                  </FormDescription>
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
