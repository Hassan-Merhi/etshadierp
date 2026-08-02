/**
 * CategoryPieChart — extracted sub-component.
 *
 * Extracted from DailyProductionReport.tsx during the Phase 4 god-file split.
 */
import { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

import { GROUP_ORDER, PIE_COLORS, classifyCategory } from "../utils";

export function CategoryPieChart({
  byCategory,
  wipersGarbageKg,
}: {
  byCategory: { categoryName: string; totalWeightKg: number }[];
  wipersGarbageKg: number;
}) {
  const grouped = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const cat of byCategory) {
      const group = classifyCategory(cat.categoryName);
      if (group === "__skip__") continue;
      acc[group] = (acc[group] ?? 0) + cat.totalWeightKg;
    }
    if (wipersGarbageKg > 0) {
      acc["Wipers & Garbage"] = (acc["Wipers & Garbage"] ?? 0) + wipersGarbageKg;
    }
    return acc;
  }, [byCategory, wipersGarbageKg]);

  const slices = GROUP_ORDER.filter((g) => (grouped[g] ?? 0) > 0).map((g, i) => ({
    name: g,
    value: grouped[g] ?? 0,
    color: PIE_COLORS[GROUP_ORDER.indexOf(g) % PIE_COLORS.length],
  }));

  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return null;

  return (
    <div className="flex items-center gap-1" data-testid="card-category-pie">
      {/* Legend — tight left of pie */}
      <div className="flex flex-col gap-1">
        {slices.map((s) => {
          const pct = ((s.value / total) * 100).toFixed(1);
          return (
            <div key={s.name} className="flex items-center gap-1.5">
              <span
                className="inline-block rounded-sm flex-shrink-0"
                style={{ width: 10, height: 10, background: s.color }}
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

      {/* Pie — right of legend */}
      <div style={{ width: 160, height: 160, flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              cx="50%"
              cy="50%"
              innerRadius={42}
              outerRadius={72}
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
  );
}

// ── Shared mini-pie renderer used by both new charts ──────────────────────
