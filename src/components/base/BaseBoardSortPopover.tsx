import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, ArrowDown, X, RotateCcw, Check } from 'lucide-react';
import type { BoardColumnSortRule } from '../../base/baseConfig';
import { useTranslation } from '../../i18n';
import { BottomSheet, useIsMobile } from '../BottomSheet';

export interface BaseBoardSortPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  anchorEl: HTMLElement | null;
  currentSort?: BoardColumnSortRule;
  onApplySort: (sortRule?: BoardColumnSortRule) => void;
  columnName?: string;
  cardProperties?: string[];
  propertyDisplayNames?: Record<string, string>;
}

export const BaseBoardSortPopover: React.FC<BaseBoardSortPopoverProps> = ({
  isOpen,
  onClose,
  anchorEl,
  currentSort,
  onApplySort,
  columnName,
  cardProperties = [],
  propertyDisplayNames = {},
}) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const popoverRef = useRef<HTMLDivElement>(null);

  // 1. Local state hooks
  const [selectedProperty, setSelectedProperty] = useState<string>(
    currentSort?.property || 'file.name'
  );
  const [selectedDirection, setSelectedDirection] = useState<'asc' | 'desc'>(
    currentSort?.direction || 'asc'
  );

  // Position calculation with window boundary clamping
  const [coords, setCoords] = useState<{ top: number; left: number }>(() => {
    if (!anchorEl || typeof window === 'undefined') return { top: 0, left: 0 };
    const rect = anchorEl.getBoundingClientRect();
    const popoverWidth = 270;
    let left = rect.left;
    if (left + popoverWidth > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - popoverWidth - 12);
    }
    return { top: rect.bottom + 6, left };
  });

  // 2. Synchronize state when currentSort changes externally
  useEffect(() => {
    setSelectedProperty(currentSort?.property || 'file.name');
    setSelectedDirection(currentSort?.direction || 'asc');
  }, [currentSort?.property, currentSort?.direction]);

  // 3. Update popover position when anchor element changes or window resizes/scrolls
  useEffect(() => {
    if (!anchorEl || typeof window === 'undefined') return;

    const updatePosition = () => {
      const rect = anchorEl.getBoundingClientRect();
      const popoverWidth = 270;
      let left = rect.left;

      if (left + popoverWidth > window.innerWidth - 12) {
        left = Math.max(12, window.innerWidth - popoverWidth - 12);
      }
      setCoords({ top: rect.bottom + 6, left });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorEl]);

  // 4. Handle click outside and Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        (!anchorEl || !anchorEl.contains(target))
      ) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, anchorEl]);

  // 5. Available sorting property options
  const propertyOptions = useMemo(() => {
    const list: { key: string; label: string }[] = [
      { key: 'file.name', label: t('base.sortByName', 'Name') },
      { key: 'file.ctime', label: t('base.sortByCreated', 'Erstelldatum') },
    ];

    const isDuplicate = (p: string) => {
      const lower = p.toLowerCase();
      return (
        lower === 'file.name' ||
        lower === 'name' ||
        lower === 'file.ctime' ||
        lower === 'ctime' ||
        lower === 'created'
      );
    };

    for (const prop of cardProperties) {
      if (!isDuplicate(prop)) {
        const label = propertyDisplayNames[prop] || prop;
        list.push({ key: prop, label });
      }
    }

    return list;
  }, [cardProperties, propertyDisplayNames, t]);

  // 6. Action callbacks
  const handlePropertyChange = useCallback(
    (newProp: string) => {
      setSelectedProperty(newProp);
      onApplySort({
        property: newProp,
        direction: selectedDirection,
      });
    },
    [onApplySort, selectedDirection]
  );

  const handleDirectionChange = useCallback(
    (newDir: 'asc' | 'desc') => {
      setSelectedDirection(newDir);
      onApplySort({
        property: selectedProperty,
        direction: newDir,
      });
    },
    [onApplySort, selectedProperty]
  );

  const handleResetSort = useCallback(() => {
    onApplySort(undefined);
    onClose();
  }, [onApplySort, onClose]);

  // Early return MUST happen ONLY AFTER all hooks have executed
  if (!isOpen) return null;

  if (isMobile) {
    const sheetTitle = `${t('base.sortBy', 'Sortieren nach')}${columnName ? ` (${columnName})` : ''}`;
    return (
      <BottomSheet isOpen={isOpen} onClose={onClose} title={sheetTitle}>
        <div className="bottom-sheet-section">
          <div className="bottom-sheet-direction-row">
            <button
              type="button"
              className={`bottom-sheet-action-btn bottom-sheet-dir-btn board-sort-dir-asc ${selectedDirection === 'asc' ? 'is-active' : ''}`}
              onClick={() => handleDirectionChange('asc')}
              aria-label="↑ (A-Z)"
            >
              <ArrowUp size={16} />
              <span>↑ (A-Z)</span>
            </button>
            <button
              type="button"
              className={`bottom-sheet-action-btn bottom-sheet-dir-btn board-sort-dir-desc ${selectedDirection === 'desc' ? 'is-active' : ''}`}
              onClick={() => handleDirectionChange('desc')}
              aria-label="↓ (Z-A)"
            >
              <ArrowDown size={16} />
              <span>↓ (Z-A)</span>
            </button>
          </div>
        </div>

        <div className="bottom-sheet-section">
          {propertyOptions.map((opt) => {
            const isSelected = selectedProperty === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                className={`bottom-sheet-action-btn ${isSelected ? 'is-active' : ''}`}
                onClick={() => handlePropertyChange(opt.key)}
              >
                <span className="bottom-sheet-action-label">{opt.label}</span>
                {isSelected && <Check size={16} className="bottom-sheet-check-icon" />}
              </button>
            );
          })}
        </div>

        {currentSort && (
          <div className="bottom-sheet-section">
            <button
              type="button"
              className="bottom-sheet-action-btn danger"
              onClick={handleResetSort}
            >
              <RotateCcw size={16} />
              <span>{t('base.clearSort', 'Sortierung zurücksetzen')}</span>
            </button>
          </div>
        )}
      </BottomSheet>
    );
  }

  return createPortal(
    <div
      ref={popoverRef}
      className="base-board-sort-popover board-sort-popover"
      style={{
        position: 'fixed',
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        zIndex: 9999,
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t('base.sortColumn', 'Karten sortieren')}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="base-board-sort-popover-header">
        <span className="base-board-sort-popover-title">
          {t('base.sortBy', 'Sortieren nach')}
          {columnName ? ` (${columnName})` : ''}
        </span>
        <button
          type="button"
          className="base-board-sort-close-btn"
          onClick={onClose}
          aria-label={t('common.close', 'Schließen')}
        >
          <X size={13} />
        </button>
      </div>

      {/* Property Selector */}
      <div className="base-board-sort-field">
        <label htmlFor="board-sort-property-select" className="base-board-sort-label">
          {t('base.sortBy', 'Sortieren nach')}:
        </label>
        <select
          id="board-sort-property-select"
          className="base-board-sort-select board-sort-select"
          value={selectedProperty}
          onChange={(e) => handlePropertyChange(e.target.value)}
        >
          {propertyOptions.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Compact Direction Segmented Control */}
      <div className="base-board-sort-direction-group">
        <button
          type="button"
          className={`base-board-sort-dir-btn board-sort-dir-asc ${selectedDirection === 'asc' ? 'is-active' : ''}`}
          onClick={() => handleDirectionChange('asc')}
          title="↑ (A-Z)"
          aria-label="↑ (A-Z)"
        >
          <ArrowUp size={12} />
          <span>(A-Z)</span>
        </button>
        <button
          type="button"
          className={`base-board-sort-dir-btn board-sort-dir-desc ${selectedDirection === 'desc' ? 'is-active' : ''}`}
          onClick={() => handleDirectionChange('desc')}
          title="↓ (Z-A)"
          aria-label="↓ (Z-A)"
        >
          <ArrowDown size={12} />
          <span>(Z-A)</span>
        </button>
      </div>

      {/* Reset Sort Button */}
      {currentSort && (
        <button
          type="button"
          className="base-board-sort-reset-btn board-sort-reset-btn"
          onClick={handleResetSort}
        >
          <RotateCcw size={11} />
          <span>{t('base.clearSort', 'Sortierung zurücksetzen')}</span>
        </button>
      )}
    </div>,
    document.body
  );
};
