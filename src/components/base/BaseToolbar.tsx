import React, { useState, useRef, useEffect } from 'react';
import {
  Table as TableIcon,
  LayoutGrid,
  Kanban,
  Plus,
  MoreVertical,
  Filter,
  ArrowUpDown,
  Layers,
  Columns,
  Eye,
  Code,
  Copy,
  Edit2,
  Trash2,
  Check,
  Settings,
} from 'lucide-react';
import type { BaseConfig, BaseSortRule } from '../../base/baseConfig';
import { useTranslation } from '../../i18n';
import { BottomSheet, useIsMobile } from '../BottomSheet';

export interface BaseToolbarProps {
  config: BaseConfig;
  activeViewIndex: number;
  onSelectView: (index: number) => void;
  onAddView: (name: string, type: 'table' | 'cards' | 'board') => void;
  onRenameView: (index: number, newName: string) => void;
  onDuplicateView: (index: number) => void;
  onDeleteView: (index: number) => void;
  onSwitchViewType?: (index: number, newType: 'table' | 'cards' | 'board') => void;
  activeFilterCount: number;
  isFilterPopoverOpen: boolean;
  onToggleFilterPopover: () => void;
  onOpenColumnsModal: () => void;
  onOpenBoardConfigModal?: () => void;
  availableProperties: { key: string; label: string }[];
  onSortChange: (sort: BaseSortRule[] | undefined) => void;
  onGroupByChange: (groupBy: { property: string; direction?: 'asc' | 'desc' } | undefined) => void;
  editorMode: 'visual' | 'source';
  onToggleEditorMode: (mode: 'visual' | 'source') => void;
}

