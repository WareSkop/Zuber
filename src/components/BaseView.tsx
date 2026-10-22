import React, { useState, useEffect, useMemo } from 'react';
import {
  Table as TableIcon,
  LayoutGrid,
  List,
  AlertTriangle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FileText,
  Tag,
  Calendar,
  CheckSquare,
  Square,
  ExternalLink,
} from 'lucide-react';
import {
  parseBaseYaml,
  executeBaseQuery,
  getPropertyValue,
  type BaseRecord,
  type BaseQueryResult,
} from '../base/baseEngine';
import { useTranslation } from '../i18n';
import { syncEngine } from '../sync/syncEngine';
import { api } from '../api';

export interface BaseViewProps {
  yamlContent?: string;
  definitionYaml?: string;
  allNotes?: any[];
  filePath?: string;
  currentBasePath?: string;
  onSelectNote?: (path: string) => void;
  onOpenNote?: (path: string) => void;
  onCellChange?: (notePath: string, key: string, value: any) => Promise<void>;
  readOnly?: boolean;
  className?: string;
}

export const BaseView: React.FC<BaseViewProps> = ({
  yamlContent,
  definitionYaml,
  allNotes,
  filePath,
  currentBasePath,
  onSelectNote,
  onOpenNote,
  onCellChange,
  readOnly = false,
  className = '',
}) => {
  const { t } = useTranslation();
  const effectiveYaml = yamlContent ?? definitionYaml ?? '';
  const effectiveSelectNote = onSelectNote || onOpenNote;
  const effectiveBasePath = filePath || currentBasePath;
  const [internalNotes, setInternalNotes] = useState<any[]>(allNotes || []);
  const [activeViewIdx, setActiveViewIdx] = useState(0);
  const [sortOverride, setSortOverride] = useState<{ property: string; direction: 'ASC' | 'DESC' } | null>(null);
  const [editingCell, setEditingCell] = useState<{ recordPath: string; column: string } | null>(null);
  const [cellDraftValue, setCellDraftValue] = useState<string>('');

  useEffect(() => {
    if (allNotes && allNotes.length > 0) {
      setInternalNotes(allNotes);
      return;
    }
    let cancelled = false;
    syncEngine.getLocalDb().getAllNotes().then((notes: any[]) => {
      if (!cancelled && notes && notes.length > 0) {
        setInternalNotes(notes);
      } else if (!cancelled && allNotes) {
        setInternalNotes(allNotes);
      }
    }).catch(() => {
      if (!cancelled && allNotes) {
        setInternalNotes(allNotes);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [allNotes]);

  // Parse YAML definition
  const { definition, parseError } = useMemo(() => {
    try {
      const def = parseBaseYaml(effectiveYaml);
      return { definition: def, parseError: null };
    } catch (err: any) {
      return { definition: null, parseError: err?.message || String(err) };
    }
  }, [effectiveYaml]);

  // Execute Query
  const queryResult: BaseQueryResult | null = useMemo(() => {
    if (!definition) return null;
    const res = executeBaseQuery(definition, internalNotes, activeViewIdx, effectiveBasePath);

    // Apply header-click sort override if present
    if (sortOverride) {
      const dir = sortOverride.direction === 'DESC' ? -1 : 1;
      const sorted = [...res.records].sort((a, b) => {
        const valA = getPropertyValue(a, sortOverride.property);
        const valB = getPropertyValue(b, sortOverride.property);
        if (valA === valB) return 0;
        if (valA === undefined || valA === null) return 1 * dir;
        if (valB === undefined || valB === null) return -1 * dir;
        if (typeof valA === 'number' && typeof valB === 'number') {
          return (valA - valB) * dir;
        }
        return String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' }) * dir;
      });

      // Update groups
      if (res.groups.length === 1 && res.groups[0].key === 'all') {
        return {
          ...res,
          records: sorted,
          groups: [{ key: 'all', label: 'All Notes', records: sorted }],
        };
      }
    }

    return res;
  }, [definition, allNotes, activeViewIdx, sortOverride]);

  if (parseError) {
    return (
      <div className="base-error-box">
        <div className="base-error-header">
          <AlertTriangle size={16} className="base-error-icon" />
          <span>{t('base.syntaxError') || 'Syntaxfehler in Base-Definition'}</span>
        </div>
        <pre className="base-error-message">{parseError}</pre>
      </div>
    );
  }

  if (!queryResult) return null;

  const views = definition?.views || [{ type: 'table', name: 'Table' }];
  const currentView = queryResult.view;
  const isCards = currentView.type === 'cards';

  const handleHeaderSort = (colKey: string) => {
    setSortOverride((prev) => {
      if (prev && prev.property === colKey) {
        return prev.direction === 'ASC' ? { property: colKey, direction: 'DESC' } : null;
      }
      return { property: colKey, direction: 'ASC' };
    });
  };

  const triggerCellChange = async (notePath: string, col: string, newVal: any) => {
    if (onCellChange) {
      await onCellChange(notePath, col, newVal);
      return;
    }
    try {
      const note = await api.getNote(notePath);
      const existingProps = [...(note.properties || [])];
      const propIdx = existingProps.findIndex((p) => p.key.toLowerCase() === col.toLowerCase());
      const propType = typeof newVal === 'boolean' ? 'checkbox' : typeof newVal === 'number' ? 'number' : 'text';
      if (propIdx >= 0) {
        existingProps[propIdx] = { key: existingProps[propIdx].key, value: newVal, type: propType };
      } else {
        existingProps.push({ key: col, value: newVal, type: propType });
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
              [col]: newVal,
            },
          };
        })
      );
    } catch (err) {
      console.error('Failed to update note property:', err);
    }
  };

  const handleCellBlur = async (rec: BaseRecord, col: string) => {
    if (readOnly) {
      setEditingCell(null);
      return;
    }
    const oldVal = getPropertyValue(rec, col);
    let newVal: any = cellDraftValue;

    // Convert number if original value was a number
    if (typeof oldVal === 'number' && !isNaN(Number(cellDraftValue))) {
      newVal = Number(cellDraftValue);
    }

    setEditingCell(null);
    if (newVal !== oldVal) {
      await triggerCellChange(rec.file.path, col, newVal);
    }
  };

  const handleCheckboxToggle = async (rec: BaseRecord, col: string, currentVal: boolean) => {
    if (readOnly) return;
    await triggerCellChange(rec.file.path, col, !currentVal);
  };

  return (
    <div className={`base-view-container ${className}`}>
      {/* View Switcher Bar */}
      <div className="base-view-header">
        <div className="base-view-tabs">
          {views.map((v, idx) => {
            const isTabActive = idx === activeViewIdx;
            const IconComponent = v.type === 'cards' ? LayoutGrid : v.type === 'list' ? List : TableIcon;
            return (
              <button
                key={`${v.name || v.type}-${idx}`}
                type="button"
                className={`base-tab-btn ${isTabActive ? 'active' : ''}`}
                onClick={() => {
                  setActiveViewIdx(idx);
                  setSortOverride(null);
                }}
              >
                <IconComponent size={14} />
                <span>{v.name || (v.type === 'cards' ? 'Cards' : 'Table')}</span>
              </button>
            );
          })}
        </div>

        <div className="base-view-meta">
          <span className="base-count-badge">
            {t('base.recordsCount', { count: queryResult.totalCount }) || `${queryResult.totalCount} Notizen`}
          </span>
        </div>
      </div>

      {/* Empty State */}
      {queryResult.records.length === 0 ? (
        <div className="base-empty-state">
          <p>{t('base.noRecordsFound') || 'Keine passenden Notizen gefunden.'}</p>
        </div>
      ) : isCards ? (
        /* CARDS VIEW */
        <div className="base-cards-container">
          {queryResult.groups.map((group) => (
            <div key={group.key} className="base-group-section">
              {queryResult.groups.length > 1 && (
                <div className="base-group-header">
                  <span className="base-group-title">{group.label}</span>
                  <span className="base-group-count">({group.records.length})</span>
                </div>
              )}
              <div className="base-cards-grid">
                {group.records.map((rec) => (
                  <div key={rec.file.path} className="base-card">
                    <div className="base-card-top">
                      <div
                        className="base-card-title-link"
                        onClick={() => effectiveSelectNote?.(rec.file.path)}
                        title={rec.file.path}
                      >
                        <FileText size={15} className="base-card-icon" />
                        <span className="base-card-title">{rec.file.name.replace(/\.md$/i, '')}</span>
                      </div>
                      {rec.file.folder && (
                        <span className="base-card-folder" title={rec.file.folder}>
                          {rec.file.folder}
                        </span>
                      )}
                    </div>

                    {rec.tags.length > 0 && (
                      <div className="base-card-tags">
                        {rec.tags.map((t) => (
                          <span key={t} className="base-tag-pill">
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="base-card-props">
                      {queryResult.columns
                        .filter((c) => c !== 'file.name' && c !== 'tags')
                        .map((col) => {
                          const val = getPropertyValue(rec, col);
                          if (val === undefined || val === null || val === '') return null;
                          const displayName = queryResult.columnDisplayNames[col] || col;
                          return (
                            <div key={col} className="base-card-prop-row">
                              <span className="base-prop-key">{displayName}:</span>
                              <span className="base-prop-val">
                                {typeof val === 'boolean' ? (
                                  val ? '✓' : '✗'
                                ) : Array.isArray(val) ? (
                                  val.join(', ')
                                ) : (
                                  String(val)
                                )}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="base-table-wrapper scroller">
          {queryResult.groups.map((group) => (
            <div key={group.key} className="base-group-section">
              {queryResult.groups.length > 1 && (
                <div className="base-group-header">
                  <span className="base-group-title">{group.label}</span>
                  <span className="base-group-count">({group.records.length})</span>
                </div>
              )}
              <table className="base-table">
                <thead>
                  <tr>
                    {queryResult.columns.map((col) => {
                      const displayName = queryResult.columnDisplayNames[col] || col;
                      const isSorted = sortOverride?.property === col;
                      const customWidth = currentView.columnSize?.[col];

                      return (
                        <th
                          key={col}
                          style={customWidth ? { width: `${customWidth}px` } : undefined}
                          onClick={() => handleHeaderSort(col)}
                          className={isSorted ? 'sorted' : ''}
                        >
                          <div className="base-th-content">
                            <span>{displayName}</span>
                            <span className="base-sort-indicator">
                              {isSorted ? (
                                sortOverride?.direction === 'ASC' ? (
                                  <ArrowUp size={12} />
                                ) : (
                                  <ArrowDown size={12} />
                                )
                              ) : (
                                <ArrowUpDown size={11} className="dimmed" />
                              )}
                            </span>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {group.records.map((rec) => (
                    <tr key={rec.file.path}>
                      {queryResult.columns.map((col) => {
                        const val = getPropertyValue(rec, col);
                        const isFormula = col.startsWith('formula.');
                        const isEditing = editingCell?.recordPath === rec.file.path && editingCell?.column === col;

                        // Case 1: file.name column
                        if (col === 'file.name') {
                          return (
                            <td key={col} className="base-col-name">
                              <div
                                className="base-name-link"
                                onClick={() => effectiveSelectNote?.(rec.file.path)}
                                title={rec.file.path}
                              >
                                <FileText size={14} className="base-name-icon" />
                                <span>{rec.file.name.replace(/\.md$/i, '')}</span>
                              </div>
                            </td>
                          );
                        }

                        // Case 2: Boolean checkbox property
                        if (typeof val === 'boolean') {
                          return (
                            <td key={col} className="base-col-checkbox">
                              <button
                                type="button"
                                className="base-checkbox-btn"
                                disabled={readOnly || isFormula}
                                onClick={() => handleCheckboxToggle(rec, col, val)}
                              >
                                {val ? (
                                  <CheckSquare size={16} className="checked" />
                                ) : (
                                  <Square size={16} className="unchecked" />
                                )}
                              </button>
                            </td>
                          );
                        }

                        // Case 3: Tags property
                        if (col === 'tags' || (Array.isArray(val) && col.toLowerCase().includes('tag'))) {
                          const tagList = Array.isArray(val) ? val : rec.tags;
                          return (
                            <td key={col} className="base-col-tags">
                              <div className="base-tags-cell">
                                {tagList.map((t: string) => (
                                  <span key={t} className="base-tag-pill">
                                    #{t.replace(/^#/, '')}
                                  </span>
                                ))}
                              </div>
                            </td>
                          );
                        }

                        // Case 4: Editing mode for cell
                        if (isEditing && !readOnly && !isFormula) {
                          return (
                            <td key={col} className="base-col-editing">
                              <input
                                type="text"
                                className="base-cell-input"
                                value={cellDraftValue}
                                autoFocus
                                onChange={(e) => setCellDraftValue(e.target.value)}
                                onBlur={() => handleCellBlur(rec, col)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleCellBlur(rec, col);
                                  if (e.key === 'Escape') setEditingCell(null);
                                }}
                              />
                            </td>
                          );
                        }

                        // Case 5: Regular cell display
                        const displayVal = val !== undefined && val !== null ? String(val) : '';
                        return (
                          <td
                            key={col}
                            className={`base-col-val ${isFormula ? 'formula-col' : ''}`}
                            onClick={() => {
                              if (!readOnly && !isFormula) {
                                setEditingCell({ recordPath: rec.file.path, column: col });
                                setCellDraftValue(displayVal);
                              }
                            }}
                          >
                            <span className={displayVal ? 'base-val-text' : 'base-val-empty'}>
                              {displayVal || '—'}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
