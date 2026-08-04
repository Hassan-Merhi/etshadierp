import { queryOptions } from "@tanstack/react-query";
import {
  parseAuthenticatedUser,
  parseSessionCompany,
  parseUserCompanies,
  type AuthenticatedUser,
  type SessionCompanyResponse,
  type UserCompanyAssignment,
} from "./sessionContracts";

export const authenticatedUserQueryKey = ["/api/auth/me"] as const;
export const userCompaniesQueryKey = ["/api/user/companies"] as const;
export const sessionCompanyQueryKey = ["/api/auth/session-company"] as const;

async function readUnknownJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `Expected JSON response from ${response.url}`);
  }
  return response.json() as Promise<unknown>;
}

export async function fetchAuthenticatedUser(signal?: AbortSignal): Promise<AuthenticatedUser | null> {
  const response = await fetch(authenticatedUserQueryKey[0], {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Failed to load authenticated user (${response.status})`);
  return parseAuthenticatedUser(await readUnknownJson(response));
}

export async function fetchUserCompanies(signal?: AbortSignal): Promise<UserCompanyAssignment[]> {
  const response = await fetch(userCompaniesQueryKey[0], {
    credentials: "include",
    signal,
  });
  if (!response.ok) throw new Error(`Failed to load user companies (${response.status})`);
  return parseUserCompanies(await readUnknownJson(response));
}

export async function fetchSessionCompany(signal?: AbortSignal): Promise<SessionCompanyResponse> {
  const response = await fetch(sessionCompanyQueryKey[0], {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`Failed to load session company (${response.status})`);
  return parseSessionCompany(await readUnknownJson(response));
}

export function authenticatedUserQueryOptions() {
  return queryOptions({
    queryKey: authenticatedUserQueryKey,
    queryFn: ({ signal }) => fetchAuthenticatedUser(signal),
    retry: false,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function userCompaniesQueryOptions() {
  return queryOptions({
    queryKey: userCompaniesQueryKey,
    queryFn: ({ signal }) => fetchUserCompanies(signal),
    retry: false,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
