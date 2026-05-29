export function StockTransfer() {
  const items = [
    { name: "Premium Cotton Bales", quantity: 120, uom: "BL" },
    { name: "Raw Polyester Fiber", quantity: 45, uom: "KG" },
    { name: "Dyed Fabric Rolls", quantity: 80, uom: "RL" },
    { name: "Thread Spools", quantity: 200, uom: "SP" },
  ];
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  const uoms = [...new Set(items.map((i) => i.uom))];
  const totalUom = uoms.length === 1 ? uoms[0] : "Mixed";

  return (
    <div className="min-h-screen bg-neutral-100 flex items-center justify-center p-4">
      <div className="w-full max-w-[420px] bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-emerald-600 px-5 py-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
              </svg>
            </div>
            <span className="text-white text-sm font-bold tracking-wider uppercase">Stock Transfer</span>
          </div>
          <div className="text-emerald-100 text-xs font-medium">
            29 May 2026 &nbsp;&bull;&nbsp; VCH-2847
          </div>
        </div>

        {/* Route */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">From</div>
              <div className="text-sm font-bold text-slate-800">Main Warehouse</div>
            </div>
            <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
              </svg>
            </div>
            <div className="flex-1 text-right">
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">To</div>
              <div className="text-sm font-bold text-slate-800">Factory Floor B</div>
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="px-5 py-3">
          <div className="flex items-center gap-2 mb-2 pb-2 border-b-2 border-slate-100">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex-1">Item</span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider w-16 text-right">Qty</span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider w-12 text-right">Unit</span>
          </div>
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2 py-2.5 border-b border-slate-50 last:border-b-0">
              <span className="text-[13px] font-medium text-slate-700 flex-1">{item.name}</span>
              <span className="text-[15px] font-bold text-emerald-600 w-16 text-right">{item.quantity}</span>
              <span className="text-[11px] font-semibold text-slate-400 w-12 text-right">{item.uom}</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Items</span>
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-extrabold text-emerald-600">{totalQty}</span>
            <span className="text-xs font-semibold text-slate-400">{totalUom}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
