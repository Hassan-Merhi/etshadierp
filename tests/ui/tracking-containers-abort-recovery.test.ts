import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("tracking containers abort recovery", () => {
  it("clears stale tracking queries before mounting the active company", () => {
    const boundary = source("client/src/pages/tracking/TrackingContainersTab.tsx");

    expect(boundary).toContain("selectedCompany?.id");
    expect(boundary).toContain("queryClient.cancelQueries");
    expect(boundary).toContain("queryClient.removeQueries");
    expect(boundary).toContain("readyCompanyId !== companyId");
  });

  it("recovers aborted tracking requests instead of leaving permanent error UI", () => {
    const boundary = source("client/src/pages/tracking/TrackingContainersTab.tsx");

    expect(boundary).toContain('name === "AbortError"');
    expect(boundary).toContain("queryClient.getQueryCache().subscribe");
    expect(boundary).toContain("queryClient.resetQueries");
    expect(boundary).toContain("recovering.has(query.queryHash)");
  });

  it("routes the Containers OTW tab through the recovery boundary", () => {
    const hub = source("client/src/pages/TrackingHub.tsx");

    expect(hub).toContain('import("@/pages/tracking/TrackingContainersTab")');
    expect(hub).toContain("<TrackingContainersTab />");
    expect(hub).not.toContain('import("@/pages/GITContainers")');
  });
});
