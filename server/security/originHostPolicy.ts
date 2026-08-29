const TRUSTED_PRODUCTION_HOST_ALIAS_GROUPS: readonly ReadonlySet<string>[] = [
  new Set(["hmdinternationalgroup.com", "www.hmdinternationalgroup.com"]),
];

type ParsedHost = {
  hostname: string;
  port: string;
};

function parseHost(value: string): ParsedHost | null {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;

  try {
    const parsed = new URL(`http://${raw}`);
    return {
      hostname: parsed.hostname.replace(/\.$/, ""),
      port: parsed.port,
    };
  } catch {
    return null;
  }
}

/**
 * Determines whether an Origin/Referer host may be treated as the same browser
 * site as the request Host for state-changing API requests.
 *
 * Exact host matches remain the default. The only cross-host allowance is an
 * explicitly enumerated production alias group. This deliberately avoids a
 * generic "strip www" rule, which could broaden trust for unrelated/custom
 * domains. Non-default explicit ports must also match.
 */
export function isTrustedOriginHost(sourceHost: string, requestHost: string): boolean {
  const source = parseHost(sourceHost);
  const request = parseHost(requestHost);
  if (!source || !request) return false;

  if (source.hostname === request.hostname && source.port === request.port) return true;
  if (source.port !== request.port) return false;

  return TRUSTED_PRODUCTION_HOST_ALIAS_GROUPS.some(
    (group) => group.has(source.hostname) && group.has(request.hostname)
  );
}
