import dns from 'node:dns';
import net from 'node:net';
import { createRequire } from 'node:module';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { isPrivateOrLocalHostname } from './linkEmbedCheck';
import type { WebExtractArticleResponse, WebExtractResponse } from '../shared/types';

const require = createRequire(import.meta.url);
const turndownPluginGfm = require('turndown-plugin-gfm') as {
  gfm?: TurndownService.Plugin;
  default?: { gfm?: TurndownService.Plugin };
};
const gfmPlugin = turndownPluginGfm.gfm || turndownPluginGfm.default?.gfm;

export const MAX_PROXY_PDF_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_HTML_BYTES = 10 * 1024 * 1024; // 10 MB
export const WEB_FETCH_TIMEOUT_MS = 12000;
const REALISTIC_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export type DnsLookupFn = (
  hostname: string
) => Promise<Array<{ address: string; family: number }>>;

export interface WebReaderDeps {
  fetchImpl?: typeof fetch;
  dnsLookup?: DnsLookupFn;
}

export class WebReaderError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = 'WebReaderError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

async function defaultDnsLookup(
  hostname: string
): Promise<Array<{ address: string; family: number }>> {
  const results = await dns.promises.lookup(hostname, { all: true });
  return Array.isArray(results) ? results : [results];
}

/**
 * Validates that `rawUrl` uses http(s), does not target localhost/private/link-local IPs,
 * and does not resolve via DNS to any private/loopback/link-local address (SSRF guard).
 */
export async function assertSafeExternalUrl(
  rawUrl: string,
  deps?: Pick<WebReaderDeps, 'dnsLookup'>
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new WebReaderError('Invalid URL format', 400, 'invalid-url');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebReaderError('Only http and https URLs are allowed', 400, 'invalid-protocol');
  }

  if (isPrivateOrLocalHostname(parsed.hostname)) {
    throw new WebReaderError('Access to private or local hosts is blocked', 403, 'blocked-host');
  }

  const hostBare = parsed.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(hostBare) === 0) {
    const lookupFn = deps?.dnsLookup || defaultDnsLookup;
    try {
      const addresses = await lookupFn(hostBare);
      if (addresses.some((entry) => isPrivateOrLocalHostname(entry.address))) {
        throw new WebReaderError(
          'Resolved IP belongs to a private or local network',
          403,
          'blocked-host'
        );
      }
    } catch (err) {
      if (err instanceof WebReaderError) throw err;
      // If a custom mock/system DNS fails transiently, let fetch handle connection errors
      // unless hostname was directly private.
    }
  }

  return parsed;
}

function resolveHttpOrKeepUrl(raw: string | null | undefined, baseUrl: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^(javascript|vbscript|data):/i.test(trimmed)) return null;
  try {
    const resolved = new URL(trimmed, baseUrl);
    if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
      return resolved.toString();
    }
  } catch {}
  return null;
}

/**
 * Resolves relative image (`src`, `data-src`, `data-original`, `data-lazy-src`, `srcset`)
 * and link (`href`) attributes against `baseUrl` into absolute `http(s)://` URLs.
 */
