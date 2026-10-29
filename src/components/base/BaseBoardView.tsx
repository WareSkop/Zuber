import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Plus,
  Check,
  X,
  MoreVertical,
  Edit2,
  Trash2,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import type {
  BaseQueryResult,
  BaseRecord,
  BaseBoard2DColumn,
  BaseBoardSwimlaneRow,
} from '../../base/baseEngine';
import { getPropertyValue, groupBoard2D } from '../../base/baseEngine';
import type {
  BaseViewConfig,
  BaseBoardColumnConfig,
  BaseBoardSwimlaneItem,
} from '../../base/baseConfig';
import { useTranslation } from '../../i18n';
import { api } from '../../api';
import { BaseBoardColumn, type BaseBoardColumnData } from './BaseBoardColumn';
import { BaseBoardCard } from './BaseBoardCard';

export interface BaseBoardViewProps {
  queryResult: BaseQueryResult;
  view: BaseViewConfig;
  onSelectNote: (path: string) => void;
  onCellChange?: (notePath: string, key: string, value: any) => Promise<void>;
  readOnly?: boolean;
  notes?: BaseRecord[];
  onAddCard?: (columnName: string, swimlaneName?: string) => void;
  onRenameColumn?: (oldName: string, newName: string) => void;
  onDeleteColumn?: (columnName: string) => void;
  onAddColumn?: (newColumnName: string) => void;
  onToggleSwimlaneCollapse?: (laneName: string, collapsed: boolean, isUnassigned?: boolean) => void;
  onRenameSwimlane?: (oldName: string, newName: string) => void;
  onDeleteSwimlane?: (laneName: string) => void;
  onUpdateConfig?: (updatedView: BaseViewConfig) => void;
}

interface SwimlaneBandProps {
  lane: BaseBoardSwimlaneRow;
  columns: BaseBoard2DColumn[];
  cardColumns: string[];
  displayNames: Record<string, string>;
  groupByProp: string;
  swimlaneProp: string;
  readOnly: boolean;
  dragOverCell: string | null;
  expandedCells: Record<string, boolean>;
  onToggleCellExpand: (cellKey: string) => void;
  onToggleCollapse: () => void;
  onAddCardInLane: () => void;
  onRenameSwimlane?: (oldName: string, newName: string) => void;
  onDeleteSwimlane?: (laneName: string) => void;
  onDropOnCell: (e: React.DragEvent, colKey: string, laneKey: string) => void;
  onDragOverCell: (e: React.DragEvent, cellKey: string) => void;
  onDragLeaveCell: (e: React.DragEvent) => void;
  onSelectNote: (path: string) => void;
  draggingPath: string | null;
  onDragStart: (path: string) => void;
  onDragEnd: () => void;
}

