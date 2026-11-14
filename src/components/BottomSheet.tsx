import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
  maxHeight?: string; // default '85dvh'
  children: React.ReactNode;
}

// ── Mobile Viewport Hook (< 768px) ───────────────────────────────────────────

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isMobile;
}

// ── Android Hardware / Gesture Back Handler (LIFO Stack) ─────────────────────

interface BackHandlerEntry {
  id: number;
  onClose: () => void;
}

const backHandlerStack: BackHandlerEntry[] = [];
let nextBackHandlerId = 1;
let ignoreNextPopstateCount = 0;
let popstateListenerAttached = false;

export function __resetMobileBackHandlerForTests(): void {
  backHandlerStack.length = 0;
  ignoreNextPopstateCount = 0;
}

function ensurePopstateListener(): void {
  if (popstateListenerAttached || typeof window === 'undefined') return;
  popstateListenerAttached = true;

  window.addEventListener('popstate', () => {
    if (ignoreNextPopstateCount > 0) {
      ignoreNextPopstateCount -= 1;
      return;
    }

    const top = backHandlerStack.pop();
    if (top) {
      top.onClose();
    }
  });
}

/**
 * Registers an open mobile overlay (BottomSheet, mobile drawer, etc.) with
 * browser history (`pushState` / `popstate`) so the Android system Back
 * gesture/button closes the topmost open layer instead of exiting the PWA.
 */
export function useMobileBackHandler(isOpen: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;

    ensurePopstateListener();

    const entryId = nextBackHandlerId++;
    const entry: BackHandlerEntry = {
      id: entryId,
      onClose: () => onCloseRef.current(),
    };

    backHandlerStack.push(entry);

    try {
      window.history.pushState({ zuberMobileOverlay: entryId }, '');
    } catch {
      // Ignore history errors in restricted contexts
    }

    return () => {
      const idx = backHandlerStack.findIndex((item) => item.id === entryId);
      if (idx !== -1) {
        // Closed via UI (backdrop tap, close button, swipe-down) rather than popstate:
        // pop the synthetic history entry cleanly without triggering another close.
        backHandlerStack.splice(idx, 1);
        ignoreNextPopstateCount += 1;
        try {
          window.history.back();
        } catch {
          ignoreNextPopstateCount = Math.max(0, ignoreNextPopstateCount - 1);
        }
      }
    };
  }, [isOpen]);
}

// ── BottomSheet Component ────────────────────────────────────────────────────

export const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  headerActions,
  footer,
  maxHeight = '85dvh',
  children,
}) => {
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartYRef = useRef<number | null>(null);
  const dragOffsetRef = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useMobileBackHandler(isOpen, onClose);

  useEffect(() => {
    if (!isOpen) {
      setDragOffsetY(0);
      setIsDragging(false);
      dragStartYRef.current = null;
      dragOffsetRef.current = 0;
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen || typeof document === 'undefined') {
    return null;
  }

  const handleHeaderTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    dragStartYRef.current = e.touches[0].clientY;
    dragOffsetRef.current = 0;
    setIsDragging(true);
  };

  const handleHeaderTouchMove = (e: React.TouchEvent) => {
    if (dragStartYRef.current === null || e.touches.length !== 1) return;
    const deltaY = e.touches[0].clientY - dragStartYRef.current;
    if (deltaY > 0) {
      dragOffsetRef.current = deltaY;
      setDragOffsetY(deltaY);
    } else {
      dragOffsetRef.current = 0;
      setDragOffsetY(0);
    }
  };

  const handleHeaderTouchEnd = () => {
    if (dragStartYRef.current === null) return;
    const finalDeltaY = dragOffsetRef.current;
    dragStartYRef.current = null;
    dragOffsetRef.current = 0;
    setIsDragging(false);
    setDragOffsetY(0);

    if (finalDeltaY > 60) {
      onClose();
    }
  };

  return createPortal(
    <div
      className="bottom-sheet-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Bottom sheet'}
    >
      <div
        className={`bottom-sheet-container ${isDragging ? 'is-dragging' : ''}`}
        style={{
          maxHeight,
          transform: dragOffsetY > 0 ? `translateY(${dragOffsetY}px)` : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag Handle + Optional Header */}
        <div
          className="bottom-sheet-drag-zone"
          onTouchStart={handleHeaderTouchStart}
          onTouchMove={handleHeaderTouchMove}
          onTouchEnd={handleHeaderTouchEnd}
          onTouchCancel={handleHeaderTouchEnd}
        >
          <div className="bottom-sheet-handle-bar" aria-hidden="true">
            <span className="bottom-sheet-handle-pill" />
          </div>

          {(title || headerActions) && (
            <div className="bottom-sheet-header">
              <div className="bottom-sheet-title">{title}</div>
              <div className="bottom-sheet-header-actions">
                {headerActions}
                <button
                  type="button"
                  className="bottom-sheet-close-btn"
                  onClick={onClose}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Scrollable Body */}
        <div className="bottom-sheet-body scroller">{children}</div>

        {/* Optional Pinned Footer */}
        {footer && <div className="bottom-sheet-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
};
