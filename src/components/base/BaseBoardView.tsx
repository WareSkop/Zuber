import React, { useState, useMemo } from 'react';
import {
  FileText,
  Folder,
  Plus,
  ArrowDown,
  ArrowUp,
  Tag as TagIcon,
} from 'lucide-react';
import type { BaseQueryResult, BaseRecord } from '../../base/baseEngine';
import { getPropertyValue } from '../../base/baseEngine';
import type { BaseViewConfig, BaseBoardColumnConfig } from '../../base/baseConfig';
import { useTranslation } from '../../i18n';
import { api } from '../../api';

export interface BaseBoardViewProps {
  queryResult: BaseQueryResult;
  view: BaseViewConfig;
  onSelectNote: (path: string) => void;
  onCellChange?: (notePath: string, key: string, value: any) => Promise<void>;
  readOnly?: boolean;
  notes?: BaseRecord[];
  onAddCard?: (columnName: string) => void;
}

export const BaseBoardView: React.FC<BaseBoardViewProps> = ({
  queryResult,
  view,
  onSelectNote,
  onCellChange,
  readOnly = false,
  notes,
  onAddCard,
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

  return (
    <div className="base-board-container scroller">
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
                <span className="base-board-column-title">{col.label}</span>
                <span className="base-board-column-count">({col.records.length})</span>
              </div>

              {!readOnly && (
                <button
                  type="button"
                  className="base-board-add-card-btn"
                  onClick={() => onAddCard?.(col.key === 'no_status' ? '' : col.key)}
                  title={t('base.addCard', 'Karte hinzufügen')}
                  aria-label={t('base.addCard', 'Karte hinzufügen')}
                >
                  <Plus size={13} />
                </button>
              )}
            </div>

            {/* Column Drop Zone / Card List */}
            <div className="base-board-cards-list">
              {visibleCards.map((rec) => {
                const isDragging = draggingPath === rec.file.path;
                const noteName = rec.file.name ? rec.file.name.replace(/\.md$/i, '') : rec.file.path;

                return (
                  <div
                    key={rec.file.path}
                    className={`base-board-card ${isDragging ? 'is-dragging' : ''}`}
                    draggable={!readOnly}
                    onDragStart={(e) => {
                      try {
                        e.dataTransfer?.setData('text/plain', rec.file.path);
                      } catch {}
                      setDraggingPath(rec.file.path);
                    }}
                    onDragEnd={() => {
                      setDraggingPath(null);
                      setDragOverCol(null);
                    }}
                    onClick={() => onSelectNote(rec.file.path)}
                  >
                    {/* Card Top: Title & Folder */}
                    <div className="base-card-top">
                      <div
                        className="base-card-title-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectNote(rec.file.path);
                        }}
                        title={rec.file.path}
                      >
                        <FileText size={15} className="base-card-icon" />
                        <span className="base-card-title">{noteName}</span>
                      </div>
                      {rec.file.folder && (
                        <span className="base-card-folder" title={rec.file.folder}>
                          <Folder size={11} className="folder-icon" />
                          <span>{rec.file.folder}</span>
                        </span>
                      )}
                    </div>

                    {/* Card Tags */}
                    {rec.tags && rec.tags.length > 0 && (
                      <div className="base-card-tags">
                        {rec.tags.map((tg) => (
                          <span key={tg} className="base-tag-pill">
                            #{tg}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Card Custom Properties */}
                    <div className="base-card-props">
                      {columns
                        .filter((c) => c !== 'file.name' && c !== 'tags' && c !== groupByProp)
                        .map((c) => {
                          const val = getPropertyValue(rec, c);
                          if (val === undefined || val === null || val === '') return null;
                          const dName = displayNames[c] || c;
                          return (
                            <div key={c} className="base-card-prop-row">
                              <span className="base-prop-key">{dName}:</span>
                              <span className="base-prop-val">
                                {typeof val === 'boolean'
                                  ? val
                                    ? '✓'
                                    : '✗'
                                  : Array.isArray(val)
                                  ? val.join(', ')
                                  : String(val)}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                );
              })}

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
    </div>
  );
};
