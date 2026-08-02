/**
 * Pure helpers and lookup tables for the FactoryPayroll page.
 *
 * Extracted from FactoryPayroll.tsx during the Phase 4 god-file split.
 */
import { Badge } from "@/components/ui/badge";

export function getStatusBadge(status: string) {
  switch (status) {
    case "DRAFT":
      return (
        <Badge
          variant="outline"
          className="bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
          data-testid={`badge-status-${status}`}
        >
          DRAFT
        </Badge>
      );
    case "APPROVED":
      return (
        <Badge
          variant="secondary"
          className="bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
          data-testid={`badge-status-${status}`}
        >
          APPROVED
        </Badge>
      );
    case "PAID":
      return (
        <Badge
          variant="secondary"
          className="bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          data-testid={`badge-status-${status}`}
        >
          PAID
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" data-testid={`badge-status-${status}`}>
          {status}
        </Badge>
      );
  }
}