const SwimlaneBand: React.FC<SwimlaneBandProps> = ({
  lane,
  columns,
  cardColumns,
  displayNames,
  groupByProp,
  swimlaneProp,
  readOnly,
  dragOverCell,
  expandedCells,
  onToggleCellExpand,
  onToggleCollapse,
  onAddCardInLane,
  onRenameSwimlane,
  onDeleteSwimlane,
  onDropOnCell,
  onDragOverCell,
  onDragLeaveCell,
  onSelectNote,
  draggingPath,
  onDragStart,
  onDragEnd,
}) => {
  const { t } = useTranslation();
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(lane.label);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isEscapingRef = useRef(false);

  useEffect(() => {
    setDraftName(lane.label);
  }, [lane.label]);

  useEffect(() => {
    if (isRenaming) {
      isEscapingRef.current = false;
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }
  }, [isRenaming]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  const handleCommitRename = () => {
    if (isEscapingRef.current) {
      isEscapingRef.current = false;
      return;
    }
    const trimmed = draftName.trim();
    setIsRenaming(false);
    if (trimmed && trimmed !== lane.key) {
      onRenameSwimlane?.(lane.key, trimmed);
    } else {
      setDraftName(lane.label);
    }
  };

  const handleCancelRename = () => {
    isEscapingRef.current = true;
    setIsRenaming(false);
    setDraftName(lane.label);
  };

  return (
    <div
      className={`base-board-swimlane-band ${lane.collapsed ? 'is-collapsed' : 'is-expanded'}`}
      data-swimlane-key={lane.key}
    >
      {/* Swimlane Header Bar */}
      <div className="base-board-swimlane-header">
        <div className="base-board-swimlane-title-cluster">
          <button
            type="button"
            className="base-board-swimlane-collapse-btn"
            onClick={onToggleCollapse}
            aria-label={lane.collapsed ? 'Swimlane ausklappen' : 'Swimlane einklappen'}
            title={lane.collapsed ? 'Swimlane ausklappen' : 'Swimlane einklappen'}
          >
            <span className="collapse-chevron">{lane.collapsed ? '▶' : '▼'}</span>
          </button>

          {isRenaming ? (
            <div className="base-board-col-edit-inline" onClick={(e) => e.stopPropagation()}>
              <input
                ref={inputRef}
                type="text"
                className="base-board-col-rename-input"
                value={draftName}
                autoFocus
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCommitRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    handleCancelRename();
                  }
                }}
                onBlur={handleCommitRename}
              />
              <button
                type="button"
                className="base-board-col-confirm-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCommitRename}
                title="Bestätigen"
              >
                <Check size={12} />
              </button>
              <button
                type="button"
                className="base-board-col-cancel-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCancelRename}
                title="Abbrechen"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <span className="base-board-swimlane-title">{lane.label}</span>
          )}

          <span className="base-board-swimlane-count">({lane.totalCount})</span>
        </div>

        {!readOnly && (
          <div className="base-board-swimlane-actions">
            <button
              type="button"
              className="base-board-add-card-btn"
              onClick={onAddCardInLane}
              title={t('base.addCard', 'Karte hinzufügen')}
              aria-label={`${t('base.addCard', 'Karte hinzufügen')} (${lane.label})`}
            >
              <Plus size={13} />
            </button>

            {!lane.isUnassigned && (
              <div className="base-board-col-menu-wrapper" ref={menuRef}>
                <button
                  type="button"
                  className="base-board-col-menu-trigger"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsMenuOpen((prev) => !prev);
                  }}
                  title="Swimlane-Optionen"
                  aria-label={`Swimlane-Optionen (${lane.label})`}
                >
                  <MoreVertical size={13} />
                </button>

                {isMenuOpen && (
                  <div
                    className="base-dropdown-menu col-dropdown"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="base-dropdown-item"
                      onClick={() => {
                        setIsMenuOpen(false);
                        setDraftName(lane.label);
                        setIsRenaming(true);
                      }}
                    >
                      <Edit2 size={13} />
                      <span>{t('base.renameSwimlane', 'Swimlane umbenennen')}</span>
                    </button>
                    <button
                      type="button"
                      className="base-dropdown-item danger"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onDeleteSwimlane?.(lane.key);
                      }}
                    >
                      <Trash2 size={13} />
                      <span>{t('base.removeSwimlane', 'Swimlane entfernen')}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Swimlane Cells Row (only rendered when expanded) */}
      {!lane.collapsed && (
        <div className="base-board-swimlane-cells-row">
          {columns.map((col) => {
            const cellKey = `${lane.key}::${col.key}`;
            const cellRecords = lane.cells[col.key] || [];
            const isExpanded = !!expandedCells[cellKey];
            const visibleCards = isExpanded ? cellRecords : cellRecords.slice(0, col.limit);
            const remainingCount = cellRecords.length - visibleCards.length;
            const isOver = dragOverCell === cellKey;

            return (
              <div
                key={col.key}
                className={`base-board-swimlane-cell ${isOver ? 'drag-over' : ''}`}
                data-column-key={col.key}
                data-swimlane-key={lane.key}
                onDragOver={(e) => onDragOverCell(e, cellKey)}
                onDragLeave={onDragLeaveCell}
                onDrop={(e) => onDropOnCell(e, col.key, lane.key)}
              >
                {visibleCards.map((rec) => (
                  <BaseBoardCard
                    key={rec.file.path}
                    record={rec}
                    columns={cardColumns}
                    displayNames={displayNames}
                    groupByProp={groupByProp}
                    swimlaneProp={swimlaneProp}
                    readOnly={readOnly}
                    isDragging={draggingPath === rec.file.path}
                    onSelectNote={onSelectNote}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                  />
                ))}

                {remainingCount > 0 && (
                  <button
                    type="button"
                    className="base-board-show-more-btn"
                    onClick={() => onToggleCellExpand(cellKey)}
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

                {isExpanded && cellRecords.length > col.limit && (
                  <button
                    type="button"
                    className="base-board-show-more-btn"
                    onClick={() => onToggleCellExpand(cellKey)}
                  >
                    <ArrowUp size={12} />
                    <span>{t('base.showFewerCards', 'Weniger anzeigen')}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

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
  onToggleSwimlaneCollapse,
  onRenameSwimlane,
  onDeleteSwimlane,
  onUpdateConfig,
}) => {
  const { t } = useTranslation();
  const groupByProp = view.groupBy?.property || 'status';
  const swimlaneProp = view.swimlanes?.property?.trim() || '';
  const is2D = Boolean(swimlaneProp);

  // Optimistic in-memory overrides for zero-latency card moves: notePath -> { [propKey]: value }
  const [optimisticOverrides, setOptimisticOverrides] = useState<
    Record<string, Record<string, string>>
  >({});

  // Local collapse overrides so collapsing works immediately even before parent re-renders
  const [localCollapsedLanes, setLocalCollapsedLanes] = useState<Record<string, boolean>>({});

  // Sync local collapse overrides when view.swimlanes changes externally
  useEffect(() => {
    setLocalCollapsedLanes({});
  }, [view.swimlanes]);

  // Column / cell expanded state (for show more / fewer)
  const [expandedColumns, setExpandedColumns] = useState<Record<string, boolean>>({});
  const [expandedCells, setExpandedCells] = useState<Record<string, boolean>>({});

  // Drag and drop state
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);

  // New column input state (board right edge)
  const [isAddingColumn, setIsAddingColumn] = useState<boolean>(false);
  const [newColumnInput, setNewColumnInput] = useState<string>('');

  // Global dragend listener to ensure no card stays greyed out
  useEffect(() => {
    const handleGlobalDragEnd = () => {
      setDraggingPath(null);
      setDragOverCol(null);
      setDragOverCell(null);
    };

    window.addEventListener('dragend', handleGlobalDragEnd);
    return () => {
      window.removeEventListener('dragend', handleGlobalDragEnd);
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

  const getEffectivePropValue = (rec: BaseRecord, prop: string): any => {
    const overrides = optimisticOverrides[rec.file.path];
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, prop)) {
      return overrides[prop];
    }
    return getPropertyValue(rec, prop);
  };

  // Map records to 1D columns considering optimistic updates
  const columnsData: BaseBoardColumnData[] = useMemo(() => {
    const colMap = new Map<string, BaseRecord[]>();
    columnConfigs.forEach((c) => colMap.set(c.name, []));
    const noStatusRecords: BaseRecord[] = [];

    for (const rec of allRecords) {
      const currentVal = getEffectivePropValue(rec, groupByProp);

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

    const cols: BaseBoardColumnData[] = [];

    for (const col of columnConfigs) {
      cols.push({
        key: col.name,
        label: col.name,
        records: colMap.get(col.name) || [],
        limit: col.limit || view.columnLimit || 10,
        color: col.color,
      });
    }

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

  // 2D Matrix grouping when swimlanes are enabled
  const board2DData = useMemo(() => {
    if (!is2D) return null;
    const raw2D = groupBoard2D(allRecords, view, {
      noStatusLabel: t('base.noStatusColumn', 'Kein Status'),
      unassignedSwimlaneLabel: t('base.unassignedSwimlane', 'Keine Zuordnung'),
      getPropValue: getEffectivePropValue,
    });

    // Apply local collapse overrides if any
    const rows = raw2D.rows.map((r) => {
      if (Object.prototype.hasOwnProperty.call(localCollapsedLanes, r.key)) {
        return { ...r, collapsed: localCollapsedLanes[r.key] };
      }
      return r;
    });

    return {
      ...raw2D,
      rows,
    };
  }, [is2D, allRecords, view, optimisticOverrides, localCollapsedLanes, t]);

  const columns =
    Array.isArray(view?.order) && view.order.length > 0
      ? view.order
      : queryResult?.columns || ['file.name'];
  const displayNames = queryResult?.columnDisplayNames || {};

  // Helper to persist one or two frontmatter properties atomically
  const updateNoteProperties = async (
    notePath: string,
    updates: { prop: string; value: string }[]
  ) => {
    if (updates.length === 0) return;

    // 1. Instant optimistic update
    setOptimisticOverrides((prev) => {
      const existing = prev[notePath] || {};
      const nextForNote = { ...existing };
      for (const u of updates) {
        nextForNote[u.prop] = u.value;
      }
      return {
        ...prev,
        [notePath]: nextForNote,
      };
    });

    // 2. Persist to vault
    // When updating multiple properties at once (or clearing properties), save atomically via api.getNote + api.saveNote,
    // and also notify onCellChange if provided for single-property compatibility.
    if (updates.length === 1 && onCellChange && updates[0].value !== '') {
      await onCellChange(notePath, updates[0].prop, updates[0].value);
      return;
    }

    try {
      const note = await api.getNote(notePath);
      let existingProps = [...(note.properties || [])];

      for (const u of updates) {
        const propIdx = existingProps.findIndex(
          (p: any) => p.key.toLowerCase() === u.prop.toLowerCase()
        );
        if (u.value === '') {
          // Dropped into "Kein Status" or "Keine Zuordnung" -> remove property from frontmatter
          if (propIdx >= 0) {
            existingProps.splice(propIdx, 1);
          }
        } else if (propIdx >= 0) {
          existingProps[propIdx] = { ...existingProps[propIdx], value: u.value };
        } else {
          existingProps.push({ key: u.prop, value: u.value, type: 'text' });
        }
      }

      await api.saveNote({
        path: note.path,
        body: note.body,
        properties: existingProps,
        forceOverwrite: true,
      });

      if (onCellChange) {
        for (const u of updates) {
          try {
            await onCellChange(notePath, u.prop, u.value);
          } catch {}
        }
      }
    } catch (err) {
      // Fallback if api.getNote fails in mock/test environments where only onCellChange is provided
      if (onCellChange) {
        for (const u of updates) {
          try {
            await onCellChange(notePath, u.prop, u.value);
          } catch {}
        }
      } else {
        console.error('Failed to update frontmatter on board drop:', err);
      }
    }
  };

  // Handle drop event on a 1D column (or 2D column header)
  const handleDropOnColumn = async (e: React.DragEvent, targetColKey: string) => {
    e.preventDefault();
    setDragOverCol(null);
    const notePath = e.dataTransfer ? e.dataTransfer.getData('text/plain') : (draggingPath || '');
    setDraggingPath(null);

    if (!notePath || readOnly) return;

    const targetValue = targetColKey === 'no_status' ? '' : targetColKey;
    const found = allRecords.find((r) => r.file.path === notePath);
    const currentVal = found ? String(getEffectivePropValue(found, groupByProp) || '') : '';

    if (currentVal.toLowerCase() === targetValue.toLowerCase()) {
      return;
    }

    await updateNoteProperties(notePath, [{ prop: groupByProp, value: targetValue }]);
  };

  // Handle drop event on a 2D cell (targetColKey × targetLaneKey)
  const handleDropOnCell = async (
    e: React.DragEvent,
    targetColKey: string,
    targetLaneKey: string
  ) => {
    e.preventDefault();
    setDragOverCell(null);
    const notePath = e.dataTransfer ? e.dataTransfer.getData('text/plain') : (draggingPath || '');
    setDraggingPath(null);

    if (!notePath || readOnly) return;

    const targetColVal = targetColKey === 'no_status' ? '' : targetColKey;
    const targetLaneVal = targetLaneKey === 'unassigned_swimlane' ? '' : targetLaneKey;

    const found = allRecords.find((r) => r.file.path === notePath);
    const curColVal = found ? String(getEffectivePropValue(found, groupByProp) || '') : '';
    const curLaneVal = found ? String(getEffectivePropValue(found, swimlaneProp) || '') : '';

    const updates: { prop: string; value: string }[] = [];
    if (curColVal.toLowerCase() !== targetColVal.toLowerCase()) {
      updates.push({ prop: groupByProp, value: targetColVal });
    }
    if (
      swimlaneProp &&
      swimlaneProp.toLowerCase() !== groupByProp.toLowerCase() &&
      curLaneVal.toLowerCase() !== targetLaneVal.toLowerCase()
    ) {
      updates.push({ prop: swimlaneProp, value: targetLaneVal });
    }

    if (updates.length === 0) return;

    await updateNoteProperties(notePath, updates);
  };

  const toggleExpand = (colKey: string) => {
    setExpandedColumns((prev) => ({
      ...prev,
      [colKey]: !prev[colKey],
    }));
  };

  const toggleCellExpand = (cellKey: string) => {
    setExpandedCells((prev) => ({
      ...prev,
      [cellKey]: !prev[cellKey],
    }));
  };

  const handleToggleSwimlane = (lane: BaseBoardSwimlaneRow) => {
    const nextCollapsed = !lane.collapsed;
    setLocalCollapsedLanes((prev) => ({
      ...prev,
      [lane.key]: nextCollapsed,
    }));

    if (onToggleSwimlaneCollapse) {
      onToggleSwimlaneCollapse(lane.key, nextCollapsed, lane.isUnassigned);
      return;
    }

    if (onUpdateConfig && view.swimlanes) {
      if (lane.isUnassigned) {
        onUpdateConfig({
          ...view,
          swimlanes: {
            ...view.swimlanes,
            unassignedCollapsed: nextCollapsed,
          },
        });
      } else {
        const curLanes = view.swimlanes.lanes || [];
        const updatedLanes: (string | BaseBoardSwimlaneItem)[] = curLanes.map((item) => {
          const itemName = typeof item === 'string' ? item : item.name;
          if (itemName.toLowerCase() === lane.key.toLowerCase()) {
            return { name: itemName, collapsed: nextCollapsed };
          }
          return item;
        });
        onUpdateConfig({
          ...view,
          swimlanes: {
            ...view.swimlanes,
            lanes: updatedLanes,
          },
        });
      }
    }
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

  const renderAddColumnWidget = () => {
    if (readOnly) return null;
    return (
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
    );
  };

  // ==========================================
  // 2D SWIMLANE BOARD RENDER
  // ==========================================
  if (is2D && board2DData) {
    const firstValidColumnKey =
      board2DData.columns.find((c) => c.key !== 'no_status')?.key || '';

    return (
      <div
        className="base-board-container base-board-2d-container scroller"
        onDragEnd={() => {
          setDraggingPath(null);
          setDragOverCol(null);
          setDragOverCell(null);
        }}
        onDrop={() => {
          setDraggingPath(null);
          setDragOverCol(null);
          setDragOverCell(null);
        }}
      >
        <div className="base-board-2d-grid">
          {/* 1. Sticky Column Headers Row (rendered once at the top) */}
          <div className="base-board-2d-header-row">
            {board2DData.columns.map((col) => {
              const colData: BaseBoardColumnData = {
                key: col.key,
                label: col.label,
                records: new Array(col.totalCount).fill(null) as any,
                limit: col.limit,
                color: col.color,
              };
              return (
                <BaseBoardColumn
                  key={col.key}
                  col={colData}
                  columns={columns}
                  displayNames={displayNames}
                  groupByProp={groupByProp}
                  readOnly={readOnly}
                  isOver={dragOverCol === col.key}
                  isExpanded={false}
                  onToggleExpand={() => {}}
                  onDrop={handleDropOnColumn}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverCol !== col.key) setDragOverCol(col.key);
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    setDragOverCol(null);
                  }}
                  onAddCard={(colVal) => onAddCard?.(colVal)}
                  onRenameColumn={onRenameColumn}
                  onDeleteColumn={onDeleteColumn}
                  onSelectNote={onSelectNote}
                  draggingPath={draggingPath}
                  onDragStart={(path) => setDraggingPath(path)}
                  onDragEnd={() => {
                    setDraggingPath(null);
                    setDragOverCol(null);
                    setDragOverCell(null);
                  }}
                  headerOnly={true}
                />
              );
            })}

            {renderAddColumnWidget()}
          </div>

          {/* 2. Horizontal Swimlane Bands */}
          <div className="base-board-2d-swimlanes-list">
            {board2DData.rows.map((lane) => (
              <SwimlaneBand
                key={lane.key}
                lane={lane}
                columns={board2DData.columns}
                cardColumns={columns}
                displayNames={displayNames}
                groupByProp={groupByProp}
                swimlaneProp={swimlaneProp}
                readOnly={readOnly}
                dragOverCell={dragOverCell}
                expandedCells={expandedCells}
                onToggleCellExpand={toggleCellExpand}
                onToggleCollapse={() => handleToggleSwimlane(lane)}
                onAddCardInLane={() =>
                  onAddCard?.(firstValidColumnKey, lane.isUnassigned ? '' : lane.key)
                }
                onRenameSwimlane={onRenameSwimlane}
                onDeleteSwimlane={onDeleteSwimlane}
                onDropOnCell={handleDropOnCell}
                onDragOverCell={(e, cellKey) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverCell !== cellKey) setDragOverCell(cellKey);
                }}
                onDragLeaveCell={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  setDragOverCell(null);
                }}
                onSelectNote={onSelectNote}
                draggingPath={draggingPath}
                onDragStart={(path) => setDraggingPath(path)}
                onDragEnd={() => {
                  setDraggingPath(null);
                  setDragOverCol(null);
                  setDragOverCell(null);
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // 1D STANDARD BOARD RENDER
  // ==========================================
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
      {columnsData.map((col) => (
        <BaseBoardColumn
          key={col.key}
          col={col}
          columns={columns}
          displayNames={displayNames}
          groupByProp={groupByProp}
          readOnly={readOnly}
          isOver={dragOverCol === col.key}
          isExpanded={!!expandedColumns[col.key]}
          onToggleExpand={() => toggleExpand(col.key)}
          onDrop={handleDropOnColumn}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dragOverCol !== col.key) setDragOverCol(col.key);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setDragOverCol(null);
          }}
          onAddCard={(colVal) => onAddCard?.(colVal)}
          onRenameColumn={onRenameColumn}
          onDeleteColumn={onDeleteColumn}
          onSelectNote={onSelectNote}
          draggingPath={draggingPath}
          onDragStart={(path) => setDraggingPath(path)}
          onDragEnd={() => {
            setDraggingPath(null);
            setDragOverCol(null);
          }}
        />
      ))}

      {renderAddColumnWidget()}
    </div>
  );
};
