/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { renderReadingHtml } from './utils/readingMode';
import { sanitizePdfText, waitForEmbedsToRender } from './utils/pdfExport';

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
});
