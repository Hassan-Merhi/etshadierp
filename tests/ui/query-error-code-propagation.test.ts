/**
 * A failed request keeps its machine-readable reason.
 *
 * Several endpoints answer a refusal with a stable `code` beside the prose
 * message — the convergence reconciler's 409 names the invariant that failed,
 * for instance — and the client has to branch on that code to tell "we could
 * not trust the evidence" from any other error. The shared query error carried
 * `status` but dropped `code`, which left callers matching on message text:
 * a check that breaks the first time someone rewords a sentence, in the
 * direction of silently treating a hard failure as an ordinary one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getQueryFn } from "../../client/src/lib/queryClient";

function respondWith(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status,
      statusText: "Conflict",
      text: async () => JSON.stringify(body),
    }))
  );
}

function invoke(url: string) {
  const queryFn = getQueryFn<unknown>({ on401: "throw" });
  return (queryFn as (context: unknown) => Promise<unknown>)({
    queryKey: [url],
    signal: undefined,
    meta: undefined,
    client: undefined,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("query error code propagation", () => {
  it("carries the endpoint's code alongside the status and message", async () => {
    respondWith(409, {
      code: "DUPLICATE_DAYBOOK_MIRROR",
      message: "Voucher 912 has two Daybook mirror rows in company 7",
    });

    await expect(invoke("/api/admin/convergence-reconciliation")).rejects.toMatchObject({
      status: 409,
      code: "DUPLICATE_DAYBOOK_MIRROR",
      message: "Voucher 912 has two Daybook mirror rows in company 7",
    });
  });

  it("leaves code undefined when the endpoint did not send one", async () => {
    respondWith(500, { message: "Internal Server Error" });

    // Absent, not invented: a caller branching on a specific code must not be
    // handed a plausible-looking default it can accidentally match.
    const error = await invoke("/api/anything").then(
      () => null,
      (caught: unknown) => caught as { code?: unknown; status?: number }
    );

    expect(error?.status).toBe(500);
    expect(error?.code).toBeUndefined();
  });
});