export function resolveRelativeUrlsInDocument(document: any, baseUrl: string): void {
  const imgs = Array.from(document.querySelectorAll('img')) as any[];
  for (const img of imgs) {
    const srcAttr = (img.getAttribute('src') || '').trim();
    const lazySrc =
      (img.getAttribute('data-src') ||
        img.getAttribute('data-lazy-src') ||
        img.getAttribute('data-original') ||
        '').trim();

    const isPlaceholderSrc = !srcAttr || /^data:image\//i.test(srcAttr);
    const chosenRaw = isPlaceholderSrc && lazySrc ? lazySrc : srcAttr || lazySrc;

    if (chosenRaw) {
      const resolvedSrc = resolveHttpOrKeepUrl(chosenRaw, baseUrl);
      if (resolvedSrc) {
        img.setAttribute('src', resolvedSrc);
      } else if (/^(javascript|vbscript):/i.test(chosenRaw)) {
        img.removeAttribute('src');
      }
    }

    const srcset = img.getAttribute('srcset');
    if (srcset) {
      const rewritten = srcset
        .split(',')
        .map((candidate: string) => {
          const parts = candidate.trim().split(/\s+/);
          if (!parts[0]) return candidate;
          const abs = resolveHttpOrKeepUrl(parts[0], baseUrl);
          return abs ? [abs, ...parts.slice(1)].join(' ') : candidate;
        })
        .join(', ');
      img.setAttribute('srcset', rewritten);
    }
  }

  const anchors = Array.from(document.querySelectorAll('a[href]')) as any[];
  for (const a of anchors) {
    const rawHref = (a.getAttribute('href') || '').trim();
    if (!rawHref) continue;
    if (/^(javascript|vbscript|data):/i.test(rawHref)) {
      a.removeAttribute('href');
      continue;
    }
    const resolvedHref = resolveHttpOrKeepUrl(rawHref, baseUrl);
    if (resolvedHref) {
      a.setAttribute('href', resolvedHref);
    }
  }
}

function buildTurndownService(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  });

  if (gfmPlugin) {
    td.use(gfmPlugin);
  }

  td.remove(['script', 'style', 'noscript', 'iframe']);
  td.addRule('stripSvg', {
    filter: (node) => node.nodeName.toLowerCase() === 'svg',
    replacement: () => '',
  });
  return td;
}

/**
 * Extracts a clean, ad-free GFM Markdown article from raw HTML using LinkeDOM,
 * `@mozilla/readability`, and Turndown + GFM plugin after resolving relative URLs.
 */
export function extractArticleFromHtml(
  html: string,
  finalUrl: string
): WebExtractArticleResponse {
  const { document } = parseHTML(html);
  resolveRelativeUrlsInDocument(document, finalUrl);

  const fallbackTitle =
    (document.querySelector('title')?.textContent || '').trim() ||
    (() => {
      try {
        return new URL(finalUrl).hostname;
      } catch {
        return finalUrl;
      }
    })();

  let parsedArticle: ReturnType<Readability['parse']> = null;
  try {
    const reader = new Readability(document as unknown as Document);
    parsedArticle = reader.parse();
  } catch {
    parsedArticle = null;
  }

  const articleHtml =
    parsedArticle?.content ||
    document.querySelector('article, main')?.innerHTML ||
    document.body?.innerHTML ||
    html;

  const td = buildTurndownService();
  let markdown = td.turndown(articleHtml || '').trim();
  markdown = markdown.replace(/\n{3,}/g, '\n\n');

  const title = (parsedArticle?.title || '').trim() || fallbackTitle;
  const byline = parsedArticle?.byline ? parsedArticle.byline.trim() || null : null;
  const siteName = parsedArticle?.siteName ? parsedArticle.siteName.trim() || null : null;

  return {
    type: 'article',
    url: finalUrl,
    title,
    byline,
    siteName,
    markdown,
  };
}

async function fetchWithSafeRedirects(
  rawUrl: string,
  acceptHeader: string,
  deps?: WebReaderDeps,
  maxRedirects = 5
): Promise<{ response: Response; finalUrl: string }> {
  const fetchFn = deps?.fetchImpl || fetch;
  let currentUrl = await assertSafeExternalUrl(rawUrl, deps);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let response: Response;
    try {
      response = await fetchFn(currentUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': REALISTIC_USER_AGENT,
          Accept: acceptHeader,
          'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        signal: AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS),
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new WebReaderError('Upstream request timed out', 504, 'timeout');
      }
      throw new WebReaderError(err?.message || 'Failed to fetch target URL', 502, 'fetch-failed');
    }

    if (response.status >= 300 && response.status < 400) {
      try {
        await response.body?.cancel();
      } catch {}
      const location = response.headers.get('location');
      if (!location) {
        throw new WebReaderError('Redirect missing Location header', 502, 'bad-redirect');
      }
      if (hop === maxRedirects) {
        throw new WebReaderError('Too many redirects', 502, 'too-many-redirects');
      }
      let nextCandidate: URL;
      try {
        nextCandidate = new URL(location, currentUrl);
      } catch {
        throw new WebReaderError('Invalid redirect target URL', 400, 'invalid-url');
      }
      currentUrl = await assertSafeExternalUrl(nextCandidate.toString(), deps);
      continue;
    }

    return { response, finalUrl: currentUrl.toString() };
  }

  throw new WebReaderError('Too many redirects', 502, 'too-many-redirects');
}

function titleFromUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    const segment = parsed.pathname.split('/').filter(Boolean).pop();
    return segment ? decodeURIComponent(segment) : parsed.hostname;
  } catch {
    return urlStr;
  }
}

async function readTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return await response.text();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {}
        throw new WebReaderError('HTML response exceeds size limit', 413, 'payload-too-large');
      }
      chunks.push(value);
    }
  }

  const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return merged.toString('utf-8');
}

/**
 * Fetches an external web URL safely (SSRF guard, redirect checks, 12s timeout) and either
 * identifies a PDF document (`{ type: 'pdf', url, title }`) or extracts clean Markdown (`type: 'article'`).
 */
export async function extractWebUrl(
  rawUrl: string,
  deps?: WebReaderDeps
): Promise<WebExtractResponse> {
  const { response, finalUrl } = await fetchWithSafeRedirects(
    rawUrl,
    'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
    deps
  );

  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {}
    throw new WebReaderError(
      `Upstream returned HTTP ${response.status}`,
      response.status >= 400 && response.status < 600 ? 502 : response.status,
      'upstream-error'
    );
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const looksLikePdf =
    contentType.includes('application/pdf') ||
    (contentType.includes('application/octet-stream') &&
      /\.pdf(?:$|\?)/i.test(finalUrl));

  if (looksLikePdf) {
    try {
      await response.body?.cancel();
    } catch {}
    return {
      type: 'pdf',
      url: finalUrl,
      title: titleFromUrl(finalUrl),
    };
  }

  if (
    contentType &&
    !contentType.includes('text/html') &&
    !contentType.includes('application/xhtml+xml') &&
    !contentType.includes('text/plain')
  ) {
    try {
      await response.body?.cancel();
    } catch {}
    throw new WebReaderError(
      `Unsupported content type for reader mode: ${contentType}`,
      415,
      'unsupported-media-type'
    );
  }

  const html = await readTextWithLimit(response, MAX_HTML_BYTES);
  return extractArticleFromHtml(html, finalUrl);
}

/**
 * Validates and opens an upstream external PDF stream with SSRF protection and 50 MB size limit.
 */
export async function fetchExternalPdfStream(
  rawUrl: string,
  deps?: WebReaderDeps
): Promise<{ response: Response; finalUrl: string; contentLength: number | null }> {
  const { response, finalUrl } = await fetchWithSafeRedirects(
    rawUrl,
    'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
    deps
  );

  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {}
    throw new WebReaderError(
      `Upstream returned HTTP ${response.status}`,
      502,
      'upstream-error'
    );
  }

  const rawLen = response.headers.get('content-length');
  const parsedLen = rawLen ? Number(rawLen) : NaN;
  const contentLength = Number.isFinite(parsedLen) && parsedLen >= 0 ? parsedLen : null;

  if (contentLength !== null && contentLength > MAX_PROXY_PDF_BYTES) {
    try {
      await response.body?.cancel();
    } catch {}
    throw new WebReaderError(
      `PDF exceeds maximum allowed size of ${MAX_PROXY_PDF_BYTES} bytes`,
      413,
      'payload-too-large'
    );
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (
    contentType &&
    !contentType.includes('application/pdf') &&
    !contentType.includes('application/octet-stream') &&
    !contentType.includes('binary/octet-stream')
  ) {
    try {
      await response.body?.cancel();
    } catch {}
    throw new WebReaderError(
      `Expected PDF content type, got ${contentType}`,
      415,
      'unsupported-media-type'
    );
  }

  return { response, finalUrl, contentLength };
}
