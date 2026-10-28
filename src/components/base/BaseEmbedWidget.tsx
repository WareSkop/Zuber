import React, { useState, useEffect, useMemo } from 'react';
import {
  Database,
  Table as TableIcon,
  LayoutGrid,
  Kanban,
  List,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../../api';
import { syncEngine } from '../../sync/syncEngine';
import { useTranslation } from '../../i18n';
import { parseBaseYaml, stringifyBaseYaml, type BaseConfig, type BaseViewConfig } from '../../base/baseConfig';
import {
  executeBaseQuery,
  getPropertyValue,
  type BaseQueryResult,
  type BaseRecord,
} from '../../base/baseEngine';
import { BaseTableView } from './BaseTableView';
import { BaseCardsView } from './BaseCardsView';
import { BaseBoardView } from './BaseBoardView';

export interface BaseEmbedWidgetProps {
  basePath: string;
  onOpenNote: (path: string) => void;
  allNotes?: any[];
  rawContent?: string;
  onCellChange?: (notePath: string, key: string, value: any) => Promise<void>;
  readOnly?: boolean;
  initialView?: string;
  height?: string | number;
}

export const BaseEmbedWidget: React.FC<BaseEmbedWidgetProps> = ({
  basePath,
  onOpenNote,
  allNotes,
  rawContent,
  onCellChange,
  readOnly = false,
  initialView,
  height,
}) => {
  const { t } = useTranslation();
  const [yaml, setYaml] = useState<string>(rawContent || '');
  const [loading, setLoading] = useState<boolean>(!rawContent);
  const [error, setError] = useState<string | null>(null);
  const [internalNotes, setInternalNotes] = useState<any[]>(allNotes || []);
  const [activeViewIdx, setActiveViewIdx] = useState<number>(0);

  // Column overrides for interactive embedded table
  const [localColumnSizes, setLocalColumnSizes] = useState<Record<string, number>>({});
  const [columnOrderOverride, setColumnOrderOverride] = useState<string[] | null>(null);
  const [sortOverride, setSortOverride] = useState<{ property: string; direction: 'asc' | 'desc' } | null>(null);

  // Sync / fetch allNotes if not provided
  useEffect(() => {
    if (allNotes && allNotes.length > 0) {
      setInternalNotes(allNotes);
      return;
    }
    let cancelled = false;
    syncEngine
      .getLocalDb()
      .getAllNotes()
      .then((notes: any[]) => {
        if (!cancelled && notes && notes.length > 0) {
          setInternalNotes(notes);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [allNotes]);

  const resolvedFullPath = useMemo(() => {
    const normalizedTarget = basePath.trim();
    const pool = internalNotes.length > 0 ? internalNotes : (allNotes || []);
    const foundNote = pool.find((n: any) =>
      n.path === normalizedTarget ||
      n.path === `${normalizedTarget}.base` ||
      n.path.toLowerCase() === normalizedTarget.toLowerCase() ||
      n.name === normalizedTarget ||
      n.name === normalizedTarget.replace(/\.base$/i, '') ||
      n.basename === normalizedTarget ||
      n.basename === normalizedTarget.replace(/\.base$/i, '')
    );
    return foundNote ? foundNote.path : basePath;
  }, [basePath, internalNotes, allNotes]);

  // Load Base YAML content if not provided via props
  useEffect(() => {
    if (rawContent !== undefined) {
      setYaml(rawContent);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const loadData = async () => {
      try {
        let note: any;
        try {
          note = await syncEngine.getNote(resolvedFullPath);
        } catch {
          note = await api.getNote(resolvedFullPath);
        }
        if (!cancelled) {
          const content = note.rawContent || note.body || '';
          setYaml(content);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError(`Base-Datei konnte nicht geladen werden (${basePath})`);
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      cancelled = true;
    };
  }, [resolvedFullPath, basePath, rawContent]);

  // Parse YAML configuration
  const { config, parseError } = useMemo(() => {
    if (!yaml) return { config: null, parseError: null };
    try {
      const parsed = parseBaseYaml(yaml);
      return { config: parsed, parseError: null };
    } catch (err: any) {
      return { config: null, parseError: err?.message || String(err) };
    }
  }, [yaml]);

  // Views & active view
  const views = useMemo(() => {
    return config?.views && config.views.length > 0
      ? config.views
      : [{ type: 'table' as const, name: 'Table' }];
  }, [config?.views]);

  const safeViewIndex = Math.min(Math.max(0, activeViewIdx), views.length - 1);
  const activeView = views[safeViewIndex];

  // Set initial view if specified
  useEffect(() => {
    if (!initialView || !config || !config.views || config.views.length === 0) return;
    const lower = initialView.toLowerCase().trim();
    const idx = config.views.findIndex(
      (v) => (v.name && v.name.toLowerCase().trim() === lower) || v.type.toLowerCase().trim() === lower
    );
    if (idx >= 0) {
      setActiveViewIdx(idx);
    }
  }, [config, initialView]);

  const parsedHeight = useMemo(() => {
    if (!height) return undefined;
    if (typeof height === 'number') return `${height}px`;
    const str = String(height).trim();
    return /^\d+$/.test(str) ? `${str}px` : str;
  }, [height]);

  // Execute query against vault notes
  const rawQueryResult = useMemo(() => {
    if (!config) return null;
    try {
      return executeBaseQuery(config, internalNotes, safeViewIndex, resolvedFullPath);
    } catch (err: any) {
      return null;
    }
  }, [config, internalNotes, safeViewIndex, resolvedFullPath]);

  // Apply interactive sorting override if present
  const queryResult: BaseQueryResult | null = useMemo(() => {
    if (!rawQueryResult) return null;
    if (!sortOverride) return rawQueryResult;

    const dir = sortOverride.direction === 'desc' ? -1 : 1;
    const sorted = [...rawQueryResult.records].sort((a, b) => {
      const valA = getPropertyValue(a, sortOverride.property);
      const valB = getPropertyValue(b, sortOverride.property);
      if (valA === valB) return 0;
      if (valA === undefined || valA === null) return 1 * dir;
      if (valB === undefined || valB === null) return -1 * dir;
      if (typeof valA === 'number' && typeof valB === 'number') return (valA - valB) * dir;
      return String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });

    return {
      ...rawQueryResult,
      records: sorted,
      groups: rawQueryResult.groups.map((g) => ({
        ...g,
        records: sorted.filter((s) => g.records.some((r) => r.file.path === s.file.path)),
      })),
    };
  }, [rawQueryResult, sortOverride]);

  // Cell editing support
  const handleCellChange = async (notePath: string, key: string, value: any) => {
    if (readOnly) return;
    if (onCellChange) {
      await onCellChange(notePath, key, value);
      return;
    }
    try {
      const note = await api.getNote(notePath);
      const existingProps = [...(note.properties || [])];
      const propIdx = existingProps.findIndex((p) => p.key.toLowerCase() === key.toLowerCase());
      const propType = typeof value === 'boolean' ? 'checkbox' : typeof value === 'number' ? 'number' : 'text';
      if (propIdx >= 0) {
        existingProps[propIdx] = { key: existingProps[propIdx].key, value, type: propType };
      } else {
        existingProps.push({ key, value, type: propType });
      }
      await api.saveNote({
        path: note.path,
        body: note.body,
        properties: existingProps,
        forceOverwrite: true,
      });
      setInternalNotes((prev) =>
        prev.map((n) => {
          if (n.path !== notePath) return n;
          return {
            ...n,
            properties: existingProps,
            frontmatter: {
              ...(n.frontmatter || {}),
              [key]: value,
            },
          };
        })
      );
    } catch (err) {
      console.error('Failed to update note property in BaseEmbedWidget:', err);
    }
  };

  const fileName = resolvedFullPath.split('/').pop() || resolvedFullPath;
  const effectiveColumnSizes = useMemo(() => {
    return { ...(activeView.columnSize || {}), ...localColumnSizes };
  }, [activeView.columnSize, localColumnSizes]);

  const handleUpdateViewConfig = async (updatedView: BaseViewConfig) => {
    if (readOnly || !config) return;
    const newViews = config.views.map((v, i) => (i === safeViewIndex ? updatedView : v));
    const newConfig: BaseConfig = {
      ...config,
      views: newViews,
    };
    try {
      const nextYaml = stringifyBaseYaml(newConfig);
      setYaml(nextYaml);
      await api.saveNote({
        path: resolvedFullPath,
        body: nextYaml,
        properties: [],
        forceOverwrite: true,
      });
    } catch (err) {
      console.error('Failed to persist BaseEmbedWidget view config update:', err);
    }
  };

  return (
    <div
      className="cm-lp-base-embed embedded-base-container base-embed-widget"
      style={parsedHeight ? { height: parsedHeight } : undefined}
    >
      {/* 1. Subtle Status Bar */}
      <div className="base-embed-status-bar">
        <div className="base-embed-status-left">
          <div
            className="base-embed-title-cluster"
            onClick={() => onOpenNote(resolvedFullPath)}
            title={resolvedFullPath}
          >
            <Database size={14} className="base-embed-icon" />
            <span className="base-embed-title">{fileName}</span>
          </div>

          {/* View pills if multiple views exist */}
          {views.length > 1 && (
            <div className="base-embed-view-pills">
              {views.map((v, idx) => {
                const isActive = idx === safeViewIndex;
                const ViewIcon = v.type === 'board' ? Kanban : v.type === 'cards' ? LayoutGrid : v.type === 'list' ? List : TableIcon;
                return (
                  <button
                    key={`${v.name || v.type}-${idx}`}
                    type="button"
                    className={`base-embed-pill-btn ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      setActiveViewIdx(idx);
                      setSortOverride(null);
                    }}
                    title={v.name}
                  >
                    <ViewIcon size={12} />
                    <span>{v.name || (v.type === 'board' ? 'Board' : v.type === 'cards' ? 'Cards' : 'Table')}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="base-embed-status-right">
          <button
            type="button"
            className="base-embed-open-btn"
            onClick={() => onOpenNote(resolvedFullPath)}
            title={t('base.openInEditor') || 'Im Editor öffnen ↗'}
            aria-label={t('base.openInEditor') || 'Im Editor öffnen'}
          >
            <span className="open-label-desktop">{t('base.openInEditor') || 'Im Editor öffnen'}</span>
            <ExternalLink size={13} className="external-icon" />
          </button>
        </div>
      </div>

      {/* 2. Embedded Content Area */}
      <div className="base-embed-content">
        {loading ? (
          <div className="base-embed-loading">
            <span className="loading-spinner-small" />
            <span>Lade Base...</span>
          </div>
        ) : error ? (
          <div className="base-error-box">
            <div className="base-error-header">
              <AlertTriangle size={15} className="base-error-icon" />
              <span>{error}</span>
            </div>
          </div>
        ) : parseError ? (
          <div className="base-error-box">
            <div className="base-error-header">
              <AlertTriangle size={15} className="base-error-icon" />
              <span>{t('base.syntaxError') || 'Syntaxfehler in Base-Definition'}</span>
            </div>
            <pre className="base-error-message">{parseError}</pre>
          </div>
        ) : !queryResult || queryResult.records.length === 0 ? (
          <div className="base-empty-state">
            <Database size={24} className="empty-icon" />
            <p>{t('base.noRecordsFound') || 'Keine passenden Notizen gefunden.'}</p>
          </div>
        ) : activeView.type === 'board' ? (
          <BaseBoardView
            queryResult={queryResult}
            view={activeView}
            onSelectNote={onOpenNote}
            onCellChange={handleCellChange}
            readOnly={readOnly}
            onUpdateConfig={handleUpdateViewConfig}
          />
        ) : activeView.type === 'cards' ? (
          <BaseCardsView
            queryResult={queryResult}
            view={activeView}
            onSelectNote={onOpenNote}
          />
        ) : (
          <BaseTableView
            queryResult={queryResult}
            onSelectNote={onOpenNote}
            onCellChange={handleCellChange}
            readOnly={readOnly}
            columnSizes={effectiveColumnSizes}
            onColumnResize={(col, width) =>
              setLocalColumnSizes((prev) => ({ ...prev, [col]: width }))
            }
            onColumnReorder={(newOrder) => setColumnOrderOverride(newOrder)}
            onColumnHide={() => {}}
            onColumnDisplayNameChange={() => {}}
            onColumnSort={(col, direction) => setSortOverride({ property: col, direction })}
            availablePropertiesToAdd={[]}
            onAddColumn={() => {}}
          />
        )}
      </div>
    </div>
  );
};
