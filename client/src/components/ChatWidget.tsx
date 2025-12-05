import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircle, X, Send, Bot, User, Loader2, MinimizeIcon, Maximize2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  message: string;
  createdAt: string;
}

interface ChatStatus {
  enabled: boolean;
  hasApiKey: boolean;
  isAdminOrOwner: boolean;
}

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [message, setMessage] = useState("");
  const [sessionId] = useState(() => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: status } = useQuery<ChatStatus>({
    queryKey: ["/api/chatbot/status"],
  });

  const { data: history = [], refetch: refetchHistory } = useQuery<ChatMessage[]>({
    queryKey: ["/api/chatbot/history", sessionId],
    enabled: isOpen && status?.enabled && status?.hasApiKey,
  });

  const sendMutation = useMutation({
    mutationFn: async (msg: string) => {
      const response = await apiRequest("POST", "/api/chatbot/message", {
        message: msg,
        sessionId,
      });
      return response.json();
    },
    onSuccess: () => {
      refetchHistory();
      setMessage("");
    },
  });

  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [history, sendMutation.isPending]);

  useEffect(() => {
    if (isOpen && inputRef.current && !isMinimized) {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized]);

  const handleSend = () => {
    if (!message.trim() || sendMutation.isPending) return;
    sendMutation.mutate(message.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!status?.enabled || !status?.hasApiKey) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50" data-testid="chat-widget-container">
      {!isOpen ? (
        <Button
          size="lg"
          className="rounded-full h-14 w-14 shadow-lg"
          onClick={() => setIsOpen(true)}
          data-testid="button-open-chat"
        >
          <MessageCircle className="h-6 w-6" />
        </Button>
      ) : (
        <Card className={cn(
          "w-80 sm:w-96 shadow-2xl transition-all duration-200",
          isMinimized ? "h-auto" : "h-[500px]"
        )}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 py-3 px-4 border-b">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              <CardTitle className="text-sm font-medium">ERP Assistant</CardTitle>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setIsMinimized(!isMinimized)}
                data-testid="button-minimize-chat"
              >
                {isMinimized ? <Maximize2 className="h-4 w-4" /> : <MinimizeIcon className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setIsOpen(false)}
                data-testid="button-close-chat"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          
          {!isMinimized && (
            <>
              <CardContent className="p-0 flex flex-col h-[calc(100%-4rem)]">
                <ScrollArea ref={scrollAreaRef} className="flex-1 px-4 py-2">
                  {history.length === 0 && !sendMutation.isPending && (
                    <div className="flex flex-col items-center justify-center h-full text-center py-8">
                      <Bot className="h-12 w-12 text-muted-foreground mb-4" />
                      <p className="text-sm text-muted-foreground">
                        Hello! I can help you with your ERP data.
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        Ask me about inventory, sales, accounts, or anything else.
                      </p>
                    </div>
                  )}
                  
                  <div className="space-y-3">
                    {history.map((msg) => (
                      <div
                        key={msg.id}
                        className={cn(
                          "flex gap-2",
                          msg.role === "user" ? "justify-end" : "justify-start"
                        )}
                        data-testid={`chat-message-${msg.id}`}
                      >
                        {msg.role === "assistant" && (
                          <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary flex items-center justify-center">
                            <Bot className="h-4 w-4 text-primary-foreground" />
                          </div>
                        )}
                        <div
                          className={cn(
                            "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          )}
                        >
                          <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                        </div>
                        {msg.role === "user" && (
                          <div className="flex-shrink-0 h-7 w-7 rounded-full bg-muted flex items-center justify-center">
                            <User className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                    ))}
                    
                    {sendMutation.isPending && (
                      <div className="flex gap-2 justify-start">
                        <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary flex items-center justify-center">
                          <Bot className="h-4 w-4 text-primary-foreground" />
                        </div>
                        <div className="bg-muted rounded-lg px-3 py-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>

                <div className="p-3 border-t">
                  <div className="flex gap-2">
                    <Input
                      ref={inputRef}
                      placeholder="Ask about your business data..."
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      onKeyDown={handleKeyDown}
                      disabled={sendMutation.isPending}
                      data-testid="input-chat-message"
                    />
                    <Button
                      size="icon"
                      onClick={handleSend}
                      disabled={!message.trim() || sendMutation.isPending}
                      data-testid="button-send-message"
                    >
                      {sendMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {sendMutation.isError && (
                    <p className="text-xs text-destructive mt-1" data-testid="text-chat-error">
                      Failed to send message. Please try again.
                    </p>
                  )}
                </div>
              </CardContent>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
