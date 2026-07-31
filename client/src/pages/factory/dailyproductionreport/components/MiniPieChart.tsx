/**
 * MiniPieChart — extracted sub-component.
 *
 * Extracted from DailyProductionReport.tsx during the Phase 4 god-file split.
 */
import {useMemo} from "react";
import {PieChart, Pie, Cell, Tooltip, ResponsiveContainer} from "recharts";

export // ── Shared mini-pie renderer used by both new charts ──────────────────────
function MiniPieChart({
  title,
  allRows,
  classifyFn,
  order,
  colors,
  testId,
}: {
  title: string;
  allRows: { categoryName: string; totalWeightKg: number }[];
  classifyFn: (name: string) => string;
  order: string[];
  colors: Record<string, string>;
  testId: string;
}) {
  const grouped = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const row of allRows) {
      const group = classifyFn(row.categoryName);
      if (group === "__skip__") continue;
      acc[group] = (acc[group] ?? 0) + row.totalWeightKg;
    }
    return acc;
  }, [allRows, classifyFn]);

  const slices = order
    .filter((g) => (grouped[g] ?? 0) > 0)
    .map((g) => ({ name: g, value: grouped[g]!, color: colors[g] ?? "#94a3b8" }));

  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return null;

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
      <div className="flex items-start gap-3">
        {/* Legend */}
        <div className="flex flex-col gap-1 min-w-0">
          {slices.map((s) => {
            const pct = ((s.value / total) * 100).toFixed(1);
            return (
              <div key={s.name} className="flex items-center gap-1.5">
                <span
                  className="inline-block rounded-sm flex-shrink-0"
                  style={{ width: 9, height: 9, background: s.color }}
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">{s.name}</span>
                <span className="text-xs font-bold tabular-nums">{pct}%</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {Math.round(s.value).toLocaleString()} kg
                </span>
              </div>
            );
          })}
        </div>
        {/* Donut */}
        <div style={{ width: 140, height: 140, flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                cx="50%"
                cy="50%"
                innerRadius={38}
                outerRadius={62}
                paddingAngle={2}
                dataKey="value"
                strokeWidth={0}
              >
                {slices.map((s) => (
                  <Cell key={s.name} fill={s.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v: number) => [`${Math.round(v).toLocaleString()} kg`, ""]}
                contentStyle={{ fontSize: 11, borderRadius: 6 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Bale Ledger tab — types, helpers, component
// ─────────────────────────────────────────────
