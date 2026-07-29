import { useState, useRef, useEffect } from "react";
import {
  Search, ChevronRight, AlertTriangle, Download,
  RefreshCw, RotateCcw, Plus, ChevronDown, Check, X,
} from "lucide-react";

const CATEGORIES = ["BAGS & BELTS", "CLOTHING", "FOOTWEAR", "ACCESSORIES", "WIPERS", "SUMMER #1"];

const products = [
  { name: "HAND BAG 20KG",             code: "HM011174", category: "BAGS & BELTS",  stock: 245, expected: 180, loaded: 215, balance: 30  },
  { name: "LADIES LEATHER BELTS MIX",  code: "LB003421", category: "BAGS & BELTS",  stock: 89,  expected: 100, loaded: 0,   balance: -11 },
  { name: "MENS BAGS ASSORTED",         code: "MB007892", category: "BAGS & BELTS",  stock: 0,   expected: 45,  loaded: 45,  balance: 0   },
  { name: "SCHOOL BACKPACK 25L",        code: "SB002156", category: "CLOTHING",      stock: 312, expected: 280, loaded: 268, balance: 44  },
  { name: "WALLET LADIES PU LEATHER",  code: "WL004567", category: "ACCESSORIES",   stock: 156, expected: 180, loaded: 0,   balance: -24 },
  { name: "TRAVEL DUFFLE BAG 60L",     code: "TD001923", category: "BAGS & BELTS",  stock: 78,  expected: 55,  loaded: 62,  balance: 16  },
  { name: "BELT MENS GENUINE LEATHER", code: "BM009834", category: "BAGS & BELTS",  stock: 45,  expected: 60,  loaded: 58,  balance: -13 },
  { name: "CROSSBODY BAG CANVAS",      code: "CB005612", category: "CLOTHING",      stock: 203, expected: 150, loaded: 147, balance: 56  },
  { name: "SNEAKERS SUMMER MIX",       code: "SS001122", category: "FOOTWEAR",      stock: 61,  expected: 80,  loaded: 0,   balance: -19 },
  { name: "WIPER CLOTH ROLL 10M",      code: "WC008811", category: "WIPERS",        stock: 400, expected: 300, loaded: 300, balance: 100 },
];

