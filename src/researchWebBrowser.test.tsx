// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeWebUrl,
  routeExternalLinkClick,
  shouldOpenLinkInResearchPane,
} from './utils/researchLinkUtils';
import { isPrivateOrLocalHostname, parseEmbedHeaders } from '../server/linkEmbedCheck';
import { ResearchPane } from './components/ResearchPane';
import { I18nProvider } from './i18n';
import { api } from './api';

describe('researchLinkUtils', () => {
  it('normalizes URLs and prepends https:// when no protocol is present', () => {
    expect(normalizeWebUrl('example.com')).toBe('https://example.com/');
    expect(normalizeWebUrl('  https://docs.example.org/guide  ')).toBe('https://docs.example.org/guide');
    expect(normalizeWebUrl('http://neverssl.com')).toBe('http://neverssl.com/');
    expect(normalizeWebUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeWebUrl('')).toBeNull();
  });

  it('routes normal left-click to Research Pane when split-view is open and bypasses on Ctrl/Cmd/Middle click', () => {
    expect(shouldOpenLinkInResearchPane(false, { button: 0 })).toBe(false);
    expect(shouldOpenLinkInResearchPane(true, { button: 0 })).toBe(true);
    expect(shouldOpenLinkInResearchPane(true, { ctrlKey: true, button: 0 })).toBe(false);
    expect(shouldOpenLinkInResearchPane(true, { metaKey: true, button: 0 })).toBe(false);
    expect(shouldOpenLinkInResearchPane(true, { button: 1 })).toBe(false);

    const onOpenInResearch = vi.fn();
    const openExternal = vi.fn();
    const preventDefault = vi.fn();

    const normalRes = routeExternalLinkClick({
      url: 'https://example.com',
      isResearchOpen: true,
      event: { button: 0, preventDefault },
      onOpenInResearch,
      openExternal,
    });
    expect(normalRes).toBe('research');
    expect(onOpenInResearch).toHaveBeenCalledWith('https://example.com');
    expect(openExternal).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();

    onOpenInResearch.mockClear();
    const ctrlRes = routeExternalLinkClick({
      url: 'https://example.com',
      isResearchOpen: true,
      event: { ctrlKey: true, button: 0, preventDefault },
      onOpenInResearch,
      openExternal,
    });
    expect(ctrlRes).toBe('external');
    expect(onOpenInResearch).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith('https://example.com');
  });
});

describe('server/linkEmbedCheck', () => {
  it('detects X-Frame-Options and CSP frame-ancestors restrictions', () => {
    expect(parseEmbedHeaders('DENY', null)).toMatchObject({
      embeddable: false,
      reason: 'x-frame-options',
    });
    expect(parseEmbedHeaders('SAMEORIGIN', null)).toMatchObject({
      embeddable: false,
      reason: 'x-frame-options',
    });
    expect(parseEmbedHeaders(null, "default-src 'self'; frame-ancestors 'none'")).toMatchObject({
      embeddable: false,
      reason: 'csp-frame-ancestors',
    });
    expect(parseEmbedHeaders(null, "frame-ancestors 'self' https://github.com")).toMatchObject({
      embeddable: false,
      reason: 'csp-frame-ancestors',
    });
    expect(parseEmbedHeaders(null, 'frame-ancestors *')).toMatchObject({
      embeddable: true,
    });
    expect(parseEmbedHeaders(null, null)).toMatchObject({
      embeddable: true,
    });
  });

  it('blocks private and loopback hostnames against SSRF', () => {
    expect(isPrivateOrLocalHostname('localhost')).toBe(true);
    expect(isPrivateOrLocalHostname('127.0.0.1')).toBe(true);
    expect(isPrivateOrLocalHostname('192.168.1.10')).toBe(true);
    expect(isPrivateOrLocalHostname('10.0.0.5')).toBe(true);
    expect(isPrivateOrLocalHostname('example.com')).toBe(false);
  });
});

describe('ResearchPane Web Browser', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('renders Markdown reader by default, switches to sandboxed iframe in HTML mode, and normalizes submitted URL', async () => {
    vi.spyOn(api, 'extractWebUrl').mockResolvedValue({
      type: 'article',
      url: 'https://example.com/',
      title: 'Example Domain',
      byline: null,
      siteName: 'Example',
      markdown: 'Sample extracted article body.',
    });
    vi.spyOn(api, 'checkLinkEmbed').mockResolvedValue({ embeddable: true });
    const onOpenWebUrl = vi.fn();

    await act(async () => {
      root.render(
        <I18nProvider>
          <ResearchPane
            target={{ path: 'https://example.com', type: 'web' }}
            orientation="horizontal"
            onToggleOrientation={vi.fn()}
            onOpenInMain={vi.fn()}
            onClose={vi.fn()}
            onNavigate={vi.fn()}
            onShowGraph={vi.fn()}
            onOpenWebUrl={onOpenWebUrl}
            graphData={{ nodes: [], edges: [], tags: [] }}
            allNotes={[]}
            activeNotePath={null}
          />
        </I18nProvider>
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="research-web-reader"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="research-web-iframe"]')).toBeNull();

    // Switch to HTML mode -> renders sandboxed iframe
    const htmlBtn = container.querySelector('[data-testid="research-web-mode-html"]') as HTMLButtonElement;
    expect(htmlBtn).toBeTruthy();
    await act(async () => {
      htmlBtn.click();
    });

    const iframe = container.querySelector('[data-testid="research-web-iframe"]') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.src).toBe('https://example.com/');

    const input = container.querySelector('[data-testid="research-web-url-input"]') as HTMLInputElement;
    const form = container.querySelector('[data-testid="research-web-bar"]') as HTMLFormElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'wikipedia.org');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(onOpenWebUrl).toHaveBeenCalledWith('https://wikipedia.org/');
  });

  it('shows fallback card in HTML mode when embed pre-check reports X-Frame-Options/CSP block', async () => {
    vi.spyOn(api, 'extractWebUrl').mockResolvedValue({
      type: 'article',
      url: 'https://github.com/',
      title: 'GitHub',
      byline: null,
      siteName: 'GitHub',
      markdown: 'Repo content.',
    });
    vi.spyOn(api, 'checkLinkEmbed').mockResolvedValue({
      embeddable: false,
      reason: 'x-frame-options',
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    await act(async () => {
      root.render(
        <I18nProvider>
          <ResearchPane
            target={{ path: 'https://github.com', type: 'web' }}
            orientation="horizontal"
            onToggleOrientation={vi.fn()}
            onOpenInMain={vi.fn()}
            onClose={vi.fn()}
            onNavigate={vi.fn()}
            onShowGraph={vi.fn()}
            onOpenWebUrl={vi.fn()}
            graphData={{ nodes: [], edges: [], tags: [] }}
            allNotes={[]}
            activeNotePath={null}
          />
        </I18nProvider>
      );
    });

    await act(async () => {
      (container.querySelector('[data-testid="research-web-mode-html"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const card = container.querySelector('[data-testid="research-web-blocked-card"]');
    expect(card).toBeTruthy();
    const openBtn = container.querySelector('[data-testid="research-web-blocked-open-btn"]') as HTMLButtonElement;
    await act(async () => {
      openBtn.click();
    });
    expect(openSpy).toHaveBeenCalledWith('https://github.com', '_blank', 'noopener,noreferrer');
  });
});
