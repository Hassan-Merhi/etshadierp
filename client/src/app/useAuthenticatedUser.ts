import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn, queryClient, apiRequest } from "@/lib/queryClient";

/**
 * Manages the authenticated user session:
 *   - /api/auth/me query with 30-minute stale time
 *   - 12-second loading timeout (forces redirect to /login if auth is stuck)
 *   - handleLogout — clears cache, clears biometric credentials, redirects
 */
export function useAuthenticatedUser() {
  const {
    data: user,
    isLoading,
    error,
  } = useQuery<any>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: 30 * 60 * 1000,
  });

  // Safety-net: if still loading after 12 seconds, force redirect to login
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  useEffect(() => {
    if (!isLoading) return;
    const t = setTimeout(() => setLoadingTimedOut(true), 12000);
    return () => clearTimeout(t);
  }, [isLoading]);

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout", {});
      queryClient.clear();
      try {
        const { clearBiometricCredentials } = await import("@/pages/Login");
        await clearBiometricCredentials();
      } catch {}
      window.location.href = "/login";
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  return { user, isLoading, error, loadingTimedOut, handleLogout };
}
