import { CreditCard, Landmark, PiggyBank, type LucideIcon } from "lucide-react";
import type { BalanceSheetSectionKey } from "./balanceSheetModel";

interface SectionItem {
  key: BalanceSheetSectionKey;
  label: string;
  icon: LucideIcon;
}

const SECTION_ITEMS: SectionItem[] = [
  { key: "assets", label: "Assets", icon: Landmark },
  { key: "liabilities", label: "Liabilities", icon: CreditCard },
  { key: "equity", label: "Equity", icon: PiggyBank },
];

interface BalanceSheetSectionNavProps {
  activeSection: BalanceSheetSectionKey;
  onSectionChange: (section: BalanceSheetSectionKey) => void;
}

export function BalanceSheetSectionNav({ activeSection, onSectionChange }: BalanceSheetSectionNavProps) {
  return (
    <nav aria-label="Balance sheet sections" className="w-full shrink-0 sm:w-56">
      <h2 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Balance Sheet
      </h2>
      <div className="grid grid-cols-3 gap-1 sm:block sm:space-y-1">
        {SECTION_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSectionChange(item.key)}
              aria-current={isActive ? "page" : undefined}
              data-testid={`tab-${item.key}`}
              className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors sm:justify-start ${
                isActive
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
