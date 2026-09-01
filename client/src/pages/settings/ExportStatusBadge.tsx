import { Badge } from "@/components/ui/badge";

export function StatusBadge({ active, needsSetup }: { active: boolean; needsSetup: boolean }) {
  if (active)
    return (
      <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-0">Active</Badge>
    );
  if (needsSetup)
    return (
      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0">
        Needs Setup
      </Badge>
    );
  return <Badge variant="secondary">Disabled</Badge>;
}
