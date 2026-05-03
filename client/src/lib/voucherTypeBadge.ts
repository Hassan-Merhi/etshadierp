export type VoucherBadgeStyle = {
  variant: "default" | "secondary" | "destructive" | "outline";
  className?: string;
};

const STYLES: Record<string, VoucherBadgeStyle> = {
  Sales: { variant: "outline", className: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/40" },
  Purchase: { variant: "outline", className: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/40" },
  Payment: { variant: "outline", className: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/40" },
  Receipt: { variant: "outline", className: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/40" },
  Journal: { variant: "outline", className: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/40" },
  Contra: { variant: "outline", className: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/40" },
  "Stock Transfer": { variant: "outline", className: "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/40" },
  StockTransfer: { variant: "outline", className: "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/40" },
  Consumption: { variant: "outline", className: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/40" },
  Production: { variant: "outline", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40" },
  Mixed: { variant: "outline", className: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/40" },
  "Credit Note": { variant: "outline", className: "bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/40" },
  "Debit Note": { variant: "outline", className: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40" },
};

export function getVoucherTypeBadge(type: string): VoucherBadgeStyle {
  return STYLES[type] ?? { variant: "outline" };
}
