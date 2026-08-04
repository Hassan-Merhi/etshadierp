import { Button } from "@/components/ui/button";

interface PaginationBarProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  noun?: string;
}

export function PaginationBar({ page, totalPages, total, pageSize, onPageChange, noun = "items" }: PaginationBarProps) {
  if (total <= pageSize && totalPages <= 1) return null;
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between gap-3 py-3 text-sm text-muted-foreground">
      <span>
        Showing {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()} {noun}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          Previous
        </Button>
        <span className="min-w-20 text-center">
          Page {page} of {Math.max(1, totalPages)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
