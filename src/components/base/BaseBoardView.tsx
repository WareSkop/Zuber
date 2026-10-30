import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Plus,
  Check,
  X,
} from 'lucide-react';
import type {
  BaseQueryResult,
  BaseRecord,
  BaseBoard2DColumn,
  BaseBoardSwimlaneRow as BaseBoardSwimlaneRowData,
} from '../../base/baseEngine';
import { getPropertyValue, groupBoard2D, sortColumnNotes } from '../../base/baseEngine';
import type {
  BaseConfig,
  BaseViewConfig,
  BaseBoardColumnConfig,
  BaseBoardSwimlaneItem,
  BoardColumnSortRule,
} from '../../base/baseConfig';
import { useTranslation } from '../../i18n';
import { api } from '../../api';
import { BaseBoardColumn, type BaseBoardColumnData } from './BaseBoardColumn';
import { BaseBoardSwimlaneRow } from './BaseBoardSwimlaneRow';
import { BaseBoardSortPopover } from './BaseBoardSortPopover';

export interface BaseBoardViewProps {
  queryResult: BaseQueryResult;
  view: BaseViewConfig;
  config?: BaseConfig;
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

export const BaseBoardView: React.FC<BaseBoardViewProps> = ({
  queryResult,
  view,
  config,
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
      typeof c === 'string'
        ? { name: c }
        : { name: c.name, limit: c.limit, color: c.color, sort: c.sort }
    );
  }, [explicitCols]);

  // Local column sort overrides (instant optimistic UI)
  const [localColumnSorts, setLocalColumnSorts] = useState<
    Record<string, BoardColumnSortRule | undefined>
  >({});
  const [activeSortCol, setActiveSortCol] = useState<{
    colKey: string;
    anchorEl: HTMLElement;
  } | null>(null);

  const viewRef = useRef(view);
  viewRef.current = view;

  const onUpdateConfigRef = useRef(onUpdateConfig);
  onUpdateConfigRef.current = onUpdateConfig;

  const pendingSortRulesRef = useRef<Record<string, BoardColumnSortRule | undefined>>({});
  const sortDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingBaseRef = useRef<boolean>(false);
  const queuedSaveConfigRef = useRef<BaseViewConfig | null>(null);

  // Sync local sort overrides when view changes externally, but only when no pending unsaved sorts
  useEffect(() => {
    if (Object.keys(pendingSortRulesRef.current).length === 0 && !sortDebounceTimerRef.current) {
      setLocalColumnSorts({});
    }
  }, [view]);

  const getEffectiveColumnSort = useCallback(
    (colKey: string): BoardColumnSortRule | undefined => {
      if (Object.prototype.hasOwnProperty.call(localColumnSorts, colKey)) {
        return localColumnSorts[colKey];
      }
      if (colKey === 'no_status') {
        return view.boardSort;
      }
      const colCfg = columnConfigs.find((c) => c.name.toLowerCase() === colKey.toLowerCase());
      return colCfg?.sort || view.boardSort;
    },
    [localColumnSorts, view.boardSort, columnConfigs]
  );

  const flushPendingSortConfig = useCallback(async () => {
    if (!onUpdateConfigRef.current) return;
    if (sortDebounceTimerRef.current) {
      clearTimeout(sortDebounceTimerRef.current);
      sortDebounceTimerRef.current = null;
    }

    const pendingRules = { ...pendingSortRulesRef.current };
    const keys = Object.keys(pendingRules);
    if (keys.length === 0) return;

    // Reset pending sort rules ref now that we are persisting them
    pendingSortRulesRef.current = {};

    let updatedView = { ...viewRef.current };

    for (const [colKey, sortRule] of Object.entries(pendingRules)) {
      if (colKey === 'no_status') {
        updatedView = {
          ...updatedView,
          boardSort: sortRule,
        };
        continue;
      }

      const curCols = updatedView.groupBy?.columns || ['Open', 'inWork', 'Waiting', 'Finish'];
      let found = false;
      const updatedCols: (string | BaseBoardColumnConfig)[] = curCols.map((c) => {
        const name = typeof c === 'string' ? c : c.name;
        if (name.toLowerCase() === colKey.toLowerCase()) {
          found = true;
          if (!sortRule) {
            if (typeof c === 'string') return c;
            const { sort, ...rest } = c;
            return Object.keys(rest).length === 1 && rest.name ? rest.name : rest;
          }
          if (typeof c === 'string') {
            return { name: c, sort: sortRule };
          }
          return { ...c, sort: sortRule };
        }
        return c;
      });

      if (!found && sortRule) {
        updatedCols.push({ name: colKey, sort: sortRule });
      }

      updatedView = {
        ...updatedView,
        groupBy: {
          ...(updatedView.groupBy || { property: 'status' }),
          property: updatedView.groupBy?.property || 'status',
          columns: updatedCols,
        },
      };
    }

    // Save serialization: if a save is in-flight, queue the latest state
    if (isSavingBaseRef.current) {
      queuedSaveConfigRef.current = updatedView;
      return;
    }

    isSavingBaseRef.current = true;
    try {
      await Promise.resolve(onUpdateConfigRef.current(updatedView));
    } catch (err) {
      console.error('Failed to update board sort config:', err);
    } finally {
      isSavingBaseRef.current = false;
      if (queuedSaveConfigRef.current) {
        const nextView = queuedSaveConfigRef.current;
        queuedSaveConfigRef.current = null;
        isSavingBaseRef.current = true;
        try {
          await Promise.resolve(onUpdateConfigRef.current(nextView));
        } catch (e) {
          console.error('Failed to update queued board sort config:', e);
        } finally {
          isSavingBaseRef.current = false;
        }
      }
    }
  }, []);

  // Flush pending changes on unmount
  useEffect(() => {
    return () => {
      if (sortDebounceTimerRef.current) {
        clearTimeout(sortDebounceTimerRef.current);
        sortDebounceTimerRef.current = null;
        flushPendingSortConfig();
      }
    };
  }, [flushPendingSortConfig]);

  const handleColumnSortChange = useCallback(
    (colKey: string, sortRule?: BoardColumnSortRule) => {
      // 1. Instant optimistic update for UI and card ordering
      setLocalColumnSorts((prev) => ({
        ...prev,
        [colKey]: sortRule,
      }));

      // 2. Queue sort rule for debounced persistence
      pendingSortRulesRef.current[colKey] = sortRule;

      // 3. Debounce save (450ms) to avoid overlapping writes on rapid clicks
      if (sortDebounceTimerRef.current) {
        clearTimeout(sortDebounceTimerRef.current);
      }
      sortDebounceTimerRef.current = setTimeout(() => {
        flushPendingSortConfig();
      }, 450);
    },
    [flushPendingSortConfig]
  );

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
      const recs = colMap.get(col.name) || [];
      const sortRule = getEffectiveColumnSort(col.name);
      cols.push({
        key: col.name,
        label: col.name,
        records: sortColumnNotes(recs, sortRule),
        limit: col.limit || view.columnLimit || 10,
        color: col.color,
      });
    }

    if (noStatusRecords.length > 0 || columnConfigs.length === 0) {
      const noStatusSortRule = getEffectiveColumnSort('no_status');
      cols.push({
        key: 'no_status',
        label: t('base.noStatusColumn', 'Kein Status'),
        records: sortColumnNotes(noStatusRecords, noStatusSortRule),
        limit: view.columnLimit || 10,
      });
    }

    return cols;
  }, [allRecords, optimisticOverrides, columnConfigs, groupByProp, view.columnLimit, localColumnSorts, view.boardSort, t]);

  // 2D Matrix grouping when swimlanes are enabled
  const board2DData = useMemo(() => {
    if (!is2D) return null;
    const raw2D = groupBoard2D(allRecords, view, {
      noStatusLabel: t('base.noStatusColumn', 'Kein Status'),
      unassignedSwimlaneLabel: t('base.unassignedSwimlane', 'Keine Zuordnung'),
      getPropValue: getEffectivePropValue,
    });

    // Apply local collapse overrides and sort cards per cell according to column sort rules
    const rows = raw2D.rows.map((r) => {
      const collapsed = Object.prototype.hasOwnProperty.call(localCollapsedLanes, r.key)
        ? localCollapsedLanes[r.key]
        : r.collapsed;

      const sortedCells: Record<string, BaseRecord[]> = {};
      for (const [colKey, cellRecs] of Object.entries(r.cells)) {
        sortedCells[colKey] = sortColumnNotes(cellRecs, getEffectiveColumnSort(colKey));
      }

      return {
        ...r,
        collapsed,
        cells: sortedCells,
      };
    });

    const sortedCols = raw2D.columns.map((col) => ({
      ...col,
      records: sortColumnNotes(col.records, getEffectiveColumnSort(col.key)),
    }));

    return {
      ...raw2D,
      columns: sortedCols,
      rows,
    };
  }, [is2D, allRecords, view, optimisticOverrides, localCollapsedLanes, localColumnSorts, columnConfigs, t]);

  const columnSortRules = useMemo(() => {
    const map: Record<string, BoardColumnSortRule | undefined> = {};
    if (board2DData) {
      for (const col of board2DData.columns) {
        map[col.key] = getEffectiveColumnSort(col.key);
      }
    }
    return map;
  }, [board2DData, localColumnSorts, columnConfigs, view.boardSort]);

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

  const handleToggleSwimlane = (lane: BaseBoardSwimlaneRowData) => {
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

  const colPropKey = view.groupBy?.property || 'status';
  const colPropDisplayName = useMemo(() => {
    const effectiveConfig = config || queryResult?.definition;
    if (effectiveConfig?.properties?.[colPropKey]?.displayName) {
      return effectiveConfig.properties[colPropKey].displayName!;
    }
    const lower = colPropKey.toLowerCase();
    if (effectiveConfig?.properties) {
      for (const [k, v] of Object.entries(effectiveConfig.properties)) {
        if (k.toLowerCase() === lower && v?.displayName) {
          return v.displayName;
        }
      }
    }
    if (queryResult?.columnDisplayNames?.[colPropKey]) {
      return queryResult.columnDisplayNames[colPropKey];
    }
    if (queryResult?.columnDisplayNames) {
      for (const [k, v] of Object.entries(queryResult.columnDisplayNames)) {
        if (k.toLowerCase() === lower && v) {
          return v;
        }
      }
    }
    return colPropKey.toUpperCase();
  }, [colPropKey, config, queryResult]);

  const swimlaneDisplayName = useMemo(() => {
    const propName = view.swimlanes?.property?.trim() || '';
    if (!propName) return 'Swimlane';
    const effectiveConfig = config || queryResult?.definition;
    if (effectiveConfig?.properties?.[propName]?.displayName) {
      return effectiveConfig.properties[propName].displayName!;
    }
    const lower = propName.toLowerCase();
    if (effectiveConfig?.properties) {
      for (const [k, v] of Object.entries(effectiveConfig.properties)) {
        if (k.toLowerCase() === lower && v?.displayName) {
          return v.displayName;
        }
      }
    }
    if (queryResult?.columnDisplayNames?.[propName]) {
      return queryResult.columnDisplayNames[propName];
    }
    if (queryResult?.columnDisplayNames) {
      for (const [k, v] of Object.entries(queryResult.columnDisplayNames)) {
        if (k.toLowerCase() === lower && v) {
          return v;
        }
      }
    }
    return propName;
  }, [view.swimlanes?.property, config, queryResult]);

  // ==========================================
  // UNIFIED BOARD RENDER (2D Swimlane or 1D Standard)
  // ==========================================
  return (
    <>
      <div
        className={`base-board-container ${is2D && board2DData ? 'base-board-2d-container' : ''} scroller`}
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
        {is2D && board2DData ? (
          <div className="base-board-2d-grid">
            {/* Horizontal Swimlane Rows with unified column blocks */}
            <div className="base-board-2d-swimlanes-list">
              {board2DData.rows.map((lane) => (
                <BaseBoardSwimlaneRow
                  key={lane.key}
                  lane={lane}
                  columns={board2DData.columns}
                  cardColumns={columns}
                  displayNames={displayNames}
                  groupByProp={groupByProp}
                  groupByDisplayName={colPropDisplayName}
                  swimlaneProp={swimlaneProp}
                  swimlaneDisplayName={swimlaneDisplayName}
                  readOnly={readOnly}
                  dragOverCell={dragOverCell}
                  expandedCells={expandedCells}
                  onToggleCellExpand={toggleCellExpand}
                  onToggleCollapse={() => handleToggleSwimlane(lane)}
                  onAddCard={(colVal, laneVal) => onAddCard?.(colVal, laneVal)}
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
                  columnSortRules={columnSortRules}
                  onOpenSort={(colKey, anchorEl) => setActiveSortCol({ colKey, anchorEl })}
                />
              ))}
            </div>
          </div>
        ) : (
          columnsData.map((col) => (
            <BaseBoardColumn
              key={col.key}
              col={col}
              columns={columns}
              displayNames={displayNames}
              groupByProp={groupByProp}
              groupByDisplayName={colPropDisplayName}
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
              sortRule={getEffectiveColumnSort(col.key)}
              onOpenSort={(colKey, anchorEl) => setActiveSortCol({ colKey, anchorEl })}
              onSortChange={(rule) => handleColumnSortChange(col.key, rule)}
              cardProperties={columns}
            />
          ))
        )}
      </div>

      {activeSortCol && (
        <BaseBoardSortPopover
          key={activeSortCol.colKey}
          isOpen={Boolean(activeSortCol)}
          onClose={() => {
            flushPendingSortConfig();
            setActiveSortCol(null);
          }}
          anchorEl={activeSortCol.anchorEl}
          columnName={
            activeSortCol.colKey === 'no_status'
              ? t('base.noStatusColumn', 'Kein Status')
              : activeSortCol.colKey
          }
          currentSort={getEffectiveColumnSort(activeSortCol.colKey)}
          cardProperties={columns}
          propertyDisplayNames={displayNames}
          onApplySort={(rule) => {
            handleColumnSortChange(activeSortCol.colKey, rule);
          }}
        />
      )}
    </>
  );
};