export const BaseToolbar: React.FC<BaseToolbarProps> = ({
  config,
  activeViewIndex,
  onSelectView,
  onAddView,
  onRenameView,
  onDuplicateView,
  onDeleteView,
  onSwitchViewType,
  activeFilterCount,
  isFilterPopoverOpen,
  onToggleFilterPopover,
  onOpenColumnsModal,
  onOpenBoardConfigModal,
  availableProperties,
  onSortChange,
  onGroupByChange,
  editorMode,
  onToggleEditorMode,
}) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  // New View popover state
  const [isAddViewOpen, setIsAddViewOpen] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [newViewType, setNewViewType] = useState<'table' | 'cards' | 'board'>('table');

  // Tab menu dropdown state
  const [tabMenuIndex, setTabMenuIndex] = useState<number | null>(null);
  const [editingTabNameIndex, setEditingTabNameIndex] = useState<number | null>(null);
  const [draftTabName, setDraftTabName] = useState('');

  // Sort & Group dropdowns
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false);

  const toolbarRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setIsAddViewOpen(false);
        setTabMenuIndex(null);
        setIsSortDropdownOpen(false);
        setIsGroupDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAddViewOpen(false);
        setTabMenuIndex(null);
        setIsSortDropdownOpen(false);
        setIsGroupDropdownOpen(false);
        setEditingTabNameIndex(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const activeView = config.views[activeViewIndex] || config.views[0];
  const currentSort = activeView?.sort?.[0];
  const currentGroupBy = activeView?.groupBy;

  const handleStartRename = (idx: number, curName: string) => {
    setTabMenuIndex(null);
    setEditingTabNameIndex(idx);
    setDraftTabName(curName);
  };

  const handleCommitRename = (idx: number) => {
    if (draftTabName.trim()) {
      onRenameView(idx, draftTabName.trim());
    }
    setEditingTabNameIndex(null);
  };

  const handleOpenAddView = () => {
    const defaultPrefix = t('base.typeTable') === 'Table' ? 'View' : 'Ansicht';
    setNewViewName(`${defaultPrefix} ${config.views.length + 1}`);
    setNewViewType('table');
    setIsAddViewOpen((o) => !o);
    setTabMenuIndex(null);
  };

  const handleCreateViewSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const defaultPrefix = t('base.typeTable') === 'Table' ? 'View' : 'Ansicht';
    const fallbackName = `${defaultPrefix} ${config.views.length + 1}`;
    const finalName = newViewName.trim() || fallbackName;
    onAddView(finalName, newViewType);
    setNewViewName('');
    setIsAddViewOpen(false);
  };

  return (
    <div className="base-toolbar-container" ref={toolbarRef}>
      {/* LEFT: View Tabs */}
      <div className="base-toolbar-views-group">
        <div className="base-view-tabs">
          {config.views.map((v, idx) => {
            const isTabActive = idx === activeViewIndex;
            const IconComponent = v.type === 'board' ? Kanban : v.type === 'cards' ? LayoutGrid : TableIcon;
            const isRenaming = editingTabNameIndex === idx;

            return (
              <div
                key={`${v.name}-${idx}`}
                className={`base-tab-wrapper ${isTabActive ? 'active' : ''}`}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setTabMenuIndex(idx);
                }}
              >
                {isRenaming ? (
                  <div className="base-tab-rename-inline">
                    <input
                      type="text"
                      className="base-tab-rename-input"
                      value={draftTabName}
                      autoFocus
                      onChange={(e) => setDraftTabName(e.target.value)}
                      onBlur={() => handleCommitRename(idx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCommitRename(idx);
                        if (e.key === 'Escape') setEditingTabNameIndex(null);
                      }}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`base-tab-btn ${isTabActive ? 'active' : ''}`}
                    onClick={() => onSelectView(idx)}
                    onDoubleClick={() => handleStartRename(idx, v.name)}
                    title={v.name}
                  >
                    <IconComponent size={14} className="base-tab-icon" />
                    <span className="base-tab-title">{v.name}</span>
                  </button>
                )}

                {/* View Options Menu (⋮) */}
                <button
                  type="button"
                  className="base-tab-menu-trigger"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTabMenuIndex(tabMenuIndex === idx ? null : idx);
                  }}
                  title="Ansichts-Optionen"
                >
                  <MoreVertical size={13} />
                </button>

                {tabMenuIndex === idx && !isMobile && (
                  <div
                    className="base-dropdown-menu tab-dropdown"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Switch View Type */}
                    {v.type !== 'table' && (
                      <button
                        type="button"
                        className="base-dropdown-item"
                        onClick={() => {
                          setTabMenuIndex(null);
                          onSwitchViewType?.(idx, 'table');
                        }}
                      >
                        <TableIcon size={13} />
                        <span>{t('base.switchToTable') || 'Zu Tabellenansicht wechseln'}</span>
                      </button>
                    )}
                    {v.type !== 'cards' && (
                      <button
                        type="button"
                        className="base-dropdown-item"
                        onClick={() => {
                          setTabMenuIndex(null);
                          onSwitchViewType?.(idx, 'cards');
                        }}
                      >
                        <LayoutGrid size={13} />
                        <span>{t('base.switchToCards') || 'Zu Kartenansicht wechseln'}</span>
                      </button>
                    )}
                    {v.type !== 'board' && (
                      <button
                        type="button"
                        className="base-dropdown-item"
                        onClick={() => {
                          setTabMenuIndex(null);
                          onSwitchViewType?.(idx, 'board');
                        }}
                      >
                        <Kanban size={13} />
                        <span>{t('base.switchToBoard') || 'Zu Boardansicht wechseln'}</span>
                      </button>
                    )}

                    {/* Rename View */}
                    <button
                      type="button"
                      className="base-dropdown-item"
                      onClick={() => handleStartRename(idx, v.name)}
                    >
                      <Edit2 size={13} />
                      <span>{t('base.renameView') || t('base.rename') || 'Umbenennen'}</span>
                    </button>

                    {/* Duplicate View */}
                    <button
                      type="button"
                      className="base-dropdown-item"
                      onClick={() => {
                        setTabMenuIndex(null);
                        onDuplicateView(idx);
                      }}
                    >
                      <Copy size={13} />
                      <span>{t('base.duplicateView') || t('base.duplicate') || 'Duplizieren'}</span>
                    </button>

                    {/* Delete View */}
                    {config.views.length > 1 && (
                      <button
                        type="button"
                        className="base-dropdown-item danger"
                        onClick={() => {
                          setTabMenuIndex(null);
                          onDeleteView(idx);
                        }}
                      >
                        <Trash2 size={13} />
                        <span>{t('base.deleteView') || t('base.delete') || 'Ansicht löschen'}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* + Add View Button */}
          <div className="base-add-view-wrapper">
            <button
              type="button"
              className={`base-add-tab-btn ${isAddViewOpen ? 'active' : ''}`}
              onClick={handleOpenAddView}
              title={t('base.addView') || 'Neue Ansicht hinzufügen'}
            >
              <Plus size={14} />
              <span className="btn-label-desktop">{t('base.addView') || 'Ansicht'}</span>
            </button>

            {isAddViewOpen && !isMobile && (
              <form
                className="base-dropdown-menu add-view-dropdown"
                onSubmit={handleCreateViewSubmit}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="add-view-field">
                  <label className="add-view-label">{t('base.viewName') || 'Name der Ansicht'}</label>
                  <input
                    type="text"
                    className="base-input"
                    placeholder={t('base.viewName') || 'Name der Ansicht'}
                    value={newViewName}
                    autoFocus
                    onChange={(e) => setNewViewName(e.target.value)}
                  />
                </div>
                <div className="add-view-field">
                  <label className="add-view-label">{t('base.viewType') || 'Layout-Typ'}</label>
                  <div className="add-view-types">
                    <button
                      type="button"
                      className={`type-btn ${newViewType === 'table' ? 'active' : ''}`}
                      onClick={() => setNewViewType('table')}
                    >
                      <TableIcon size={14} />
                      <span>{t('base.typeTable') || 'Tabelle'}</span>
                    </button>
                    <button
                      type="button"
                      className={`type-btn ${newViewType === 'cards' ? 'active' : ''}`}
                      onClick={() => setNewViewType('cards')}
                    >
                      <LayoutGrid size={14} />
                      <span>{t('base.typeCards') || 'Karten'}</span>
                    </button>
                    <button
                      type="button"
                      className={`type-btn ${newViewType === 'board' ? 'active' : ''}`}
                      onClick={() => setNewViewType('board')}
                    >
                      <Kanban size={14} />
                      <span>{t('base.typeBoard') || 'Board'}</span>
                    </button>
                  </div>
                </div>
                <div className="add-view-actions">
                  <button
                    type="button"
                    className="base-btn secondary-btn"
                    onClick={() => setIsAddViewOpen(false)}
                  >
                    {t('base.cancel') || 'Abbrechen'}
                  </button>
                  <button type="submit" className="base-btn primary-btn add-btn-submit">
                    {t('base.create') || 'Erstellen'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT: Actions & Controls */}
      <div className="base-toolbar-controls">
        {/* Filter Toggle */}
        <button
          type="button"
          className={`base-toolbar-btn filter-toggle-btn ${activeFilterCount > 0 ? 'has-filters' : ''} ${isFilterPopoverOpen ? 'active' : ''}`}
          onClick={onToggleFilterPopover}
          title="Filter anpassen"
        >
          <Filter size={14} />
          <span>Filter</span>
          {activeFilterCount > 0 && <span className="base-badge-count">{activeFilterCount}</span>}
        </button>

        {/* Sort Button & Dropdown */}
        <div className="base-dropdown-wrapper">
          <button
            type="button"
            className={`base-toolbar-btn ${currentSort ? 'active' : ''}`}
            onClick={() => {
              setIsSortDropdownOpen((o) => !o);
              setIsGroupDropdownOpen(false);
            }}
            title="Sortierung festlegen"
          >
            <ArrowUpDown size={14} />
            <span className="btn-label-desktop">
              {currentSort ? `Sortiert (${currentSort.property})` : 'Sortieren'}
            </span>
          </button>

          {isSortDropdownOpen && !isMobile && (
            <div className="base-dropdown-menu sort-dropdown">
              <button
                type="button"
                className={`base-dropdown-item ${!currentSort ? 'selected' : ''}`}
                onClick={() => {
                  onSortChange(undefined);
                  setIsSortDropdownOpen(false);
                }}
              >
                {!currentSort && <Check size={13} />}
                <span>(Keine Sortierung)</span>
              </button>
              {availableProperties.map((p) => {
                const isSelected = currentSort?.property === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    className={`base-dropdown-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      if (isSelected) {
                        // Toggle direction
                        const nextDir = currentSort.direction === 'asc' ? 'desc' : 'asc';
                        onSortChange([{ property: p.key, direction: nextDir }]);
                      } else {
                        onSortChange([{ property: p.key, direction: 'asc' }]);
                      }
                      setIsSortDropdownOpen(false);
                    }}
                  >
                    {isSelected && <Check size={13} />}
                    <span>{p.label}</span>
                    {isSelected && (
                      <span className="sort-dir-badge">
                        {currentSort.direction === 'asc' ? 'A-Z' : 'Z-A'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* GroupBy Button & Dropdown */}
        <div className="base-dropdown-wrapper">
          <button
            type="button"
            className={`base-toolbar-btn ${currentGroupBy ? 'active' : ''}`}
            onClick={() => {
              setIsGroupDropdownOpen((o) => !o);
              setIsSortDropdownOpen(false);
            }}
            title="Gruppierung festlegen"
          >
            <Layers size={14} />
            <span className="btn-label-desktop">
              {currentGroupBy ? `Gruppiert (${currentGroupBy.property})` : 'Gruppieren'}
            </span>
          </button>

          {isGroupDropdownOpen && !isMobile && (
            <div className="base-dropdown-menu group-dropdown">
              <button
                type="button"
                className={`base-dropdown-item ${!currentGroupBy ? 'selected' : ''}`}
                onClick={() => {
                  onGroupByChange(undefined);
                  setIsGroupDropdownOpen(false);
                }}
              >
                {!currentGroupBy && <Check size={13} />}
                <span>(Keine Gruppierung)</span>
              </button>
              {availableProperties.map((p) => {
                const isSelected = currentGroupBy?.property === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    className={`base-dropdown-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      if (isSelected) {
                        const nextDir = currentGroupBy.direction === 'asc' ? 'desc' : 'asc';
                        onGroupByChange({ property: p.key, direction: nextDir });
                      } else {
                        onGroupByChange({ property: p.key, direction: 'asc' });
                      }
                      setIsGroupDropdownOpen(false);
                    }}
                  >
                    {isSelected && <Check size={13} />}
                    <span>{p.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Columns Manager Toggle (Table & Cards) */}
        {activeView.type !== 'board' ? (
          <button
            type="button"
            className="base-toolbar-btn columns-btn"
            onClick={onOpenColumnsModal}
            title="Spalten einblenden / ausblenden"
          >
            <Columns size={14} />
            <span className="btn-label-desktop">Spalten</span>
          </button>
        ) : onOpenBoardConfigModal ? (
          <button
            type="button"
            className="base-toolbar-btn board-config-btn"
            onClick={onOpenBoardConfigModal}
            title={t('base.configureBoard', 'Board konfigurieren')}
          >
            <Settings size={14} />
            <span className="btn-label-desktop">{t('base.configureBoard', 'Board')}</span>
          </button>
        ) : null}

        {/* Editor Mode Toggle [ Ansicht | Quellcode ] */}
        <div className="base-editor-mode-toggle">
          <button
            type="button"
            className={`mode-toggle-btn ${editorMode === 'visual' ? 'active' : ''}`}
            onClick={() => onToggleEditorMode('visual')}
            title="Visuelle Tabellen- & Kachelansicht"
          >
            <Eye size={13} />
            <span className="btn-label-desktop">{t('base.visualView') || 'Ansicht'}</span>
          </button>
          <button
            type="button"
            className={`mode-toggle-btn ${editorMode === 'source' ? 'active' : ''}`}
            onClick={() => onToggleEditorMode('source')}
            title="YAML-Quellcode bearbeiten"
          >
            <Code size={13} />
            <span className="btn-label-desktop">{t('base.sourceView') || 'Quelltext'}</span>
          </button>
        </div>
      </div>

      {/* Mobile BottomSheets for Toolbar Menus */}
      {isMobile && tabMenuIndex !== null && config.views[tabMenuIndex] && (() => {
        const idx = tabMenuIndex;
        const v = config.views[idx];
        return (
          <BottomSheet
            isOpen={true}
            onClose={() => setTabMenuIndex(null)}
            title={v.name}
          >
            <div className="bottom-sheet-section">
              {v.type !== 'table' && (
                <button
                  type="button"
                  className="bottom-sheet-action-btn"
                  onClick={() => {
                    setTabMenuIndex(null);
                    onSwitchViewType?.(idx, 'table');
                  }}
                >
                  <TableIcon size={16} />
                  <span>{t('base.switchToTable') || 'Zu Tabellenansicht wechseln'}</span>
                </button>
              )}
              {v.type !== 'cards' && (
                <button
                  type="button"
                  className="bottom-sheet-action-btn"
                  onClick={() => {
                    setTabMenuIndex(null);
                    onSwitchViewType?.(idx, 'cards');
                  }}
                >
                  <LayoutGrid size={16} />
                  <span>{t('base.switchToCards') || 'Zu Kartenansicht wechseln'}</span>
                </button>
              )}
              {v.type !== 'board' && (
                <button
                  type="button"
                  className="bottom-sheet-action-btn"
                  onClick={() => {
                    setTabMenuIndex(null);
                    onSwitchViewType?.(idx, 'board');
                  }}
                >
                  <Kanban size={16} />
                  <span>{t('base.switchToBoard') || 'Zu Boardansicht wechseln'}</span>
                </button>
              )}
              <button
                type="button"
                className="bottom-sheet-action-btn"
                onClick={() => handleStartRename(idx, v.name)}
              >
                <Edit2 size={16} />
                <span>{t('base.renameView') || t('base.rename') || 'Umbenennen'}</span>
              </button>
              <button
                type="button"
                className="bottom-sheet-action-btn"
                onClick={() => {
                  setTabMenuIndex(null);
                  onDuplicateView(idx);
                }}
              >
                <Copy size={16} />
                <span>{t('base.duplicateView') || t('base.duplicate') || 'Duplizieren'}</span>
              </button>
              {config.views.length > 1 && (
                <button
                  type="button"
                  className="bottom-sheet-action-btn danger"
                  onClick={() => {
                    setTabMenuIndex(null);
                    onDeleteView(idx);
                  }}
                >
                  <Trash2 size={16} />
                  <span>{t('base.deleteView') || t('base.delete') || 'Ansicht löschen'}</span>
                </button>
              )}
            </div>
          </BottomSheet>
        );
      })()}

      {isMobile && isAddViewOpen && (
        <BottomSheet
          isOpen={isAddViewOpen}
          onClose={() => setIsAddViewOpen(false)}
          title={t('base.addView') || 'Neue Ansicht hinzufügen'}
        >
          <form className="bottom-sheet-form" onSubmit={handleCreateViewSubmit}>
            <div className="add-view-field">
              <label className="add-view-label">{t('base.viewName') || 'Name der Ansicht'}</label>
              <input
                type="text"
                className="base-input"
                placeholder={t('base.viewName') || 'Name der Ansicht'}
                value={newViewName}
                autoFocus
                onChange={(e) => setNewViewName(e.target.value)}
              />
            </div>
            <div className="add-view-field">
              <label className="add-view-label">{t('base.viewType') || 'Layout-Typ'}</label>
              <div className="add-view-types">
                <button
                  type="button"
                  className={`type-btn ${newViewType === 'table' ? 'active' : ''}`}
                  onClick={() => setNewViewType('table')}
                >
                  <TableIcon size={15} />
                  <span>{t('base.typeTable') || 'Tabelle'}</span>
                </button>
                <button
                  type="button"
                  className={`type-btn ${newViewType === 'cards' ? 'active' : ''}`}
                  onClick={() => setNewViewType('cards')}
                >
                  <LayoutGrid size={15} />
                  <span>{t('base.typeCards') || 'Karten'}</span>
                </button>
                <button
                  type="button"
                  className={`type-btn ${newViewType === 'board' ? 'active' : ''}`}
                  onClick={() => setNewViewType('board')}
                >
                  <Kanban size={15} />
                  <span>{t('base.typeBoard') || 'Board'}</span>
                </button>
              </div>
            </div>
            <div className="add-view-actions">
              <button
                type="button"
                className="base-btn secondary-btn"
                onClick={() => setIsAddViewOpen(false)}
              >
                {t('base.cancel') || 'Abbrechen'}
              </button>
              <button type="submit" className="base-btn primary-btn add-btn-submit">
                {t('base.create') || 'Erstellen'}
              </button>
            </div>
          </form>
        </BottomSheet>
      )}

      {isMobile && isSortDropdownOpen && (
        <BottomSheet
          isOpen={isSortDropdownOpen}
          onClose={() => setIsSortDropdownOpen(false)}
          title={t('base.sortBy', 'Sortieren nach')}
        >
          <div className="bottom-sheet-section">
            <button
              type="button"
              className={`bottom-sheet-action-btn ${!currentSort ? 'is-active' : ''}`}
              onClick={() => {
                onSortChange(undefined);
                setIsSortDropdownOpen(false);
              }}
            >
              <span className="bottom-sheet-action-label">(Keine Sortierung)</span>
              {!currentSort && <Check size={16} className="bottom-sheet-check-icon" />}
            </button>
            {availableProperties.map((p) => {
              const isSelected = currentSort?.property === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  className={`bottom-sheet-action-btn ${isSelected ? 'is-active' : ''}`}
                  onClick={() => {
                    if (isSelected) {
                      const nextDir = currentSort.direction === 'asc' ? 'desc' : 'asc';
                      onSortChange([{ property: p.key, direction: nextDir }]);
                    } else {
                      onSortChange([{ property: p.key, direction: 'asc' }]);
                    }
                    setIsSortDropdownOpen(false);
                  }}
                >
                  <span className="bottom-sheet-action-label">{p.label}</span>
                  {isSelected && (
                    <span className="sort-dir-badge">
                      {currentSort.direction === 'asc' ? 'A-Z' : 'Z-A'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </BottomSheet>
      )}

      {isMobile && isGroupDropdownOpen && (
        <BottomSheet
          isOpen={isGroupDropdownOpen}
          onClose={() => setIsGroupDropdownOpen(false)}
          title={t('base.groupByProperty', 'Gruppieren nach')}
        >
          <div className="bottom-sheet-section">
            <button
              type="button"
              className={`bottom-sheet-action-btn ${!currentGroupBy ? 'is-active' : ''}`}
              onClick={() => {
                onGroupByChange(undefined);
                setIsGroupDropdownOpen(false);
              }}
            >
              <span className="bottom-sheet-action-label">(Keine Gruppierung)</span>
              {!currentGroupBy && <Check size={16} className="bottom-sheet-check-icon" />}
            </button>
            {availableProperties.map((p) => {
              const isSelected = currentGroupBy?.property === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  className={`bottom-sheet-action-btn ${isSelected ? 'is-active' : ''}`}
                  onClick={() => {
                    if (isSelected) {
                      const nextDir = currentGroupBy.direction === 'asc' ? 'desc' : 'asc';
                      onGroupByChange({ property: p.key, direction: nextDir });
                    } else {
                      onGroupByChange({ property: p.key, direction: 'asc' });
                    }
                    setIsGroupDropdownOpen(false);
                  }}
                >
                  <span className="bottom-sheet-action-label">{p.label}</span>
                  {isSelected && <Check size={16} className="bottom-sheet-check-icon" />}
                </button>
              );
            })}
          </div>
        </BottomSheet>
      )}
    </div>
  );
};
