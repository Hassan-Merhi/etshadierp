import React, { useState } from "react";
import { Sparkles, Minus, X, Paperclip, Send, ChevronRight, FileText, CheckCircle2 } from "lucide-react";
import { Card } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";

export function SleekDark() {
  const [minimized, setMinimized] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans selection:bg-indigo-500/30">
      <div className="relative w-full max-w-sm">
        {/* Ambient glow behind widget */}
        <div className="absolute -inset-0.5 bg-gradient-to-br from-indigo-500/20 to-purple-600/20 rounded-2xl blur-xl opacity-50" />
        
        <div className={`relative flex flex-col w-[380px] bg-slate-900/90 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 ease-in-out ${minimized ? 'h-[60px]' : 'h-[600px]'}`}>
          
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-slate-900/80 border-b border-slate-800/80 backdrop-blur-md z-10 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 shadow-[0_0_15px_rgba(99,102,241,0.4)]">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-slate-200 tracking-wide">ERP Assistant</h3>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)] animate-pulse" />
                  <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Online</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button 
                variant="ghost" 
                size="icon" 
                className="w-8 h-8 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 rounded-full transition-colors"
                onClick={() => setMinimized(!minimized)}
              >
                <Minus className="w-4 h-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                className="w-8 h-8 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-full transition-colors"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Chat Area */}
          {!minimized && (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
                
                {/* Assistant Message */}
                <div className="flex gap-3 max-w-[85%]">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0 mt-1 shadow-lg">
                    <Sparkles className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="bg-slate-800/60 border border-slate-700/50 backdrop-blur-sm text-slate-300 text-sm p-3.5 rounded-2xl rounded-tl-none shadow-sm leading-relaxed">
                      Hello! I noticed low stock on <span className="text-indigo-300 font-medium">Bale Product X</span>. Would you like me to draft a restock order or check alternative warehouses?
                    </div>
                    <span className="text-[10px] text-slate-500 ml-1">10:42 AM</span>
                  </div>
                </div>

                {/* User Message */}
                <div className="flex gap-3 max-w-[85%] ml-auto justify-end">
                  <div className="flex flex-col gap-1.5 items-end">
                    <div className="bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-sm p-3.5 rounded-2xl rounded-tr-none shadow-[0_4px_15px_rgba(99,102,241,0.2)] leading-relaxed">
                      Check warehouse B first, please.
                    </div>
                    <span className="text-[10px] text-slate-500 mr-1">10:43 AM</span>
                  </div>
                </div>

                {/* Assistant Message with Inline Card */}
                <div className="flex gap-3 max-w-[90%]">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0 mt-1 shadow-lg">
                    <Sparkles className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="flex flex-col gap-2 w-full">
                    <div className="bg-slate-800/60 border border-slate-700/50 backdrop-blur-sm text-slate-300 text-sm p-3.5 rounded-2xl rounded-tl-none shadow-sm leading-relaxed">
                      Warehouse B currently has 45 units available. I can allocate them to the current production batch.
                    </div>
                    
                    {/* Interactive Action Card */}
                    <div className="bg-slate-800/80 border border-indigo-500/30 rounded-xl p-3 shadow-lg group hover:border-indigo-500/50 transition-colors cursor-pointer">
                      <div className="flex items-start gap-3">
                        <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400 group-hover:bg-indigo-500/20 transition-colors">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div className="flex-1">
                          <h4 className="text-sm font-medium text-slate-200">Stock Transfer</h4>
                          <p className="text-xs text-slate-400 mt-0.5">WH-B → Production Floor</p>
                          <div className="mt-2.5 flex items-center gap-2">
                            <span className="text-xs font-semibold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">45 Units</span>
                            <span className="text-xs text-slate-500">Pending approval</span>
                          </div>
                        </div>
                        <CheckCircle2 className="w-5 h-5 text-slate-600 group-hover:text-emerald-400 transition-colors" />
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-500 ml-1">10:44 AM</span>
                  </div>
                </div>
              </div>

              {/* Input Area */}
              <div className="p-4 bg-slate-900/80 border-t border-slate-800/80 backdrop-blur-md">
                
                {/* Suggestions */}
                <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-none snap-x">
                  <button className="shrink-0 snap-start bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 text-slate-300 text-xs px-3.5 py-1.5 rounded-full transition-all hover:border-indigo-500/30 hover:text-indigo-300">
                    Approve transfer
                  </button>
                  <button className="shrink-0 snap-start bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 text-slate-300 text-xs px-3.5 py-1.5 rounded-full transition-all hover:border-indigo-500/30 hover:text-indigo-300">
                    Draft PO instead
                  </button>
                  <button className="shrink-0 snap-start bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 text-slate-300 text-xs px-3.5 py-1.5 rounded-full transition-all hover:border-indigo-500/30 hover:text-indigo-300">
                    Show current orders
                  </button>
                </div>

                <div className="relative group">
                  <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/20 to-purple-600/20 rounded-xl blur opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />
                  <div className="relative flex items-center bg-slate-950 border border-slate-800 rounded-xl focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/50 transition-all shadow-inner">
                    <Button variant="ghost" size="icon" className="h-10 w-10 text-slate-500 hover:text-slate-300 shrink-0 ml-1 rounded-lg">
                      <Paperclip className="w-4 h-4" />
                    </Button>
                    <input 
                      type="text" 
                      placeholder="Ask anything..." 
                      className="flex-1 bg-transparent border-none text-sm text-slate-200 placeholder:text-slate-600 h-10 px-2 focus:outline-none focus:ring-0"
                    />
                    <Button size="icon" className="h-8 w-8 bg-gradient-to-br from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white shrink-0 mr-1.5 rounded-lg shadow-md transition-all group-focus-within:shadow-[0_0_10px_rgba(99,102,241,0.4)]">
                      <Send className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="text-center mt-2.5">
                  <span className="text-[9px] text-slate-500 tracking-wide font-medium">ERP Intelligence AI • Powered by Replit</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
