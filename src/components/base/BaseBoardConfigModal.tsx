import React, { useState, useEffect, useMemo } from 'react';
import { Kanban, X, ArrowUp, ArrowDown, Plus, Trash2, CheckSquare, Square, GripVertical } from 'lucide-react';
import {
  extractPropertyValues,
  extractVaultProperties,
  type BaseViewConfig,
  type BaseGroupBy,
  type BaseBoardSwimlaneConfig,
} from '../../base/baseConfig';
import { useTranslation } from '../../i18n';

export interface BaseBoardConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  view: BaseViewConfig;
  availableProperties: { key: string; label: string }[];
  allNotes?: any[];
  displayNames?: Record<string, string>;
  onSave: (
    newGroupBy: BaseGroupBy,
    newColumnLimit: number,
    newSwimlanes?: BaseBoardSwimlaneConfig,
    newOrder?: string[]
  ) => void;
}

interface ColumnItem {
  id: string;
  name: string;
}

interface SwimlaneItem {
  id: string;
  name: string;
  collapsed?: boolean;
}

interface ColumnConfigRowProps {
  col: ColumnItem;
  idx: number;
  total: number;
  onMove: (index: number, direction: 'up' | 'down') => void;
  onRename: (id: string, value: string) => void;
  onDelete: (id: string) => void;
  deleteTitle: string;
}

