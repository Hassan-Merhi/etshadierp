import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { 
  MessageCircle, 
  X, 
  Send, 
  Bot, 
  User, 
  Loader2, 
  MinimizeIcon, 
  Maximize2,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  Settings,
  RefreshCw
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

interface ChatResponse {
  response: string;
  suggestions: string[];
}

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [message, setMessage] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [feedbackGiven, setFeedbackGiven] = useState<Record<number, 'positive' | 'negative'>>({});
  const [sessionId, setSessionId] = useState(() => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: status } = useQuery<ChatStatus>({
    queryKey: ["/api/chatbot/status"],
  });

  const { data: history = [], refetch: refetchHistory } = useQuery<ChatMessage[]>({
    queryKey: [`/api/chatbot/history/${sessionId}`],
    enabled: isOpen && status?.enabled && status?.hasApiKey,
  });

  const sendMutation = useMutation({
    mutationFn: async (msg: string) => {
      const response = await apiRequest("POST", "/api/chatbot/message", {
        message: msg,
        sessionId,
      });
      return response.json() as Promise<ChatResponse>;
    },
    onSuccess: (data) => {
      refetchHistory();
      setMessage("");
      if (data.suggestions && data.suggestions.length > 0) {
        setSuggestions(data.suggestions);
      }
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

  const handleSend = (msg?: string) => {
    const textToSend = msg || message.trim();
    if (!textToSend || sendMutation.isPending) return;
    sendMutation.mutate(textToSend);
    if (!msg) setMessage("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    handleSend(suggestion);
  };

  const handleFeedback = async (messageId: number, type: 'positive' | 'negative') => {
    setFeedbackGiven(prev => ({ ...prev, [messageId]: type }));
  };

  const handleNewChat = () => {
    const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setSessionId(newSessionId);
    setSuggestions([]);
    setFeedbackGiven({});
    queryClient.removeQueries({ queryKey: [`/api/chatbot/history/${sessionId}`] });
  };

  if (!status?.enabled || !status?.hasApiKey) {
    return null;
  }

  const defaultSuggestions = [
    "Give me a business summary",
    "What items are low on stock?",
    "Show my top selling products",
    "What are my outstanding payments?",
  ];

  const displaySuggestions = suggestions.length > 0 ? suggestions : defaultSuggestions;

  return (
    <div className="fixed bottom-4 right-4 z-50" data-testid="chat-widget-container">
      {!isOpen ? (
        <Button
          size="lg"
          className="rounded-full h-14 w-14 shadow-lg hover-elevate"
          onClick={() => setIsOpen(true)}
          data-testid="button-open-chat"
        >
          <MessageCircle className="h-6 w-6" />
        </Button>
      ) : (
        <Card className={cn(
          "w-[360px] sm:w-[420px] shadow-2xl transition-all duration-200 flex flex-col",
          isMinimized ? "h-auto" : "h-[600px]"
        )}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 py-3 px-4 border-b bg-primary/5">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-primary-foreground" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">ERP Assistant</CardTitle>
                <p className="text-xs text-muted-foreground">Powered by AI</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleNewChat}
                title="New conversation"
                data-testid="button-new-chat"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
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
            <CardContent className="p-0 flex flex-col flex-1 overflow-hidden">
              <ScrollArea ref={scrollAreaRef} className="flex-1 px-4 py-3">
                {history.length === 0 && !sendMutation.isPending && (
                  <div className="flex flex-col items-center justify-center h-full text-center py-6">
                    <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                      <Bot className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="font-semibold text-lg mb-1">Hello! I'm your ERP Assistant</h3>
                    <p className="text-sm text-muted-foreground mb-4 max-w-[280px]">
                      I can help you with inventory, sales, finances, and business insights.
                    </p>
                    
                    <div className="w-full space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Try asking:</p>
                      <div className="flex flex-wrap gap-2 justify-center">
                        {displaySuggestions.map((suggestion, index) => (
                          <Badge
                            key={index}
                            variant="outline"
                            className="cursor-pointer hover-elevate text-xs py-1.5 px-3"
                            onClick={() => handleSuggestionClick(suggestion)}
                            data-testid={`suggestion-chip-${index}`}
                          >
                            {suggestion}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="space-y-4">
                  {history.map((msg, index) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex gap-2",
                        msg.role === "user" ? "justify-end" : "justify-start"
                      )}
                      data-testid={`chat-message-${msg.id}`}
                    >
                      {msg.role === "assistant" && (
                        <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary flex items-center justify-center mt-1">
                          <Bot className="h-4 w-4 text-primary-foreground" />
                        </div>
                      )}
                      <div className="flex flex-col max-w-[85%]">
                        <div
                          className={cn(
                            "rounded-lg px-3 py-2 text-sm",
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          )}
                        >
                          {msg.role === "assistant" ? (
                            <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                              <ReactMarkdown 
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  table: ({ children }) => (
                                    <div className="overflow-x-auto my-2">
                                      <table className="min-w-full text-xs border-collapse">
                                        {children}
                                      </table>
                                    </div>
                                  ),
                                  th: ({ children }) => (
                                    <th className="border border-border px-2 py-1 bg-muted font-medium text-left">
                                      {children}
                                    </th>
                                  ),
                                  td: ({ children }) => (
                                    <td className="border border-border px-2 py-1">
                                      {children}
                                    </td>
                                  ),
                                  p: ({ children }) => (
                                    <p className="mb-2 last:mb-0">{children}</p>
                                  ),
                                  ul: ({ children }) => (
                                    <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>
                                  ),
                                  ol: ({ children }) => (
                                    <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>
                                  ),
                                  li: ({ children }) => (
                                    <li className="text-sm">{children}</li>
                                  ),
                                  code: ({ children, className }) => {
                                    const isInline = !className;
                                    return isInline ? (
                                      <code className="bg-background/50 px-1 py-0.5 rounded text-xs font-mono">
                                        {children}
                                      </code>
                                    ) : (
                                      <code className="block bg-background/50 p-2 rounded text-xs font-mono overflow-x-auto">
                                        {children}
                                      </code>
                                    );
                                  },
                                  strong: ({ children }) => (
                                    <strong className="font-semibold">{children}</strong>
                                  ),
                                }}
                              >
                                {msg.message}
                              </ReactMarkdown>
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                          )}
                        </div>
                        
                        {msg.role === "assistant" && (
                          <div className="flex items-center gap-1 mt-1 ml-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "h-6 w-6",
                                feedbackGiven[msg.id] === 'positive' && "text-green-500"
                              )}
                              onClick={() => handleFeedback(msg.id, 'positive')}
                              disabled={!!feedbackGiven[msg.id]}
                              data-testid={`feedback-positive-${msg.id}`}
                            >
                              <ThumbsUp className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "h-6 w-6",
                                feedbackGiven[msg.id] === 'negative' && "text-red-500"
                              )}
                              onClick={() => handleFeedback(msg.id, 'negative')}
                              disabled={!!feedbackGiven[msg.id]}
                              data-testid={`feedback-negative-${msg.id}`}
                            >
                              <ThumbsDown className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                      {msg.role === "user" && (
                        <div className="flex-shrink-0 h-7 w-7 rounded-full bg-muted flex items-center justify-center mt-1">
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
                      <div className="bg-muted rounded-lg px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-sm text-muted-foreground">Thinking...</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                
                {history.length > 0 && suggestions.length > 0 && !sendMutation.isPending && (
                  <div className="mt-4 pt-3 border-t">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Suggested questions:</p>
                    <div className="flex flex-wrap gap-2">
                      {suggestions.slice(0, 3).map((suggestion, index) => (
                        <Badge
                          key={index}
                          variant="outline"
                          className="cursor-pointer hover-elevate text-xs py-1 px-2"
                          onClick={() => handleSuggestionClick(suggestion)}
                          data-testid={`follow-up-suggestion-${index}`}
                        >
                          {suggestion}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </ScrollArea>

              <div className="p-3 border-t bg-background">
                <div className="flex gap-2">
                  <Input
                    ref={inputRef}
                    placeholder="Ask about your business data..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={sendMutation.isPending}
                    className="flex-1"
                    data-testid="input-chat-message"
                  />
                  <Button
                    size="icon"
                    onClick={() => handleSend()}
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
                  <p className="text-xs text-destructive mt-2" data-testid="text-chat-error">
                    Failed to send message. Please try again.
                  </p>
                )}
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
