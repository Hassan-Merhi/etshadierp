import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, FileText } from "lucide-react";

//todo: remove mock functionality
const voucherData = [
  { id: "1", type: "Payment", date: "2024-10-27", amount: 12500, description: "Container duties payment" },
  { id: "2", type: "Receipt", date: "2024-10-26", amount: 45000, description: "Sales receipt - Batch #234" },
  { id: "3", type: "Journal", date: "2024-10-25", amount: 3200, description: "Transport cost allocation" },
];

const expenseData = [
  { category: "Duties & Taxes", amount: 28500 },
  { category: "Transport", amount: 15200 },
  { category: "Utilities", amount: 4800 },
  { category: "Salaries", amount: 42000 },
];

export default function Financial() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Financial Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage vouchers, expenses, and financial records
          </p>
        </div>
        <Button className="gap-2" data-testid="button-add-voucher">
          <Plus className="h-4 w-4" />
          Add Voucher
        </Button>
      </div>

      <Tabs defaultValue="vouchers">
        <TabsList>
          <TabsTrigger value="vouchers" data-testid="tab-vouchers">
            Vouchers
          </TabsTrigger>
          <TabsTrigger value="expenses" data-testid="tab-expenses">
            Expenses
          </TabsTrigger>
          <TabsTrigger value="daybook" data-testid="tab-daybook">
            Daybook
          </TabsTrigger>
        </TabsList>

        <TabsContent value="vouchers" className="space-y-4">
          <Card className="p-4">
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="h-12">
                    <th className="text-left px-4 font-medium">Date</th>
                    <th className="text-left px-4 font-medium">Type</th>
                    <th className="text-left px-4 font-medium">Description</th>
                    <th className="text-right px-4 font-medium">Amount</th>
                    <th className="text-center px-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {voucherData.map((voucher) => (
                    <tr
                      key={voucher.id}
                      className="h-14 border-t hover-elevate"
                      data-testid={`row-voucher-${voucher.id}`}
                    >
                      <td className="px-4 font-mono text-muted-foreground">
                        {voucher.date}
                      </td>
                      <td className="px-4 font-medium">{voucher.type}</td>
                      <td className="px-4">{voucher.description}</td>
                      <td className="px-4 text-right font-mono font-medium">
                        ${voucher.amount.toLocaleString()}
                      </td>
                      <td className="px-4 text-center">
                        <Button variant="ghost" size="sm" data-testid={`button-view-${voucher.id}`}>
                          <FileText className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="expenses" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-medium mb-4">Expense Breakdown</h3>
            <div className="space-y-3">
              {expenseData.map((expense, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 border rounded-md"
                  data-testid={`expense-${index}`}
                >
                  <span className="text-sm font-medium">{expense.category}</span>
                  <span className="text-sm font-mono font-semibold">
                    ${expense.amount.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t mt-4 pt-4 flex justify-between">
              <span className="font-semibold">Total Expenses</span>
              <span className="text-lg font-bold font-mono">
                ${expenseData.reduce((sum, e) => sum + e.amount, 0).toLocaleString()}
              </span>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="daybook" className="space-y-4">
          <Card className="p-6">
            <p className="text-sm text-muted-foreground text-center py-8">
              Daybook entries will be displayed here
            </p>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
