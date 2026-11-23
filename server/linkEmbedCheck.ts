import net from 'node:net';

export interface EmbedCheckResult {
  embeddable: boolean;
  reason?: 'x-frame-options' | 'csp-frame-ancestors' | 'invalid-url' | 'blocked-host';
  headerValue?: string;
  status?: number;
  uncertain?: boolean;
}

/**
 * Checks whether a hostname resolves to a private, loopback, or link-local address
 * to prevent SSRF when pre-checking external link embed headers.
 */
export function isPrivateOrLocalHostname(hostname: string): boolean {
  const lower = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!lower) return true;
  if (
    lower === 'localhost' ||
    lower === '0.0.0.0' ||
    lower === '::1' ||
    lower === '0:0:0:0:0:0:0:1' ||
    lower === '0:0:0:0:0:0:0:0' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }

  // Unwrap IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice('::ffff:'.length);
    if (net.isIP(mapped) === 4) {
      return isPrivateOrLocalHostname(mapped);
    }
    const hexMatch = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hexMatch) {
      const hi = parseInt(hexMatch[1], 16);
      const lo = parseInt(hexMatch[2], 16);
      const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateOrLocalHostname(ipv4);
    }
  }

  const ipVersion = net.isIP(lower);
  if (ipVersion === 4) {
    const parts = lower.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  } else if (ipVersion === 6) {
    if (
      lower === '::' ||
      lower === '::1' ||
      /^fe[89ab][0-9a-f]:/i.test(lower) ||
      /^f[cd][0-9a-f]{2}:/i.test(lower) ||
      lower.startsWith('ff')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Inspects `X-Frame-Options` and `Content-Security-Policy` (`frame-ancestors`) headers
 * to determine if a target page allows iframe embedding.
 */
export function parseEmbedHeaders(
  xFrameOptions?: string | null,
  csp?: string | null
): EmbedCheckResult {
  if (xFrameOptions) {
    const normalizedXfo = xFrameOptions.trim().toUpperCase();
    if (
      normalizedXfo === 'DENY' ||
      normalizedXfo === 'SAMEORIGIN' ||
      normalizedXfo.startsWith('ALLOW-FROM')
    ) {
      return {
        embeddable: false,
        reason: 'x-frame-options',
        headerValue: xFrameOptions.trim(),
      };
    }
  }

  if (csp) {
    const directives = csp.split(';');
    for (const rawDirective of directives) {
      const trimmed = rawDirective.trim();
      if (!trimmed) continue;
      const tokens = trimmed.split(/\s+/);
      const name = tokens[0]?.toLowerCase();
      if (name === 'frame-ancestors') {
        const sources = tokens.slice(1).map((s) => s.toLowerCase());
        const allowsAll = sources.includes('*');
        if (!allowsAll) {
          return {
            embeddable: false,
            reason: 'csp-frame-ancestors',
            headerValue: trimmed,
          };
        }
      }
    }
  }

  return { embeddable: true };
}

async function safeFetchWithRedirects(
  initialUrl: URL,
  method: 'HEAD' | 'GET',
  maxRedirects = 3
): Promise<{ response: Response } | { blockedReason: 'invalid-url' | 'blocked-host' }> {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetch(currentUrl.toString(), {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(2500),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || hop === maxRedirects) {
        return { response };
      }
      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        return { blockedReason: 'invalid-url' };
      }
      if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
        return { blockedReason: 'invalid-url' };
      }
      if (isPrivateOrLocalHostname(nextUrl.hostname)) {
        return { blockedReason: 'blocked-host' };
      }
      currentUrl = nextUrl;
      continue;
    }

    return { response };
  }
  throw new Error('Max redirects exceeded');
}

/**
 * Validates `rawUrl` and performs a fast HEAD (fallback GET) request with a 2500ms timeout
 * to inspect `X-Frame-Options` and `Content-Security-Policy` headers.
 */
export async function checkUrlEmbeddable(rawUrl: string): Promise<EmbedCheckResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { embeddable: false, reason: 'invalid-url' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { embeddable: false, reason: 'invalid-url' };
  }

  if (isPrivateOrLocalHostname(parsed.hostname)) {
    return { embeddable: false, reason: 'blocked-host' };
  }

  try {
    let fetchOutcome = await safeFetchWithRedirects(parsed, 'HEAD');
    if ('blockedReason' in fetchOutcome) {
      return { embeddable: false, reason: fetchOutcome.blockedReason };
    }
    let response = fetchOutcome.response;

    if (response.status === 405 || response.status === 501) {
      fetchOutcome = await safeFetchWithRedirects(parsed, 'GET');
      if ('blockedReason' in fetchOutcome) {
        return { embeddable: false, reason: fetchOutcome.blockedReason };
      }
      response = fetchOutcome.response;
      try {
        await response.body?.cancel();
      } catch {}
    }

    const headerResult = parseEmbedHeaders(
      response.headers.get('x-frame-options'),
      response.headers.get('content-security-policy')
    );
    return {
      ...headerResult,
      status: response.status,
    };
  } catch {
    return { embeddable: true, uncertain: true };
  }
}
