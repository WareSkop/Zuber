import { describe, it, expect, vi } from 'vitest';
import {
  assertSafeExternalUrl,
  extractArticleFromHtml,
  extractWebUrl,
  fetchExternalPdfStream,
  MAX_PROXY_PDF_BYTES,
  WebReaderError,
} from './webReaderService';

const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];

describe('webReaderService - SSRF Guard, Readability & Turndown Extraction', () => {
  it('blocks localhost, private IPv4/IPv6 ranges, DNS rebinding IPs, and non-HTTP schemes', async () => {
    const blockedUrls = [
      'http://localhost/admin',
      'http://127.0.0.1:3000/api',
      'http://10.0.0.5/internal',
      'http://172.16.4.20/metrics',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]:8080/',
      'http://[fe80::1]/',
      'http://[::ffff:127.0.0.1]/',
      'file:///etc/passwd',
      'javascript:alert(1)',
    ];

    for (const bad of blockedUrls) {
      await expect(assertSafeExternalUrl(bad, { dnsLookup: publicDns })).rejects.toThrow(
        WebReaderError
      );
    }

    // DNS resolution returning a private IP for a public-looking hostname must be rejected
    await expect(
      assertSafeExternalUrl('https://rebind.example.com/secret', {
        dnsLookup: async () => [{ address: '10.20.30.40', family: 4 }],
      })
    ).rejects.toThrow(WebReaderError);

    // Public HTTPS URL resolves safely
    const safe = await assertSafeExternalUrl('https://example.com/articles/1', {
      dnsLookup: publicDns,
    });
    expect(safe.hostname).toBe('example.com');
  });

  it('blocks HTTP redirects pointing to localhost or private IP targets', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:8080/internal' },
      });
    });

    await expect(
      extractWebUrl('https://example.com/redirect', {
        fetchImpl: fetchMock as unknown as typeof fetch,
        dnsLookup: publicDns,
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'blocked-host',
    });
  });

  it('extracts ad-free GFM Markdown with Readability + Turndown and resolves relative/lazy image & link URLs', () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>Understanding Consensus | Example Site</title>
        </head>
        <body>
          <nav><a href="/pricing">Pricing</a><a href="/login">Login</a></nav>
          <aside class="ads">Buy our product now! Limited offer!</aside>
          <main>
            <article>
              <h1>Understanding Consensus</h1>
              <p class="byline">By Ada Lovelace</p>
              <p>Distributed systems rely on quorum agreement. Read <a href="../guides/quorum">Part 2</a> for proofs.</p>
              <p>See diagram below:</p>
              <img src="/assets/quorum.png" alt="Quorum Diagram" />
              <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="img/timeline.webp" alt="Timeline" />
              <blockquote>
                <p>First line of quote.</p>
                <p>Second line of quote.</p>
              </blockquote>
              <table>
                <thead><tr><th>Node</th><th>State</th></tr></thead>
                <tbody><tr><td>n1</td><td>Leader</td></tr></tbody>
              </table>
              <script>window.__evil = true;</script>
            </article>
          </main>
          <footer>Copyright 2026 Cookie Banner</footer>
        </body>
      </html>
    `;

    const res = extractArticleFromHtml(html, 'https://example.com/blog/2026/consensus.html');
    expect(res.type).toBe('article');
    expect(res.title).toContain('Understanding Consensus');
    expect(res.markdown).toContain('Distributed systems rely on quorum agreement.');
    expect(res.markdown).toContain('[Part 2](https://example.com/blog/guides/quorum)');
    expect(res.markdown).toContain('![Quorum Diagram](https://example.com/assets/quorum.png)');
    expect(res.markdown).toContain('![Timeline](https://example.com/blog/2026/img/timeline.webp)');
    expect(res.markdown).toContain('| Node | State |');
    expect(res.markdown).not.toContain('Buy our product now');
    expect(res.markdown).not.toContain('window.__evil');
  });

  it('detects application/pdf targets in extractWebUrl and enforces the 50 MB size limit in fetchExternalPdfStream', async () => {
    const pdfExtractFetch = vi.fn(async () => {
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    });

    const extracted = await extractWebUrl('https://example.com/docs/Whitepaper%20v2.pdf', {
      fetchImpl: pdfExtractFetch as unknown as typeof fetch,
      dnsLookup: publicDns,
    });
    expect(extracted).toEqual({
      type: 'pdf',
      url: 'https://example.com/docs/Whitepaper%20v2.pdf',
      title: 'Whitepaper v2.pdf',
    });

    const oversizedFetch = vi.fn(async () => {
      return new Response(null, {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-length': String(MAX_PROXY_PDF_BYTES + 1),
        },
      });
    });

    await expect(
      fetchExternalPdfStream('https://example.com/huge.pdf', {
        fetchImpl: oversizedFetch as unknown as typeof fetch,
        dnsLookup: publicDns,
      })
    ).rejects.toMatchObject({
      statusCode: 413,
      code: 'payload-too-large',
    });
  });
});
