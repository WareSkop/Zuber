import React, { useState, useRef, useEffect } from 'react';
import {
  Table as TableIcon,
  LayoutGrid,
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
} from 'lucide-react';
import type { BaseConfig, BaseSortRule } from '../../base/baseConfig';
import { useTranslation } from '../../i18n';

export interface BaseToolbarProps {
  config: BaseConfig;
  activeViewIndex: number;
  onSelectView: (index: number) => void;
  onAddView: (name: string, type: 'table' | 'cards') => void;
  onRenameView: (index: number, newName: string) => void;
  onDuplicateView: (index: number) => void;
  onDeleteView: (index: number) => void;
  activeFilterCount: number;
  isFilterPopoverOpen: boolean;
  onToggleFilterPopover: () => void;
  onOpenColumnsModal: () => void;
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
  activeFilterCount,
  isFilterPopoverOpen,
  onToggleFilterPopover,
  onOpenColumnsModal,
  availableProperties,
  onSortChange,
  onGroupByChange,
  editorMode,
  onToggleEditorMode,
}) => {
  const { t } = useTranslation();

  // New View popover state
  const [isAddViewOpen, setIsAddViewOpen] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [newViewType, setNewViewType] = useState<'table' | 'cards'>('table');

  // Tab menu dropdown state
  const [tabMenuIndex, setTabMenuIndex] = useState<number | null>(null);
  const [editingTabNameIndex, setEditingTabNameIndex] = useState<number | null>(null);
  const [draftTabName, setDraftTabName] = useState('');

  // Sort & Group dropdowns
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false);

  const toolbarRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setIsAddViewOpen(false);
        setTabMenuIndex(null);
        setIsSortDropdownOpen(false);
        setIsGroupDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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

  const handleCreateViewSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = newViewName.trim() || (newViewType === 'cards' ? 'Cards' : 'Table');
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
            const IconComponent = v.type === 'cards' ? LayoutGrid : TableIcon;
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

                {tabMenuIndex === idx && (
                  <div className="base-dropdown-menu tab-dropdown">
                    <button
                      type="button"
                      className="base-dropdown-item"
                      onClick={() => handleStartRename(idx, v.name)}
                    >
                      <Edit2 size={13} />
                      <span>{t('base.rename') || 'Umbenennen'}</span>
                    </button>
                    <button
                      type="button"
                      className="base-dropdown-item"
                      onClick={() => {
                        setTabMenuIndex(null);
                        onDuplicateView(idx);
                      }}
                    >
                      <Copy size={13} />
                      <span>{t('base.duplicate') || 'Duplizieren'}</span>
                    </button>
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
                        <span>{t('base.delete') || 'Ansicht löschen'}</span>
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
              className="base-add-tab-btn"
              onClick={() => setIsAddViewOpen((o) => !o)}
              title="Neue Ansicht hinzufügen"
            >
              <Plus size={14} />
              <span className="btn-label-desktop">Ansicht</span>
            </button>

            {isAddViewOpen && (
              <form className="base-dropdown-menu add-view-dropdown" onSubmit={handleCreateViewSubmit}>
                <div className="add-view-field">
                  <label className="add-view-label">Name der Ansicht</label>
                  <input
                    type="text"
                    className="base-input"
                    placeholder="z. B. Aktiv, Tabelle 2..."
                    value={newViewName}
                    autoFocus
                    onChange={(e) => setNewViewName(e.target.value)}
                  />
                </div>
                <div className="add-view-field">
                  <label className="add-view-label">Layout-Typ</label>
                  <div className="add-view-types">
                    <button
                      type="button"
                      className={`type-btn ${newViewType === 'table' ? 'active' : ''}`}
                      onClick={() => setNewViewType('table')}
                    >
                      <TableIcon size={14} />
                      <span>Tabelle</span>
                    </button>
                    <button
                      type="button"
                      className={`type-btn ${newViewType === 'cards' ? 'active' : ''}`}
                      onClick={() => setNewViewType('cards')}
                    >
                      <LayoutGrid size={14} />
                      <span>Karten</span>
                    </button>
                  </div>
                </div>
                <button type="submit" className="base-btn primary-btn add-btn-submit">
                  <span>Hinzufügen</span>
                </button>
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

          {isSortDropdownOpen && (
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

          {isGroupDropdownOpen && (
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

        {/* Columns Manager Toggle */}
        <button
          type="button"
          className="base-toolbar-btn columns-btn"
          onClick={onOpenColumnsModal}
          title="Spalten einblenden / ausblenden"
        >
          <Columns size={14} />
          <span className="btn-label-desktop">Spalten</span>
        </button>

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
    </div>
  );
};
