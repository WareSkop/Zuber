import React, { useState, useMemo, useEffect } from 'react';
import {
  Plus,
  ArrowDown,
  ArrowUp,
  MoreVertical,
  Edit2,
  Trash2,
  Check,
  X,
} from 'lucide-react';
import type { BaseQueryResult, BaseRecord } from '../../base/baseEngine';
import { getPropertyValue } from '../../base/baseEngine';
import type { BaseViewConfig, BaseBoardColumnConfig } from '../../base/baseConfig';
import { useTranslation } from '../../i18n';
import { api } from '../../api';
import { BaseBoardCard } from './BaseBoardCard';

export interface BaseBoardViewProps {
  queryResult: BaseQueryResult;
  view: BaseViewConfig;
  onSelectNote: (path: string) => void;
  onCellChange?: (notePath: string, key: string, value: any) => Promise<void>;
  readOnly?: boolean;
  notes?: BaseRecord[];
  onAddCard?: (columnName: string) => void;
  onRenameColumn?: (oldName: string, newName: string) => void;
  onDeleteColumn?: (columnName: string) => void;
  onAddColumn?: (newColumnName: string) => void;
}

export const BaseBoardView: React.FC<BaseBoardViewProps> = ({
  queryResult,
  view,
  onSelectNote,
  onCellChange,
  readOnly = false,
  notes,
  onAddCard,
  onRenameColumn,
  onDeleteColumn,
  onAddColumn,
}) => {
  const { t } = useTranslation();
  const groupByProp = view.groupBy?.property || 'status';

  // Optimistic in-memory overrides for zero-latency card moves
  const [optimisticOverrides, setOptimisticOverrides] = useState<Record<string, string>>({});

  // Column expanded state (for show more / fewer)
  const [expandedColumns, setExpandedColumns] = useState<Record<string, boolean>>({});

  // Drag and drop state
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  // Inline column editing state
  const [editingColKey, setEditingColKey] = useState<string | null>(null);
  const [draftColName, setDraftColName] = useState<string>('');
  const [openMenuColKey, setOpenMenuColKey] = useState<string | null>(null);

  // New column input state
  const [isAddingColumn, setIsAddingColumn] = useState<boolean>(false);
  const [newColumnInput, setNewColumnInput] = useState<string>('');

  // Global dragend and click outside listener to ensure no card stays greyed out
  useEffect(() => {
    const handleGlobalDragEnd = () => {
      setDraggingPath(null);
      setDragOverCol(null);
    };
    const handleClickOutside = () => {
      setOpenMenuColKey(null);
    };

    window.addEventListener('dragend', handleGlobalDragEnd);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('dragend', handleGlobalDragEnd);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Column configs from view
  const explicitCols = view.groupBy?.columns || ['Open', 'inWork', 'Waiting', 'Finish'];
  const columnConfigs: BaseBoardColumnConfig[] = useMemo(() => {
    return explicitCols.map((c) =>
      typeof c === 'string' ? { name: c } : { name: c.name, limit: c.limit, color: c.color }
    );
  }, [explicitCols]);

  // All records (either passed explicitly or from queryResult)
  const allRecords: BaseRecord[] = useMemo(() => {
    return notes || queryResult?.records || [];
  }, [notes, queryResult?.records]);

  // Map records to columns considering optimistic updates
  const columnsData = useMemo(() => {
    const colMap = new Map<string, BaseRecord[]>();
    columnConfigs.forEach((c) => colMap.set(c.name, []));
    const noStatusRecords: BaseRecord[] = [];

    for (const rec of allRecords) {
      const currentVal =
        optimisticOverrides[rec.file.path] !== undefined
          ? optimisticOverrides[rec.file.path]
          : getPropertyValue(rec, groupByProp);

      if (currentVal === undefined || currentVal === null || String(currentVal).trim() === '') {
        noStatusRecords.push(rec);
        continue;
      }

      const strVal = String(currentVal).trim();
      const matched = columnConfigs.find(
        (c) => c.name.toLowerCase() === strVal.toLowerCase()
      );

      if (matched) {
        colMap.get(matched.name)!.push(rec);
      } else {
        noStatusRecords.push(rec);
      }
    }

    const cols: Array<{
      key: string;
      label: string;
      records: BaseRecord[];
      limit: number;
      color?: string;
    }> = [];

    for (const col of columnConfigs) {
      cols.push({
        key: col.name,
        label: col.name,
        records: colMap.get(col.name) || [],
        limit: col.limit || view.columnLimit || 10,
        color: col.color,
      });
    }

    // Append 'No Status' column if there are unassigned cards or if configured
    if (noStatusRecords.length > 0 || columnConfigs.length === 0) {
      cols.push({
        key: 'no_status',
        label: t('base.noStatusColumn', 'Kein Status'),
        records: noStatusRecords,
        limit: view.columnLimit || 10,
      });
    }

    return cols;
  }, [allRecords, optimisticOverrides, columnConfigs, groupByProp, view.columnLimit, t]);

  const columns = queryResult?.columns || view?.order || ['file.name'];
  const displayNames = queryResult?.columnDisplayNames || {};

  // Handle drop event on a column
  const handleDropOnColumn = async (e: React.DragEvent, targetColKey: string) => {
    e.preventDefault();
    setDragOverCol(null);
    const notePath = e.dataTransfer ? e.dataTransfer.getData('text/plain') : (draggingPath || '');
    // Immediately clear draggingPath so the card never stays in dragging/greyed out state
    setDraggingPath(null);

    if (!notePath || readOnly) return;

    const targetValue = targetColKey === 'no_status' ? '' : targetColKey;

    const currentVal =
      optimisticOverrides[notePath] !== undefined
        ? optimisticOverrides[notePath]
        : (() => {
            const found = allRecords.find((r) => r.file.path === notePath);
            return found ? String(getPropertyValue(found, groupByProp) || '') : '';
          })();

    if (currentVal.toLowerCase() === targetValue.toLowerCase()) {
      return;
    }

    // 1. Instant optimistic update
    setOptimisticOverrides((prev) => ({
      ...prev,
      [notePath]: targetValue,
    }));

    // 2. Persist to vault
    if (onCellChange) {
      await onCellChange(notePath, groupByProp, targetValue);
    } else {
      try {
        const note = await api.getNote(notePath);
        const existingProps = [...(note.properties || [])];
        const propIdx = existingProps.findIndex(
          (p: any) => p.key.toLowerCase() === groupByProp.toLowerCase()
        );
        if (propIdx >= 0) {
          existingProps[propIdx] = { ...existingProps[propIdx], value: targetValue };
        } else {
          existingProps.push({ key: groupByProp, value: targetValue, type: 'text' });
        }
        await api.saveNote({
          path: note.path,
          body: note.body,
          properties: existingProps,
          forceOverwrite: true,
        });
      } catch (err) {
        console.error('Failed to update frontmatter on board drop:', err);
      }
    }
  };

  const toggleExpand = (colKey: string) => {
    setExpandedColumns((prev) => ({
      ...prev,
      [colKey]: !prev[colKey],
    }));
  };

  const handleCommitColRename = (oldColKey: string) => {
    if (!draftColName.trim() || draftColName.trim() === oldColKey) {
      setEditingColKey(null);
      return;
    }
    const newName = draftColName.trim();
    setEditingColKey(null);
    onRenameColumn?.(oldColKey, newName);
  };

  const handleCommitAddColumn = () => {
    const trimmed = newColumnInput.trim();
    if (!trimmed) {
      setIsAddingColumn(false);
      return;
    }
    onAddColumn?.(trimmed);
    setNewColumnInput('');
    setIsAddingColumn(false);
  };

  return (
    <div
      className="base-board-container scroller"
      onDragEnd={() => {
        setDraggingPath(null);
        setDragOverCol(null);
      }}
      onDrop={() => {
        setDraggingPath(null);
        setDragOverCol(null);
      }}
    >
      {columnsData.map((col) => {
        const isOver = dragOverCol === col.key;
        const isExpanded = !!expandedColumns[col.key];
        const visibleCards = isExpanded ? col.records : col.records.slice(0, col.limit);
        const remainingCount = col.records.length - visibleCards.length;

        return (
          <div
            key={col.key}
            className={`base-board-column ${isOver ? 'drag-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dragOverCol !== col.key) setDragOverCol(col.key);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDragOverCol(null);
            }}
            onDrop={(e) => handleDropOnColumn(e, col.key)}
          >
            {/* Column Header */}
            <div className="base-board-column-header">
              <div className="base-board-column-title-cluster">
                {col.color && (
                  <span
                    className="base-board-column-badge"
                    style={{ backgroundColor: col.color }}
                  />
                )}

                {editingColKey === col.key ? (
                  <div className="base-board-col-edit-inline" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      className="base-board-col-rename-input"
                      value={draftColName}
                      autoFocus
                      onChange={(e) => setDraftColName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCommitColRename(col.key);
                        if (e.key === 'Escape') setEditingColKey(null);
                      }}
                    />
                    <button
                      type="button"
                      className="base-board-col-confirm-btn"
                      onClick={() => handleCommitColRename(col.key)}
                      title="Bestätigen"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      type="button"
                      className="base-board-col-cancel-btn"
                      onClick={() => setEditingColKey(null)}
                      title="Abbrechen"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <span
                    className={`base-board-column-title ${!readOnly && col.key !== 'no_status' ? 'editable' : ''}`}
                    onClick={() => {
                      if (!readOnly && col.key !== 'no_status') {
                        setEditingColKey(col.key);
                        setDraftColName(col.label);
                      }
                    }}
                    title={!readOnly && col.key !== 'no_status' ? 'Klicken zum Umbenennen' : col.label}
                  >
                    {col.label}
                  </span>
                )}

                <span className="base-board-column-count">({col.records.length})</span>
              </div>

              {!readOnly && (
                <div className="base-board-col-header-actions">
                  <button
                    type="button"
                    className="base-board-add-card-btn"
                    onClick={() => onAddCard?.(col.key === 'no_status' ? '' : col.key)}
                    title={t('base.addCard', 'Karte hinzufügen')}
                    aria-label={t('base.addCard', 'Karte hinzufügen')}
                  >
                    <Plus size={13} />
                  </button>

                  {col.key !== 'no_status' && (
                    <div className="base-board-col-menu-wrapper">
                      <button
                        type="button"
                        className="base-board-col-menu-trigger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuColKey(openMenuColKey === col.key ? null : col.key);
                        }}
                        title="Spalten-Optionen"
                      >
                        <MoreVertical size={13} />
                      </button>

                      {openMenuColKey === col.key && (
                        <div
                          className="base-dropdown-menu col-dropdown"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="base-dropdown-item"
                            onClick={() => {
                              setOpenMenuColKey(null);
                              setEditingColKey(col.key);
                              setDraftColName(col.label);
                            }}
                          >
                            <Edit2 size={13} />
                            <span>{t('base.renameColumn', 'Spalte umbenennen')}</span>
                          </button>
                          {columnConfigs.length > 1 && (
                            <button
                              type="button"
                              className="base-dropdown-item danger"
                              onClick={() => {
                                setOpenMenuColKey(null);
                                onDeleteColumn?.(col.key);
                              }}
                            >
                              <Trash2 size={13} />
                              <span>{t('base.deleteColumn', 'Spalte entfernen')}</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Column Drop Zone / Card List */}
            <div className="base-board-cards-list">
              {visibleCards.map((rec) => (
                <BaseBoardCard
                  key={rec.file.path}
                  record={rec}
                  columns={columns}
                  displayNames={displayNames}
                  groupByProp={groupByProp}
                  readOnly={readOnly}
                  isDragging={draggingPath === rec.file.path}
                  onSelectNote={onSelectNote}
                  onDragStart={(path) => {
                    setDraggingPath(path);
                  }}
                  onDragEnd={() => {
                    setDraggingPath(null);
                    setDragOverCol(null);
                  }}
                />
              ))}

              {/* Show More / Show Fewer Pagination Button */}
              {remainingCount > 0 && (
                <button
                  type="button"
                  className="base-board-show-more-btn"
                  onClick={() => toggleExpand(col.key)}
                >
                  <ArrowDown size={12} />
                  <span>
                    {t(
                      'base.showMoreCards',
                      { count: remainingCount },
                      `${remainingCount} weitere anzeigen...`
                    )}
                  </span>
                </button>
              )}

              {isExpanded && col.records.length > col.limit && (
                <button
                  type="button"
                  className="base-board-show-more-btn"
                  onClick={() => toggleExpand(col.key)}
                >
                  <ArrowUp size={12} />
                  <span>{t('base.showFewerCards', 'Weniger anzeigen')}</span>
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* "+ Neue Spalte hinzufügen" Button ganz rechts auf dem Board */}
      {!readOnly && (
        <div className="base-board-add-column-wrapper">
          {isAddingColumn ? (
            <div className="base-board-add-column-form">
              <input
                type="text"
                className="base-input add-column-input"
                placeholder={t('base.newColumnPlaceholder', 'Spaltenname...')}
                value={newColumnInput}
                autoFocus
                onChange={(e) => setNewColumnInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCommitAddColumn();
                  if (e.key === 'Escape') setIsAddingColumn(false);
                }}
              />
              <div className="add-col-actions">
                <button
                  type="button"
                  className="base-btn primary-btn btn-sm"
                  onClick={handleCommitAddColumn}
                  disabled={!newColumnInput.trim()}
                >
                  <Check size={12} />
                  <span>{t('common.save', 'Speichern')}</span>
                </button>
                <button
                  type="button"
                  className="base-btn secondary-btn btn-sm"
                  onClick={() => {
                    setIsAddingColumn(false);
                    setNewColumnInput('');
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="base-board-add-column-btn"
              onClick={() => setIsAddingColumn(true)}
              title={t('base.addColumn', 'Neue Spalte hinzufügen')}
            >
              <Plus size={15} />
              <span>{t('base.addColumn', 'Neue Spalte hinzufügen')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
