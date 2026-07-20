export interface AccountsEnvelope<TAccount> {
  accounts: TAccount[];
  asOfDate?: string;
}

export function unwrapArrayResponse<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function unwrapAccountsResponse<TAccount>(value: unknown): TAccount[] {
  if (Array.isArray(value)) return value as TAccount[];
  if (!value || typeof value !== "object") return [];

  const accounts = (value as Partial<AccountsEnvelope<TAccount>>).accounts;
  return Array.isArray(accounts) ? accounts : [];
}

export async function readJsonResponse<T>(response: Response, errorMessage: string): Promise<T> {
  if (!response.ok) throw new Error(errorMessage);
  return response.json() as Promise<T>;
}

export async function readArrayResponse<T>(response: Response, errorMessage: string): Promise<T[]> {
  return unwrapArrayResponse<T>(await readJsonResponse<unknown>(response, errorMessage));
}

export async function readAccountsResponse<TAccount>(
  response: Response,
  errorMessage = "Failed to fetch accounts",
): Promise<TAccount[]> {
  return unwrapAccountsResponse<TAccount>(await readJsonResponse<unknown>(response, errorMessage));
}
