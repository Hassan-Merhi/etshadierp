export function StockRevision() {
  const items = [
    { name: "Premium Cotton Bales", before: 120, delta: -15, after: 105, uom: "BL" },
    { name: "Raw Polyester Fiber", before: 45, delta: 5, after: 50, uom: "KG" },
    { name: "Dyed Fabric Rolls", before: 80, delta: -20, after: 60, uom: "RL" },
  ];

  return (
    <div className="min-h-screen bg-neutral-100 flex items-center justify-center p-4">
      <div className="w-full max-w-[440px] bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-amber-600 px-5 py-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </div>
            <span className="text-white text-sm font-bold tracking-wider uppercase">Stock Transfer</span>
          </div>
          <div className="text-amber-100 text-[10px] font-bold tracking-wider uppercase mt-0.5">
            Revised
          </div>
          <div className="text-amber-100/80 text-xs font-medium mt-1">
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
            <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider w-14 text-right">Before</span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider w-14 text-right">Change</span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider w-14 text-right">After</span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider w-10 text-right">Unit</span>
          </div>
          {items.map((item, idx) => {
            const deltaColor = item.delta > 0 ? "text-emerald-600" : item.delta < 0 ? "text-red-500" : "text-slate-400";
            const deltaPrefix = item.delta > 0 ? "+" : "";
            return (
              <div key={idx} className="flex items-center gap-2 py-2.5 border-b border-slate-50 last:border-b-0">
                <span className="text-[13px] font-medium text-slate-700 flex-1">{item.name}</span>
                <span className="text-[13px] font-semibold text-slate-400 w-14 text-right">{item.before}</span>
                <span className={`text-[14px] font-bold w-14 text-right ${deltaColor}`}>
                  {deltaPrefix}{item.delta}
                </span>
                <span className="text-[14px] font-bold text-blue-600 w-14 text-right">{item.after}</span>
                <span className="text-[11px] font-semibold text-slate-400 w-10 text-right">{item.uom}</span>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-amber-50 border-t border-amber-100 flex items-center justify-between">
          <span className="bg-amber-600 text-white text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-full">
            Revision
          </span>
          <span className="text-sm font-bold text-amber-700">{items.length} items revised</span>
        </div>
      </div>
    </div>
  );
}
