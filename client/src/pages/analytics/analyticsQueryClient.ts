import {
  readAccountsResponse,
  readArrayResponse,
  readJsonResponse,
} from "@/lib/apiResponseAdapters";

export async function fetchAnalyticsJson<T>(url: string, errorMessage: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  return readJsonResponse<T>(response, errorMessage);
}

export async function fetchAnalyticsArray<T>(url: string, errorMessage: string): Promise<T[]> {
  const response = await fetch(url, { credentials: "include" });
  return readArrayResponse<T>(response, errorMessage);
}

export async function fetchAnalyticsAccounts<T>(url: string): Promise<T[]> {
  const response = await fetch(url, { credentials: "include" });
  return readAccountsResponse<T>(response);
}
