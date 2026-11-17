import React, { useState, useRef, useEffect } from 'react';
import {
  Plus,
  Check,
  X,
  MoreVertical,
  Edit2,
  Trash2,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
} from 'lucide-react';
import type {
  BaseBoard2DColumn,
  BaseBoardSwimlaneRow as BaseBoardSwimlaneRowData,
} from '../../base/baseEngine';
import type { BoardColumnSortRule } from '../../base/baseConfig';
import { useTranslation } from '../../i18n';
import { BaseBoardCard } from './BaseBoardCard';
import { BottomSheet, useIsMobile } from '../BottomSheet';

export interface BaseBoardSwimlaneRowProps {
  lane: BaseBoardSwimlaneRowData;
  columns: BaseBoard2DColumn[];
  cardColumns: string[];
  displayNames: Record<string, string>;
  groupByProp: string;
  groupByDisplayName?: string;
  swimlaneProp: string;
  swimlaneDisplayName?: string;
  readOnly: boolean;
  dragOverCell: string | null;
  expandedCells: Record<string, boolean>;
  onToggleCellExpand: (cellKey: string) => void;
  onToggleCollapse: () => void;
  onAddCard: (columnValue: string, swimlaneValue?: string) => void;
  onRenameSwimlane?: (oldName: string, newName: string) => void;
  onDeleteSwimlane?: (laneName: string) => void;
  onDropOnCell: (e: React.DragEvent, colKey: string, laneKey: string) => void;
  onDragOverCell: (e: React.DragEvent, cellKey: string) => void;
  onDragLeaveCell: (e: React.DragEvent) => void;
  onSelectNote: (path: string) => void;
  draggingPath: string | null;
  onDragStart: (path: string) => void;
  onDragEnd: () => void;
  columnSortRules?: Record<string, BoardColumnSortRule | undefined>;
  onOpenSort?: (colKey: string, anchorEl: HTMLElement) => void;
  onOpenMoveSheet?: (record: BaseBoard2DColumn['records'] extends (infer R)[] ? R : any) => void;
}

