import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Search, Target, X } from 'lucide-react';
import { useTranslation } from '../i18n';

export interface SendToTargetModalProps {
  isOpen: boolean;
  onClose: () => void;
  activePath: string | null;
  allNotes: Array<{
    path: string;
    name: string;
    basename: string;
    isSendTarget?: boolean;
  }>;
  onSelectTarget: (targetPath: string) => Promise<void> | void;
}

export const SendToTargetModal: React.FC<SendToTargetModalProps> = ({
  isOpen,
  onClose,
  activePath,
  allNotes,
  onSelectTarget,
}) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const hasAnyVaultSendTargets = useMemo(() => {
    return allNotes.some((n) => n.isSendTarget);
  }, [allNotes]);

  const candidateNotes = useMemo(() => {
    return allNotes.filter((n) => {
      if (!n.isSendTarget) return false;
      if (activePath && n.path === activePath) return false;
      return true;
    });
  }, [allNotes, activePath]);

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return candidateNotes;
    return candidateNotes.filter(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        n.basename.toLowerCase().includes(q) ||
        n.path.toLowerCase().includes(q)
    );
  }, [candidateNotes, searchQuery]);

  // Reset selection index when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  // Autofocus input on open
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedIndex(0);
      setIsSubmitting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>('.send-to-target-item.selected');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  const handleConfirm = async (targetPath: string) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSelectTarget(targetPath);
      onClose();
    } catch (err) {
      console.error('[SendToTargetModal] Error:', err);
      alert((err as Error).message || 'Fehler beim Senden an die Ziel-Notiz');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < filteredNotes.length - 1 ? prev + 1 : prev));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredNotes[selectedIndex]) {
        handleConfirm(filteredNotes[selectedIndex].path);
      }
    }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-box send-to-target-modal-box"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="modal-header">
          <div className="modal-header-title">
            <Target size={18} className="modal-icon send-target-header-icon" />
            <h3>{t('sendToTargetModal.title') || 'An Ziel-Notiz senden…'}</h3>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            title={t('common.close', { defaultValue: 'Schließen' })}
            aria-label={t('common.close', { defaultValue: 'Schließen' })}
          >
            <X size={16} />
          </button>
        </div>

        <div className="send-to-target-search-box">
          <Search size={15} className="search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="modal-input send-to-target-search-input"
            placeholder={
              t('sendToTargetModal.searchPlaceholder') || 'Ziel-Notiz suchen...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={isSubmitting}
          />
          {searchQuery && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setSearchQuery('')}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="send-to-target-list scroller" ref={listRef}>
          {!hasAnyVaultSendTargets ? (
            <div className="send-to-target-empty-state">
              <Target size={36} className="empty-target-icon" />
              <p className="empty-target-hint">
                {t('sendToTargetModal.noTargetsFound') ||
                  'Keine Ziel-Notizen gefunden. Rechtsklicke im Dateibaum auf eine Notiz und wähle ‚Als Sende-Ziel festlegen‘.'}
              </p>
            </div>
          ) : candidateNotes.length === 0 ? (
            <div className="send-to-target-empty-state">
              <Target size={36} className="empty-target-icon" />
              <p className="empty-target-hint">
                {t('sendToTargetModal.onlySelfIsTarget') ||
                  'Die aktuell geöffnete Notiz ist die einzige Ziel-Notiz. Bitte lege eine weitere Notiz als Ziel fest.'}
              </p>
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="send-to-target-empty-state">
              <Search size={32} className="empty-search-icon" />
              <p className="empty-search-hint">
                {t('sendToTargetModal.noMatchingTargets') ||
                  'Keine passenden Ziel-Notizen gefunden.'}
              </p>
            </div>
          ) : (
            filteredNotes.map((note, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={note.path}
                  className={`send-to-target-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleConfirm(note.path)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <span className="send-to-target-item-icon">
                    <Target size={15} className="send-target-icon" />
                  </span>
                  <div className="send-to-target-item-info">
                    <span className="send-to-target-item-name">{note.basename || note.name}</span>
                    <span className="send-to-target-item-path">{note.path}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="modal-actions send-to-target-actions">
          <button
            type="button"
            className="modal-btn modal-btn-secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {t('common.cancel', { defaultValue: 'Abbrechen' })}
          </button>
          <button
            type="button"
            className="modal-btn modal-btn-primary"
            disabled={filteredNotes.length === 0 || isSubmitting}
            onClick={() => {
              if (filteredNotes[selectedIndex]) {
                handleConfirm(filteredNotes[selectedIndex].path);
              }
            }}
          >
            {isSubmitting
              ? t('sendToTargetModal.sending') || 'Wird gesendet...'
              : t('common.confirm') || 'Senden'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
