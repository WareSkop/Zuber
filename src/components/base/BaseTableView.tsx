import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Plus,
  MoreHorizontal,
  Edit2,
  EyeOff,
  GripVertical,
  Check,
  FileText,
  Calendar,
  Tag,
} from 'lucide-react';
import type { BaseQueryResult, BaseRecord } from '../../base/baseEngine';
import { getPropertyValue } from '../../base/baseEngine';
import { useTranslation } from '../../i18n';

export interface BaseTableViewProps {
  queryResult: BaseQueryResult;
  onSelectNote?: (path: string) => void;
  onCellChange?: (notePath: string, key: string, value: any) => Promise<void>;
  readOnly?: boolean;
  columnSizes: Record<string, number>;
  onColumnResize: (col: string, newWidth: number) => void;
  onColumnReorder: (newOrder: string[]) => void;
  onColumnHide: (col: string) => void;
  onColumnDisplayNameChange: (col: string, newName: string) => void;
  onColumnSort: (col: string, direction: 'asc' | 'desc') => void;
  availablePropertiesToAdd: { key: string; label: string }[];
  onAddColumn: (col: string) => void;
}

export const BaseTableView: React.FC<BaseTableViewProps> = ({
  queryResult,
  onSelectNote,
  onCellChange,
  readOnly = false,
  columnSizes,
  onColumnResize,
  onColumnReorder,
  onColumnHide,
  onColumnDisplayNameChange,
  onColumnSort,
  availablePropertiesToAdd,
  onAddColumn,
}) => {
  const { t } = useTranslation();

  // Resize state
  const [resizingCol, setResizingCol] = useState<{ col: string; startX: number; startWidth: number } | null>(null);
  const [liveColWidths, setLiveColWidths] = useState<Record<string, number>>({});

  // Drag & drop column reordering state
  const [draggedCol, setDraggedCol] = useState<string | null>(null);
  const [dropTargetCol, setDropTargetCol] = useState<string | null>(null);

  // Column header dropdown menu state
  const [headerMenuCol, setHeaderMenuCol] = useState<string | null>(null);
  const [editingDisplayNameCol, setEditingDisplayNameCol] = useState<string | null>(null);
  const [draftDisplayName, setDraftDisplayName] = useState('');

  // Add column dropdown state
  const [isAddColumnDropdownOpen, setIsAddColumnDropdownOpen] = useState(false);

  // Cell editing state
  const [editingCell, setEditingCell] = useState<{ recordPath: string; column: string } | null>(null);
  const [cellDraftValue, setCellDraftValue] = useState<string>('');

  const tableRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (tableRef.current && !tableRef.current.contains(e.target as Node)) {
        setHeaderMenuCol(null);
        setIsAddColumnDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Resize drag listener
  useEffect(() => {
    if (!resizingCol) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - resizingCol.startX;
      const newWidth = Math.max(60, resizingCol.startWidth + deltaX);
      setLiveColWidths((prev) => ({
        ...prev,
        [resizingCol.col]: newWidth,
      }));
    };

    const handleMouseUp = () => {
      const finalWidth = liveColWidths[resizingCol.col] || resizingCol.startWidth;
      onColumnResize(resizingCol.col, Math.round(finalWidth));
      setResizingCol(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingCol, liveColWidths, onColumnResize]);

  const handleResizeStart = (e: React.MouseEvent, col: string) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).closest('th');
    const startWidth = th ? th.getBoundingClientRect().width : columnSizes[col] || 150;
    setResizingCol({
      col,
      startX: e.clientX,
      startWidth,
    });
  };

  const handleDragStart = (e: React.DragEvent, col: string) => {
    if (resizingCol) {
      e.preventDefault();
      return;
    }
    setDraggedCol(col);
    e.dataTransfer.setData('text/plain', col);
  };

  const handleDragOver = (e: React.DragEvent, col: string) => {
    e.preventDefault();
    if (draggedCol && draggedCol !== col) {
      setDropTargetCol(col);
    }
  };

  const handleDrop = (e: React.DragEvent, targetCol: string) => {
    e.preventDefault();
    if (!draggedCol || draggedCol === targetCol) {
      setDraggedCol(null);
      setDropTargetCol(null);
      return;
    }

    const currentOrder = [...queryResult.columns];
    const fromIdx = currentOrder.indexOf(draggedCol);
    const toIdx = currentOrder.indexOf(targetCol);

    if (fromIdx >= 0 && toIdx >= 0) {
      currentOrder.splice(fromIdx, 1);
      currentOrder.splice(toIdx, 0, draggedCol);
      onColumnReorder(currentOrder);
    }

    setDraggedCol(null);
    setDropTargetCol(null);
  };

  const handleStartRename = (col: string, curDisplay: string) => {
    setHeaderMenuCol(null);
    setEditingDisplayNameCol(col);
    setDraftDisplayName(curDisplay);
  };

  const handleCommitRename = (col: string) => {
    if (draftDisplayName.trim()) {
      onColumnDisplayNameChange(col, draftDisplayName.trim());
    }
    setEditingDisplayNameCol(null);
  };

  const handleCellBlur = async (rec: BaseRecord, col: string) => {
    if (readOnly) {
      setEditingCell(null);
      return;
    }
    const oldVal = getPropertyValue(rec, col);
    let newVal: any = cellDraftValue;
    if (typeof oldVal === 'number' && !isNaN(Number(cellDraftValue))) {
      newVal = Number(cellDraftValue);
    }
    setEditingCell(null);
    if (newVal !== oldVal && onCellChange) {
      await onCellChange(rec.file.path, col, newVal);
    }
  };

  const handleCheckboxToggle = async (rec: BaseRecord, col: string, curVal: boolean) => {
    if (readOnly || !onCellChange) return;
    await onCellChange(rec.file.path, col, !curVal);
  };

  return (
    <div className="base-table-wrapper scroller" ref={tableRef}>
      {queryResult.groups.map((group) => (
        <div key={group.key} className="base-group-section">
          {queryResult.groups.length > 1 && (
            <div className="base-group-header">
              <span className="base-group-title">{group.label}</span>
              <span className="base-group-count">({group.records.length})</span>
            </div>
          )}

          <table className="base-table">
            <thead>
              <tr>
                {queryResult.columns.map((col) => {
                  const displayName = queryResult.columnDisplayNames[col] || col;
                  const activeSort = queryResult.view.sort?.find((s) => s.property === col);
                  const width = liveColWidths[col] || columnSizes[col];
                  const isRenaming = editingDisplayNameCol === col;
                  const isDropTarget = dropTargetCol === col;
                  const isDragging = draggedCol === col;

                  return (
                    <th
                      key={col}
                      style={width ? { width: `${width}px`, minWidth: `${width}px` } : undefined}
                      className={`${activeSort ? 'sorted' : ''} ${isDropTarget ? 'drop-target' : ''} ${isDragging ? 'is-dragging' : ''}`}
                      draggable={!isRenaming}
                      onDragStart={(e) => handleDragStart(e, col)}
                      onDragOver={(e) => handleDragOver(e, col)}
                      onDrop={(e) => handleDrop(e, col)}
                    >
                      <div className="base-th-content">
                        {isRenaming ? (
                          <input
                            type="text"
                            className="base-th-rename-input"
                            value={draftDisplayName}
                            autoFocus
                            onChange={(e) => setDraftDisplayName(e.target.value)}
                            onBlur={() => handleCommitRename(col)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleCommitRename(col);
                              if (e.key === 'Escape') setEditingDisplayNameCol(null);
                            }}
                          />
                        ) : (
                          <span
                            className="base-th-title"
                            title={col}
                            onClick={() => {
                              const nextDir = activeSort?.direction === 'asc' ? 'desc' : 'asc';
                              onColumnSort(col, nextDir);
                            }}
                          >
                            {displayName}
                          </span>
                        )}

                        {activeSort && (
                          <span className="base-sort-badge">
                            {activeSort.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                          </span>
                        )}

                        {/* Column Header Dropdown Menu (⋯) */}
                        <div className="base-th-menu-wrapper">
                          <button
                            type="button"
                            className="base-th-menu-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setHeaderMenuCol(headerMenuCol === col ? null : col);
                            }}
                            title="Spalten-Optionen"
                          >
                            <MoreHorizontal size={13} />
                          </button>

                          {headerMenuCol === col && (
                            <div className="base-dropdown-menu header-menu">
                              <button
                                type="button"
                                className="base-dropdown-item"
                                onClick={() => handleStartRename(col, displayName)}
                              >
                                <Edit2 size={13} />
                                <span>Anzeigename ändern</span>
                              </button>
                              <button
                                type="button"
                                className="base-dropdown-item"
                                onClick={() => {
                                  onColumnSort(col, 'asc');
                                  setHeaderMenuCol(null);
                                }}
                              >
                                <ArrowUp size={13} />
                                <span>Aufsteigend sortieren (A-Z)</span>
                              </button>
                              <button
                                type="button"
                                className="base-dropdown-item"
                                onClick={() => {
                                  onColumnSort(col, 'desc');
                                  setHeaderMenuCol(null);
                                }}
                              >
                                <ArrowDown size={13} />
                                <span>Absteigend sortieren (Z-A)</span>
                              </button>
                              {col !== 'file.name' && (
                                <button
                                  type="button"
                                  className="base-dropdown-item danger"
                                  onClick={() => {
                                    onColumnHide(col);
                                    setHeaderMenuCol(null);
                                  }}
                                >
                                  <EyeOff size={13} />
                                  <span>Spalte ausblenden</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Resizer Handle */}
                      <div
                        className="col-resize-handle"
                        onMouseDown={(e) => handleResizeStart(e, col)}
                        title="Ziehen zum Ändern der Spaltenbreite"
                      />
                    </th>
                  );
                })}

                {/* + Add Column Header Button */}
                <th className="base-add-column-th">
                  <div className="base-add-column-wrapper">
                    <button
                      type="button"
                      className="base-add-col-btn"
                      onClick={() => setIsAddColumnDropdownOpen((o) => !o)}
                      title="Spalte hinzufügen"
                    >
                      <Plus size={14} />
                    </button>

                    {isAddColumnDropdownOpen && (
                      <div className="base-dropdown-menu add-column-dropdown">
                        <div className="dropdown-header-title">Spalte hinzufügen</div>
                        {availablePropertiesToAdd.length === 0 ? (
                          <div className="dropdown-empty-item">Alle Eigenschaften sichtbar</div>
                        ) : (
                          availablePropertiesToAdd.map((p) => (
                            <button
                              key={p.key}
                              type="button"
                              className="base-dropdown-item"
                              onClick={() => {
                                onAddColumn(p.key);
                                setIsAddColumnDropdownOpen(false);
                              }}
                            >
                              <Plus size={13} />
                              <span>{p.label}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </th>
              </tr>
            </thead>

            <tbody>
              {group.records.map((rec) => (
                <tr key={rec.file.path}>
                  {queryResult.columns.map((col) => {
                    const val = getPropertyValue(rec, col);
                    const isEditing = editingCell?.recordPath === rec.file.path && editingCell?.column === col;
                    const isFormula = col.startsWith('formula.');

                    // 1. file.name column
                    if (col === 'file.name') {
                      return (
                        <td key={col} className="base-col-name">
                          <div
                            className="base-name-link"
                            onClick={() => onSelectNote?.(rec.file.path)}
                            title={rec.file.path}
                          >
                            <FileText size={14} className="base-row-icon" />
                            <span className="base-name-text">{rec.file.name.replace(/\.md$/i, '')}</span>
                          </div>
                        </td>
                      );
                    }

                    // 2. file.folder column
                    if (col === 'file.folder') {
                      return (
                        <td key={col} className="base-col-folder">
                          <span className="base-folder-text">{rec.file.folder || '/'}</span>
                        </td>
                      );
                    }

                    // 3. tags column
                    if (col === 'tags') {
                      return (
                        <td key={col} className="base-col-tags">
                          {rec.tags.map((t) => (
                            <span key={t} className="base-tag-pill">
                              #{t}
                            </span>
                          ))}
                        </td>
                      );
                    }

                    // 4. Checkbox / Boolean property
                    if (typeof val === 'boolean') {
                      return (
                        <td key={col} className="base-col-bool">
                          <input
                            type="checkbox"
                            checked={val}
                            disabled={readOnly || isFormula}
                            onChange={() => handleCheckboxToggle(rec, col, val)}
                            className="base-cell-checkbox"
                          />
                        </td>
                      );
                    }

                    // 5. Editing Cell Input
                    if (isEditing) {
                      return (
                        <td key={col} className="base-col-cell editing">
                          <input
                            type="text"
                            className="base-cell-input"
                            value={cellDraftValue}
                            autoFocus
                            onChange={(e) => setCellDraftValue(e.target.value)}
                            onBlur={() => handleCellBlur(rec, col)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleCellBlur(rec, col);
                              if (e.key === 'Escape') setEditingCell(null);
                            }}
                          />
                        </td>
                      );
                    }

                    // 6. Normal Editable Cell
                    return (
                      <td
                        key={col}
                        className={`base-col-cell ${!readOnly && !isFormula ? 'editable' : ''}`}
                        onClick={() => {
                          if (!readOnly && !isFormula) {
                            setEditingCell({ recordPath: rec.file.path, column: col });
                            setCellDraftValue(val === undefined || val === null ? '' : String(val));
                          }
                        }}
                      >
                        <span className="base-cell-text">
                          {val === undefined || val === null || val === '' ? (
                            <span className="base-cell-empty">—</span>
                          ) : Array.isArray(val) ? (
                            val.join(', ')
                          ) : (
                            String(val)
                          )}
                        </span>
                      </td>
                    );
                  })}
                  {/* Empty cell under add-column header */}
                  <td className="base-add-column-td" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
};