export const BaseBoardSwimlaneRow: React.FC<BaseBoardSwimlaneRowProps> = ({
  lane,
  columns,
  cardColumns,
  displayNames,
  groupByProp,
  groupByDisplayName,
  swimlaneProp,
  swimlaneDisplayName,
  readOnly,
  dragOverCell,
  expandedCells,
  onToggleCellExpand,
  onToggleCollapse,
  onAddCard,
  onRenameSwimlane,
  onDeleteSwimlane,
  onDropOnCell,
  onDragOverCell,
  onDragLeaveCell,
  onSelectNote,
  draggingPath,
  onDragStart,
  onDragEnd,
  columnSortRules,
  onOpenSort,
  onOpenMoveSheet,
}) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const laneValue = lane.name || lane.label;
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(laneValue);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isEscapingRef = useRef(false);

  useEffect(() => {
    setDraftName(laneValue);
  }, [laneValue]);

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
      setDraftName(laneValue);
    }
  };

  const handleCancelRename = () => {
    isEscapingRef.current = true;
    setIsRenaming(false);
    setDraftName(laneValue);
  };

  const propName = swimlaneProp || 'Swimlane';
  const displayName = swimlaneDisplayName || propName;
  const colPropDisplayName = groupByDisplayName || groupByProp.toUpperCase();
  const headerLabel = lane.isUnassigned
    ? t('base.unassignedSwimlane', 'Keine Zuordnung')
    : `${displayName}: ${laneValue}`;

  return (
    <div
      className={`base-board-swimlane-band base-board-swimlane-row ${lane.collapsed ? 'is-collapsed' : 'is-expanded'}`}
      data-swimlane-key={lane.key}
    >
      {/* 1. Header Leiste (Row Bar) */}
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
              <span className="base-board-swimlane-prop-prefix">{displayName}:</span>
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
                title={t('common.confirm')}
              >
                <Check size={12} />
              </button>
              <button
                type="button"
                className="base-board-col-cancel-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleCancelRename}
                title={t('common.cancel')}
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <span className="base-board-swimlane-title">
              {lane.isUnassigned ? (
                <span className="base-board-swimlane-unassigned-label">{headerLabel}</span>
              ) : (
                <>
                  <span className="base-board-swimlane-prop-badge">{displayName}:</span>{' '}
                  <span className="base-board-swimlane-val-text">{laneValue}</span>
                </>
              )}
            </span>
          )}

          <span className="base-board-swimlane-count">
            ({isMobile && columns.length === 1 ? (lane.cells[columns[0].key]?.length ?? 0) : lane.totalCount})
          </span>
        </div>

        {!readOnly && (isMobile || !lane.isUnassigned) && (
          <div className="base-board-swimlane-actions">
            {isMobile && columns.length > 0 && (
              <button
                type="button"
                className="base-board-add-card-btn base-board-col-add-btn board-add-card-btn board-column-action-btn mobile-swimlane-add-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  const activeColKey = columns[0]?.key || '';
                  onAddCard(
                    activeColKey === 'no_status' ? '' : activeColKey,
                    lane.isUnassigned ? '' : lane.key
                  );
                }}
                title={t('base.addCard', 'Karte hinzufügen')}
                aria-label={`${t('base.addCard', 'Karte hinzufügen')} (${columns[0]?.label || ''} - ${laneValue})`}
              >
                <Plus size={14} />
              </button>
            )}
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
                aria-label={`Swimlane-Optionen (${headerLabel})`}
              >
                <MoreVertical size={13} />
              </button>

              {isMenuOpen && !isMobile && (
                <div
                  className="base-dropdown-menu col-dropdown"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="base-dropdown-item"
                    onClick={() => {
                      setIsMenuOpen(false);
                      setDraftName(laneValue);
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

              {isMenuOpen && isMobile && (
                <BottomSheet
                  isOpen={isMenuOpen}
                  onClose={() => setIsMenuOpen(false)}
                  title={headerLabel}
                >
                  <div className="bottom-sheet-section">
                    <button
                      type="button"
                      className="bottom-sheet-action-btn"
                      onClick={() => {
                        setIsMenuOpen(false);
                        setDraftName(laneValue);
                        setIsRenaming(true);
                      }}
                    >
                      <Edit2 size={16} />
                      <span>{t('base.renameSwimlane', 'Swimlane umbenennen')}</span>
                    </button>
                    <button
                      type="button"
                      className="bottom-sheet-action-btn danger"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onDeleteSwimlane?.(lane.key);
                      }}
                    >
                      <Trash2 size={16} />
                      <span>{t('base.removeSwimlane', 'Swimlane entfernen')}</span>
                    </button>
                  </div>
                </BottomSheet>
              )}
            </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Unified Column Cells Row (Rendered when !collapsed) */}
      {!lane.collapsed && (
        <div className="base-board-swimlane-cells-row">
          {columns.map((col) => {
            const cellKey = `${lane.key}::${col.key}`;
            const cellRecords = lane.cells[col.key] || [];
            const isExpanded = !!expandedCells[cellKey];
            const visibleCards = isExpanded ? cellRecords : cellRecords.slice(0, col.limit);
            const remainingCount = cellRecords.length - visibleCards.length;
            const isOver = dragOverCell === cellKey;
            const isEmpty = cellRecords.length === 0;

            return (
              <div
                key={col.key}
                className={`base-board-column base-board-swimlane-cell board-column board-swimlane-cell ${isOver ? 'drag-over' : ''} ${isEmpty ? 'is-empty' : ''}`}
                data-column-key={col.key}
                data-swimlane-key={lane.key}
                onDragOver={(e) => onDragOverCell(e, cellKey)}
                onDragLeave={onDragLeaveCell}
                onDrop={(e) => onDropOnCell(e, col.key, lane.key)}
              >
                {/* Integrated Column Header inside the box (Desktop only) */}
                {!isMobile && (
                <div className="base-board-column-header board-column-header">
                  <div className="base-board-column-title-cluster board-column-title-group board-column-title-wrap">
                    {col.color && (
                      <span
                        className="base-board-column-badge"
                        style={{ backgroundColor: col.color }}
                      />
                    )}
                    <span className="base-board-column-prop-badge board-column-prop-badge board-prop-badge">
                      {colPropDisplayName}:
                    </span>
                    <span className="base-board-column-title board-column-title board-column-name">
                      {col.label}
                    </span>
                    <span className="base-board-column-count board-column-count board-card-counter">
                      ({cellRecords.length})
                    </span>
                  </div>

                  {!readOnly && (
                    <div className="base-board-col-header-actions board-column-actions">
                      <button
                        type="button"
                        className={`base-board-col-sort-btn board-sort-btn board-column-action-btn ${columnSortRules?.[col.key] ? 'is-active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenSort?.(col.key, e.currentTarget);
                        }}
                        title={t('base.sortColumn', 'Karten sortieren')}
                        aria-label={`${t('base.sortColumn', 'Karten sortieren')} (${col.label})`}
                      >
                        <ArrowUpDown size={13} />
                      </button>

                      <button
                        type="button"
                        className="base-board-add-card-btn base-board-col-add-btn board-add-card-btn board-column-action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddCard(
                            col.key === 'no_status' ? '' : col.key,
                            lane.isUnassigned ? '' : lane.key
                          );
                        }}
                        title={t('base.addCard', 'Karte hinzufügen')}
                        aria-label={`${t('base.addCard', 'Karte hinzufügen')} (${col.label} - ${laneValue})`}
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  )}
                </div>
                )}

                {/* Cards list and drop area inside the same box */}
                <div className="base-board-cards-list base-board-swimlane-cards-list board-column-cards-container">
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
                      onOpenMoveSheet={onOpenMoveSheet}
                    />
                  ))}
                  {cellRecords.length === 0 && (
                    <div className="base-board-cell-empty-placeholder board-cell-empty-placeholder" />
                  )}
                </div>

                {/* Pagination show more / fewer */}
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
