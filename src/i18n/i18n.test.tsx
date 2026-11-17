/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import enDict from '../locales/en.json';
import deDict from '../locales/de.json';
import { I18nProvider } from './index';
import { CanvasToolbar } from '../components/canvas/CanvasToolbar';
import { BaseToolbar } from '../components/base/BaseToolbar';
import { BaseFilterPopover } from '../components/base/BaseFilterPopover';
import { CommandPalette } from '../components/CommandPalette';
import { SettingsModal } from '../components/SettingsModal';

vi.mock('../sync/syncEngine', () => ({
  syncEngine: {
    getState: () => ({ status: 'synced', pendingCount: 0, lastSyncAt: null }),
    subscribe: () => () => {},
    getStats: async () => ({ pendingCount: 0, cachedCount: 0, syncedFoldersCount: 0 }),
    getSyncedFolders: async () => [],
    getSyncStats: () => ({ pendingCount: 0, cachedCount: 0 }),
    getLogLevel: () => 'INFO',
    setLogLevel: vi.fn(),
    forceFullSync: vi.fn(),
    clearCache: vi.fn(),
  },
}));

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
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
Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true });

function collectLeafKeys(obj: Record<string, unknown>, prefix = ''): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      for (const [k, v] of collectLeafKeys(val as Record<string, unknown>, fullKey)) {
        result.set(k, v);
      }
    } else {
      result.set(fullKey, String(val ?? ''));
    }
  }
  return result;
}

describe('i18n dictionary & English UI rendering', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
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

  it('has 100% key parity and non-empty strings between en.json and de.json', () => {
    const enKeys = collectLeafKeys(enDict as Record<string, unknown>);
    const deKeys = collectLeafKeys(deDict as Record<string, unknown>);

    const missingInDe = [...enKeys.keys()].filter((k) => !deKeys.has(k));
    const missingInEn = [...deKeys.keys()].filter((k) => !enKeys.has(k));

    expect(missingInDe).toEqual([]);
    expect(missingInEn).toEqual([]);

    for (const [k, val] of enKeys.entries()) {
      expect(val.trim().length, `Empty EN value for key ${k}`).toBeGreaterThan(0);
    }
    for (const [k, val] of deKeys.entries()) {
      expect(val.trim().length, `Empty DE value for key ${k}`).toBeGreaterThan(0);
    }
  });

  it('renders CanvasToolbar in English by default', () => {
    act(() => {
      root.render(
        <I18nProvider>
          <CanvasToolbar
            onAddTextNode={vi.fn()}
            onAddFileNode={vi.fn()}
            onAddGroupNode={vi.fn()}
            onFitView={vi.fn()}
            onToggleGrid={vi.fn()}
            gridMode="dots"
            canUndo={true}
            canRedo={false}
            onUndo={vi.fn()}
            onRedo={vi.fn()}
            allNotes={[{ path: 'Note.md', name: 'Note', basename: 'Note' }]}
          />
        </I18nProvider>
      );
    });

    const text = container.textContent || '';
    expect(text).toContain('Embed note');
    expect(text).toContain('Group');
    expect(text).toContain('Network');
    expect(text).not.toContain('Notiz einbetten');
    expect(text).not.toContain('Gruppe');
    expect(text).not.toContain('Netzwerk');
  });

  it('renders BaseToolbar and BaseFilterPopover in English by default', () => {
    act(() => {
      root.render(
        <I18nProvider>
          <BaseToolbar
            config={{
              views: [{ name: 'Overview', type: 'table' }],
            }}
            activeViewIndex={0}
            onSelectView={vi.fn()}
            onAddView={vi.fn()}
            onRenameView={vi.fn()}
            onDuplicateView={vi.fn()}
            onDeleteView={vi.fn()}
            activeFilterCount={0}
            isFilterPopoverOpen={true}
            onToggleFilterPopover={vi.fn()}
            onOpenColumnsModal={vi.fn()}
            availableProperties={[{ key: 'status', label: 'Status' }]}
            onSortChange={vi.fn()}
            onGroupByChange={vi.fn()}
            editorMode="visual"
            onToggleEditorMode={vi.fn()}
          />
          <BaseFilterPopover
            isOpen={true}
            onClose={vi.fn()}
            rules={[]}
            onChangeRules={vi.fn()}
            availableProperties={[{ key: 'status', label: 'Status' }]}
            vaultFolders={['Projects']}
            vaultTags={['todo']}
          />
        </I18nProvider>
      );
    });

    const text = container.textContent || '';
    expect(text).toContain('Sort');
    expect(text).toContain('Group');
    expect(text).toContain('Columns');
    expect(text).toContain('Configure Filters');
    expect(text).toContain('Add Filter Rule');
    expect(text).not.toContain('Sortieren');
    expect(text).not.toContain('Gruppieren');
    expect(text).not.toContain('Spalten');
    expect(text).not.toContain('Filter konfigurieren');
    expect(text).not.toContain('Bedingung hinzufügen');
  });

  it('renders CommandPalette in English by default', () => {
    act(() => {
      root.render(
        <I18nProvider>
          <CommandPalette isOpen={true} onClose={vi.fn()} commands={[]} />
        </I18nProvider>
      );
    });

    const input = container.querySelector('input.command-palette-input') as HTMLInputElement;
    expect(input?.placeholder).toContain('Type command or search');
    expect(container.textContent).toContain('No commands found for');
    expect(container.textContent).toContain('Navigate');
    expect(container.textContent).toContain('Execute');
  });

  it('renders SettingsModal themes, server profile, and log levels in English by default', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          enabled: false,
          authenticated: true,
          logs: [],
          level: 'INFO',
        }),
      })
    );

    await act(async () => {
      root.render(
        <I18nProvider>
          <SettingsModal
            isOpen={true}
            onClose={vi.fn()}
            currentTheme="dark-cold"
            onThemeChange={vi.fn()}
            fileTree={[]}
            initialTab="appearance"
          />
        </I18nProvider>
      );
    });

    expect(container.textContent).toContain('Deep midnight blue (#0f172a) & ice-blue accent (#38bdf8)');
    expect(container.textContent).not.toContain('Dunkler, kühler Blaugrau-Ton');

    const tabs = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
    const serversTab = tabs.find((b) => b.textContent?.includes('Vault Connections'));
    expect(serversTab).toBeDefined();
    await act(async () => {
      serversTab?.click();
    });
    expect(container.textContent).toContain('Current Server');
    expect(container.textContent).not.toContain('Aktueller Server');

    const logsTab = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Logs & Diagnostics')
    ) as HTMLButtonElement | undefined;
    expect(logsTab).toBeDefined();
    await act(async () => {
      logsTab?.click();
    });
    expect(container.textContent).toContain('DEBUG (Detailed)');
    expect(container.textContent).not.toContain('Ausführlich');
    expect(container.textContent).not.toContain('Warnung');
  });
});
