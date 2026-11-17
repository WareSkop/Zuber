/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';
import { LivePreviewEditor } from './LivePreviewEditor';
import { I18nProvider } from '../i18n';
import { App } from '../App';
import { api } from '../api';
import { syncEngine } from '../sync/syncEngine';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => {
      store[key] = String(val);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, configurable: true });

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe('ErrorBoundary & Startup Crash Prevention (React Error #60 & Recovery Buttons)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorageMock.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('renders fallback UI cleanly when child throws string style prop or React Error #60', () => {
    const BrokenChild = () => {
      throw new Error(
        'The style prop expects a mapping from style properties to values, not a string.'
      );
    };

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => {
      root.render(
        <ErrorBoundary>
          <BrokenChild />
        </ErrorBoundary>
      );
    });
    consoleSpy.mockRestore();

    const overlay = container.querySelector('.error-boundary-overlay') as HTMLElement | null;
    expect(overlay).not.toBeNull();
    expect(overlay!.style.position).toBe('fixed');
    expect(overlay!.style.zIndex).toBe('99999');
    expect(overlay!.style.pointerEvents).toBe('auto');
    expect(overlay!.textContent).toContain(
      'The style prop expects a mapping from style properties to values, not a string.'
    );

    const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons).toHaveLength(5);
    for (const btn of buttons) {
      expect(btn.getAttribute('type')).toBe('button');
      expect(btn.style.minHeight).toBe('44px');
      expect(btn.style.touchAction).toBe('manipulation');
    }
  });

  it('clears active view/tab keys while preserving auth tokens and reloads on "Ansicht zurücksetzen & neu laden"', () => {
    localStorage.setItem('zuber_last_active_note', 'Crash.md');
    localStorage.setItem('knowmesh_last_active_note', 'Crash.md');
    localStorage.setItem('basalt_last_active_note', 'Crash.md');
    localStorage.setItem('zuber_open_tabs', '["Crash.md"]');
    localStorage.setItem('knowmesh_open_tabs', '["Crash.md"]');
    localStorage.setItem('basalt_open_tabs', '["Crash.md"]');
    localStorage.setItem('zuber_auth_token', 'secret-jwt-token');
    localStorage.setItem('knowmesh_auth_token', 'secret-jwt-token');

    const replaceMock = vi.fn();
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        origin: 'https://zuber.waresk.com',
        replace: replaceMock,
        reload: reloadMock,
      },
    });

    const BrokenChild = () => {
      throw new Error('Minified React error #60');
    };

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => {
      root.render(
        <ErrorBoundary>
          <BrokenChild />
        </ErrorBoundary>
      );
    });
    consoleSpy.mockRestore();

    const resetBtn = container.querySelector('.error-boundary-btn-reset') as HTMLButtonElement;
    expect(resetBtn).not.toBeNull();

    act(() => {
      resetBtn.click();
    });

    expect(localStorage.getItem('zuber_last_active_note')).toBeNull();
    expect(localStorage.getItem('knowmesh_last_active_note')).toBeNull();
    expect(localStorage.getItem('basalt_last_active_note')).toBeNull();
    expect(localStorage.getItem('zuber_open_tabs')).toBeNull();
    expect(localStorage.getItem('knowmesh_open_tabs')).toBeNull();
    expect(localStorage.getItem('basalt_open_tabs')).toBeNull();
    expect(localStorage.getItem('zuber_auth_token')).toBe('secret-jwt-token');
    expect(localStorage.getItem('knowmesh_auth_token')).toBe('secret-jwt-token');
    expect(resetBtn.textContent).toBe('Wird zurückgesetzt...');
    expect(replaceMock).toHaveBeenCalledWith('https://zuber.waresk.com/');
  });

  it('sets zuber_force_offline_boot and reloads on "Lokalen Cache laden / App neu starten"', () => {
    localStorage.setItem('zuber_last_active_note', 'Crash.md');
    localStorage.setItem('zuber_auth_token', 'keep-token');

    const replaceMock = vi.fn();
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        origin: 'https://zuber.waresk.com',
        replace: replaceMock,
        reload: reloadMock,
      },
    });

    const BrokenChild = () => {
      throw new Error('Network boot crash');
    };

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => {
      root.render(
        <ErrorBoundary>
          <BrokenChild />
        </ErrorBoundary>
      );
    });
    consoleSpy.mockRestore();

    const cacheBtn = container.querySelector('.error-boundary-btn-cache') as HTMLButtonElement;
    expect(cacheBtn).not.toBeNull();

    act(() => {
      cacheBtn.click();
    });

    expect(localStorage.getItem('zuber_force_offline_boot')).toBe('1');
    expect(localStorage.getItem('zuber_last_active_note')).toBeNull();
    expect(localStorage.getItem('zuber_auth_token')).toBe('keep-token');
    expect(cacheBtn.textContent).toBe('Cache wird geladen...');
    expect(replaceMock).toHaveBeenCalledWith('https://zuber.waresk.com/');
  });

  it('resets error state and re-mounts children on "Erneut versuchen"', () => {
    let shouldThrow = true;
    const FlakyChild = () => {
      if (shouldThrow) {
        throw new Error('Temporary render failure');
      }
      return <div className="recovered-app">App Recovered</div>;
    };

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => {
      root.render(
        <ErrorBoundary>
          <FlakyChild />
        </ErrorBoundary>
      );
    });
    consoleSpy.mockRestore();

    const retryBtn = container.querySelector('.error-boundary-btn-retry') as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();

    shouldThrow = false;
    act(() => {
      retryBtn.click();
    });

    expect(container.querySelector('.recovered-app')?.textContent).toBe('App Recovered');
  });

  it('mounts LivePreviewEditor in reading mode and App on mobile (390x844) and desktop (1280x800) without React Error #60', async () => {
    vi.spyOn(api, 'checkAuthStatus').mockResolvedValue({
      authenticated: true,
      https: true,
      vaultPath: '/tmp/test-vault',
    });
    vi.spyOn(api, 'getTree').mockResolvedValue({
      vaultPath: '/tmp/test-vault',
      tree: [
        {
          name: 'Welcome.md',
          path: 'Welcome.md',
          type: 'file',
          extension: 'md',
        },
      ],
      files: [
        {
          name: 'Welcome.md',
          path: 'Welcome.md',
          type: 'file',
          extension: 'md',
          basename: 'Welcome',
          folder: '',
          frontmatter: {},
          tags: [],
          mtime: Date.now(),
        },
      ],
    });
    vi.spyOn(api, 'getGraph').mockResolvedValue({
      nodes: [],
      edges: [],
      tags: [],
    });
    vi.spyOn(syncEngine, 'notifyAuthenticatedOnline').mockImplementation(() => {});
    vi.spyOn(syncEngine, 'getNote').mockResolvedValue({
      path: 'Welcome.md',
      name: 'Welcome.md',
      rawContent: '# Welcome\nHello mobile reading mode!',
      body: '# Welcome\nHello mobile reading mode!',
      frontmatter: {},
      properties: [],
      tags: [],
      links: [],
      embeds: [],
      headings: [],
      updatedAt: Date.now(),
    });
    vi.spyOn(api, 'getBacklinks').mockResolvedValue({
      linked: [],
      unlinked: [],
    });

    // 1. Direct mount of LivePreviewEditor in mode="reading" (previously threw React Error #60)
    await act(async () => {
      root.render(
        <I18nProvider>
          <ErrorBoundary>
            <LivePreviewEditor
              notePath="Welcome.md"
              body="# Welcome\nParagraph text"
              rawContent="# Welcome\nParagraph text"
              mode="reading"
              allNotes={[]}
              allTags={[]}
              onChangeBody={() => {}}
              onChangeRaw={() => {}}
              onNavigateWikiLink={() => {}}
              onSelectTag={() => {}}
              onRequestEditMode={() => {}}
            />
          </ErrorBoundary>
        </I18nProvider>
      );
    });
    expect(container.querySelector('.error-boundary-overlay')).toBeNull();
    expect(container.querySelector('.reading-view-container')).not.toBeNull();

    // 2. Mobile viewport (390x844) full <App /> mount (authenticated)
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <I18nProvider>
            <App />
          </I18nProvider>
        </ErrorBoundary>
      );
    });
    expect(container.querySelector('.error-boundary-overlay')).toBeNull();

    // 3. Desktop viewport (1280x800) full <App /> mount (unauthenticated)
    vi.spyOn(api, 'checkAuthStatus').mockResolvedValue({
      authenticated: false,
      https: true,
      vaultPath: '/tmp/test-vault',
    });
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <I18nProvider>
            <App />
          </I18nProvider>
        </ErrorBoundary>
      );
    });
    expect(container.querySelector('.error-boundary-overlay')).toBeNull();
  });

  it('logs componentStack into clientLogger and renders export/copy buttons on crash', async () => {
    const { clientLogger } = await import('../utils/logger');
    clientLogger.clear();

    const CrashChild: React.FC = () => {
      throw new Error('Simulated React error #310');
    };

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <CrashChild />
        </ErrorBoundary>
      );
    });
    consoleErrorSpy.mockRestore();

    expect(container.querySelector('.error-boundary-overlay')).not.toBeNull();
    expect(container.querySelector('.error-boundary-btn-export')).not.toBeNull();
    expect(container.querySelector('.error-boundary-btn-copy')).not.toBeNull();

    const crashLog = clientLogger.getEntries().find((e) => e.category === 'react-crash');
    expect(crashLog).toBeDefined();
    expect(crashLog?.message).toContain('Simulated React error #310');
    expect(crashLog?.details).toContain('CrashChild');
  });
});
