/**
 * A cancelled request is not a failure. React Query surfaces the rejection of
 * an aborted fetch as a query error, so anything that renders error UI has to
 * tell the two apart — otherwise a request nobody wanted any more shows up as a
 * problem the user is asked to act on.
 */
export function isAbortError(error: unknown): boolean {
  const candidate = error as { name?: string } | null;
  return candidate?.name === "AbortError" || candidate?.name === "CancelledError";
}

/**
 * True when a query error should be shown to the user: it is a real failure and
 * there is no previously loaded data still on screen. React Query keeps the last
 * successful `data` when a background refetch fails, and a stale banner over
 * perfectly good rows is noise, not information.
 */
export function isBlockingQueryError(error: unknown, hasData: boolean): boolean {
  if (!error || isAbortError(error)) return false;
  return !hasData;
}
