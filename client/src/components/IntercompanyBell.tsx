import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";

export function IntercompanyBell() {
  const [, navigate] = useLocation();

  const { data } = useQuery<{ count: number }>({
    queryKey: ["/api/intercompany-requests/pending-count"],
    queryFn: async () => {
      const r = await fetch("/api/intercompany-requests/pending-count", { credentials: "include" });
      if (!r.ok) return { count: 0 };
      return r.json();
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const count = data?.count ?? 0;

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => navigate("/intercompany-requests")}
        title="Intercompany payment requests"
        data-testid="button-intercompany-bell"
      >
        <Bell className="h-4 w-4" />
      </Button>
      {count > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-0.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center pointer-events-none"
          data-testid="badge-ic-count"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </div>
  );
}
