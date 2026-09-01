import { Badge } from "@/components/ui/badge";
import { TableCell } from "@/components/ui/table";

interface OtwFreightCellProps {
  containerId: number;
  freightStatusMap: Record<number, { totalFreight: number; totalPaid: number; status: string }>;
}

export function OtwFreightCell({ containerId, freightStatusMap }: OtwFreightCellProps) {
  const fs = freightStatusMap[containerId];
  return (
    <TableCell>
      {!fs || fs.status === "NONE" ? (
        <span className="text-xs text-muted-foreground">--</span>
      ) : (
        <Badge
          variant={
            fs.status === "PAID"
              ? "default"
              : fs.status === "PARTIAL"
                ? "secondary"
                : "destructive"
          }
          data-testid={`badge-freight-${containerId}`}
        >
          {fs.status}
        </Badge>
      )}
    </TableCell>
  );
}
