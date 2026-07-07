import { Truck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Container } from "@shared/schema";

interface OtwEmptyStateProps {
  otwContainers: Container[];
}

export function OtwEmptyState({ otwContainers }: OtwEmptyStateProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12">
        <Truck className="w-16 h-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">No OTW containers</h2>
        <p className="text-muted-foreground">
          {otwContainers.length === 0
            ? "All containers have arrived or been offloaded"
            : "No containers match your search"}
        </p>
      </CardContent>
    </Card>
  );
}
