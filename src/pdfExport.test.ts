/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { renderReadingHtml } from './utils/readingMode';
import {
  prepareSvgsForHtml2Canvas,
  sanitizePdfText,
  waitForEmbedsToRender,
} from './utils/pdfExport';
import { api } from './api';

describe('PDF Export & Reading Mode Embeds', () => {
  it('waitForEmbedsToRender resolves promptly when no embeds exist', async () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Plain note without embeds</p>';

    const start = Date.now();
    await waitForEmbedsToRender(container, 2500);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
  });

  it('waitForEmbedsToRender waits until .canvas-embed-loading disappears and .react-flow__node renders', async () => {
    const container = document.createElement('div');
    const canvasEmbed = document.createElement('div');
    canvasEmbed.className = 'embedded-canvas-container';
    const loading = document.createElement('div');
    loading.className = 'canvas-embed-loading';
    loading.textContent = 'Lädt Canvas-Vorschau...';
    canvasEmbed.appendChild(loading);
    container.appendChild(canvasEmbed);

    let resolved = false;
    const waitPromise = waitForEmbedsToRender(container, 2500).then(() => {
      resolved = true;
    });

    await new Promise((r) => setTimeout(r, 80));
    expect(resolved).toBe(false);

    // Simulate CanvasEmbedWidget finishing async fetch and mounting React Flow
    loading.remove();
    const rfNode = document.createElement('div');
    rfNode.className = 'react-flow__node';
    canvasEmbed.appendChild(rfNode);

    await waitPromise;
    expect(resolved).toBe(true);
  });

  it('uses an inline SVG icon instead of raw 📄 emoji for embedded note headers and PDF callouts in Reading Mode HTML', () => {
    const markdown = '![[AnotherNote]]\n\n![[Manual.pdf]]';
    const html = renderReadingHtml(markdown, 'Main.md', [], {
      attachmentLabel: 'Anhang',
    });

    expect(html).not.toContain('📄');
    expect(html).toContain('class="embedded-note-header"');
    expect(html).toContain('<svg class="embed-inline-icon"');
    expect(html).toContain('Eingebettete Notiz:');
    expect(html).toContain('AnotherNote');
  });

  it('sanitizePdfText strips UTF-16 surrogate-pair emojis while preserving German umlauts', () => {
    const input = '📄 Eingebettete Notiz: Überprüfung für Größe & Spaß ↗';
    const sanitized = sanitizePdfText(input);

    expect(sanitized).not.toContain('📄');
    expect(sanitized).toBe('Eingebettete Notiz: Überprüfung für Größe & Spaß ->');
  });

  it('prepareSvgsForHtml2Canvas sets explicit width/height on dimensionless SVGs, inlines edge strokes, and bakes arrowheads', () => {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const container = document.createElement('div');
    const rf = document.createElement('div');
    rf.className = 'react-flow';
    Object.defineProperty(rf, 'getBoundingClientRect', {
      value: () => ({ width: 640, height: 360, top: 0, left: 0, right: 640, bottom: 360 }),
    });

    const edgesSvg = document.createElementNS(SVG_NS, 'svg');
    edgesSvg.setAttribute('class', 'react-flow__edges');

    const edgeGroup = document.createElementNS(SVG_NS, 'g');
    edgeGroup.setAttribute('class', 'react-flow__edge');

    const edgePath = document.createElementNS(SVG_NS, 'path');
    edgePath.setAttribute('class', 'react-flow__edge-path');
    edgePath.setAttribute('d', 'M 10 10 L 110 10');
    edgePath.setAttribute('stroke', 'var(--text-muted)');
    edgePath.setAttribute('marker-end', 'url(#arrow)');

    // Mock SVGPathElement geometry APIs in JSDOM
    (edgePath as any).getTotalLength = () => 100;
    (edgePath as any).getPointAtLength = (d: number) => ({ x: 10 + d, y: 10 });

    edgeGroup.appendChild(edgePath);
    edgesSvg.appendChild(edgeGroup);
    rf.appendChild(edgesSvg);
    container.appendChild(rf);
    document.body.appendChild(container);

    try {
      prepareSvgsForHtml2Canvas(container);

      expect(Number(edgesSvg.getAttribute('width'))).toBe(640);
      expect(Number(edgesSvg.getAttribute('height'))).toBe(360);
      expect(edgesSvg.style.overflow).toBe('visible');

      expect(edgePath.getAttribute('stroke')).toBe('#64748b');
      expect(edgePath.getAttribute('stroke-width')).toBe('2');
      expect(edgePath.getAttribute('fill')).toBe('none');
      expect(edgePath.style.fill).toBe('none');

      const arrowhead = edgeGroup.querySelector('polygon.pdf-baked-arrowhead');
      expect(arrowhead).not.toBeNull();
      expect(arrowhead?.getAttribute('fill')).toBe('#64748b');
      expect(arrowhead?.getAttribute('points')).toContain('110.00,10.00');
    } finally {
      container.remove();
    }
  });

  it('api.sendNoteByEmail configures a timeout of at least 60000ms', async () => {
    const originalFetch = globalThis.fetch;
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ ok: true }),
    }) as any;

    try {
      await api.sendNoteByEmail({
        notePath: 'Test.md',
        to: 'user@example.com',
        format: 'pdf',
        pdfBase64: 'dGVzdA==',
      });

      const timeoutDelays = setTimeoutSpy.mock.calls.map((c) => Number(c[1] ?? 0));
      expect(timeoutDelays.some((ms) => ms >= 60000)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      setTimeoutSpy.mockRestore();
    }
  });
});