function CategoryDropdown({
  selected, onChange,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  function toggle(cat: string) {
    onChange(selected.includes(cat) ? selected.filter(c => c !== cat) : [...selected, cat]);
  }

  const label =
    selected.length === 0 ? "All Categories"
    : selected.length === 1 ? selected[0]
    : `${selected.length} categories`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex h-9 min-w-[160px] items-center justify-between gap-2 rounded-lg border px-3 text-sm font-medium transition-colors
          ${open || selected.length > 0
            ? "border-blue-500 bg-blue-600/10 text-blue-300"
            : "border-slate-700 bg-[#0f1117] text-slate-300 hover:border-slate-600 hover:text-white"
          }`}
      >
        <span className="truncate">{label}</span>
        <div className="flex items-center gap-1 shrink-0">
          {selected.length > 0 && (
            <span
              onClick={e => { e.stopPropagation(); onChange([]); }}
              className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500/30 text-blue-300 hover:bg-blue-500/50"
            >
              <X className="h-2.5 w-2.5" />
            </span>
          )}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1.5 w-56 rounded-xl border border-slate-700 bg-[#1a1f2e] shadow-xl shadow-black/40 overflow-hidden">
          {/* Select all */}
          <button
            onClick={() => onChange(selected.length === CATEGORIES.length ? [] : [...CATEGORIES])}
            className="flex w-full items-center gap-2.5 border-b border-slate-800 px-3 py-2.5 text-xs font-semibold text-slate-400 hover:bg-slate-800/60 hover:text-white transition-colors"
          >
            <div className={`flex h-4 w-4 items-center justify-center rounded border transition-colors
              ${selected.length === CATEGORIES.length ? "border-blue-500 bg-blue-500" : "border-slate-600"}`}>
              {selected.length === CATEGORIES.length && <Check className="h-2.5 w-2.5 text-white" />}
              {selected.length > 0 && selected.length < CATEGORIES.length && (
                <div className="h-1.5 w-1.5 rounded-sm bg-blue-400" />
              )}
            </div>
            Select all
          </button>
          {CATEGORIES.map(cat => {
            const checked = selected.includes(cat);
            return (
              <button
                key={cat}
                onClick={() => toggle(cat)}
                className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-sm transition-colors
                  ${checked ? "bg-blue-600/10 text-blue-200" : "text-slate-300 hover:bg-slate-800/60 hover:text-white"}`}
              >
                <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors
                  ${checked ? "border-blue-500 bg-blue-500" : "border-slate-600"}`}>
                  {checked && <Check className="h-2.5 w-2.5 text-white" />}
                </div>
                {cat}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CleanStructured() {
  const [showZero, setShowZero] = useState(true);
  const [negOnly, setNegOnly] = useState(false);
  const [showWipers, setShowWipers] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const visible = products.filter(p => {
    if (!showWipers && (p.category === "WIPERS" || p.name.toLowerCase().includes("wiper"))) return false;
    if (!showZero && p.stock === 0 && p.expected === 0 && p.loaded === 0) return false;
    if (negOnly && p.balance >= 0) return false;
    if (selectedCategories.length > 0 && !selectedCategories.includes(p.category)) return false;
    return true;
  });

  const shortageCount = visible.filter(p => p.balance < 0).length;
  const totalStock    = visible.reduce((s, p) => s + p.stock, 0);
  const totalExpected = visible.reduce((s, p) => s + p.expected, 0);
  const totalLoaded   = visible.reduce((s, p) => s + p.loaded, 0);
  const totalBalance  = visible.reduce((s, p) => s + p.balance, 0);

  return (
    <div className="min-h-screen bg-[#0f1117] text-white font-sans flex flex-col">
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="border-b border-slate-800 bg-[#0f1117] px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-white">Stock Allocation</h1>
            <span className="rounded-full bg-slate-700/70 px-2 py-0.5 text-[11px] font-semibold text-slate-400 ring-1 ring-slate-700">
              v5
            </span>
            <div className="flex items-center gap-1.5 rounded-md bg-red-500/10 px-2.5 py-1 ring-1 ring-red-500/30">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
              <span className="text-[13px] font-semibold text-red-300">{shortageCount + 190} shortages</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Restore Cancelled */}
            <button className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-transparent px-3 py-2 text-xs font-medium text-slate-400 transition-all hover:border-slate-500 hover:bg-slate-800 hover:text-white">
              <RotateCcw className="h-3.5 w-3.5" />
              Restore Cancelled
            </button>
            {/* Create Proforma */}
            <button className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-500/20">
              <Plus className="h-4 w-4" />
              Create Proforma
            </button>
          </div>
        </div>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="border-b border-slate-800 bg-[#13181f] px-8 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Left: search + category */}
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search product or code…"
                className="h-9 w-60 rounded-lg border border-slate-700 bg-[#0f1117] pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50 transition-colors"
              />
            </div>
            <CategoryDropdown selected={selectedCategories} onChange={setSelectedCategories} />
          </div>

          {/* Right: toggle pills + icon buttons */}
          <div className="flex items-center gap-2">
            {/* Toggle pills */}
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0f1117] p-1">
              <button
                onClick={() => setShowZero(v => !v)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                  showZero
                    ? "bg-indigo-600 text-white shadow shadow-indigo-500/30"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
              >
                Show Zero Rows
              </button>
              <button
                onClick={() => setNegOnly(v => !v)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                  negOnly
                    ? "bg-red-600 text-white shadow shadow-red-500/30"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
              >
                Negative Only
              </button>
              <button
                onClick={() => setShowWipers(v => !v)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                  showWipers
                    ? "bg-slate-600 text-white shadow shadow-slate-500/20"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
              >
                {showWipers ? "Hide Garbage/Wipers" : "Show Garbage/Wipers (10)"}
              </button>
            </div>

            <div className="h-5 w-px bg-slate-700/70 mx-0.5" />

            {/* Icon buttons */}
            <button
              title="Export Excel"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-transparent text-slate-400 transition-all hover:border-slate-500 hover:bg-slate-800 hover:text-white"
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              title="Refresh"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-transparent text-slate-400 transition-all hover:border-slate-500 hover:bg-slate-800 hover:text-white"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-8 py-5">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {[
                { label: "Product",          accent: "border-slate-600", align: "text-left"   },
                { label: "Stock Available",  accent: "border-green-500", align: "text-right"  },
                { label: "Expected to Load", accent: "border-amber-500", align: "text-right"  },
                { label: "Total Loaded",     accent: "border-blue-500",  align: "text-right"  },
                { label: "Available Balance",accent: "border-slate-600", align: "text-right"  },
                { label: "Detail",           accent: "border-slate-600", align: "text-center" },
              ].map(col => (
                <th
                  key={col.label}
                  className={`border-t-2 ${col.accent} border-b border-b-slate-800 pb-3 pt-0 ${col.align} text-xs font-semibold uppercase tracking-wider text-slate-400 ${col.align === "text-right" ? "pr-4" : ""} ${col.align === "text-left" ? "pr-6" : ""}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((product, idx) => {
              const isShortage = product.balance < 0;
              return (
                <tr
                  key={product.code}
                  style={isShortage ? { boxShadow: "inset 3px 0 0 #ef4444" } : undefined}
                  className={`border-b border-slate-800/50 transition-colors hover:bg-slate-800/30 ${
                    isShortage ? "bg-red-950/10" : idx % 2 === 0 ? "bg-transparent" : "bg-[#13181f]/40"
                  }`}
                >
                  {/* Product */}
                  <td className={`py-3.5 pr-6 ${isShortage ? "pl-4" : "pl-1"}`}>
                    <div className="flex items-center gap-2">
                      {isShortage && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />}
                      <div>
                        <div className="text-sm font-semibold text-white">{product.name}</div>
                        <div className="font-mono text-[11px] text-slate-500">{product.code}</div>
                      </div>
                    </div>
                  </td>
                  {/* Stock Available */}
                  <td className="py-3.5 pr-4 text-right font-mono text-sm font-semibold">
                    <span className={product.stock === 0 ? "text-slate-600" : "text-green-400"}>
                      {product.stock === 0 ? "0" : product.stock.toLocaleString()}
                    </span>
                  </td>
                  {/* Expected */}
                  <td className="py-3.5 pr-4 text-right font-mono text-sm font-semibold text-amber-400">
                    {product.expected.toLocaleString()}
                  </td>
                  {/* Loaded */}
                  <td className="py-3.5 pr-4 text-right font-mono text-sm font-semibold">
                    <span className={product.loaded === 0 ? "text-slate-600" : "text-blue-400"}>
                      {product.loaded === 0 ? "—" : product.loaded.toLocaleString()}
                    </span>
                  </td>
                  {/* Balance */}
                  <td className="py-3.5 pr-4 text-right">
                    <div className="flex flex-col items-end gap-0.5">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        product.balance < 0  ? "bg-red-600/20 text-red-300 ring-1 ring-red-500/40"
                        : product.balance === 0 ? "bg-slate-700/50 text-slate-400 ring-1 ring-slate-600/40"
                        : "bg-green-600/20 text-green-300 ring-1 ring-green-500/40"
                      }`}>
                        {product.balance > 0 ? "+" : ""}{product.balance}
                      </span>
                      {product.balance < 0 && (
                        <span className="text-[10px] text-red-500/80">need {Math.abs(product.balance)} more</span>
                      )}
                    </div>
                  </td>
                  {/* Detail */}
                  <td className="py-3.5 text-center">
                    <button className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700/60 text-slate-500 transition-all hover:border-slate-500 hover:bg-slate-800 hover:text-white">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}

            {/* Totals */}
            <tr className="sticky bottom-0 border-t-2 border-slate-700 bg-[#1c2133]">
              <td className="py-3.5 pl-1 pr-6">
                <span className="text-sm font-bold text-slate-200">Totals</span>
                <span className="ml-2 text-xs text-slate-500">{visible.length} products</span>
              </td>
              <td className="py-3.5 pr-4 text-right font-mono text-sm font-bold text-green-400">{totalStock.toLocaleString()}</td>
              <td className="py-3.5 pr-4 text-right font-mono text-sm font-bold text-amber-400">{totalExpected.toLocaleString()}</td>
              <td className="py-3.5 pr-4 text-right font-mono text-sm font-bold text-blue-400">{totalLoaded.toLocaleString()}</td>
              <td className="py-3.5 pr-4 text-right">
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  totalBalance < 0  ? "bg-red-600/20 text-red-300 ring-1 ring-red-500/40"
                  : totalBalance === 0 ? "bg-slate-700/50 text-slate-400"
                  : "bg-green-600/20 text-green-300 ring-1 ring-green-500/40"
                }`}>
                  {totalBalance > 0 ? "+" : ""}{totalBalance}
                </span>
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
