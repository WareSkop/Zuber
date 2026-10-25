import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Copy,
  Download,
  Upload,
  X,
} from 'lucide-react';
import {
  syncEngine,
  isFastForwardCompatible,
  type ConflictItem,
  type ConflictResolution,
} from '../sync/syncEngine';
import { toNormalizedServerTime } from '../api';
import { useTranslation } from '../i18n';

interface ConflictModalProps {
  conflicts: ConflictItem[];
  onClose: () => void;
}

export const ConflictModal: React.FC<ConflictModalProps> = ({ conflicts, onClose }) => {
  const { t, language } = useTranslation();
  const [applyToAll, setApplyToAll] = useState(false);
  const [resolving, setResolving] = useState(false);

  if (conflicts.length === 0) return null;

  const currentConflict = conflicts[0];
  const remainingCount = conflicts.length - 1;

  // Auto-resolve any fast-forward compatible conflicts seamlessly without interrupting the user
  useEffect(() => {
    if (conflicts.length > 0) {
      const current = conflicts[0];
      const ff = isFastForwardCompatible(current.localBody, current.serverNote.body);
      if (ff.compatible) {
        handleResolve(ff.winner === 'local' ? 'keep_local' : 'keep_server');
      }
    }
  }, [conflicts]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString(language === 'de' ? 'de-DE' : 'en-US', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const handleResolve = async (strategy: ConflictResolution) => {
    setResolving(true);
    try {
      if (applyToAll) {
        await syncEngine.resolveAllConflicts(strategy);
      } else {
        await syncEngine.resolveConflict(currentConflict.id, strategy);
      }
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="conflict-modal">
        <div className="conflict-header">
          <div className="conflict-header-title">
            <AlertTriangle size={20} className="conflict-warning-icon" />
            <div>
              <h3>{t('conflict.title')}</h3>
              <span className="conflict-path-label">{currentConflict.path}</span>
            </div>
          </div>
          <button type="button" className="settings-close-btn" onClick={onClose} title={t('conflict.resolveLater')}>
            <X size={18} />
          </button>
        </div>

        <p className="conflict-explanation">
          {t('conflict.explanation')}
        </p>

        <div className="conflict-comparison-grid">
          {/* Local Version */}
          <div className="conflict-pane local-pane">
            <div className="pane-header">
              <Upload size={15} />
              <span>{t('conflict.localVersion')}</span>
              <span className="pane-time">{formatDate(toNormalizedServerTime(currentConflict.localTimestamp))}</span>
            </div>
            <pre className="pane-content scroller">{currentConflict.localBody}</pre>
          </div>

          {/* Server Version */}
          <div className="conflict-pane server-pane">
            <div className="pane-header">
              <Download size={15} />
              <span>{t('conflict.serverVersion')}</span>
              <span className="pane-time">{formatDate(currentConflict.serverNote.updatedAt)}</span>
            </div>
            <pre className="pane-content scroller">{currentConflict.serverNote.body}</pre>
          </div>
        </div>

        {remainingCount > 0 && (
          <div className="conflict-batch-option">
            <label className="batch-checkbox-label">
              <input
                type="checkbox"
                checked={applyToAll}
                onChange={(e) => setApplyToAll(e.target.checked)}
              />
              <span>{t('conflict.applyToAll', { count: remainingCount })}</span>
            </label>
          </div>
        )}

        <div className="conflict-actions-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => handleResolve('keep_server')}
            disabled={resolving}
          >
            <Download size={15} />
            <span>{t('conflict.keepServer')}</span>
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => handleResolve('keep_both')}
            disabled={resolving}
          >
            <Copy size={15} />
            <span>{t('conflict.keepBoth')}</span>
          </button>

          <button
            type="button"
            className="btn-primary"
            onClick={() => handleResolve('keep_local')}
            disabled={resolving}
          >
            <Upload size={15} />
            <span>{t('conflict.keepLocal')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
