import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useCompany } from "@/contexts/CompanyContext";
import type { Employee } from "@shared/schema";

export default function Payroll() {
  const [selectedTab, setSelectedTab] = useState("employees");
  const { selectedCompany } = useCompany();

  const { data: employees, isLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
    enabled: !!selectedCompany,
  });

  const employeeStaff = employees?.filter((emp) => emp.employeeType === "Employee") || [];
  const workerStaff = employees?.filter((emp) => emp.employeeType === "Worker") || [];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Payroll</h1>
        <Card className="p-6">
          <Skeleton className="h-[400px] w-full" />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Payroll</h1>

      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid grid-cols-2 w-[400px]">
          <TabsTrigger value="employees" data-testid="tab-employees">
            Employees ({employeeStaff.length})
          </TabsTrigger>
          <TabsTrigger value="workers" data-testid="tab-workers">
            Workers ({workerStaff.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="employees">
          <Card className="p-6">
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Warehouse Staff (Employees)</h2>
                <p className="text-sm text-muted-foreground">
                  Employees who manage warehouse operations, inventory, and administration
                </p>
              </div>

              {employeeStaff.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No employees found</p>
                  <p className="text-sm mt-2">Create employees from the Create Master Data page</p>
                </div>
              ) : (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead data-testid="header-code">Code</TableHead>
                        <TableHead data-testid="header-name">Name</TableHead>
                        <TableHead data-testid="header-email">Email</TableHead>
                        <TableHead data-testid="header-phone">Phone</TableHead>
                        <TableHead data-testid="header-department">Department</TableHead>
                        <TableHead data-testid="header-join-date">Join Date</TableHead>
                        <TableHead data-testid="header-status">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employeeStaff.map((employee) => (
                        <TableRow key={employee.id} data-testid={`row-employee-${employee.id}`}>
                          <TableCell data-testid={`cell-code-${employee.id}`}>
                            {employee.code}
                          </TableCell>
                          <TableCell data-testid={`cell-name-${employee.id}`}>
                            {employee.firstName} {employee.lastName}
                          </TableCell>
                          <TableCell data-testid={`cell-email-${employee.id}`}>
                            {employee.email}
                          </TableCell>
                          <TableCell data-testid={`cell-phone-${employee.id}`}>
                            {employee.phone || "-"}
                          </TableCell>
                          <TableCell data-testid={`cell-department-${employee.id}`}>
                            {employee.department || "-"}
                          </TableCell>
                          <TableCell data-testid={`cell-join-date-${employee.id}`}>
                            {new Date(employee.joinDate).toLocaleDateString()}
                          </TableCell>
                          <TableCell data-testid={`cell-status-${employee.id}`}>
                            <Badge variant={employee.active ? "default" : "secondary"}>
                              {employee.active ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="workers">
          <Card className="p-6">
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Shop Floor Staff (Workers)</h2>
                <p className="text-sm text-muted-foreground">
                  Workers who handle physical tasks like moving bales and assisting customers
                </p>
              </div>

              {workerStaff.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No workers found</p>
                  <p className="text-sm mt-2">Create workers from the Create Master Data page</p>
                </div>
              ) : (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead data-testid="header-code">Code</TableHead>
                        <TableHead data-testid="header-name">Name</TableHead>
                        <TableHead data-testid="header-email">Email</TableHead>
                        <TableHead data-testid="header-phone">Phone</TableHead>
                        <TableHead data-testid="header-department">Department</TableHead>
                        <TableHead data-testid="header-join-date">Join Date</TableHead>
                        <TableHead data-testid="header-status">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {workerStaff.map((worker) => (
                        <TableRow key={worker.id} data-testid={`row-worker-${worker.id}`}>
                          <TableCell data-testid={`cell-code-${worker.id}`}>
                            {worker.code}
                          </TableCell>
                          <TableCell data-testid={`cell-name-${worker.id}`}>
                            {worker.firstName} {worker.lastName}
                          </TableCell>
                          <TableCell data-testid={`cell-email-${worker.id}`}>
                            {worker.email}
                          </TableCell>
                          <TableCell data-testid={`cell-phone-${worker.id}`}>
                            {worker.phone || "-"}
                          </TableCell>
                          <TableCell data-testid={`cell-department-${worker.id}`}>
                            {worker.department || "-"}
                          </TableCell>
                          <TableCell data-testid={`cell-join-date-${worker.id}`}>
                            {new Date(worker.joinDate).toLocaleDateString()}
                          </TableCell>
                          <TableCell data-testid={`cell-status-${worker.id}`}>
                            <Badge variant={worker.active ? "default" : "secondary"}>
                              {worker.active ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
