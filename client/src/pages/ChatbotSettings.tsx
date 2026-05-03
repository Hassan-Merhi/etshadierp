import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Bot, Users, MessageCircle, ArrowLeft, Loader2, Check, X, Settings } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";

interface UserChatbotStatus {
  id: string;
  username: string;
  chatbotEnabled: boolean;
  active: boolean;
}

interface ChatMessage {
  id: number;
  userId: number;
  sessionId: string;
  role: "user" | "assistant";
  message: string;
  createdAt: string;
  username?: string;
}

export default function ChatbotSettings() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("users");

  const { data: users = [], isLoading: usersLoading } = useQuery<UserChatbotStatus[]>({
    queryKey: ["/api/users/chatbot-status"],
  });

  const { data: chatHistory = [], isLoading: historyLoading } = useQuery<ChatMessage[]>({
    queryKey: ["/api/chatbot/all-history"],
  });

  const { data: chatStatus } = useQuery<{ enabled: boolean; hasApiKey: boolean; providerName: string; selectedProvider: string; isAdminOrOwner: boolean }>({
    queryKey: ["/api/chatbot/status"],
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ userId, enabled }: { userId: string; enabled: boolean }) => {
      const response = await apiRequest("PATCH", `/api/users/${userId}/chatbot`, { enabled });
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users/chatbot-status"] });
      toast({
        title: variables.enabled ? "Chatbot enabled" : "Chatbot disabled",
        description: `User chatbot access has been ${variables.enabled ? "enabled" : "disabled"}.`,
      });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to update chatbot access",
        variant: "destructive",
      });
    },
  });

  const providerMutation = useMutation({
    mutationFn: async (provider: string) => {
      const response = await apiRequest("PATCH", "/api/chatbot/provider", { provider });
      return response.json();
    },
    onSuccess: (_, provider) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chatbot/status"] });
      toast({
        title: "AI Provider Updated",
        description: `Switched to ${provider === "chatgpt" ? "ChatGPT (OpenAI)" : provider === "grok" ? "Grok (xAI)" : "Gemini (Google)"}.`,
      });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to update AI provider",
        variant: "destructive",
      });
    },
  });

  const groupedHistory = chatHistory.reduce((acc, msg) => {
    const key = msg.sessionId;
    if (!acc[key]) {
      acc[key] = {
        sessionId: key,
        username: msg.username || "Unknown",
        userId: msg.userId,
        messages: [],
        lastMessageTime: msg.createdAt,
      };
    }
    acc[key].messages.push(msg);
    if (new Date(msg.createdAt) > new Date(acc[key].lastMessageTime)) {
      acc[key].lastMessageTime = msg.createdAt;
    }
    return acc;
  }, {} as Record<string, { sessionId: string; username: string; userId: number; messages: ChatMessage[]; lastMessageTime: string }>);

  const sessions = Object.values(groupedHistory).sort(
    (a, b) => new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
  );

  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const selectedMessages = selectedSession ? groupedHistory[selectedSession]?.messages || [] : [];

  return (
    <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/settings">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex items-center gap-3">
          <Bot className="h-8 w-8 text-primary" />
          <div>
            <PageHeader title="AI Chatbot Settings" subtitle="Manage chatbot access and view conversations" />
          </div>
        </div>
      </div>

      {!chatStatus?.hasApiKey && (
        <Card className="border-orange-500/50 bg-orange-500/10">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Bot className="h-5 w-5 text-orange-500" />
              <p className="text-sm">
                <span className="font-medium">API Key Missing:</span> The {chatStatus?.providerName || "AI"} API key is not configured. 
                Please add the {chatStatus?.selectedProvider === "chatgpt" ? "OPENAI_API_KEY" : chatStatus?.selectedProvider === "grok" ? "XAI_API_KEY" : "GEMINI_API_KEY"} secret in the Secrets tab to enable the AI chatbot.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {chatStatus?.isAdminOrOwner && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Settings className="h-5 w-5" />
              AI Provider
            </CardTitle>
            <CardDescription>
              Choose which AI service powers the chatbot
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
              <Select
                value={chatStatus?.selectedProvider || "gemini"}
                onValueChange={(value) => providerMutation.mutate(value)}
                disabled={providerMutation.isPending}
              >
                <SelectTrigger className="w-[200px]" data-testid="select-ai-provider">
                  <SelectValue placeholder="Select AI Provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini">Gemini (Google)</SelectItem>
                  <SelectItem value="chatgpt">ChatGPT (OpenAI)</SelectItem>
                  <SelectItem value="grok">Grok (xAI)</SelectItem>
                </SelectContent>
              </Select>
              {providerMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {chatStatus?.hasApiKey && (
                <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
                  <Check className="h-3 w-3 mr-1" />
                  API Key Configured
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="users" className="gap-2" data-testid="tab-users">
            <Users className="h-4 w-4" />
            User Access
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2" data-testid="tab-history">
            <MessageCircle className="h-4 w-4" />
            Chat History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                User Chatbot Access
              </CardTitle>
              <CardDescription>
                Enable or disable AI chatbot access for each user. Only users with access enabled can use the floating chat widget.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : users.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No users found.</p>
              ) : (
                <div className="table-responsive">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Username</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Chatbot Access</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                        <TableCell className="font-medium">{user.username}</TableCell>
                        <TableCell>
                          <Badge variant={user.active ? "default" : "secondary"}>
                            {user.active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Switch
                            checked={user.chatbotEnabled || false}
                            onCheckedChange={(checked) => 
                              toggleMutation.mutate({ userId: user.id, enabled: checked })
                            }
                            disabled={toggleMutation.isPending}
                            data-testid={`switch-chatbot-${user.id}`}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <Card className="md:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Conversations</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {historyLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : sessions.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8 px-4">No chat history yet.</p>
                ) : (
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-1 p-2">
                      {sessions.map((session) => (
                        <button
                          key={session.sessionId}
                          onClick={() => setSelectedSession(session.sessionId)}
                          className={`w-full text-left p-3 rounded-md transition-colors ${
                            selectedSession === session.sessionId
                              ? "bg-primary/10"
                              : "hover-elevate"
                          }`}
                          data-testid={`button-session-${session.sessionId}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium truncate">{session.username}</span>
                            <Badge variant="outline" className="text-xs">
                              {session.messages.length}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {format(new Date(session.lastMessageTime), "MMM d, h:mm a")}
                          </p>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Messages</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {!selectedSession ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <MessageCircle className="h-12 w-12 mb-4" />
                    <p>Select a conversation to view messages</p>
                  </div>
                ) : (
                  <ScrollArea className="h-[400px] p-4">
                    <div className="space-y-3">
                      {selectedMessages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`flex gap-2 ${
                            msg.role === "user" ? "justify-end" : "justify-start"
                          }`}
                          data-testid={`message-${msg.id}`}
                        >
                          {msg.role === "assistant" && (
                            <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary flex items-center justify-center">
                              <Bot className="h-4 w-4 text-primary-foreground" />
                            </div>
                          )}
                          <div
                            className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                              msg.role === "user"
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted"
                            }`}
                          >
                            <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                            <p className="text-xs opacity-70 mt-1">
                              {format(new Date(msg.createdAt), "h:mm a")}
                            </p>
                          </div>
                          {msg.role === "user" && (
                            <div className="flex-shrink-0 h-7 w-7 rounded-full bg-muted flex items-center justify-center">
                              <span className="text-xs font-medium">
                                {msg.username?.charAt(0).toUpperCase() || "U"}
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
