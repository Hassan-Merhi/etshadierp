/**
 * ExpandableCard — extracted sub-component.
 *
 * Extracted from DailyProductionReport.tsx during the Phase 4 god-file split.
 */
import {useState} from "react";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {ChevronDown, ChevronRight} from "lucide-react";

export function ExpandableCard({
  title,
  badge,
  icon: Icon,
  children,
  testId,
}: {
  title: string;
  badge?: string;
  icon: React.ElementType;
  children: React.ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card data-testid={testId}>
      <CardHeader
        className="cursor-pointer py-3 px-4 flex flex-row items-center justify-between gap-2"
        onClick={() => setOpen(!open)}
      >
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
        {badge !== undefined && (
          <Badge variant="secondary" className="text-xs">
            {badge}
          </Badge>
        )}
      </CardHeader>
      {open && <CardContent className="pt-0 px-4 pb-4">{children}</CardContent>}
    </Card>
  );
}
