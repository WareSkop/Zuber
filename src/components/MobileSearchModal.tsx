import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText,
  FolderOpen,
  HelpCircle,
  Search,
  Settings,
  Terminal,
  X,
} from 'lucide-react';
import { useTranslation } from '../i18n';
import { syncEngine } from '../sync/syncEngine';
import type { NoteData } from '../../shared/types';
import { findRegexMatchesInText, parseSearchQuery } from '../../shared/searchEngine';
import type { CommandItem } from './CommandPalette';
import type { SettingsTab } from './SettingsModal';
import {
  findInNoteMatches,
  searchNotesFullTextOffline,
  searchVaultFiles,
  type SearchScope,
  type SearchSortMode,
} from '../utils/mobileSearchUtils';

export interface MobileSearchFileEntry {
  path: string;
  name?: string;
  title?: string;
  mtime?: number;
}

export interface MobileSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeNote: { path: string; body: string; rawContent?: string } | null;
  allFiles: MobileSearchFileEntry[];
  commands: CommandItem[];
  initialScope?: SearchScope;
  onOpenFile: (path: string) => void;
  onJumpToInNoteMatch: (query: string, matchIndex: number) => void;
  onJumpToNoteWithSearch: (path: string, query: string, matchIndex: number) => void;
  onOpenSettingsTab: (tab: SettingsTab) => void;
}

