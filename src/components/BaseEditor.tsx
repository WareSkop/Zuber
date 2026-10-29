import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Database,
  Code,
  Eye,
  AlertTriangle,
  Folder,
  Tag,
  FileText,
  X,
  Plus,
  LayoutGrid,
  Link as LinkIcon,
} from 'lucide-react';
import {
  parseBaseYaml,
  stringifyBaseYaml,
  extractFilterRules,
  rulesToFiltersObject,
  extractVaultProperties,
  extractVaultFolders,
  extractVaultTags,
  type BaseConfig,
  type BaseViewConfig,
  type BaseFilterRule,
  type BaseSortRule,
  type BaseGroupBy,
  type BaseBoardSwimlaneConfig,
  type BaseBoardSwimlaneItem,
} from '../base/baseConfig';
import {
  executeBaseQuery,
  getPropertyValue,
  type BaseQueryResult,
  type BaseRecord,
} from '../base/baseEngine';
import { BaseToolbar } from './base/BaseToolbar';
import { BaseFilterPopover } from './base/BaseFilterPopover';
import { BaseColumnsModal } from './base/BaseColumnsModal';
import { BaseBoardConfigModal } from './base/BaseBoardConfigModal';
import { BaseTableView } from './base/BaseTableView';
import { BaseCardsView } from './base/BaseCardsView';
import { BaseBoardView } from './base/BaseBoardView';
import { useTranslation } from '../i18n';
import { api } from '../api';
import type { FrontmatterProperty } from '../../shared/types';

export interface BaseEditorProps {
  filePath: string;
  rawContent: string;
  onChange: (newYaml: string) => void;
  onSelectNote: (path: string) => void;
  allFiles: any[];
  onCellChange?: (notePath: string, key: string, value: any) => Promise<void>;
  onOpenCreateNoteDialog?: (parentFolder?: string, initialProperties?: FrontmatterProperty[]) => void;
}

