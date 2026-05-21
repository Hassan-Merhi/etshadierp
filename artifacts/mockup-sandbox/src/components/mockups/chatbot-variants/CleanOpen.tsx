import React, { useState } from "react";
import { Sparkles, Minimize2, X, Paperclip, Send, Box, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const MOCK_CONVERSATION = [
  {
    role: "assistant",
    content: "Hi there! I'm your ERP Assistant. I can help you find records, generate reports, or answer questions about your data. What do you need help with today?",
    time: "10:24 AM",
  },
  {
    role: "user",
    content: "Can you show me the sales figures for last month?",
    time: "10:25 AM",
  },
  {
    role: "assistant",
    content: "I've pulled up the sales figures for last month (October). Total revenue was $245,000, which is up 12% from September. The top-performing category was Electronics. Would you like me to generate a detailed PDF report?",
    time: "10:25 AM",
  },
];

const SUGGESTIONS = [
  "Show low inventory items",
  "Generate Q3 report",
  "Check order #12345",
];

export function CleanOpen() {
  const [dark, setDark] = useState(false);

  const bg = dark ? "bg-zinc-950" : "bg-gray-50";
  const card = dark ? "bg-zinc-900 border-zinc-800" : "bg-white border-gray-100";
  const headerBorder = dark ? "border-zinc-800" : "border-gray-100";
  const titleColor = dark ? "text-zinc-100" : "text-gray-900";
  const subtitleColor = dark ? "text-zinc-500" : "text-gray-400";
  const iconBg = dark ? "bg-blue-900/40 text-blue-400" : "bg-blue-50 text-blue-500";
  const controlColor = dark ? "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800" : "text-gray-400 hover:text-gray-600 hover:bg-gray-50";

  const contextBadge = dark
    ? "bg-blue-900/40 text-blue-400 border-blue-800"
    : "bg-blue-50 text-blue-700 border-blue-100";

  const msgAreaBg = dark ? "bg-zinc-900" : "bg-white";
  const dateColor = dark ? "text-zinc-600" : "text-gray-400";

  const userBubble = dark ? "bg-blue-900/50 text-blue-100" : "bg-blue-50 text-blue-900";
  const asstBubble = dark ? "bg-zinc-800 text-zinc-200 border border-zinc-700" : "bg-gray-50 text-gray-800";

  const avatarAssistant = dark ? "bg-blue-700 text-white" : "bg-blue-500 text-white";
  const avatarUser = dark ? "bg-zinc-700 text-zinc-300" : "bg-gray-200 text-gray-600";
  const nameLabel = dark ? "text-zinc-500" : "text-gray-400";

  const chipBorder = dark ? "border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:border-zinc-600" : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50";

  const inputArea = dark
    ? "bg-zinc-800 border-zinc-700 focus-within:border-zinc-500 focus-within:ring-zinc-700/40"
    : "bg-gray-50 border-gray-100 focus-within:border-gray-200 focus-within:bg-white focus-within:ring-gray-50";
  const inputText = dark ? "text-zinc-100 placeholder:text-zinc-600" : "text-gray-800 placeholder:text-gray-400";
  const clipColor = dark ? "text-zinc-500 hover:text-zinc-300" : "text-gray-400 hover:text-gray-600";
  const sendBtn = dark ? "bg-zinc-100 hover:bg-white text-zinc-900" : "bg-gray-900 hover:bg-black text-white";

  const disclaimerColor = dark ? "text-zinc-700" : "text-gray-400";

  const appBg = dark ? "bg-zinc-950" : "bg-gray-100";
  const appBlock = dark ? "bg-zinc-800" : "bg-gray-200";

  return (
    <div className={`w-full h-full min-h-screen ${appBg} relative font-sans p-8 transition-colors duration-300`}>

      {/* Dark/Light toggle for demo */}
      <button
        onClick={() => setDark(!dark)}
        className={`fixed top-4 left-4 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
          dark ? "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
        }`}
      >
        {dark ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
        {dark ? "Light mode" : "Dark mode"}
      </button>

      {/* Simulated app background */}
      <div className="max-w-4xl mx-auto space-y-6 opacity-20 pointer-events-none">
        <div className={`h-12 w-48 ${appBlock} rounded-md`}></div>
        <div className="grid grid-cols-3 gap-6">
          <div className={`h-32 ${appBlock} rounded-lg`}></div>
          <div className={`h-32 ${appBlock} rounded-lg`}></div>
          <div className={`h-32 ${appBlock} rounded-lg`}></div>
        </div>
        <div className={`h-96 ${appBlock} rounded-lg`}></div>
      </div>

      {/* Floating Widget */}
      <div className={`fixed bottom-6 right-6 w-[400px] h-[600px] ${card} rounded-3xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] flex flex-col overflow-hidden border transition-colors duration-300`}>

        {/* Header */}
        <div className={`px-5 py-4 flex items-center justify-between border-b ${headerBorder} z-10`}>
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full ${iconBg} flex items-center justify-center`}>
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className={`font-medium ${titleColor} text-sm`}>ERP Assistant</h3>
              <p className={`text-xs ${subtitleColor}`}>Online</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className={`h-8 w-8 rounded-full ${controlColor}`}>
              <Minimize2 className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className={`h-8 w-8 rounded-full ${controlColor}`}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Context Pill */}
        <div className={`px-5 pt-3 pb-1 shrink-0 ${msgAreaBg}`}>
          <Badge
            variant="secondary"
            className={`${contextBadge} border font-medium px-2 py-0.5 flex items-center gap-1.5 w-fit text-xs`}
          >
            <Box className="w-3 h-3" />
            Context: Inventory
          </Badge>
        </div>

        {/* Message Area */}
        <div className={`flex-1 overflow-y-auto px-5 py-4 space-y-5 ${msgAreaBg}`}>

          {/* Date stamp */}
          <div className={`text-center text-xs ${dateColor} my-1`}>Today at 10:24 AM</div>

          {MOCK_CONVERSATION.map((msg, i) => (
            <div key={i} className={`flex gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              {/* Avatar */}
              <Avatar className="w-7 h-7 shrink-0 mt-0.5">
                <AvatarFallback className={`text-xs font-medium ${msg.role === "assistant" ? avatarAssistant : avatarUser}`}>
                  {msg.role === "assistant" ? <Sparkles className="w-3.5 h-3.5" /> : "U"}
                </AvatarFallback>
              </Avatar>

              <div className={`flex flex-col gap-1 max-w-[82%] ${msg.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`flex items-center gap-2 px-0.5`}>
                  <span className={`text-[11px] ${nameLabel}`}>
                    {msg.role === "assistant" ? "Assistant" : "You"} · {msg.time}
                  </span>
                </div>
                <div className={`px-4 py-3 text-sm leading-relaxed rounded-2xl ${
                  msg.role === "user"
                    ? `${userBubble} rounded-tr-sm`
                    : `${asstBubble} rounded-tl-sm`
                }`}>
                  {msg.content}
                </div>
              </div>
            </div>
          ))}

          {/* Suggestions */}
          <div className="pt-2 flex flex-wrap gap-2 pl-9">
            {SUGGESTIONS.map((s, i) => (
              <button
                key={i}
                className={`px-3.5 py-1.5 border rounded-full text-xs transition-colors ${chipBorder}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Input Area */}
        <div className={`p-4 ${msgAreaBg} border-t ${headerBorder}`}>
          <div className={`relative flex items-center ${inputArea} rounded-2xl border p-1 pr-2 shadow-sm transition-all focus-within:shadow-md focus-within:ring-4`}>
            <Button variant="ghost" size="icon" className={`h-10 w-10 ${clipColor} rounded-xl shrink-0`}>
              <Paperclip className="w-4 h-4" />
            </Button>
            <input
              type="text"
              placeholder="Ask anything..."
              className={`flex-1 bg-transparent border-none outline-none px-2 text-sm ${inputText} h-12`}
            />
            <Button className={`h-10 w-10 rounded-xl ${sendBtn} shrink-0 p-0 flex items-center justify-center shadow-sm`}>
              <Send className="w-4 h-4 ml-0.5" />
            </Button>
          </div>
          <p className={`text-center mt-2 text-[10px] ${disclaimerColor} font-medium tracking-wide uppercase`}>
            AI responses may be inaccurate
          </p>
        </div>

      </div>
    </div>
  );
}
