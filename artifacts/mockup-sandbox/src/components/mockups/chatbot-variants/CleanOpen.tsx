import React from "react";
import { Sparkles, Minimize2, X, Paperclip, Send, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

const MOCK_CONVERSATION = [
  {
    role: "assistant",
    content: "Hi there! I'm your ERP Assistant. I can help you find records, generate reports, or answer questions about your data. What do you need help with today?",
  },
  {
    role: "user",
    content: "Can you show me the sales figures for last month?",
  },
  {
    role: "assistant",
    content: "I've pulled up the sales figures for last month (October). Total revenue was $245,000, which is up 12% from September. The top-performing category was Electronics. Would you like me to generate a detailed PDF report?",
  },
];

const SUGGESTIONS = [
  "Show low inventory items",
  "Generate Q3 report",
  "Check order #12345 status",
];

export function CleanOpen() {
  return (
    <div className="w-full h-full min-h-screen bg-gray-50 relative font-sans p-8">
      {/* Background to simulate an app */}
      <div className="max-w-4xl mx-auto space-y-6 opacity-30 pointer-events-none">
        <div className="h-12 w-48 bg-gray-200 rounded-md"></div>
        <div className="grid grid-cols-3 gap-6">
          <div className="h-32 bg-gray-200 rounded-lg"></div>
          <div className="h-32 bg-gray-200 rounded-lg"></div>
          <div className="h-32 bg-gray-200 rounded-lg"></div>
        </div>
        <div className="h-96 bg-gray-200 rounded-lg"></div>
      </div>

      {/* Floating Widget */}
      <div className="fixed bottom-6 right-6 w-[400px] h-[600px] bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] flex flex-col overflow-hidden border border-gray-100">
        
        {/* Header */}
        <div className="px-6 py-5 flex items-center justify-between border-b border-gray-50 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-500">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-medium text-gray-900 text-sm">ERP Assistant</h3>
              <p className="text-xs text-gray-400">Online</p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-gray-400">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-gray-50 hover:text-gray-600">
              <Minimize2 className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-gray-50 hover:text-gray-600">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Message Area */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8 bg-white">
          {MOCK_CONVERSATION.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div 
                className={`max-w-[85%] px-5 py-4 text-[15px] leading-relaxed
                  ${msg.role === 'user' 
                    ? 'bg-blue-50 text-blue-900 rounded-2xl rounded-tr-sm' 
                    : 'bg-gray-50 text-gray-800 rounded-2xl rounded-tl-sm'
                  }
                `}
              >
                {msg.content}
              </div>
            </div>
          ))}
          
          {/* Suggestions */}
          <div className="pt-4 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s, i) => (
              <button 
                key={i}
                className="px-4 py-2 bg-white border border-gray-200 rounded-full text-xs text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-colors shadow-sm"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white">
          <div className="relative flex items-center bg-gray-50 rounded-2xl border border-gray-100 p-1 pr-2 shadow-sm transition-all focus-within:border-gray-200 focus-within:bg-white focus-within:shadow-md focus-within:ring-4 focus-within:ring-gray-50">
            <Button variant="ghost" size="icon" className="h-10 w-10 text-gray-400 hover:text-gray-600 rounded-xl shrink-0">
              <Paperclip className="w-4 h-4" />
            </Button>
            <input 
              type="text"
              placeholder="Ask anything..."
              className="flex-1 bg-transparent border-none outline-none px-2 text-[15px] text-gray-800 placeholder:text-gray-400 h-12"
            />
            <Button className="h-10 w-10 rounded-xl bg-gray-900 hover:bg-black text-white shrink-0 p-0 flex items-center justify-center shadow-sm">
              <Send className="w-4 h-4 ml-0.5" />
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
