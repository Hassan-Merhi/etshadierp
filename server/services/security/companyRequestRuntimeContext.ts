import { AsyncLocalStorage } from "node:async_hooks";

export interface CompanyRequestRuntimeContext {
  userId: string;
  companyId: number;
  role: string;
  method: string;
  path: string;
  developerBypass: boolean;
}

const companyRequestRuntime = new AsyncLocalStorage<CompanyRequestRuntimeContext>();

export function runWithCompanyRequestRuntimeContext<T>(context: CompanyRequestRuntimeContext, callback: () => T): T {
  return companyRequestRuntime.run(context, callback);
}

export function getCompanyRequestRuntimeContext(): CompanyRequestRuntimeContext | undefined {
  return companyRequestRuntime.getStore();
}