function renderHighlightedText(text: string, query: string): React.ReactNode {
  const parsed = parseSearchQuery(query);
  if (!parsed.hasTerms || parsed.required.length === 0) return text;
  const spans = findRegexMatchesInText(text, parsed);
  if (spans.length === 0) return text;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const span of spans) {
    if (span.from > cursor) {
      parts.push(text.slice(cursor, span.from));
    }
    parts.push(
      <mark key={key++} className="mobile-search-snippet-mark">
        {text.slice(span.from, span.to)}
      </mark>
    );
    cursor = span.to;
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
  { tab: 'email', labelKey: 'email.tabLabel', fallback: 'Email (SMTP & IMAP)', keywords: 'email smtp imap mail inbox export' },
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
  initialScope,
  onOpenFile,
  onJumpToInNoteMatch,
  onJumpToNoteWithSearch,
  onOpenSettingsTab,
}) => {
  const { t } = useTranslation();
  const [scope, setScope] = useState<SearchScope>(
    initialScope && (initialScope !== 'in-note' || activeNote)
      ? initialScope
      : activeNote
        ? 'in-note'
        : 'files'
  );
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SearchSortMode>('relevance');
  const [showSyntaxHelp, setShowSyntaxHelp] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [offlineNotes, setOfflineNotes] = useState<NoteData[]>([]);
  const [loadingFullText, setLoadingFullText] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const targetScope =
      initialScope && (initialScope !== 'in-note' || activeNote)
        ? initialScope
        : activeNote
          ? 'in-note'
          : 'files';
    setScope(targetScope);
    setQuery('');
    setSelectedIndex(0);
    setShowSyntaxHelp(false);
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [isOpen, initialScope, activeNote?.path]);

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
    return searchNotesFullTextOffline(offlineNotes, query, 50, sortMode);
  }, [scope, offlineNotes, query, sortMode]);

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

  const totalCount =
    scope === 'in-note'
      ? inNoteMatches.length
      : scope === 'files'
        ? fileHits.length
        : scope === 'fulltext'
          ? fullTextHits.length
          : settingsAndCommands.tabs.length + settingsAndCommands.cmds.length;

  useEffect(() => {
    setSelectedIndex((prev) => (totalCount === 0 ? 0 : Math.min(prev, totalCount - 1)));
  }, [totalCount]);

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
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.key === '1' && activeNote) {
        e.preventDefault();
        setScope('in-note');
        return;
      }
      if (e.key === '2') {
        e.preventDefault();
        setScope('files');
        return;
      }
      if (e.key === '3') {
        e.preventDefault();
        setScope('fulltext');
        return;
      }
      if (e.key === '4') {
        e.preventDefault();
        setScope('settings');
        return;
      }
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown' && totalCount > 0) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % totalCount);
      return;
    }
    if (e.key === 'ArrowUp' && totalCount > 0) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + totalCount) % totalCount);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (scope === 'in-note' && inNoteMatches.length > 0) {
        const target = inNoteMatches[selectedIndex] || inNoteMatches[0];
        onJumpToInNoteMatch(query.trim(), target.index);
        onClose();
      } else if (scope === 'files' && fileHits.length > 0) {
        const target = fileHits[selectedIndex] || fileHits[0];
        onOpenFile(target.path);
        onClose();
      } else if (scope === 'fulltext' && fullTextHits.length > 0) {
        const target = fullTextHits[selectedIndex] || fullTextHits[0];
        onJumpToNoteWithSearch(target.path, query.trim(), 0);
        onClose();
      } else if (scope === 'settings') {
        const tabLen = settingsAndCommands.tabs.length;
        if (selectedIndex < tabLen) {
          onOpenSettingsTab(settingsAndCommands.tabs[selectedIndex].tab);
          onClose();
        } else {
          const cmd = settingsAndCommands.cmds[selectedIndex - tabLen] || settingsAndCommands.cmds[0];
          if (cmd) {
            cmd.action();
            onClose();
          }
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
            onChange={(e) => {
              setScope(e.target.value as SearchScope);
              setSelectedIndex(0);
            }}
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
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
            />
          </div>

          <button
            type="button"
            className={`search-syntax-help-btn ${showSyntaxHelp ? 'active' : ''}`}
            title={t('search.syntaxHelpTitle')}
            aria-label={t('search.syntaxHelpTitle')}
            onClick={() => setShowSyntaxHelp((v) => !v)}
          >
            <HelpCircle size={17} />
          </button>

          <button
            type="button"
            className="mobile-search-close-btn"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        {showSyntaxHelp && (
          <div className="search-syntax-help-banner" data-testid="search-syntax-help">
            <strong>{t('search.syntaxHelpTitle')}:</strong> {t('search.syntaxHelpBody')}
          </div>
        )}

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
              {inNoteMatches.map((m, idx) => (
                <button
                  key={`${m.index}-${m.from}`}
                  type="button"
                  className={`mobile-search-result-item ${idx === selectedIndex ? 'is-selected' : ''}`}
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
                fileHits.map((hit, idx) => (
                  <button
                    key={hit.path}
                    type="button"
                    className={`mobile-search-result-item ${idx === selectedIndex ? 'is-selected' : ''}`}
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
              <div className="search-sort-bar">
                <span className="search-sort-count">
                  {query.trim() && !loadingFullText
                    ? fullTextHits.length > 0
                      ? `${fullTextHits.length}`
                      : t('search.noMatches')
                    : ''}
                </span>
                <div className="search-sort-toggle" role="group" aria-label="Sort">
                  <button
                    type="button"
                    className={`search-sort-btn ${sortMode === 'relevance' ? 'active' : ''}`}
                    onClick={() => setSortMode('relevance')}
                  >
                    {t('search.sortRelevance')}
                  </button>
                  <button
                    type="button"
                    className={`search-sort-btn ${sortMode === 'newest' ? 'active' : ''}`}
                    onClick={() => setSortMode('newest')}
                  >
                    {t('search.sortNewest')}
                  </button>
                </div>
              </div>

              {loadingFullText && (
                <div className="mobile-search-empty">{t('common.loading')}</div>
              )}
              {!loadingFullText && query.trim() && fullTextHits.length === 0 && (
                <div className="mobile-search-empty">{t('search.noMatches')}</div>
              )}
              {fullTextHits.map((hit, idx) => (
                <button
                  key={hit.path}
                  type="button"
                  className={`mobile-search-result-item ${idx === selectedIndex ? 'is-selected' : ''}`}
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
              {settingsAndCommands.tabs.map((item, idx) => (
                <button
                  key={item.tab}
                  type="button"
                  className={`mobile-search-result-item ${idx === selectedIndex ? 'is-selected' : ''}`}
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
              {settingsAndCommands.cmds.map((cmd, idx) => {
                const absIdx = settingsAndCommands.tabs.length + idx;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    className={`mobile-search-result-item ${absIdx === selectedIndex ? 'is-selected' : ''}`}
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
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