const ColumnConfigRow: React.FC<ColumnConfigRowProps> = ({
  col,
  idx,
  total,
  onMove,
  onRename,
  onDelete,
  deleteTitle,
}) => {
  return (
    <div className="base-board-column-config-row">
      <div className="reorder-buttons">
        <button
          type="button"
          className="col-move-btn"
          disabled={idx === 0}
          onClick={() => onMove(idx, 'up')}
          title="Nach oben"
        >
          <ArrowUp size={12} />
        </button>
        <button
          type="button"
          className="col-move-btn"
          disabled={idx === total - 1}
          onClick={() => onMove(idx, 'down')}
          title="Nach unten"
        >
          <ArrowDown size={12} />
        </button>
      </div>

      <input
        type="text"
        className="base-input column-name-input"
        value={col.name}
        onChange={(e) => onRename(col.id, e.target.value)}
        placeholder="Spaltenname..."
      />

      <button
        type="button"
        className="col-delete-btn"
        disabled={total <= 1}
        onClick={() => onDelete(col.id)}
        title={deleteTitle}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
};

interface SwimlaneConfigRowProps {
  lane: SwimlaneItem;
  idx: number;
  total: number;
  onMove: (index: number, direction: 'up' | 'down') => void;
  onRename: (id: string, value: string) => void;
  onDelete: (id: string) => void;
  deleteTitle: string;
  placeholder: string;
}

const SwimlaneConfigRow: React.FC<SwimlaneConfigRowProps> = ({
  lane,
  idx,
  total,
  onMove,
  onRename,
  onDelete,
  deleteTitle,
  placeholder,
}) => {
  return (
    <div className="base-board-column-config-row base-board-swimlane-config-row">
      <div className="reorder-buttons">
        <button
          type="button"
          className="col-move-btn"
          disabled={idx === 0}
          onClick={() => onMove(idx, 'up')}
          title="Nach oben"
        >
          <ArrowUp size={12} />
        </button>
        <button
          type="button"
          className="col-move-btn"
          disabled={idx === total - 1}
          onClick={() => onMove(idx, 'down')}
          title="Nach unten"
        >
          <ArrowDown size={12} />
        </button>
      </div>

      <input
        type="text"
        className="base-input swimlane-name-input"
        value={lane.name}
        onChange={(e) => onRename(lane.id, e.target.value)}
        placeholder={placeholder}
      />

      <button
        type="button"
        className="col-delete-btn"
        onClick={() => onDelete(lane.id)}
        title={deleteTitle}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
};

export const BaseBoardConfigModal: React.FC<BaseBoardConfigModalProps> = ({
  isOpen,
  onClose,
  view,
  availableProperties,
  allNotes = [],
  displayNames = {},
  onSave,
}) => {
  const { t } = useTranslation();

  const [property, setProperty] = useState<string>('status');
  const [columns, setColumns] = useState<ColumnItem[]>([]);
  const [columnLimit, setColumnLimit] = useState<number>(10);
  const [newColName, setNewColName] = useState<string>('');

  const [swimlaneProperty, setSwimlaneProperty] = useState<string>('');
  const [swimlanes, setSwimlanes] = useState<SwimlaneItem[]>([]);
  const [newSwimlaneName, setNewSwimlaneName] = useState<string>('');

  const [cardOrder, setCardOrder] = useState<string[]>(['file.name']);
  const [orderDirty, setOrderDirty] = useState<boolean>(false);
  const [draggedCardPropIndex, setDraggedCardPropIndex] = useState<number | null>(null);

  // Merge availableProperties with frontmatter properties detected from allNotes (matching base records)
  const detectedCardProperties = useMemo(() => {
    const map = new Map<string, string>();
    map.set('tags', displayNames['tags'] || 'Tags (tags)');
    map.set('file.folder', displayNames['file.folder'] || 'Ordner (file.folder)');

    // Properties from matching notes / records
    const extracted = extractVaultProperties(allNotes);
    for (const p of extracted) {
      if (p.key && p.key !== 'file.name') {
        map.set(p.key, displayNames[p.key] || p.label || p.key);
      }
    }

    // Also include BaseRecord properties dictionary if allNotes contains BaseRecord objects
    for (const n of allNotes || []) {
      if (n && n.properties && !Array.isArray(n.properties) && typeof n.properties === 'object') {
        for (const k of Object.keys(n.properties)) {
          const clean = k.trim();
          if (clean && clean !== 'file.name' && !map.has(clean)) {
            map.set(clean, displayNames[clean] || clean);
          }
        }
      }
      if (n && Array.isArray(n.tags) && n.tags.length > 0 && !map.has('tags')) {
        map.set('tags', displayNames['tags'] || 'Tags (tags)');
      }
    }

    // Properties from availableProperties prop
    for (const p of availableProperties || []) {
      if (p.key && p.key !== 'file.name' && !map.has(p.key)) {
        map.set(p.key, displayNames[p.key] || p.label || p.key);
      }
    }

    const result: { key: string; label: string }[] = [];
    for (const [key, label] of map.entries()) {
      result.push({ key, label });
    }
    return result;
  }, [allNotes, availableProperties, displayNames]);

  useEffect(() => {
    if (isOpen) {
      const initialProp = view.groupBy?.property || 'status';
      setProperty(initialProp);

      const rawCols = view.groupBy?.columns || ['Open', 'inWork', 'Waiting', 'Finish'];
      const stringCols: ColumnItem[] = rawCols.map((c, i) => ({
        id: `col-${i}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: typeof c === 'string' ? c : c.name,
      }));
      setColumns(stringCols);

      setColumnLimit(view.columnLimit || 10);
      setNewColName('');

      const initialSwimlaneProp = view.swimlanes?.property || '';
      setSwimlaneProperty(initialSwimlaneProp);

      const rawLanes = view.swimlanes?.lanes || [];
      const laneItems: SwimlaneItem[] = rawLanes.map((l, i) => ({
        id: `lane-${i}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: typeof l === 'string' ? l : l.name,
        collapsed: typeof l === 'string' ? false : Boolean(l.collapsed),
      }));
      setSwimlanes(laneItems);
      setNewSwimlaneName('');

      const initialOrder =
        Array.isArray(view.order) && view.order.length > 0
          ? view.order.includes('file.name')
            ? [...view.order]
            : ['file.name', ...view.order]
          : ['file.name'];
      setCardOrder(initialOrder);
      setOrderDirty(false);
    }
  }, [isOpen, view]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Build ordered list of card properties (excluding 'file.name' which is always the card title)
  const selectedCardProps = cardOrder.filter((k) => k !== 'file.name');
  const selectedCardPropsSet = new Set(selectedCardProps);

  const allCardPropertyItems = useMemo(() => {
    const items: { key: string; label: string; isVisible: boolean }[] = [];

    // 1. Visible properties first in their configured order
    for (const key of selectedCardProps) {
      const found = detectedCardProperties.find((p) => p.key === key);
      items.push({
        key,
        label: displayNames[key] || found?.label || key,
        isVisible: true,
      });
    }

    // 2. Remaining detected properties
    for (const p of detectedCardProperties) {
      if (!selectedCardPropsSet.has(p.key)) {
        items.push({
          key: p.key,
          label: displayNames[p.key] || p.label || p.key,
          isVisible: false,
        });
      }
    }

    return items;
  }, [selectedCardProps, detectedCardProperties, displayNames]);

  if (!isOpen) return null;

  const handleMoveColumn = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= columns.length) return;
    const newCols = [...columns];
    const [moved] = newCols.splice(index, 1);
    newCols.splice(targetIndex, 0, moved);
    setColumns(newCols);
  };

  const handleRenameColumn = (id: string, value: string) => {
    setColumns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name: value } : c))
    );
  };

  const handleDeleteColumn = (id: string) => {
    if (columns.length <= 1) return;
    setColumns((prev) => prev.filter((c) => c.id !== id));
  };

  const handleAddColumn = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newColName.trim();
    if (!trimmed) return;
    if (!columns.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      setColumns((prev) => [
        ...prev,
        {
          id: `col-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          name: trimmed,
        },
      ]);
    }
    setNewColName('');
  };

  const handleSwimlanePropertyChange = (nextProp: string) => {
    setSwimlaneProperty(nextProp);
    if (!nextProp) return;

    // Auto-suggest existing property values from vault notes if no swimlanes defined yet (or switching property)
    const suggested = extractPropertyValues(allNotes, nextProp);
    if (suggested.length > 0 && (swimlanes.length === 0 || nextProp !== swimlaneProperty)) {
      setSwimlanes(
        suggested.map((val, i) => ({
          id: `lane-${i}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          name: val,
          collapsed: false,
        }))
      );
    }
  };

  const handleMoveSwimlane = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= swimlanes.length) return;
    const newLanes = [...swimlanes];
    const [moved] = newLanes.splice(index, 1);
    newLanes.splice(targetIndex, 0, moved);
    setSwimlanes(newLanes);
  };

  const handleRenameSwimlane = (id: string, value: string) => {
    setSwimlanes((prev) =>
      prev.map((l) => (l.id === id ? { ...l, name: value } : l))
    );
  };

  const handleDeleteSwimlane = (id: string) => {
    setSwimlanes((prev) => prev.filter((l) => l.id !== id));
  };

  const handleAddSwimlane = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newSwimlaneName.trim();
    if (!trimmed) return;
    if (!swimlanes.some((l) => l.name.toLowerCase() === trimmed.toLowerCase())) {
      setSwimlanes((prev) => [
        ...prev,
        {
          id: `lane-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          name: trimmed,
          collapsed: false,
        },
      ]);
    }
    setNewSwimlaneName('');
  };

  const handleToggleCardProperty = (key: string) => {
    setOrderDirty(true);
    setCardOrder((prev) => {
      const withoutFileName = prev.filter((k) => k !== 'file.name');
      if (withoutFileName.includes(key)) {
        return ['file.name', ...withoutFileName.filter((k) => k !== key)];
      } else {
        return ['file.name', ...withoutFileName, key];
      }
    });
  };

  const handleMoveCardProperty = (indexInSelected: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? indexInSelected - 1 : indexInSelected + 1;
    if (targetIdx < 0 || targetIdx >= selectedCardProps.length) return;
    setOrderDirty(true);
    const nextSelected = [...selectedCardProps];
    const [moved] = nextSelected.splice(indexInSelected, 1);
    nextSelected.splice(targetIdx, 0, moved);
    setCardOrder(['file.name', ...nextSelected]);
  };

  const handleDragStartCardProperty = (indexInSelected: number) => {
    setDraggedCardPropIndex(indexInSelected);
  };

  const handleDragOverCardProperty = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedCardPropIndex === null || draggedCardPropIndex === targetIdx) return;
    if (draggedCardPropIndex >= selectedCardProps.length || targetIdx >= selectedCardProps.length) return;
    setOrderDirty(true);
    const nextSelected = [...selectedCardProps];
    const [moved] = nextSelected.splice(draggedCardPropIndex, 1);
    nextSelected.splice(targetIdx, 0, moved);
    setDraggedCardPropIndex(targetIdx);
    setCardOrder(['file.name', ...nextSelected]);
  };

  const handleDragEndCardProperty = () => {
    setDraggedCardPropIndex(null);
  };

  const handleSubmit = (e?: React.FormEvent | React.MouseEvent) => {
    if (e && e.preventDefault) e.preventDefault();
    const cleanCols = columns
      .map((c) => {
        const trimmed = c.name.trim();
        if (!trimmed) return null;
        const existing = (view.groupBy?.columns || []).find((ec) =>
          (typeof ec === 'string' ? ec : ec.name).toLowerCase() === trimmed.toLowerCase()
        );
        if (typeof existing === 'object' && existing !== null) {
          return { ...existing, name: trimmed };
        }
        return trimmed;
      })
      .filter((c): c is string | any => c !== null);
    const finalCols = cleanCols.length > 0 ? cleanCols : ['Open', 'inWork', 'Waiting', 'Finish'];
    const finalLimit = Math.max(1, Number(columnLimit) || 10);

    const trimmedSwimlaneProp = swimlaneProperty.trim();
    let finalSwimlanes: BaseBoardSwimlaneConfig | undefined = undefined;
    if (trimmedSwimlaneProp) {
      const cleanLanes = swimlanes
        .map((l) => ({
          name: l.name.trim(),
          collapsed: Boolean(l.collapsed),
        }))
        .filter((l) => Boolean(l.name));

      finalSwimlanes = {
        property: trimmedSwimlaneProp,
        lanes: cleanLanes,
        unassignedCollapsed: view.swimlanes?.unassignedCollapsed,
      };
    }

    const finalOrder = ['file.name', ...cardOrder.filter((k) => k !== 'file.name')];
    if (orderDirty || view.order !== undefined) {
      onSave(
        {
          property: property.trim() || 'status',
          columns: finalCols,
        },
        finalLimit,
        finalSwimlanes,
        finalOrder
      );
    } else {
      onSave(
        {
          property: property.trim() || 'status',
          columns: finalCols,
        },
        finalLimit,
        finalSwimlanes
      );
    }
    onClose();
  };

  return (
    <div
      className="board-config-modal-overlay modal-backdrop base-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="board-config-modal modal-container base-modal-container base-board-config-modal base-board-config-modal-2col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. Header (Fixed at top) */}
        <div className="board-config-header modal-header base-modal-header">
          <div className="board-config-title modal-title-cluster base-modal-title">
            <span className="board-config-icon modal-title-icon">
              <Kanban size={18} className="modal-icon" />
            </span>
            <h3 className="modal-title">{t('base.configureBoard', 'Board konfigurieren')}</h3>
          </div>
          <button
            type="button"
            className="board-config-close-btn base-modal-close-btn close-btn"
            onClick={onClose}
            aria-label={t('common.close', 'Schließen')}
          >
            <X size={16} />
          </button>
        </div>

        {/* 2. Body (Scrollable in between) */}
        <div className="board-config-body modal-body base-modal-body base-board-config-grid scroller">
            {/* LEFT COLUMN: Vertical Columns */}
            <div className="base-board-config-column base-board-config-col base-board-config-left">
              {/* 1. Group By Property */}
              <div className="base-config-field-group">
                <label className="base-config-label">
                  {t('base.groupByProperty', 'Gruppieren nach')}:
                </label>
                <select
                  className="base-select"
                  value={property}
                  onChange={(e) => setProperty(e.target.value)}
                >
                  {property && !availableProperties.some((p) => p.key === property) && property !== 'status' && (
                    <option value={property}>{property}</option>
                  )}
                  <option value="status">status</option>
                  {availableProperties
                    .filter((p) => p.key !== 'status' && !p.key.startsWith('file.'))
                    .map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label} ({p.key})
                      </option>
                    ))}
                </select>
              </div>

              {/* 2. Column Values List */}
              <div className="base-config-field-group">
                <label className="base-config-label">
                  {t('base.boardColumns', 'Board-Spalten')}:
                </label>

                <div className="base-board-columns-list scroller">
                  {columns.map((col, idx) => (
                    <ColumnConfigRow
                      key={col.id}
                      col={col}
                      idx={idx}
                      total={columns.length}
                      onMove={handleMoveColumn}
                      onRename={handleRenameColumn}
                      onDelete={handleDeleteColumn}
                      deleteTitle={t('base.deleteColumn', 'Spalte entfernen')}
                    />
                  ))}
                </div>

                {/* Add column input */}
                <div className="base-board-add-col-input-row">
                  <input
                    type="text"
                    className="base-input"
                    placeholder={t('base.newColumnPlaceholder', 'Spaltenname...')}
                    value={newColName}
                    onChange={(e) => setNewColName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddColumn();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="base-btn secondary-btn"
                    onClick={() => handleAddColumn()}
                    disabled={!newColName.trim()}
                  >
                    <Plus size={14} />
                    <span>{t('base.addColumn', 'Spalte hinzufügen')}</span>
                  </button>
                </div>
              </div>

              {/* 3. Column card limit */}
              <div className="base-config-field-group">
                <label className="base-config-label">
                  {t('base.columnLimit', 'Karten-Limit pro Spalte')}:
                </label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  className="base-input limit-input"
                  value={columnLimit}
                  onChange={(e) => setColumnLimit(Number(e.target.value) || 10)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                />
              </div>
            </div>

            {/* RIGHT COLUMN: Horizontal Swimlanes */}
            <div className="base-board-config-column base-board-config-col base-board-config-right">
              <div className="base-config-field-group">
                <label className="base-config-label" htmlFor="board-swimlane-by-select">
                  {t('base.swimlaneBy', 'Swimlanes nach:')}{' '}
                </label>
                <select
                  id="board-swimlane-by-select"
                  className="base-select swimlane-property-select"
                  value={swimlaneProperty}
                  onChange={(e) => handleSwimlanePropertyChange(e.target.value)}
                >
                  <option value="">{t('base.noSwimlanes', 'Keine Swimlanes (Deaktiviert)')}</option>
                  {swimlaneProperty &&
                    !availableProperties.some((p) => p.key === swimlaneProperty) && (
                      <option value={swimlaneProperty}>{swimlaneProperty}</option>
                    )}
                  {availableProperties
                    .filter((p) => !p.key.startsWith('file.'))
                    .map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label} ({p.key})
                      </option>
                    ))}
                </select>
              </div>

              {!swimlaneProperty ? (
                <div className="base-board-swimlane-hint">
                  {t(
                    'base.swimlaneHint',
                    'Wähle eine Eigenschaft (z. B. Priorität oder Projekt), um das Board horizontal in Swimlanes zu unterteilen.'
                  )}
                </div>
              ) : (
                <div className="base-config-field-group">
                  <label className="base-config-label">
                    {t('base.swimlanes', 'Swimlanes')}:
                  </label>

                  <div className="base-board-columns-list base-board-swimlanes-list scroller">
                    {swimlanes.map((lane, idx) => (
                      <SwimlaneConfigRow
                        key={lane.id}
                        lane={lane}
                        idx={idx}
                        total={swimlanes.length}
                        onMove={handleMoveSwimlane}
                        onRename={handleRenameSwimlane}
                        onDelete={handleDeleteSwimlane}
                        deleteTitle={t('base.removeSwimlane', 'Swimlane entfernen')}
                        placeholder={t('base.swimlaneNamePlaceholder', 'Swimlane-Name...')}
                      />
                    ))}
                  </div>

                  {/* Add swimlane input */}
                  <div className="base-board-add-col-input-row base-board-add-swimlane-input-row">
                    <input
                      type="text"
                      className="base-input new-swimlane-input"
                      placeholder={t('base.swimlaneNamePlaceholder', 'Swimlane-Name...')}
                      value={newSwimlaneName}
                      onChange={(e) => setNewSwimlaneName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddSwimlane();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="base-btn secondary-btn add-swimlane-btn"
                      onClick={() => handleAddSwimlane()}
                      disabled={!newSwimlaneName.trim()}
                    >
                      <span>{t('base.addSwimlane', '+ Swimlane hinzufügen')}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Card Content / Properties Configuration Section */}
              <div className="base-config-field-group base-board-card-properties-section">
                <label className="base-config-label">
                  {t('base.cardProperties', 'Karten-Inhalte')}:
                </label>
                <p className="base-modal-hint base-card-props-hint">
                  {t(
                    'base.cardPropertiesHint',
                    'Wähle und sortiere die Eigenschaften, die auf den Karten angezeigt werden sollen:'
                  )}
                </p>

                <div className="base-columns-checklist base-board-card-props-list scroller">
                  {allCardPropertyItems.map((prop, idx) => {
                    const isOrderable = prop.isVisible;
                    const selectedIdx = isOrderable ? selectedCardProps.indexOf(prop.key) : -1;

                    return (
                      <div
                        key={prop.key}
                        className={`base-column-item base-card-prop-config-item ${
                          prop.isVisible ? 'visible' : ''
                        } ${draggedCardPropIndex === selectedIdx && isOrderable ? 'dragging' : ''}`}
                        data-prop-key={prop.key}
                        draggable={isOrderable}
                        onDragStart={() => isOrderable && handleDragStartCardProperty(selectedIdx)}
                        onDragOver={(e) => isOrderable && handleDragOverCardProperty(e, selectedIdx)}
                        onDragEnd={handleDragEndCardProperty}
                      >
                        <div className="base-column-left">
                          {isOrderable ? (
                            <span className="base-col-drag-handle" title="Ziehen zum Neuanordnen">
                              <GripVertical size={14} />
                            </span>
                          ) : (
                            <span className="base-col-drag-spacer" />
                          )}
                          <button
                            type="button"
                            className="base-checkbox-toggle card-prop-checkbox"
                            data-prop-key={prop.key}
                            aria-checked={prop.isVisible}
                            role="checkbox"
                            onClick={() => handleToggleCardProperty(prop.key)}
                            title={
                              prop.isVisible
                                ? 'Eigenschaft auf Karte ausblenden'
                                : 'Eigenschaft auf Karte anzeigen'
                            }
                          >
                            {prop.isVisible ? (
                              <CheckSquare size={16} className="checked-icon" />
                            ) : (
                              <Square size={16} className="unchecked-icon" />
                            )}
                          </button>
                          <span
                            className="base-col-name"
                            onClick={() => handleToggleCardProperty(prop.key)}
                            style={{ cursor: 'pointer' }}
                          >
                            {prop.label}
                          </span>
                        </div>

                        <div className="base-card-prop-config-right">
                          {prop.key !== prop.label && !prop.label.includes(`(${prop.key})`) && (
                            <span className="base-col-raw-key">({prop.key})</span>
                          )}
                          {isOrderable && (
                            <div className="reorder-buttons card-prop-reorder-buttons">
                              <button
                                type="button"
                                className="col-move-btn card-prop-move-up"
                                disabled={selectedIdx <= 0}
                                onClick={() => handleMoveCardProperty(selectedIdx, 'up')}
                                title="Nach oben"
                              >
                                <ArrowUp size={12} />
                              </button>
                              <button
                                type="button"
                                className="col-move-btn card-prop-move-down"
                                disabled={selectedIdx >= selectedCardProps.length - 1}
                                onClick={() => handleMoveCardProperty(selectedIdx, 'down')}
                                title="Nach unten"
                              >
                                <ArrowDown size={12} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
        </div>

        {/* 3. Footer (Always pinned at bottom) */}
        <div className="board-config-footer modal-footer base-modal-footer">
          <button
            type="button"
            className="board-config-cancel-btn base-btn secondary-btn"
            onClick={onClose}
          >
            <span>{t('common.cancel', 'Abbrechen')}</span>
          </button>
          <button
            type="button"
            className="board-config-save-btn base-btn primary-btn btn-primary"
            onClick={() => handleSubmit()}
          >
            <span>{t('common.save', 'Speichern')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
