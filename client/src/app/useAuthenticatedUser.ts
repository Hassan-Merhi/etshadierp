import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { authenticatedUserQueryOptions } from "@/contracts/sessionQueryContracts";

/**
 * Manages the authenticated user session:
 *   - /api/auth/me query with runtime response validation
 *   - 30-minute stale time
 *   - 12-second loading timeout (forces redirect to /login if auth is stuck)
 *   - handleLogout — clears cache, clears biometric credentials, redirects
 */
export function useAuthenticatedUser() {
  const { data: user, isLoading, error } = useQuery(authenticatedUserQueryOptions());

  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  useEffect(() => {
    if (!isLoading) {
      setLoadingTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setLoadingTimedOut(true), 12000);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  const handleLogout = async (): Promise<void> => {
    try {
      await apiRequest("POST", "/api/auth/logout", {});
      queryClient.clear();
      try {
        const { clearBiometricCredentials } = await import("@/pages/Login");
        await clearBiometricCredentials();
      } catch {
        // Biometric support is optional and must not block logout.
      }
      window.location.href = "/login";
    } catch (logoutError: unknown) {
      console.error("Logout failed:", logoutError);
    }
  };

  return { user, isLoading, error, loadingTimedOut, handleLogout };
}
