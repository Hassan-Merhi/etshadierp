import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Edit, Building2, Users } from "lucide-react";
import { insertUserSchema, insertCompanySchema } from "@shared/schema";

const userFormSchema = insertUserSchema;
const companyFormSchema = insertCompanySchema;

type UserFormData = z.infer<typeof userFormSchema>;
type CompanyFormData = z.infer<typeof companyFormSchema>;

export default function Settings() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [isCompanyDialogOpen, setIsCompanyDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<any>(null);

  const { data: companies = [], isLoading: isLoadingCompanies } = useQuery<any[]>({
    queryKey: ["/api/companies"],
  });

  const { data: users = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/users"],
  });

  const companyForm = useForm<CompanyFormData>({
    resolver: zodResolver(companyFormSchema),
    defaultValues: {
      name: "",
      code: "",
      active: true,
    },
  });

  const form = useForm<UserFormData>({
    resolver: zodResolver(userFormSchema),
    defaultValues: {
      username: "",
      password: "",
      active: true,
    },
  });

  const createCompanyMutation = useMutation({
    mutationFn: async (data: CompanyFormData) => {
      if (editingCompany) {
        const res = await apiRequest("PATCH", `/api/companies/${editingCompany.id}`, data);
        return await res.json();
      } else {
        const res = await apiRequest("POST", "/api/companies", data);
        return await res.json();
      }
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: editingCompany ? "Company updated successfully" : "Company created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setIsCompanyDialogOpen(false);
      setEditingCompany(null);
      companyForm.reset({
        name: "",
        code: "",
        active: true,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save company",
        variant: "destructive",
      });
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async (data: UserFormData) => {
      if (editingUser) {
        const res = await apiRequest("PATCH", `/api/users/${editingUser.id}`, data);
        return await res.json();
      } else {
        const res = await apiRequest("POST", "/api/users", data);
        return await res.json();
      }
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: editingUser ? "User updated successfully" : "User created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsDialogOpen(false);
      setEditingUser(null);
      form.reset({
        username: "",
        password: "",
        active: true,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save user",
        variant: "destructive",
      });
    },
  });

  const handleEditCompany = (company: any) => {
    setEditingCompany(company);
    companyForm.reset({
      name: company.name,
      code: company.code,
      active: company.active,
    });
    setIsCompanyDialogOpen(true);
  };

  const handleEdit = (user: any) => {
    setEditingUser(user);
    form.reset({
      username: user.username,
      password: "",
      active: user.active,
    });
    setIsDialogOpen(true);
  };

  const handleSubmitCompany = (data: CompanyFormData) => {
    createCompanyMutation.mutate(data);
  };

  const handleSubmit = (data: UserFormData) => {
    // If editing and password is empty, remove it from the update
    if (editingUser && !data.password) {
      const { password, ...dataWithoutPassword } = data;
      createUserMutation.mutate(dataWithoutPassword as UserFormData);
    } else {
      createUserMutation.mutate(data);
    }
  };

  return (
    <div className="space-y-8">
      {/* Companies Management Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            <h2 className="text-2xl font-semibold">Company Management</h2>
          </div>
          <Dialog open={isCompanyDialogOpen} onOpenChange={setIsCompanyDialogOpen}>
            <DialogTrigger asChild>
              <Button
                onClick={() => {
                  setEditingCompany(null);
                  companyForm.reset({
                    name: "",
                    code: "",
                    active: true,
                  });
                }}
                data-testid="button-add-company"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Company
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{editingCompany ? "Edit Company" : "Create New Company"}</DialogTitle>
              </DialogHeader>
              <Form {...companyForm}>
                <form onSubmit={companyForm.handleSubmit(handleSubmitCompany)} className="space-y-4">
                  <FormField
                    control={companyForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company Name *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="ABC Textiles Inc."
                            data-testid="input-company-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={companyForm.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company Code *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="ABC"
                            data-testid="input-company-code"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={companyForm.control}
                    name="active"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="checkbox-company-active"
                          />
                        </FormControl>
                        <FormLabel className="!mt-0">Active</FormLabel>
                      </FormItem>
                    )}
                  />

                  <div className="flex gap-2 justify-end border-t pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setIsCompanyDialogOpen(false);
                        setEditingCompany(null);
                      }}
                      disabled={createCompanyMutation.isPending}
                      data-testid="button-cancel-company"
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={createCompanyMutation.isPending} data-testid="button-save-company">
                      {createCompanyMutation.isPending ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="p-6">
          {isLoadingCompanies ? (
            <p className="text-center text-muted-foreground">Loading companies...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((company: any) => (
                  <TableRow key={company.id}>
                    <TableCell className="font-medium" data-testid={`text-company-name-${company.id}`}>
                      {company.name}
                    </TableCell>
                    <TableCell data-testid={`text-company-code-${company.id}`}>{company.code}</TableCell>
                    <TableCell data-testid={`text-company-status-${company.id}`}>
                      {company.active ? "Active" : "Inactive"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEditCompany(company)}
                        data-testid={`button-edit-company-${company.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      {/* User Management Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            <h2 className="text-2xl font-semibold">User Management</h2>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button
                onClick={() => {
                  setEditingUser(null);
                  form.reset({
                    username: "",
                    password: "",
                    active: true,
                  });
                }}
                data-testid="button-add-user"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add User
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{editingUser ? "Edit User" : "Create New User"}</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="john.doe"
                            data-testid="input-username"
                            disabled={!!editingUser}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Password {!editingUser && "*"}
                          {editingUser && " (leave blank to keep current)"}
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            placeholder={editingUser ? "Leave blank to keep current" : "Enter password"}
                            data-testid="input-password"
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
                      <FormItem className="flex items-center gap-2 space-y-0">
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

                  <div className="flex gap-2 justify-end border-t pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setIsDialogOpen(false);
                        setEditingUser(null);
                      }}
                      disabled={createUserMutation.isPending}
                      data-testid="button-cancel"
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={createUserMutation.isPending} data-testid="button-save">
                      {createUserMutation.isPending ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="p-6">
          {isLoading ? (
            <p className="text-center text-muted-foreground">Loading users...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user: any) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium" data-testid={`text-username-${user.id}`}>
                      {user.username}
                    </TableCell>
                    <TableCell data-testid={`text-status-${user.id}`}>
                      {user.active ? "Active" : "Inactive"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEdit(user)}
                        data-testid={`button-edit-${user.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      <p className="text-sm text-muted-foreground">
        Note: User role assignments per company can be configured in the next section (coming soon).
      </p>
    </div>
  );
}
