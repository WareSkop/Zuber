import React, { useState, useEffect } from 'react';
import { Kanban, X, ArrowUp, ArrowDown, Plus, Trash2 } from 'lucide-react';
import type { BaseViewConfig, BaseGroupBy } from '../../base/baseConfig';
import { useTranslation } from '../../i18n';

export interface BaseBoardConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  view: BaseViewConfig;
  availableProperties: { key: string; label: string }[];
  onSave: (newGroupBy: BaseGroupBy, newColumnLimit: number) => void;
}

interface ColumnItem {
  id: string;
  name: string;
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

export const BaseBoardConfigModal: React.FC<BaseBoardConfigModalProps> = ({
  isOpen,
  onClose,
  view,
  availableProperties,
  onSave,
}) => {
  const { t } = useTranslation();

  const [property, setProperty] = useState<string>('status');
  const [columns, setColumns] = useState<ColumnItem[]>([]);
  const [columnLimit, setColumnLimit] = useState<number>(10);
  const [newColName, setNewColName] = useState<string>('');

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
    }
  }, [isOpen, view]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCols = columns.map((c) => c.name.trim()).filter(Boolean);
    const finalCols = cleanCols.length > 0 ? cleanCols : ['Open', 'inWork', 'Waiting', 'Finish'];
    const finalLimit = Math.max(1, Number(columnLimit) || 10);

    onSave(
      {
        property: property.trim() || 'status',
        columns: finalCols,
      },
      finalLimit
    );
    onClose();
  };

  return (
    <div className="modal-backdrop base-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-container base-modal-container base-board-config-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header base-modal-header">
          <div className="modal-title-cluster base-modal-title">
            <Kanban size={18} className="modal-icon modal-title-icon" />
            <h2 className="modal-title">{t('base.configureBoard', 'Board konfigurieren')}</h2>
          </div>
          <button
            type="button"
            className="base-modal-close-btn close-btn"
            onClick={onClose}
            aria-label={t('common.close', 'Schließen')}
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="base-board-config-form">
          <div className="modal-body base-modal-body scroller">
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
                {/* Ensure current property is in list */}
                {property && !availableProperties.some((p) => p.key === property) && (
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
                  placeholder={t('base.newColumnPlaceholder', 'Neue Spalte (z. B. Prüfung)...')}
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
                  <span>{t('base.addColumn', 'Hinzufügen')}</span>
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
              />
            </div>
          </div>

          <div className="modal-footer base-modal-footer">
            <button type="button" className="base-btn secondary-btn" onClick={onClose}>
              <span>{t('common.cancel', 'Abbrechen')}</span>
            </button>
            <button type="submit" className="base-btn primary-btn">
              <span>{t('common.save', 'Speichern')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
