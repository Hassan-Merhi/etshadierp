export interface LegacyRouteRegistration {
  file: string;
  line: number;
  method: string;
  path: string;
  signature: string;
}

export interface LegacyRouteBoundaryReport {
  generatedAt: string;
  configVersion: number;
  summary: {
    legacyFiles: number;
    totalLines: number;
    totalRouteRegistrations: number;
    duplicateRouteSignatures: number;
    failures: number;
  };
  files: Array<{
    path: string;
    owner: string;
    maxLines: number;
    targetLines: number;
    migrationPhase: number;
    actualLines: number;
    remainingToTarget: number;
    routeRegistrations: number;
    routes: LegacyRouteRegistration[];
  }>;
  duplicateRoutes: Array<{
    signature: string;
    entries: LegacyRouteRegistration[];
  }>;
  failures: string[];
}

export function auditLegacyRouteBoundaries(options?: { root?: string }): LegacyRouteBoundaryReport;
