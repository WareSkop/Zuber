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
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
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
  } else if (ipVersion === 6) {
    if (lower === '::' || lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
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
    let response = await fetch(parsed.toString(), {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(2500),
    });

    if (response.status === 405 || response.status === 501) {
      response = await fetch(parsed.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(2500),
      });
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
