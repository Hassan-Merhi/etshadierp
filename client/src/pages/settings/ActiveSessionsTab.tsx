import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Monitor, Smartphone, Globe, LogOut, ShieldAlert, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ActiveSession {
  sid: string;
  isCurrent: boolean;
  userId: string;
  username: string;
  role: string;
  expires: string;
  userAgent: string | null;
  ip: string | null;
}

function getDeviceIcon(ua: string | null) {
  if (!ua) return Globe;
  const lower = ua.toLowerCase();
  if (lower.includes("mobile") || lower.includes("android") || lower.includes("iphone")) return Smartphone;
  return Monitor;
}

function parseUserAgent(ua: string | null) {
  if (!ua) return "Unknown device";
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Safari") && !ua.includes("Chrome")) return "Safari";
  if (ua.includes("Edge")) return "Edge";
  return ua.slice(0, 40);
}

export function ActiveSessionsTab({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useToast();

  const { data: sessions = [], isLoading, refetch } = useQuery<ActiveSession[]>({
    queryKey: ["/api/sessions"],
  });

  const revokeMutation = useMutation({
    mutationFn: async (sid: string) => {
      await apiRequest("DELETE", `/api/sessions/${sid}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      toast({ title: "Session revoked" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to revoke session", description: err.message, variant: "destructive" });
    },
  });

  const revokeAllMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/sessions");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      toast({ title: "All other sessions signed out" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to sign out sessions", description: err.message, variant: "destructive" });
    },
  });

  const otherSessions = sessions.filter(s => !s.isCurrent);
  const groupedByUser = isAdmin
    ? sessions.reduce<Record<string, ActiveSession[]>>((acc, s) => {
        const key = s.username || s.userId || "unknown";
        if (!acc[key]) acc[key] = [];
        acc[key].push(s);
        return acc;
      }, {})
    : { me: sessions };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6" />
            Active Sessions
          </h2>
          <p className="text-muted-foreground mt-1">
            {isAdmin
              ? "View and revoke sessions for all users."
              : "Manage where you are logged in. Revoke any session you don't recognise."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="default" onClick={() => refetch()} data-testid="button-refresh-sessions">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {otherSessions.length > 0 && !isAdmin && (
            <Button
              variant="destructive"
              size="default"
              onClick={() => revokeAllMutation.mutate()}
              disabled={revokeAllMutation.isPending}
              data-testid="button-signout-all"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign out all other devices
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : sessions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No active sessions found.
          </CardContent>
        </Card>
      ) : isAdmin ? (
        <div className="space-y-6">
          {Object.entries(groupedByUser).map(([username, userSessions]) => (
            <div key={username}>
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                {username}
              </p>
              <div className="space-y-2">
                {userSessions.map(session => (
                  <SessionRow
                    key={session.sid}
                    session={session}
                    onRevoke={() => revokeMutation.mutate(session.sid)}
                    isRevoking={revokeMutation.isPending}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map(session => (
            <SessionRow
              key={session.sid}
              session={session}
              onRevoke={() => revokeMutation.mutate(session.sid)}
              isRevoking={revokeMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionRow({
  session,
  onRevoke,
  isRevoking,
}: {
  session: ActiveSession;
  onRevoke: () => void;
  isRevoking: boolean;
}) {
  const DeviceIcon = getDeviceIcon(session.userAgent);
  const browser = parseUserAgent(session.userAgent);
  const expiresIn = session.expires
    ? formatDistanceToNow(new Date(session.expires), { addSuffix: true })
    : "unknown";

  return (
    <Card data-testid={`session-row-${session.sid.slice(0, 8)}`}>
      <CardContent className="py-3 px-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
            <DeviceIcon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium truncate">{browser}</span>
              {session.isCurrent && (
                <Badge variant="secondary" data-testid="badge-current-session">
                  This device
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              {session.ip && (
                <span className="text-xs text-muted-foreground">{session.ip}</span>
              )}
              <span className="text-xs text-muted-foreground">Expires {expiresIn}</span>
              {session.role && (
                <span className="text-xs text-muted-foreground capitalize">{session.role}</span>
              )}
            </div>
          </div>
        </div>
        {!session.isCurrent && (
          <Button
            variant="outline"
            size="default"
            onClick={onRevoke}
            disabled={isRevoking}
            data-testid={`button-revoke-${session.sid.slice(0, 8)}`}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Revoke
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
