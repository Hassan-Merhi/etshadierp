import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { authenticatedUserQueryOptions } from "@/contracts/sessionQueryContracts";

/**
 * Manages the authenticated user session:
 *   - /api/auth/me query with runtime response validation
 *   - transient auth transport failures stay in a recoverable loading/error state
 *   - only a confirmed 401 resolves the user to null and permits a login redirect
 *   - handleLogout — clears cache, clears biometric credentials, redirects
 */
export function useAuthenticatedUser() {
  const isLoginRoute =
    typeof window !== "undefined" &&
    (window.location.pathname === "/login" || window.location.pathname.startsWith("/login/"));
  const { data: user, isLoading, error } = useQuery({
    ...authenticatedUserQueryOptions(),
    // The login page is public. Avoid starting an authenticated session probe
    // while it is already being displayed; a stale render can otherwise turn
    // the expected 401 into browser error noise.
    enabled: !isLoginRoute,
  });

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

  return { user, isLoading, error, handleLogout };
}
