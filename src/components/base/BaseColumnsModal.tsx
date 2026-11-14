import React, { useState } from 'react';
import { Columns, GripVertical, CheckSquare, Square, X, RotateCcw } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { BottomSheet, useIsMobile } from '../BottomSheet';

export interface BaseColumnsModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: string[];
  availableProperties: { key: string; label: string }[];
  displayNames: Record<string, string>;
  onReorder: (newOrder: string[]) => void;
  onToggleColumn: (col: string, visible: boolean) => void;
  onResetColumns: () => void;
}

export const BaseColumnsModal: React.FC<BaseColumnsModalProps> = ({
  isOpen,
  onClose,
  order,
  availableProperties,
  displayNames,
  onReorder,
  onToggleColumn,
  onResetColumns,
}) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  if (!isOpen) return null;

  // Build list of all columns: those currently in order first (in order), then the rest
  const orderSet = new Set(order);
  const standardFields = [
    { key: 'file.name', label: 'Name (file.name)' },
    { key: 'file.folder', label: 'Folder (file.folder)' },
    { key: 'file.ext', label: 'Extension (file.ext)' },
  ];

  const allColumnsList: { key: string; label: string; isVisible: boolean }[] = [];

  // First add visible columns in their exact order
  for (const col of order) {
    const customDisplay = displayNames[col];
    allColumnsList.push({
      key: col,
      label: customDisplay || col,
      isVisible: true,
    });
  }

  // Then add remaining standard fields
  for (const f of standardFields) {
    if (!orderSet.has(f.key)) {
      allColumnsList.push({
        key: f.key,
        label: f.label,
        isVisible: false,
      });
    }
  }

  // Then add remaining vault properties
  for (const p of availableProperties) {
    if (!orderSet.has(p.key) && !standardFields.some((f) => f.key === p.key)) {
      allColumnsList.push({
        key: p.key,
        label: displayNames[p.key] || p.label,
        isVisible: false,
      });
    }
  }

  const handleDragStart = (idx: number) => {
    setDraggedColIndex(idx);
  };

  const handleDragOver = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedColIndex === null || draggedColIndex === targetIdx) return;

    // Only allow reordering among visible items
    if (draggedColIndex >= order.length || targetIdx >= order.length) return;

    const newOrder = [...order];
    const [moved] = newOrder.splice(draggedColIndex, 1);
    newOrder.splice(targetIdx, 0, moved);
    setDraggedColIndex(targetIdx);
    onReorder(newOrder);
  };

  const handleDragEnd = () => {
    setDraggedColIndex(null);
  };

  const columnsBody = (
    <>
      <p className="base-modal-hint">
        {t('base.columnsHint') ||
          'Wähle aus, welche Spalten in der Tabelle sichtbar sein sollen und ziehe sie per Drag & Drop in die gewünschte Reihenfolge:'}
      </p>

      <div className="base-columns-checklist scroller">
        {allColumnsList.map((col, idx) => {
          const isOrderable = idx < order.length;

          return (
            <div
              key={col.key}
              className={`base-column-item ${col.isVisible ? 'visible' : ''} ${draggedColIndex === idx ? 'dragging' : ''}`}
              draggable={isOrderable}
              onDragStart={() => isOrderable && handleDragStart(idx)}
              onDragOver={(e) => isOrderable && handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
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
                  className="base-checkbox-toggle"
                  onClick={() => onToggleColumn(col.key, !col.isVisible)}
                  title={col.isVisible ? 'Spalte ausblenden' : 'Spalte einblenden'}
                >
                  {col.isVisible ? (
                    <CheckSquare size={16} className="checked-icon" />
                  ) : (
                    <Square size={16} className="unchecked-icon" />
                  )}
                </button>
                <span className="base-col-name">{col.label}</span>
              </div>

              {col.key !== col.label && <span className="base-col-raw-key">({col.key})</span>}
            </div>
          );
        })}
      </div>
    </>
  );

  const columnsFooter = (
    <>
      <button type="button" className="base-btn secondary-btn" onClick={onResetColumns}>
        <RotateCcw size={14} />
        <span>{t('base.resetDefault', 'Standard wiederherstellen')}</span>
      </button>
      <button type="button" className="base-btn primary-btn" onClick={onClose}>
        <span>{t('common.done', 'Fertig')}</span>
      </button>
    </>
  );

  if (isMobile) {
    return (
      <BottomSheet
        isOpen={isOpen}
        onClose={onClose}
        title={t('base.manageColumns') || 'Spalten verwalten'}
        footer={<div className="bottom-sheet-footer-actions">{columnsFooter}</div>}
      >
        {columnsBody}
      </BottomSheet>
    );
  }

  return (
    <div className="modal-backdrop base-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-container base-modal-container base-columns-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header base-modal-header">
          <div className="modal-title-cluster base-modal-title">
            <Columns size={18} className="modal-icon modal-title-icon" />
            <h2 className="modal-title">{t('base.manageColumns') || 'Spalten verwalten'}</h2>
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

        <div className="modal-body base-modal-body scroller">{columnsBody}</div>

        <div className="modal-footer base-modal-footer">{columnsFooter}</div>
      </div>
    </div>
  );
};