export const BaseEditor: React.FC<BaseEditorProps> = ({
  filePath,
  rawContent,
  onChange,
  onSelectNote,
  allFiles,
  onCellChange,
  onOpenCreateNoteDialog,
}) => {
  const { t } = useTranslation();
  const [editorMode, setEditorMode] = useState<'visual' | 'source'>('visual');
  const [activeViewIndex, setActiveViewIndex] = useState(0);

  // Popover & Modal visibility
  const [isFilterPopoverOpen, setIsFilterPopoverOpen] = useState(false);
  const [isColumnsModalOpen, setIsColumnsModalOpen] = useState(false);
  const [isBoardConfigModalOpen, setIsBoardConfigModalOpen] = useState(false);
  const [createNoteModal, setCreateNoteModal] = useState<{
    parentFolder: string;
    properties: FrontmatterProperty[];
    defaultName: string;
  } | null>(null);
  const [createNoteInput, setCreateNoteInput] = useState('');

  // Parsed Config state
  const [config, setConfig] = useState<BaseConfig>(() => {
    try {
      return parseBaseYaml(rawContent);
    } catch {
      return { views: [{ type: 'table', name: 'Table' }] };
    }
  });

  const [parseError, setParseError] = useState<string | null>(null);

  // Sync external changes to rawContent when not editing source
  const lastRawContentRef = useRef(rawContent);
  useEffect(() => {
    if (rawContent !== lastRawContentRef.current) {
      lastRawContentRef.current = rawContent;
      try {
        const parsed = parseBaseYaml(rawContent);
        setConfig(parsed);
        setParseError(null);
      } catch (err: any) {
        setParseError(err?.message || String(err));
      }
    }
  }, [rawContent]);

  // Debounced auto-save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitConfigChange = useCallback(
    (newConfig: BaseConfig) => {
      setConfig(newConfig);
      setParseError(null);

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        try {
          const yaml = stringifyBaseYaml(newConfig);
          lastRawContentRef.current = yaml;
          onChange(yaml);
        } catch (err) {
          console.error('Failed to serialize Base config:', err);
        }
      }, 500);
    },
    [onChange]
  );

  // Extract Vault metadata for auto-completion
  const vaultProperties = useMemo(() => extractVaultProperties(allFiles), [allFiles]);
  const vaultFolders = useMemo(() => extractVaultFolders(allFiles), [allFiles]);
  const vaultTags = useMemo(() => extractVaultTags(allFiles), [allFiles]);
  const vaultNotes = useMemo(() => {
    return (allFiles || [])
      .filter((f) => f.extension === 'md' || f.path?.endsWith('.md'))
      .map((f) => ({
        path: f.path,
        name: f.name ? f.name.replace(/\.md$/i, '') : f.path.replace(/\.md$/i, '').split('/').pop() || '',
      }));
  }, [allFiles]);

  // Ensure activeViewIndex is within bounds
  const safeViewIndex = Math.min(Math.max(0, activeViewIndex), Math.max(0, config.views.length - 1));
  const activeView = config.views[safeViewIndex] || config.views[0];

  // Execute Query for the active view
  const queryResult: BaseQueryResult | null = useMemo(() => {
    try {
      return executeBaseQuery(config, allFiles, safeViewIndex, filePath);
    } catch (err: any) {
      setParseError(err?.message || String(err));
      return null;
    }
  }, [config, allFiles, safeViewIndex, filePath]);

  // Active filter rules (from active view if present, otherwise global)
  const activeFilterRules: BaseFilterRule[] = useMemo(() => {
    if (activeView.filters) {
      return extractFilterRules(activeView.filters);
    }
    return extractFilterRules(config.filters);
  }, [activeView.filters, config.filters]);

  // ----------------------------------------------------
  // Handlers for Views (Add, Rename, Duplicate, Delete)
  // ----------------------------------------------------
  const handleAddView = (name: string, type: 'table' | 'cards' | 'board') => {
    const newViewObj: any = {
      type,
      name,
      order: activeView?.order ? [...activeView.order] : ['file.name'],
    };
    if (type === 'board') {
      newViewObj.groupBy = {
        property: 'status',
        columns: ['Open', 'inWork', 'Waiting', 'Finish'],
      };
      newViewObj.columnLimit = 10;
    }
    const newViews = [
      ...config.views,
      newViewObj,
    ];
    commitConfigChange({
      ...config,
      views: newViews,
    });
    setActiveViewIndex(newViews.length - 1);
  };

  const handleRenameView = (idx: number, newName: string) => {
    const newViews = config.views.map((v, i) => (i === idx ? { ...v, name: newName } : v));
    commitConfigChange({
      ...config,
      views: newViews,
    });
  };

  const handleDuplicateView = (idx: number) => {
    const target = config.views[idx];
    if (!target) return;
    const clone = {
      ...JSON.parse(JSON.stringify(target)),
      name: `${target.name} (${t('base.copy') || 'Kopie'})`,
    };
    const newViews = [...config.views];
    newViews.splice(idx + 1, 0, clone);
    commitConfigChange({
      ...config,
      views: newViews,
    });
    setActiveViewIndex(idx + 1);
  };

  const handleDeleteView = (idx: number) => {
    if (config.views.length <= 1) return;
    const newViews = config.views.filter((_, i) => i !== idx);
    commitConfigChange({
      ...config,
      views: newViews,
    });
    setActiveViewIndex(Math.max(0, idx - 1));
  };

  const handleSwitchViewType = (idx: number, newType: 'table' | 'cards' | 'board') => {
    const newViews = config.views.map((v, i) => {
      if (i !== idx) return v;
      const updated: any = { ...v, type: newType };
      if (newType === 'board' && !updated.groupBy?.property) {
        updated.groupBy = {
          property: 'status',
          columns: ['Open', 'inWork', 'Waiting', 'Finish'],
        };
        if (!updated.columnLimit) {
          updated.columnLimit = 10;
        }
      }
      return updated;
    });
    commitConfigChange({
      ...config,
      views: newViews,
    });
  };

  // ----------------------------------------------------
  // Handlers for Board Columns & Board Configuration
  // ----------------------------------------------------
  const handleBoardRenameColumn = async (oldName: string, newName: string) => {
    if (!oldName || !newName || oldName.trim() === newName.trim()) return;
    const trimmedNew = newName.trim();
    const curCols = activeView.groupBy?.columns || ['Open', 'inWork', 'Waiting', 'Finish'];
    const stringCols = curCols.map((c) => (typeof c === 'string' ? c : c.name));

    const updatedCols = stringCols.map((c) =>
      c.toLowerCase() === oldName.trim().toLowerCase() ? trimmedNew : c
    );

    const newViews = config.views.map((v, i) =>
      i === safeViewIndex
        ? {
            ...v,
            groupBy: {
              ...(v.groupBy || { property: 'status' }),
              columns: updatedCols,
            },
          }
        : v
    );

    commitConfigChange({
      ...config,
      views: newViews,
    });

    // Automatically update existing notes' frontmatter
    const groupByProp = activeView.groupBy?.property || 'status';
    if (onCellChange && queryResult?.records) {
      for (const rec of queryResult.records) {
        const val = getPropertyValue(rec, groupByProp);
        if (val && String(val).trim().toLowerCase() === oldName.trim().toLowerCase()) {
          try {
            await onCellChange(rec.file.path, groupByProp, trimmedNew);
          } catch (err) {
            console.error('Failed to update note status on column rename:', err);
          }
        }
      }
    }
  };

  const handleBoardDeleteColumn = (colName: string) => {
    const curCols = activeView.groupBy?.columns || ['Open', 'inWork', 'Waiting', 'Finish'];
    const stringCols = curCols.map((c) => (typeof c === 'string' ? c : c.name));

    const updatedCols = stringCols.filter(
      (c) => c.toLowerCase() !== colName.trim().toLowerCase()
    );

    const newViews = config.views.map((v, i) =>
      i === safeViewIndex
        ? {
            ...v,
            groupBy: {
              ...(v.groupBy || { property: 'status' }),
              columns: updatedCols,
            },
          }
        : v
    );

    commitConfigChange({
      ...config,
      views: newViews,
    });
  };

  const handleBoardAddCard = async (columnValue: string, swimlaneValue?: string) => {
    const groupByProp = activeView.groupBy?.property || 'status';
    const swimlaneProp = activeView.swimlanes?.property?.trim() || '';

    const folderRule = activeFilterRules.find(
      (r) =>
        (r.field === 'file.inFolder' || r.field === 'file.folder' || r.field === 'folder') &&
        (r.operator === '==' || !r.operator) &&
        r.value &&
        typeof r.value === 'string'
    );

    let targetFolder = '';
    if (folderRule && typeof folderRule.value === 'string') {
      targetFolder = folderRule.value.trim().replace(/^\/+|\/+$/g, '');
    } else {
      const lastSlash = filePath.lastIndexOf('/');
      targetFolder = lastSlash >= 0 ? filePath.substring(0, lastSlash) : '';
    }

    const existingPaths = new Set(
      (allFiles || []).map((f) => (f.path || '').toLowerCase())
    );

    const baseTitle = 'Neue Notiz';
    let noteTitle = baseTitle;
    let fileName = `${noteTitle}.md`;
    let candidatePath = targetFolder ? `${targetFolder}/${fileName}` : fileName;

    let counter = 1;
    while (existingPaths.has(candidatePath.toLowerCase())) {
      noteTitle = `${baseTitle} ${counter}`;
      fileName = `${noteTitle}.md`;
      candidatePath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
      counter++;
    }

    const properties: FrontmatterProperty[] = [];
    if (columnValue && columnValue !== 'no_status') {
      properties.push({ key: groupByProp, value: columnValue, type: 'text' });
    }
    if (
      swimlaneProp &&
      swimlaneValue &&
      swimlaneValue !== 'unassigned_swimlane' &&
      swimlaneProp.toLowerCase() !== groupByProp.toLowerCase()
    ) {
      properties.push({ key: swimlaneProp, value: swimlaneValue, type: 'text' });
    }

    if (onOpenCreateNoteDialog) {
      onOpenCreateNoteDialog(targetFolder, properties);
      return;
    }

    setCreateNoteModal({
      parentFolder: targetFolder,
      properties,
      defaultName: noteTitle,
    });
    setCreateNoteInput(noteTitle);
  };

  const handleConfirmCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createNoteModal) return;
    const rawVal = createNoteInput.trim();
    if (!rawVal) return;
    const cleanTitle = rawVal.replace(/\.md$/i, '').trim();
    if (!cleanTitle) return;

    const relPath = createNoteModal.parentFolder
      ? `${createNoteModal.parentFolder}/${cleanTitle}.md`
      : `${cleanTitle}.md`;

    try {
      await api.saveNote({
        path: relPath,
        body: `# ${cleanTitle}\n\n`,
        properties: createNoteModal.properties,
        forceOverwrite: true,
      });
      setCreateNoteModal(null);
      onSelectNote(relPath);
    } catch (err) {
      console.error('Failed to create note from board modal:', err);
    }
  };

  const handleBoardAddColumn = (newColName: string) => {
    const trimmed = newColName.trim();
    if (!trimmed) return;
    const curCols = activeView.groupBy?.columns || ['Open', 'inWork', 'Waiting', 'Finish'];
    const stringCols = curCols.map((c) => (typeof c === 'string' ? c : c.name));
    if (stringCols.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return;

    const updatedCols = [...stringCols, trimmed];

    const newViews = config.views.map((v, i) =>
      i === safeViewIndex
        ? {
            ...v,
            groupBy: {
              ...(v.groupBy || { property: 'status' }),
              columns: updatedCols,
            },
          }
        : v
    );

    commitConfigChange({
      ...config,
      views: newViews,
    });
  };

  const handleSaveBoardConfig = (
    newGroupBy: BaseGroupBy,
    newColumnLimit: number,
    newSwimlanes?: BaseBoardSwimlaneConfig,
    newOrder?: string[]
  ) => {
    const newViews = config.views.map((v, i) => {
      if (i !== safeViewIndex) return v;
      const updated: BaseViewConfig = {
        ...v,
        groupBy: newGroupBy,
        columnLimit: newColumnLimit,
      };
      if (newSwimlanes && newSwimlanes.property) {
        updated.swimlanes = newSwimlanes;
      } else {
        delete updated.swimlanes;
      }
      if (Array.isArray(newOrder) && newOrder.length > 0) {
        updated.order = newOrder;
      }
      return updated;
    });

    commitConfigChange({
      ...config,
      views: newViews,
    });
  };

  const handleUpdateActiveViewConfig = (updatedView: BaseViewConfig) => {
    const newViews = config.views.map((v, i) => (i === safeViewIndex ? updatedView : v));
    commitConfigChange({
      ...config,
      views: newViews,
    });
  };

  const handleBoardToggleSwimlaneCollapse = (
    laneName: string,
    collapsed: boolean,
    isUnassigned?: boolean
  ) => {
    if (!activeView.swimlanes?.property) return;
    if (isUnassigned) {
      handleUpdateActiveViewConfig({
        ...activeView,
        swimlanes: {
          ...activeView.swimlanes,
          unassignedCollapsed: collapsed,
        },
      });
      return;
    }

    const curLanes = activeView.swimlanes.lanes || [];
    const updatedLanes: (string | BaseBoardSwimlaneItem)[] = curLanes.map((item) => {
      const name = typeof item === 'string' ? item : item.name;
      if (name.toLowerCase() === laneName.trim().toLowerCase()) {
        return { name, collapsed };
      }
      return item;
    });

    handleUpdateActiveViewConfig({
      ...activeView,
      swimlanes: {
        ...activeView.swimlanes,
        lanes: updatedLanes,
      },
    });
  };

  const handleBoardRenameSwimlane = async (oldName: string, newName: string) => {
    if (!oldName || !newName || oldName.trim() === newName.trim() || !activeView.swimlanes?.property) {
      return;
    }
    const trimmedNew = newName.trim();
    const curLanes = activeView.swimlanes.lanes || [];
    const updatedLanes: (string | BaseBoardSwimlaneItem)[] = curLanes.map((item) => {
      const name = typeof item === 'string' ? item : item.name;
      const collapsed = typeof item === 'string' ? false : Boolean(item.collapsed);
      if (name.toLowerCase() === oldName.trim().toLowerCase()) {
        return collapsed ? { name: trimmedNew, collapsed: true } : trimmedNew;
      }
      return item;
    });

    handleUpdateActiveViewConfig({
      ...activeView,
      swimlanes: {
        ...activeView.swimlanes,
        lanes: updatedLanes,
      },
    });

    // Automatically update existing notes' frontmatter for swimlane property
    const swimlaneProp = activeView.swimlanes.property;
    if (onCellChange && queryResult?.records) {
      for (const rec of queryResult.records) {
        const val = getPropertyValue(rec, swimlaneProp);
        if (val && String(val).trim().toLowerCase() === oldName.trim().toLowerCase()) {
          try {
            await onCellChange(rec.file.path, swimlaneProp, trimmedNew);
          } catch (err) {
            console.error('Failed to update note swimlane on rename:', err);
          }
        }
      }
    }
  };

  const handleBoardDeleteSwimlane = (laneName: string) => {
    if (!activeView.swimlanes?.property) return;
    const curLanes = activeView.swimlanes.lanes || [];
    const updatedLanes = curLanes.filter((item) => {
      const name = typeof item === 'string' ? item : item.name;
      return name.toLowerCase() !== laneName.trim().toLowerCase();
    });

    handleUpdateActiveViewConfig({
      ...activeView,
      swimlanes: {
        ...activeView.swimlanes,
        lanes: updatedLanes,
      },
    });
  };

  // ----------------------------------------------------
  // Handlers for Filters
  // ----------------------------------------------------
  const handleFilterRulesChange = (newRules: BaseFilterRule[]) => {
    const filtersObj = rulesToFiltersObject(newRules);

    // If view already had its own filters, update view filters, otherwise global filters
    if (activeView.filters || !config.filters) {
      const newViews = config.views.map((v, i) => (i === safeViewIndex ? { ...v, filters: filtersObj } : v));
      commitConfigChange({
        ...config,
        views: newViews,
      });
    } else {
      commitConfigChange({
        ...config,
        filters: filtersObj,
      });
    }
  };

  const handleRemoveFilterRule = (ruleId: string) => {
    const updated = activeFilterRules.filter((r) => r.id !== ruleId);
    handleFilterRulesChange(updated);
  };

  // ----------------------------------------------------
  // Handlers for Columns (Resize, Reorder, Hide, Add, Sort)
  // ----------------------------------------------------
  const handleColumnResize = (col: string, newWidth: number) => {
    const curSizes = activeView.columnSize || {};
    const newViews = config.views.map((v, i) =>
      i === safeViewIndex
        ? {
            ...v,
            columnSize: {
              ...curSizes,
              [col]: newWidth,
            },
          }
        : v
    );
    commitConfigChange({
      ...config,
      views: newViews,
    });
  };

  const handleColumnReorder = (newOrder: string[]) => {
    const newViews = config.views.map((v, i) => (i === safeViewIndex ? { ...v, order: newOrder } : v));
    commitConfigChange({
      ...config,
      views: newViews,
    });
  };

  const handleColumnHide = (col: string) => {
    const curOrder = queryResult?.columns || activeView.order || [];
    const newOrder = curOrder.filter((c) => c !== col);
    handleColumnReorder(newOrder);
  };

  const handleColumnAdd = (col: string) => {
    const curOrder = queryResult?.columns || activeView.order || [];
    if (!curOrder.includes(col)) {
      handleColumnReorder([...curOrder, col]);
    }
  };

  const handleColumnDisplayNameChange = (col: string, newDisplayName: string) => {
    const curProperties = config.properties || {};
    const curColProp = curProperties[col] || {};
    commitConfigChange({
      ...config,
      properties: {
        ...curProperties,
        [col]: {
          ...curColProp,
          displayName: newDisplayName,
        },
      },
    });
  };

  const handleSortChange = (newSort: BaseSortRule[] | undefined) => {
    const newViews = config.views.map((v, i) => (i === safeViewIndex ? { ...v, sort: newSort } : v));
    commitConfigChange({
      ...config,
      views: newViews,
    });
  };

  const handleGroupByChange = (newGroupBy: { property: string; direction?: 'asc' | 'desc' } | undefined) => {
    const newViews = config.views.map((v, i) => (i === safeViewIndex ? { ...v, groupBy: newGroupBy } : v));
    commitConfigChange({
      ...config,
      views: newViews,
    });
  };

  // Columns not yet added to current view
  const availablePropertiesToAdd = useMemo(() => {
    const activeCols = new Set(queryResult?.columns || activeView.order || []);
    return vaultProperties.filter((p) => !activeCols.has(p.key));
  }, [vaultProperties, queryResult?.columns, activeView.order]);

  // Mode toggle between Visual and Source
  const handleToggleMode = (nextMode: 'visual' | 'source') => {
    if (nextMode === 'source') {
      try {
        const yaml = stringifyBaseYaml(config);
        lastRawContentRef.current = yaml;
        onChange(yaml);
      } catch {}
    } else {
      try {
        const parsed = parseBaseYaml(rawContent);
        setConfig(parsed);
        setParseError(null);
      } catch (err: any) {
        setParseError(err?.message || String(err));
      }
    }
    setEditorMode(nextMode);
  };

  return (
    <div className="base-editor-container">
      {/* 1. Interactive Toolbar */}
      <BaseToolbar
        config={config}
        activeViewIndex={safeViewIndex}
        onSelectView={setActiveViewIndex}
        onAddView={handleAddView}
        onRenameView={handleRenameView}
        onDuplicateView={handleDuplicateView}
        onDeleteView={handleDeleteView}
        onSwitchViewType={handleSwitchViewType}
        activeFilterCount={activeFilterRules.length}
        isFilterPopoverOpen={isFilterPopoverOpen}
        onToggleFilterPopover={() => setIsFilterPopoverOpen((o) => !o)}
        onOpenColumnsModal={() => setIsColumnsModalOpen(true)}
        onOpenBoardConfigModal={() => setIsBoardConfigModalOpen(true)}
        availableProperties={vaultProperties}
        onSortChange={handleSortChange}
        onGroupByChange={handleGroupByChange}
        editorMode={editorMode}
        onToggleEditorMode={handleToggleMode}
      />

      {/* 2. Filter Popover */}
      <BaseFilterPopover
        isOpen={isFilterPopoverOpen}
        onClose={() => setIsFilterPopoverOpen(false)}
        rules={activeFilterRules}
        onChangeRules={handleFilterRulesChange}
        availableProperties={vaultProperties}
        vaultFolders={vaultFolders}
        vaultTags={vaultTags}
        vaultNotes={vaultNotes}
      />

      {/* 3. Columns Modal */}
      <BaseColumnsModal
        isOpen={isColumnsModalOpen}
        onClose={() => setIsColumnsModalOpen(false)}
        order={queryResult?.columns || activeView.order || ['file.name']}
        availableProperties={vaultProperties}
        displayNames={queryResult?.columnDisplayNames || {}}
        onReorder={handleColumnReorder}
        onToggleColumn={(col, visible) => {
          if (visible) handleColumnAdd(col);
          else handleColumnHide(col);
        }}
        onResetColumns={() => {
          handleColumnReorder(['file.name']);
        }}
      />

      {/* 3b. Board Configuration Modal */}
      <BaseBoardConfigModal
        isOpen={isBoardConfigModalOpen}
        onClose={() => setIsBoardConfigModalOpen(false)}
        view={activeView}
        availableProperties={vaultProperties}
        allNotes={queryResult?.records && queryResult.records.length > 0 ? queryResult.records : allFiles}
        displayNames={queryResult?.columnDisplayNames || {}}
        onSave={handleSaveBoardConfig}
      />

      {/* 4. Filter Chips Bar (Active Filters) */}
      {editorMode === 'visual' && activeFilterRules.length > 0 && (
        <div className="base-filter-chips-bar">
          <span className="chips-bar-label">{t('base.activeFilters') || 'Filter:'}</span>
          <div className="chips-list">
            {activeFilterRules.map((rule) => {
              let label = `${rule.field} ${rule.operator} ${rule.value}`;
              let Icon = FileText;
              if (rule.field === 'file.inFolder') {
                Icon = Folder;
                label = rule.operator === '!=' ? `Nicht in: ${rule.value || '/'}` : `Ordner: ${rule.value || '/'}`;
              } else if (rule.field === 'file.hasTag') {
                Icon = Tag;
                label = rule.operator === '!=' ? `Ohne Tag: #${rule.value}` : `Tag: #${rule.value}`;
              } else if (rule.field === 'file.hasLink') {
                Icon = LinkIcon;
                label = rule.operator === '!=' ? `Verlinkt nicht auf: [[${rule.value}]]` : `Verlinkt auf: [[${rule.value}]]`;
              } else if (rule.operator === 'isEmpty') {
                label = `${rule.field} ist leer`;
              } else if (rule.operator === '!isEmpty') {
                label = `${rule.field} ist nicht leer`;
              }

              return (
                <div key={rule.id} className="base-filter-chip" title={label}>
                  <Icon size={12} className="chip-icon" />
                  <span className="chip-text">{label}</span>
                  <button
                    type="button"
                    className="chip-remove-btn"
                    onClick={() => handleRemoveFilterRule(rule.id)}
                    title="Filter entfernen"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. Editor Body (Visual vs Source) */}
      <div className="base-editor-body">
        {editorMode === 'source' ? (
          <div className="base-source-editor">
            <textarea
              className="base-source-textarea"
              value={rawContent}
              onChange={(e) => {
                onChange(e.target.value);
                try {
                  const p = parseBaseYaml(e.target.value);
                  setConfig(p);
                  setParseError(null);
                } catch (err: any) {
                  setParseError(err?.message || String(err));
                }
              }}
              placeholder={'filters:\n  file.inFolder("Projekte")\nviews:\n  - type: table\n    name: "Übersicht"'}
              spellCheck={false}
            />
          </div>
        ) : parseError ? (
          <div className="base-error-box">
            <div className="base-error-header">
              <AlertTriangle size={16} className="base-error-icon" />
              <span>{t('base.syntaxError') || 'Syntaxfehler in Base-Definition'}</span>
            </div>
            <pre className="base-error-message">{parseError}</pre>
          </div>
        ) : !queryResult ? null : queryResult.records.length === 0 ? (
          <div className="base-empty-state">
            <Database size={32} className="empty-icon" />
            <p>{t('base.noRecordsFound') || 'Keine passenden Notizen gefunden.'}</p>
            {activeFilterRules.length > 0 && (
              <button
                type="button"
                className="base-btn secondary-btn"
                onClick={() => handleFilterRulesChange([])}
              >
                <span>Alle Filter zurücksetzen</span>
              </button>
            )}
          </div>
        ) : activeView.type === 'board' ? (
          /* Kanban Board View */
          <BaseBoardView
            queryResult={queryResult}
            view={activeView}
            onSelectNote={onSelectNote}
            onCellChange={onCellChange}
            onAddCard={handleBoardAddCard}
            onRenameColumn={handleBoardRenameColumn}
            onDeleteColumn={handleBoardDeleteColumn}
            onAddColumn={handleBoardAddColumn}
            onToggleSwimlaneCollapse={handleBoardToggleSwimlaneCollapse}
            onRenameSwimlane={handleBoardRenameSwimlane}
            onDeleteSwimlane={handleBoardDeleteSwimlane}
            onUpdateConfig={handleUpdateActiveViewConfig}
          />
        ) : activeView.type === 'cards' ? (
          /* Cards View */
          <BaseCardsView
            queryResult={queryResult}
            view={activeView}
            onSelectNote={onSelectNote}
          />
        ) : (
          /* Table View */
          <BaseTableView
            queryResult={queryResult}
            onSelectNote={onSelectNote}
            onCellChange={onCellChange}
            columnSizes={activeView.columnSize || {}}
            onColumnResize={handleColumnResize}
            onColumnReorder={handleColumnReorder}
            onColumnHide={handleColumnHide}
            onColumnDisplayNameChange={handleColumnDisplayNameChange}
            onColumnSort={(col, dir) => handleSortChange([{ property: col, direction: dir }])}
            availablePropertiesToAdd={availablePropertiesToAdd}
            onAddColumn={handleColumnAdd}
          />
        )}
      </div>

      {createNoteModal && (
        <div className="modal-backdrop" onClick={() => setCreateNoteModal(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>{t('dialogs.newNoteTitle') || 'Neue Notiz erstellen'}</h3>
            <form onSubmit={handleConfirmCreateNote}>
              {createNoteModal.parentFolder && (
                <p className="modal-subfolder-hint">
                  {t('dialogs.moveTargetFolder') || 'Zielordner:'} <code>{createNoteModal.parentFolder}/</code>
                </p>
              )}
              <input
                type="text"
                className="modal-input"
                value={createNoteInput}
                onChange={(e) => setCreateNoteInput(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                autoFocus
                required
              />
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setCreateNoteModal(null)}
                >
                  {t('common.cancel') || 'Abbrechen'}
                </button>
                <button type="submit" className="btn-primary">
                  {t('common.confirm') || 'Bestätigen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
