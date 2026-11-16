/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { renderReadingHtml } from './utils/readingMode';
import {
  applyReactFlowEdgeOverlaysInClone,
  prepareSvgsForHtml2Canvas,
  sanitizePdfText,
  snapshotReactFlowEdges,
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

  it('snapshotReactFlowEdges + applyReactFlowEdgeOverlaysInClone injects top-level svg.pdf-canvas-edges-overlay with matrix transform, strokes, arrowheads, and edge labels', () => {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const container = document.createElement('div');
    const rf = document.createElement('div');
    rf.className = 'react-flow';
    Object.defineProperty(rf, 'getBoundingClientRect', {
      value: () => ({ width: 720, height: 380, top: 0, left: 0, right: 720, bottom: 380 }),
    });

    const viewport = document.createElement('div');
    viewport.className = 'react-flow__viewport';
    viewport.style.transform = 'translate(120px, 45px) scale(0.85)';

    const edgesSvg = document.createElementNS(SVG_NS, 'svg');
    edgesSvg.setAttribute('class', 'react-flow__edges');

    const edgeGroup = document.createElementNS(SVG_NS, 'g');
    edgeGroup.setAttribute('class', 'react-flow__edge');

    const edgePath = document.createElementNS(SVG_NS, 'path');
    edgePath.setAttribute('class', 'react-flow__edge-path');
    edgePath.setAttribute('d', 'M -50 20 C 20 20, 40 120, 150 120');
    edgePath.setAttribute('stroke', 'var(--border-strong, #888)');
    edgePath.setAttribute('marker-end', 'url(#arrow)');
    (edgePath as any).getTotalLength = () => 200;
    (edgePath as any).getPointAtLength = (d: number) => ({ x: -50 + d, y: d === 200 ? 120 : 20 });

    const labelWrapper = document.createElementNS(SVG_NS, 'g');
    labelWrapper.setAttribute('class', 'react-flow__edge-textwrapper');
    labelWrapper.setAttribute('transform', 'translate(40 60)');
    const labelBg = document.createElementNS(SVG_NS, 'rect');
    labelBg.setAttribute('class', 'react-flow__edge-textbg');
    labelBg.setAttribute('x', '-4');
    labelBg.setAttribute('y', '-2');
    labelBg.setAttribute('width', '22');
    labelBg.setAttribute('height', '16');
    const labelText = document.createElementNS(SVG_NS, 'text');
    labelText.setAttribute('class', 'react-flow__edge-text');
    labelText.textContent = 'Ja';
    labelWrapper.appendChild(labelBg);
    labelWrapper.appendChild(labelText);

    edgeGroup.appendChild(edgePath);
    edgeGroup.appendChild(labelWrapper);
    edgesSvg.appendChild(edgeGroup);

    const groupNode = document.createElement('div');
    groupNode.className = 'react-flow__node react-flow__node-group';
    const shapeNode = document.createElement('div');
    shapeNode.className = 'react-flow__node react-flow__node-shape';

    viewport.appendChild(edgesSvg);
    viewport.appendChild(groupNode);
    viewport.appendChild(shapeNode);
    rf.appendChild(viewport);
    container.appendChild(rf);
    document.body.appendChild(container);

    try {
      const snapshots = snapshotReactFlowEdges(container);
      expect(snapshots).toHaveLength(1);
      expect(rf.getAttribute('data-pdf-rf-idx')).toBe('0');

      const clonedContainer = container.cloneNode(true) as HTMLElement;
      applyReactFlowEdgeOverlaysInClone(clonedContainer, snapshots);

      const clonedRf = clonedContainer.querySelector('.react-flow[data-pdf-rf-idx="0"]') as HTMLElement;
      expect(clonedRf).not.toBeNull();

      const hiddenEdges = clonedRf.querySelector('.react-flow__edges') as HTMLElement;
      expect(hiddenEdges.style.display).toBe('none');

      const overlay = clonedRf.querySelector(':scope > svg.pdf-canvas-edges-overlay') as SVGSVGElement;
      expect(overlay).not.toBeNull();
      expect(overlay.getAttribute('width')).toBe('720');
      expect(overlay.getAttribute('height')).toBe('380');
      expect(overlay.getAttribute('viewBox')).toBe('0 0 720 380');
      expect(overlay.style.zIndex).toBe('2');

      const matrixGroup = overlay.querySelector('g[transform]');
      expect(matrixGroup).not.toBeNull();
      expect(matrixGroup?.getAttribute('transform')).toMatch(/^matrix\(/);

      const compositedPath = matrixGroup?.querySelector('path');
      expect(compositedPath).not.toBeNull();
      expect(compositedPath?.getAttribute('d')).toBe('M -50 20 C 20 20, 40 120, 150 120');
      expect(compositedPath?.getAttribute('stroke')).toBe('#64748b');
      expect(compositedPath?.getAttribute('fill')).toBe('none');

      const arrowhead = matrixGroup?.querySelector('polygon.pdf-baked-arrowhead');
      expect(arrowhead).not.toBeNull();
      expect(arrowhead?.getAttribute('fill')).toBe('#64748b');
      expect(arrowhead?.getAttribute('points')).toContain('150.00,120.00');

      const compositedLabel = matrixGroup?.querySelector('.react-flow__edge-textwrapper');
      expect(compositedLabel).not.toBeNull();
      expect(compositedLabel?.querySelector('.react-flow__edge-text')?.textContent).toBe('Ja');

      expect((clonedRf.querySelector('.react-flow__node-group') as HTMLElement).style.zIndex).toBe('1');
      expect((clonedRf.querySelector('.react-flow__node-shape') as HTMLElement).style.zIndex).toBe('4');
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
