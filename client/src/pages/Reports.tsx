import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Download } from "lucide-react";

const reportTypes = [
  { title: "Profit & Loss Statement", description: "View income and expenses summary" },
  { title: "Balance Sheet", description: "Assets, liabilities, and equity overview" },
  { title: "Ratio Analysis", description: "Financial ratios and performance metrics" },
  { title: "Sales Report", description: "Detailed sales analysis by period" },
  { title: "Stock Movement", description: "Track inventory changes across locations" },
  { title: "Container Report", description: "Container arrival and offloading status" },
];

export default function Reports() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reports & Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate and download comprehensive business reports
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reportTypes.map((report, index) => (
          <Card
            key={index}
            className="p-6 hover-elevate cursor-pointer"
            data-testid={`card-report-${index}`}
          >
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 flex-shrink-0">
                <FileText className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold mb-1">{report.title}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {report.description}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  onClick={() => console.log(`Generating ${report.title}`)}
                  data-testid={`button-generate-${index}`}
                >
                  <Download className="h-3 w-3" />
                  Generate
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-6">
        <h3 className="text-lg font-medium mb-4">Sample: Profit & Loss Statement</h3>
        <div className="max-w-3xl">
          <div className="space-y-2 mb-4">
            <div className="flex justify-between py-2">
              <span className="font-medium">Revenue</span>
              <span className="font-mono font-semibold">$328,500</span>
            </div>
            <div className="flex justify-between py-2 text-sm">
              <span className="text-muted-foreground ml-4">Sales</span>
              <span className="font-mono">$328,500</span>
            </div>
          </div>

          <div className="space-y-2 mb-4 border-t pt-4">
            <div className="flex justify-between py-2">
              <span className="font-medium">Expenses</span>
              <span className="font-mono font-semibold">$232,500</span>
            </div>
            <div className="flex justify-between py-2 text-sm">
              <span className="text-muted-foreground ml-4">Cost of Goods</span>
              <span className="font-mono">$142,000</span>
            </div>
            <div className="flex justify-between py-2 text-sm">
              <span className="text-muted-foreground ml-4">Operating Expenses</span>
              <span className="font-mono">$90,500</span>
            </div>
          </div>

          <div className="border-t-2 pt-4">
            <div className="flex justify-between py-2">
              <span className="text-lg font-bold">Net Profit</span>
              <span className="text-lg font-bold font-mono text-chart-2">
                $96,000
              </span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
