import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText,
  FolderOpen,
  Search,
  Settings,
  Terminal,
  X,
} from 'lucide-react';
import { useTranslation } from '../i18n';
import { syncEngine } from '../sync/syncEngine';
import type { NoteData } from '../../shared/types';
import type { CommandItem } from './CommandPalette';
import type { SettingsTab } from './SettingsModal';
import {
  findInNoteMatches,
  searchNotesFullTextOffline,
  searchVaultFiles,
  type SearchScope,
} from '../utils/mobileSearchUtils';

export interface MobileSearchFileEntry {
  path: string;
  name?: string;
  title?: string;
}

export interface MobileSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeNote: { path: string; body: string; rawContent?: string } | null;
  allFiles: MobileSearchFileEntry[];
  commands: CommandItem[];
  onOpenFile: (path: string) => void;
  onJumpToInNoteMatch: (query: string, matchIndex: number) => void;
  onJumpToNoteWithSearch: (path: string, query: string, matchIndex: number) => void;
  onOpenSettingsTab: (tab: SettingsTab) => void;
}

function renderHighlightedText(text: string, query: string): React.ReactNode {
  const trimmed = query.trim();
  if (!trimmed) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  while (cursor <= lowerText.length - lowerQuery.length) {
    const idx = lowerText.indexOf(lowerQuery, cursor);
    if (idx === -1) break;
    if (idx > cursor) {
      parts.push(text.slice(cursor, idx));
    }
    parts.push(
      <mark key={key++} className="mobile-search-snippet-mark">
        {text.slice(idx, idx + lowerQuery.length)}
      </mark>
    );
    cursor = idx + Math.max(1, lowerQuery.length);
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts;
}

const SETTINGS_TAB_ITEMS: Array<{ tab: SettingsTab; labelKey: string; fallback: string; keywords: string }> = [
  { tab: 'appearance', labelKey: 'settings.appearance', fallback: 'Appearance', keywords: 'theme dark light font css appearance' },
  { tab: 'editor', labelKey: 'settings.editorAndFiles', fallback: 'Editor & Files', keywords: 'editor files live preview reading template daily' },
  { tab: 'sync', labelKey: 'settings.syncAndOffline', fallback: 'Sync & Offline', keywords: 'sync offline indexeddb cache' },
  { tab: 'git', labelKey: 'settings.gitBackup', fallback: 'Git Backup', keywords: 'git backup commit push' },
  { tab: 'logs', labelKey: 'settings.logs', fallback: 'Logs & Diagnostics', keywords: 'logs diagnostics debug console' },
  { tab: 'security', labelKey: 'settings.security', fallback: 'Security', keywords: 'security password pin lock' },
  { tab: 'servers', labelKey: 'settings.servers', fallback: 'Servers & Connections', keywords: 'servers connections url api' },
];

export const MobileSearchModal: React.FC<MobileSearchModalProps> = ({
  isOpen,
  onClose,
  activeNote,
  allFiles,
  commands,
  onOpenFile,
  onJumpToInNoteMatch,
  onJumpToNoteWithSearch,
  onOpenSettingsTab,
}) => {
  const { t } = useTranslation();
  const [scope, setScope] = useState<SearchScope>(activeNote ? 'in-note' : 'files');
  const [query, setQuery] = useState('');
  const [offlineNotes, setOfflineNotes] = useState<NoteData[]>([]);
  const [loadingFullText, setLoadingFullText] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setScope(activeNote ? 'in-note' : 'files');
    setQuery('');
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [isOpen, activeNote?.path]);

  useEffect(() => {
    if (!isOpen || scope !== 'fulltext') return;
    let cancelled = false;
    setLoadingFullText(true);
    syncEngine
      .getLocalDb()
      .getAllNotes()
      .then((notes) => {
        if (!cancelled) {
          setOfflineNotes(notes);
          setLoadingFullText(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOfflineNotes([]);
          setLoadingFullText(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, scope]);

  const inNoteMatches = useMemo(() => {
    if (scope !== 'in-note' || !activeNote) return [];
    return findInNoteMatches(activeNote.body ?? '', query);
  }, [scope, activeNote, query]);

  const fileHits = useMemo(() => {
    if (scope !== 'files') return [];
    return searchVaultFiles(allFiles, query, 60);
  }, [scope, allFiles, query]);

  const fullTextHits = useMemo(() => {
    if (scope !== 'fulltext') return [];
    return searchNotesFullTextOffline(offlineNotes, query, 50);
  }, [scope, offlineNotes, query]);

  const settingsAndCommands = useMemo(() => {
    if (scope !== 'settings') return { tabs: [], cmds: [] as CommandItem[] };
    const q = query.trim().toLowerCase();
    const tabs = SETTINGS_TAB_ITEMS.filter((item) => {
      if (!q) return true;
      const label = (t(item.labelKey) || item.fallback).toLowerCase();
      return label.includes(q) || item.tab.includes(q) || item.keywords.includes(q);
    });
    const cmds = commands.filter((cmd) => {
      if (!q) return true;
      return (
        cmd.title.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q) ||
        (cmd.keywords?.some((k) => k.toLowerCase().includes(q)) ?? false)
      );
    });
    return { tabs, cmds };
  }, [scope, query, commands, t]);

  if (!isOpen) return null;

  const placeholderText =
    scope === 'in-note'
      ? t('search.placeholderInNote')
      : scope === 'files'
        ? t('search.placeholderFiles')
        : scope === 'fulltext'
          ? t('search.placeholderFullText')
          : t('search.placeholderSettings');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (scope === 'in-note' && inNoteMatches.length > 0) {
        onJumpToInNoteMatch(query.trim(), inNoteMatches[0].index);
        onClose();
      } else if (scope === 'files' && fileHits.length > 0) {
        onOpenFile(fileHits[0].path);
        onClose();
      } else if (scope === 'fulltext' && fullTextHits.length > 0) {
        onJumpToNoteWithSearch(fullTextHits[0].path, query.trim(), 0);
        onClose();
      } else if (scope === 'settings') {
        if (settingsAndCommands.tabs.length > 0) {
          onOpenSettingsTab(settingsAndCommands.tabs[0].tab);
          onClose();
        } else if (settingsAndCommands.cmds.length > 0) {
          settingsAndCommands.cmds[0].action();
          onClose();
        }
      }
    }
  };

  return (
    <div
      className="mobile-search-overlay"
      data-testid="mobile-search-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mobile-search-modal">
        <div className="mobile-search-header">
          <select
            className="mobile-search-scope-select"
            data-testid="mobile-search-scope-select"
            aria-label={t('common.search')}
            value={scope}
            onChange={(e) => setScope(e.target.value as SearchScope)}
          >
            <option value="in-note" disabled={!activeNote}>
              {t('search.scopeInNote')}
            </option>
            <option value="files">{t('search.scopeFiles')}</option>
            <option value="fulltext">{t('search.scopeFullText')}</option>
            <option value="settings">{t('search.scopeSettings')}</option>
          </select>

          <div className="mobile-search-input-wrap">
            <Search size={16} className="mobile-search-input-icon" />
            <input
              ref={inputRef}
              type="search"
              data-testid="mobile-search-input"
              className="mobile-search-input"
              placeholder={placeholderText}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>

          <button
            type="button"
            className="mobile-search-close-btn"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        <div className="mobile-search-results">
          {scope === 'in-note' && (
            <>
              {query.trim() && (
                <div className="mobile-search-status-row" data-testid="mobile-search-match-count">
                  {inNoteMatches.length > 0
                    ? t('search.matchesCount').replace('{count}', String(inNoteMatches.length))
                    : t('search.noMatches')}
                </div>
              )}
              {inNoteMatches.map((m) => (
                <button
                  key={`${m.index}-${m.from}`}
                  type="button"
                  className="mobile-search-result-item"
                  onClick={() => {
                    onJumpToInNoteMatch(query.trim(), m.index);
                    onClose();
                  }}
                >
                  <div className="mobile-search-result-meta">L{m.line}</div>
                  <div className="mobile-search-result-preview">
                    {renderHighlightedText(m.lineText, query)}
                  </div>
                </button>
              ))}
            </>
          )}

          {scope === 'files' && (
            <>
              {fileHits.length === 0 ? (
                <div className="mobile-search-empty">{t('search.noMatches')}</div>
              ) : (
                fileHits.map((hit) => (
                  <button
                    key={hit.path}
                    type="button"
                    className="mobile-search-result-item"
                    onClick={() => {
                      onOpenFile(hit.path);
                      onClose();
                    }}
                  >
                    <FileText size={16} className="mobile-search-result-icon" />
                    <div className="mobile-search-result-body">
                      <div className="mobile-search-result-title">{hit.name}</div>
                      {hit.folder && (
                        <div className="mobile-search-result-sub">
                          <FolderOpen size={12} /> {hit.folder}
                        </div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </>
          )}

          {scope === 'fulltext' && (
            <>
              {loadingFullText && (
                <div className="mobile-search-empty">{t('common.loading')}</div>
              )}
              {!loadingFullText && query.trim() && fullTextHits.length === 0 && (
                <div className="mobile-search-empty">{t('search.noMatches')}</div>
              )}
              {fullTextHits.map((hit) => (
                <button
                  key={hit.path}
                  type="button"
                  className="mobile-search-result-item"
                  onClick={() => {
                    onJumpToNoteWithSearch(hit.path, query.trim(), 0);
                    onClose();
                  }}
                >
                  <FileText size={16} className="mobile-search-result-icon" />
                  <div className="mobile-search-result-body">
                    <div className="mobile-search-result-title">
                      {hit.name}
                      <span className="mobile-search-hit-badge">{hit.matchCount}</span>
                    </div>
                    <div className="mobile-search-result-preview">
                      {renderHighlightedText(hit.snippet, query)}
                    </div>
                  </div>
                </button>
              ))}
            </>
          )}

          {scope === 'settings' && (
            <>
              {settingsAndCommands.tabs.map((item) => (
                <button
                  key={item.tab}
                  type="button"
                  className="mobile-search-result-item"
                  onClick={() => {
                    onOpenSettingsTab(item.tab);
                    onClose();
                  }}
                >
                  <Settings size={16} className="mobile-search-result-icon" />
                  <div className="mobile-search-result-body">
                    <div className="mobile-search-result-title">
                      {t(item.labelKey) || item.fallback}
                    </div>
                    <div className="mobile-search-result-sub">{t('search.scopeSettings')}</div>
                  </div>
                </button>
              ))}
              {settingsAndCommands.cmds.map((cmd) => (
                <button
                  key={cmd.id}
                  type="button"
                  className="mobile-search-result-item"
                  onClick={() => {
                    cmd.action();
                    onClose();
                  }}
                >
                  <Terminal size={16} className="mobile-search-result-icon" />
                  <div className="mobile-search-result-body">
                    <div className="mobile-search-result-title">{cmd.title}</div>
                    <div className="mobile-search-result-sub">{cmd.category}</div>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
