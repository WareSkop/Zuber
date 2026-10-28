import React, { useState, useRef, useEffect } from 'react';
import {
  Plus,
  MoreVertical,
  Edit2,
  Trash2,
  ArrowDown,
  ArrowUp,
  Check,
  X,
} from 'lucide-react';
import type { BaseRecord } from '../../base/baseEngine';
import { BaseBoardCard } from './BaseBoardCard';
import { useTranslation } from '../../i18n';

export interface BaseBoardColumnData {
  key: string;
  label: string;
  records: BaseRecord[];
  limit: number;
  color?: string;
}

export interface BaseBoardColumnProps {
  col: BaseBoardColumnData;
  columns: string[];
  displayNames: Record<string, string>;
  groupByProp: string;
  readOnly?: boolean;
  isOver?: boolean;
  isExpanded?: boolean;
  onToggleExpand: () => void;
  onDrop: (e: React.DragEvent, colKey: string) => void;
  onDragOver: (e: React.DragEvent, colKey: string) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onAddCard?: (columnValue: string) => void;
  onRenameColumn?: (oldName: string, newName: string) => void;
  onDeleteColumn?: (columnName: string) => void;
  onSelectNote: (path: string) => void;
  draggingPath: string | null;
  onDragStart: (path: string) => void;
  onDragEnd: () => void;
  headerOnly?: boolean;
}

export const BaseBoardColumn: React.FC<BaseBoardColumnProps> = ({
  col,
  columns,
  displayNames,
  groupByProp,
  readOnly = false,
  isOver = false,
  isExpanded = false,
  onToggleExpand,
  onDrop,
  onDragOver,
  onDragLeave,
  onAddCard,
  onRenameColumn,
  onDeleteColumn,
  onSelectNote,
  draggingPath,
  onDragStart,
  onDragEnd,
  headerOnly = false,
}) => {
  const { t } = useTranslation();

  const [isRenaming, setIsRenaming] = useState(false);
  const [draftColName, setDraftColName] = useState(col.label);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isEscapingRef = useRef(false);

  // Sync draftColName when label changes externally
  useEffect(() => {
    setDraftColName(col.label);
  }, [col.label]);

  // Focus and select input text when entering rename mode
  useEffect(() => {
    if (isRenaming) {
      isEscapingRef.current = false;
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }
  }, [isRenaming]);

  // Close three-dot menu on click outside
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
    const trimmed = draftColName.trim();
    setIsRenaming(false);
    if (trimmed && trimmed !== col.key) {
      onRenameColumn?.(col.key, trimmed);
    } else {
      setDraftColName(col.label);
    }
  };

  const handleCancelRename = () => {
    isEscapingRef.current = true;
    setIsRenaming(false);
    setDraftColName(col.label);
  };

  const visibleCards = isExpanded ? col.records : col.records.slice(0, col.limit);
  const remainingCount = col.records.length - visibleCards.length;

  return (
    <div
      className={`base-board-column ${headerOnly ? 'base-board-column-header-only' : ''} ${isOver ? 'drag-over' : ''}`}
      onDragOver={(e) => onDragOver(e, col.key)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, col.key)}
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

          {isRenaming ? (
            <div className="base-board-col-edit-inline" onClick={(e) => e.stopPropagation()}>
              <input
                ref={inputRef}
                type="text"
                className="base-board-col-rename-input"
                value={draftColName}
                autoFocus
                onChange={(e) => setDraftColName(e.target.value)}
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
            <span className="base-board-column-title">
              {col.label}
            </span>
          )}

          <span className="base-board-column-count">({col.records.length})</span>
        </div>

        {!readOnly && (
          <div className="base-board-col-header-actions">
            <button
              type="button"
              className="base-board-add-card-btn"
              onClick={() => onAddCard?.(col.key === 'no_status' ? '' : col.key)}
              title={t('base.addCard', 'Karte hinzufügen')}
              aria-label={t('base.addCard', 'Karte hinzufügen')}
            >
              <Plus size={13} />
            </button>

            {col.key !== 'no_status' && (
              <div className="base-board-col-menu-wrapper" ref={menuRef}>
                <button
                  type="button"
                  className="base-board-col-menu-trigger"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsMenuOpen((prev) => !prev);
                  }}
                  title="Spalten-Optionen"
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
                        setDraftColName(col.label);
                        setIsRenaming(true);
                      }}
                    >
                      <Edit2 size={13} />
                      <span>{t('base.renameColumn', 'Spalte umbenennen')}</span>
                    </button>
                    <button
                      type="button"
                      className="base-dropdown-item danger"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onDeleteColumn?.(col.key);
                      }}
                    >
                      <Trash2 size={13} />
                      <span>{t('base.deleteColumn', 'Spalte entfernen')}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Column Drop Zone / Card List */}
      {!headerOnly && (
        <div className="base-board-cards-list">
          {visibleCards.map((rec) => (
            <BaseBoardCard
              key={rec.file.path}
              record={rec}
              columns={columns}
              displayNames={displayNames}
              groupByProp={groupByProp}
              readOnly={readOnly}
              isDragging={draggingPath === rec.file.path}
              onSelectNote={onSelectNote}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))}

          {/* Show More / Show Fewer Pagination Button */}
          {remainingCount > 0 && (
            <button
              type="button"
              className="base-board-show-more-btn"
              onClick={onToggleExpand}
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
              onClick={onToggleExpand}
            >
              <ArrowUp size={12} />
              <span>{t('base.showFewerCards', 'Weniger anzeigen')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
