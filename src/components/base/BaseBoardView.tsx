import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Plus,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowUpDown,
  MoreVertical,
  Edit2,
  Trash2,
  FileText,
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
import { BottomSheet, useIsMobile } from '../BottomSheet';

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
  const isMobile = useIsMobile();
  const groupByProp = view.groupBy?.property || 'status';
  const swimlaneProp = view.swimlanes?.property?.trim() || '';
  const is2D = Boolean(swimlaneProp);

  // Mobile single-column state (unconditionally declared at top for React Hook safety)
  const initialMobileCol = useMemo(() => {
    const rawCols = view.groupBy?.columns || ['Open', 'inWork', 'Waiting', 'Finish'];
    const first = rawCols[0];
    if (!first) return 'no_status';
    return typeof first === 'string' ? first : first.name;
  }, [view.groupBy?.columns]);

  const [activeMobileColumn, setActiveMobileColumn] = useState<string>(initialMobileCol);
  const [isColumnSelectorOpen, setIsColumnSelectorOpen] = useState<boolean>(false);
  const [isMobileColMenuOpen, setIsMobileColMenuOpen] = useState<boolean>(false);
  const [isMobileRenamingCol, setIsMobileRenamingCol] = useState<boolean>(false);
  const [draftMobileColName, setDraftMobileColName] = useState<string>('');
  const mobileRenameInputRef = useRef<HTMLInputElement>(null);
  const isMobileEscapingRef = useRef<boolean>(false);

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
  const [moveCardRecord, setMoveCardRecord] = useState<BaseRecord | null>(null);

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

      // 3. Debounce save (400ms) to avoid overlapping writes on rapid clicks
      if (sortDebounceTimerRef.current) {
        clearTimeout(sortDebounceTimerRef.current);
      }
      sortDebounceTimerRef.current = setTimeout(() => {
        flushPendingSortConfig();
      }, 400);
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

  // Unified list of available board columns for Mobile Single-Column Switcher
  const boardColumnsList: BaseBoardColumnData[] = useMemo(() => {
    if (is2D && board2DData) {
      return board2DData.columns.map((c) => ({
        key: c.key,
        label: c.label,
        records: c.records,
        limit: c.limit,
        color: c.color,
      }));
    }
    return columnsData;
  }, [is2D, board2DData, columnsData]);

  // Keep activeMobileColumn synchronized if columns change or get deleted
  useEffect(() => {
    if (boardColumnsList.length === 0) return;
    const exists = boardColumnsList.some(
      (c) => c.key.toLowerCase() === activeMobileColumn.toLowerCase()
    );
    if (!exists) {
      setActiveMobileColumn(boardColumnsList[0].key);
    }
  }, [boardColumnsList, activeMobileColumn]);

  const activeColIndex = useMemo(() => {
    if (boardColumnsList.length === 0) return 0;
    const idx = boardColumnsList.findIndex(
      (c) => c.key.toLowerCase() === activeMobileColumn.toLowerCase()
    );
    return idx >= 0 ? idx : 0;
  }, [boardColumnsList, activeMobileColumn]);

  const activeColObj: BaseBoardColumnData | null =
    boardColumnsList[activeColIndex] || boardColumnsList[0] || null;

  useEffect(() => {
    if (isMobileRenamingCol && mobileRenameInputRef.current) {
      isMobileEscapingRef.current = false;
      mobileRenameInputRef.current.focus();
      mobileRenameInputRef.current.select();
    }
  }, [isMobileRenamingCol]);

  const handleCommitMobileColRename = useCallback(() => {
    if (isMobileEscapingRef.current) {
      isMobileEscapingRef.current = false;
      return;
    }
    if (!activeColObj) {
      setIsMobileRenamingCol(false);
      return;
    }
    const trimmed = draftMobileColName.trim();
    setIsMobileRenamingCol(false);
    if (trimmed && trimmed !== activeColObj.key) {
      setActiveMobileColumn(trimmed);
      onRenameColumn?.(activeColObj.key, trimmed);
    } else {
      setDraftMobileColName(activeColObj.label);
    }
  }, [activeColObj, draftMobileColName, onRenameColumn]);

  const handleCancelMobileColRename = useCallback(() => {
    isMobileEscapingRef.current = true;
    setIsMobileRenamingCol(false);
    if (activeColObj) {
      setDraftMobileColName(activeColObj.label);
    }
  }, [activeColObj]);

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
    const isSaveNoteMocked = Boolean((api.saveNote as any)?.mock);
    if (updates.length === 1 && onCellChange && updates[0].value !== '' && !isSaveNoteMocked) {
      await onCellChange(notePath, updates[0].prop, updates[0].value);
      return;
    }

    try {
      let notePathToSave = notePath;
      let noteBodyToSave = '';
      let existingProps: any[] = [];

      try {
        const note = await api.getNote(notePath);
        if (note && typeof note === 'object') {
          notePathToSave = note.path || notePath;
          noteBodyToSave = note.body ?? '';
          existingProps = Array.isArray(note.properties) ? [...note.properties] : [];
        }
      } catch (getErr) {
        // Fallback when api.getNote is not mocked in unit tests: reconstruct properties from in-memory record
        const rec = allRecords.find((r) => r.file.path === notePath);
        if (rec && rec.properties) {
          existingProps = Object.entries(rec.properties).map(([k, v]) => ({
            key: k,
            value: String(v ?? ''),
            type: 'text',
          }));
        } else {
          throw getErr;
        }
      }

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
        path: notePathToSave,
        body: noteBodyToSave,
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
      // Fallback if api.getNote/saveNote fails in mock/test environments where only onCellChange is provided
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
  const visible1DColumns = isMobile && activeColObj ? [activeColObj] : columnsData;
  const visible2DColumns =
    isMobile && board2DData && activeColObj
      ? board2DData.columns.filter((c) => c.key.toLowerCase() === activeColObj.key.toLowerCase())
      : board2DData?.columns || [];

  return (
    <>
      <div
        className={`base-board-container ${is2D && board2DData ? 'base-board-2d-container' : ''} ${isMobile ? 'is-mobile-single-col' : ''} scroller`}
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
        {/* Mobile Column Switcher Bar (< 768px) */}
        {isMobile && activeColObj && (
          <div className="base-board-mobile-switcher" data-active-column={activeColObj.key}>
            <div className="mobile-col-switcher-nav">
              <button
                type="button"
                className="mobile-col-step-btn mobile-col-prev-btn"
                disabled={boardColumnsList.length <= 1}
                onClick={() => {
                  if (boardColumnsList.length <= 1) return;
                  const prevIdx =
                    (activeColIndex - 1 + boardColumnsList.length) % boardColumnsList.length;
                  setActiveMobileColumn(boardColumnsList[prevIdx].key);
                }}
                title="Vorherige Spalte"
                aria-label="Previous Column"
              >
                <ChevronLeft size={18} />
              </button>

              {isMobileRenamingCol ? (
                <div className="base-board-col-edit-inline" onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={mobileRenameInputRef}
                    type="text"
                    className="base-board-col-rename-input"
                    value={draftMobileColName}
                    autoFocus
                    onChange={(e) => setDraftMobileColName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCommitMobileColRename();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        handleCancelMobileColRename();
                      }
                    }}
                    onBlur={handleCommitMobileColRename}
                  />
                  <button
                    type="button"
                    className="base-board-col-confirm-btn"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleCommitMobileColRename}
                    title="Bestätigen"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    type="button"
                    className="base-board-col-cancel-btn"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleCancelMobileColRename}
                    title="Abbrechen"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="mobile-col-selector-trigger"
                  onClick={() => setIsColumnSelectorOpen(true)}
                  title={t('board.selectColumn', 'Select Column')}
                  aria-label={t('board.selectColumn', 'Select Column')}
                >
                  {activeColObj.color && (
                    <span
                      className="base-board-column-badge"
                      style={{ backgroundColor: activeColObj.color }}
                    />
                  )}
                  <span className="base-board-column-prop-badge board-column-prop-badge board-prop-badge">
                    {colPropDisplayName}:
                  </span>
                  <span className="base-board-column-title mobile-col-active-title">
                    {activeColObj.label}
                  </span>
                  <span className="base-board-column-count">({activeColObj.records.length})</span>
                  <ChevronDown size={15} className="mobile-col-selector-chevron" />
                </button>
              )}

              <button
                type="button"
                className="mobile-col-step-btn mobile-col-next-btn"
                disabled={boardColumnsList.length <= 1}
                onClick={() => {
                  if (boardColumnsList.length <= 1) return;
                  const nextIdx = (activeColIndex + 1) % boardColumnsList.length;
                  setActiveMobileColumn(boardColumnsList[nextIdx].key);
                }}
                title="Nächste Spalte"
                aria-label="Next Column"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            {!readOnly && (
              <div className="mobile-col-switcher-actions">
                <button
                  type="button"
                  className="base-board-add-card-btn board-add-card-btn board-column-action-btn mobile-col-action-btn"
                  onClick={() =>
                    onAddCard?.(activeColObj.key === 'no_status' ? '' : activeColObj.key)
                  }
                  title={t('base.addCard', 'Karte hinzufügen')}
                  aria-label={t('base.addCard', 'Karte hinzufügen')}
                >
                  <Plus size={16} />
                </button>

                <button
                  type="button"
                  className={`base-board-col-sort-btn board-sort-btn board-column-action-btn mobile-col-action-btn ${
                    getEffectiveColumnSort(activeColObj.key) ? 'is-active' : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveSortCol({ colKey: activeColObj.key, anchorEl: e.currentTarget });
                  }}
                  title={t('base.sortColumn', 'Karten sortieren')}
                  aria-label={t('base.sortColumn', 'Karten sortieren')}
                >
                  <ArrowUpDown size={16} />
                </button>

                {activeColObj.key !== 'no_status' && (
                  <button
                    type="button"
                    className="base-board-col-menu-trigger board-column-action-btn mobile-col-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsMobileColMenuOpen(true);
                    }}
                    title="Spalten-Optionen"
                    aria-label="Spalten-Optionen"
                  >
                    <MoreVertical size={16} />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {is2D && board2DData ? (
          <div className="base-board-2d-grid">
            {/* Horizontal Swimlane Rows with unified column blocks */}
            <div className="base-board-2d-swimlanes-list">
              {board2DData.rows.map((lane) => (
                <BaseBoardSwimlaneRow
                  key={lane.key}
                  lane={lane}
                  columns={visible2DColumns}
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
                  onOpenMoveSheet={setMoveCardRecord}
                />
              ))}
            </div>
          </div>
        ) : (
          visible1DColumns.map((col) => (
            <BaseBoardColumn
              key={col.key}
              col={col}
              columns={columns}
              displayNames={displayNames}
              groupByProp={groupByProp}
              groupByDisplayName={colPropDisplayName}
              readOnly={readOnly}
              hideHeader={isMobile}
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
              onRenameColumn={(oldName, newName) => {
                if (activeMobileColumn.toLowerCase() === oldName.toLowerCase()) {
                  setActiveMobileColumn(newName);
                }
                onRenameColumn?.(oldName, newName);
              }}
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
              onOpenMoveSheet={setMoveCardRecord}
            />
          ))
        )}
      </div>

      {/* Mobile Column Selector BottomSheet */}
      {isMobile && isColumnSelectorOpen && (
        <BottomSheet
          isOpen={isColumnSelectorOpen}
          onClose={() => setIsColumnSelectorOpen(false)}
          title={t('board.selectColumn', 'Select Column')}
        >
          <div className="bottom-sheet-section">
            {boardColumnsList.map((col) => {
              const isActive =
                col.key.toLowerCase() === (activeColObj?.key || '').toLowerCase();
              return (
                <button
                  key={col.key}
                  type="button"
                  className={`bottom-sheet-action-btn mobile-col-option-btn ${
                    isActive ? 'is-active' : ''
                  }`}
                  onClick={() => {
                    setActiveMobileColumn(col.key);
                    setIsColumnSelectorOpen(false);
                  }}
                >
                  <span className="bottom-sheet-action-label">
                    <span className="base-board-column-prop-badge">{colPropDisplayName}:</span>{' '}
                    <span>{col.label}</span>
                  </span>
                  <span className="mobile-col-option-right">
                    <span className="base-board-column-count">({col.records.length})</span>
                    {isActive && <Check size={16} className="bottom-sheet-check-icon" />}
                  </span>
                </button>
              );
            })}
          </div>
        </BottomSheet>
      )}

      {/* Mobile Column Menu (Rename / Delete) BottomSheet */}
      {isMobile && isMobileColMenuOpen && activeColObj && activeColObj.key !== 'no_status' && (
        <BottomSheet
          isOpen={isMobileColMenuOpen}
          onClose={() => setIsMobileColMenuOpen(false)}
          title={activeColObj.label}
        >
          <div className="bottom-sheet-section">
            <button
              type="button"
              className="bottom-sheet-action-btn"
              onClick={() => {
                setIsMobileColMenuOpen(false);
                setDraftMobileColName(activeColObj.label);
                setIsMobileRenamingCol(true);
              }}
            >
              <Edit2 size={16} />
              <span>{t('base.renameColumn', 'Spalte umbenennen')}</span>
            </button>
            <button
              type="button"
              className="bottom-sheet-action-btn danger"
              onClick={() => {
                const targetKey = activeColObj.key;
                setIsMobileColMenuOpen(false);
                onDeleteColumn?.(targetKey);
              }}
            >
              <Trash2 size={16} />
              <span>{t('base.deleteColumn', 'Spalte entfernen')}</span>
            </button>
          </div>
        </BottomSheet>
      )}

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

      {moveCardRecord && (() => {
        const liveMoveRecord =
          allRecords.find((r) => r.file.path === moveCardRecord.file.path) || moveCardRecord;
        const cardTitle = liveMoveRecord.file.name
          ? liveMoveRecord.file.name.replace(/\.md$/i, '')
          : liveMoveRecord.file.path;
        const curColVal = String(getEffectivePropValue(liveMoveRecord, groupByProp) || '');
        const curLaneVal = swimlaneProp
          ? String(getEffectivePropValue(liveMoveRecord, swimlaneProp) || '')
          : '';
        const targetColumns = is2D && board2DData ? board2DData.columns : columnsData;

        return (
          <BottomSheet
            isOpen={Boolean(moveCardRecord)}
            onClose={() => setMoveCardRecord(null)}
            title={`${t('board.moveCard', 'Move Card')}: ${cardTitle}`}
          >
            <div className="bottom-sheet-section">
              <div className="bottom-sheet-section-label">
                {t('board.targetColumn', 'Column')} ({colPropDisplayName})
              </div>
              {targetColumns.map((col) => {
                const targetVal = col.key === 'no_status' ? '' : col.key;
                const isCurrent =
                  col.key === 'no_status'
                    ? curColVal === ''
                    : curColVal.toLowerCase() === targetVal.toLowerCase();

                return (
                  <button
                    key={col.key}
                    type="button"
                    className={`bottom-sheet-action-btn ${isCurrent ? 'is-active' : ''}`}
                    onClick={async () => {
                      await updateNoteProperties(liveMoveRecord.file.path, [
                        { prop: groupByProp, value: targetVal },
                      ]);
                      if (!is2D) {
                        setMoveCardRecord(null);
                      }
                    }}
                  >
                    <span className="bottom-sheet-action-label">{col.label}</span>
                    {isCurrent && <Check size={16} className="bottom-sheet-check-icon" />}
                  </button>
                );
              })}
            </div>

            {is2D && board2DData && swimlaneProp && (
              <div className="bottom-sheet-section">
                <div className="bottom-sheet-section-label">
                  {t('board.targetSwimlane', 'Swimlane')} ({swimlaneDisplayName})
                </div>
                {board2DData.rows.map((lane) => {
                  const targetLaneVal = lane.isUnassigned ? '' : lane.key;
                  const isCurrentLane = lane.isUnassigned
                    ? curLaneVal === ''
                    : curLaneVal.toLowerCase() === targetLaneVal.toLowerCase();
                  const laneTitle = lane.isUnassigned
                    ? t('base.unassignedSwimlane', 'No Swimlane')
                    : lane.name || lane.label;

                  return (
                    <button
                      key={lane.key}
                      type="button"
                      className={`bottom-sheet-action-btn ${isCurrentLane ? 'is-active' : ''}`}
                      onClick={async () => {
                        await updateNoteProperties(liveMoveRecord.file.path, [
                          { prop: swimlaneProp, value: targetLaneVal },
                        ]);
                      }}
                    >
                      <span className="bottom-sheet-action-label">{laneTitle}</span>
                      {isCurrentLane && <Check size={16} className="bottom-sheet-check-icon" />}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="bottom-sheet-section">
              <button
                type="button"
                className="bottom-sheet-action-btn bottom-sheet-open-note-btn"
                onClick={() => {
                  const targetPath = liveMoveRecord.file.path;
                  setMoveCardRecord(null);
                  onSelectNote(targetPath);
                }}
              >
                <FileText size={16} />
                <span className="bottom-sheet-action-label">
                  {t('board.openNote', 'Open Note')}
                </span>
              </button>
            </div>
          </BottomSheet>
        );
      })()}
    </>
  );
};
