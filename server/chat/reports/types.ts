export interface DataQueryContext {
  companyId: number;
  params: Record<string, unknown> & { queryType?: string };
  dateFrom: string;
  dateTo: string;
  todayStr: string;
  todayDate: Date;
  thisMonthStart: string;
  lastMonthStart: string;
  lastMonthEnd: string;
  rowLimit: number;
  userMessage: string;
  fmt: (n: number) => string;
  fmtDec: (n: number) => string;
}

export type DataQueryResult = Record<string, unknown> | undefined;

export interface ReportDomainHandler {
  readonly domain: string;
  readonly queryTypes: readonly string[];
  handles(queryType: string): boolean;
  run(ctx: DataQueryContext): Promise<DataQueryResult>;
}
