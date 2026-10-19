import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  History,
  X,
  RotateCcw,
  GitCommit as GitCommitIcon,
  Check,
  AlertCircle,
  FileText,
  Clock,
  User,
  GitBranch,
} from 'lucide-react';
import type { GitFileCommit, GitFileVersionResponse, NoteData } from '../../shared/types';
import { api } from '../api';
import { useTranslation } from '../i18n';

export interface VersionHistoryModalProps {
  filePath: string | null;
  isOpen: boolean;
  onClose: () => void;
  onRestore: (restoredNote: NoteData) => void;
}

export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const normOld = (oldText ?? '').replace(/\r\n/g, '\n');
  const normNew = (newText ?? '').replace(/\r\n/g, '\n');

  if (normOld === normNew) {
    if (normOld.length === 0) return [];
    return normOld.split('\n').map((line, idx) => ({
      type: 'unchanged',
      oldLineNumber: idx + 1,
      newLineNumber: idx + 1,
      content: line,
    }));
  }

  const oldLines = normOld.length > 0 ? normOld.split('\n') : [];
  const newLines = normNew.length > 0 ? normNew.split('\n') : [];

  if (oldLines.length === 0) {
    return newLines.map((line, idx) => ({
      type: 'added',
      newLineNumber: idx + 1,
      content: line,
    }));
  }

  if (newLines.length === 0) {
    return oldLines.map((line, idx) => ({
      type: 'removed',
      oldLineNumber: idx + 1,
      content: line,
    }));
  }

  // 1. Common prefix
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }

  // 2. Common suffix
  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--;
    newEnd--;
  }

  const result: DiffLine[] = [];
  let oldLineNo = 1;
  let newLineNo = 1;

  for (let i = 0; i < start; i++) {
    result.push({
      type: 'unchanged',
      oldLineNumber: oldLineNo++,
      newLineNumber: newLineNo++,
      content: oldLines[i],
    });
  }

  const midOld = oldLines.slice(start, oldEnd + 1);
  const midNew = newLines.slice(start, newEnd + 1);

  if (midOld.length * midNew.length > 600_000) {
    for (const line of midOld) {
      result.push({ type: 'removed', oldLineNumber: oldLineNo++, content: line });
    }
    for (const line of midNew) {
      result.push({ type: 'added', newLineNumber: newLineNo++, content: line });
    }
  } else {
    const dp = Array.from({ length: midOld.length + 1 }, () => new Int32Array(midNew.length + 1));
    for (let i = 0; i < midOld.length; i++) {
      for (let j = 0; j < midNew.length; j++) {
        if (midOld[i] === midNew[j]) {
          dp[i + 1][j + 1] = dp[i][j] + 1;
        } else {
          dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }

    let i = midOld.length;
    let j = midNew.length;
    const middleOps: { type: 'added' | 'removed' | 'unchanged'; content: string }[] = [];

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && midOld[i - 1] === midNew[j - 1]) {
        middleOps.push({ type: 'unchanged', content: midOld[i - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        middleOps.push({ type: 'added', content: midNew[j - 1] });
        j--;
      } else if (i > 0) {
        middleOps.push({ type: 'removed', content: midOld[i - 1] });
        i--;
      }
    }
    middleOps.reverse();

    for (const op of middleOps) {
      if (op.type === 'unchanged') {
        result.push({
          type: 'unchanged',
          oldLineNumber: oldLineNo++,
          newLineNumber: newLineNo++,
          content: op.content,
        });
      } else if (op.type === 'added') {
        result.push({
          type: 'added',
          newLineNumber: newLineNo++,
          content: op.content,
        });
      } else {
        result.push({
          type: 'removed',
          oldLineNumber: oldLineNo++,
          content: op.content,
        });
      }
    }
  }

  for (let k = oldEnd + 1; k < oldLines.length; k++) {
    result.push({
      type: 'unchanged',
      oldLineNumber: oldLineNo++,
      newLineNumber: newLineNo++,
      content: oldLines[k],
    });
  }

  return result;
}

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  filePath,
  isOpen,
  onClose,
  onRestore,
}) => {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(false);
  const [gitEnabled, setGitEnabled] = useState(true);
  const [commits, setCommits] = useState<GitFileCommit[]>([]);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'diff-current' | 'diff-previous' | 'full'>('diff-current');
  const [selectedVersion, setSelectedVersion] = useState<GitFileVersionResponse | null>(null);
  const [prevVersionContent, setPrevVersionContent] = useState<string | null>(null);
  const [loadingVersion, setLoadingVersion] = useState(false);

  const [restoring, setRestoring] = useState(false);
  const [creatingCommit, setCreatingCommit] = useState(false);
  const [showConfirmRestore, setShowConfirmRestore] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadHistory = useCallback(async () => {
    if (!filePath) return;
    setLoading(true);
    setFeedback(null);
    try {
      const res = await api.getFileGitHistory(filePath);
      setGitEnabled(res.gitEnabled);
      setCommits(res.commits || []);
      if (res.commits && res.commits.length > 0) {
        setSelectedHash((prev) => (prev && res.commits.some((c) => c.hash === prev) ? prev : res.commits[0].hash));
      } else {
        setSelectedHash(null);
        setSelectedVersion(null);
        setPrevVersionContent(null);
      }
    } catch (err: unknown) {
      setFeedback({ type: 'error', message: (err as Error).message || 'Fehler beim Laden des Versionsverlaufs' });
    } finally {
      setLoading(false);
    }
  }, [filePath]);

  useEffect(() => {
    if (isOpen && filePath) {
      loadHistory();
    } else {
      setCommits([]);
      setSelectedHash(null);
      setSelectedVersion(null);
      setPrevVersionContent(null);
      setFeedback(null);
      setShowConfirmRestore(false);
    }
  }, [isOpen, filePath, loadHistory]);

  // Load version content when selectedHash or viewMode changes
  useEffect(() => {
    if (!filePath || !selectedHash) return;

    let isMounted = true;
    setLoadingVersion(true);

    const fetchVersion = async () => {
      try {
        const ver = await api.getFileGitVersion(filePath, selectedHash);
        if (!isMounted) return;
        setSelectedVersion(ver);

        // If diff-previous is requested, find the commit before selectedHash
        const currentIndex = commits.findIndex((c) => c.hash === selectedHash);
        if (currentIndex >= 0 && currentIndex < commits.length - 1) {
          const prevCommit = commits[currentIndex + 1];
          const prevVer = await api.getFileGitVersion(filePath, prevCommit.hash);
          if (isMounted) setPrevVersionContent(prevVer.content);
        } else {
          // Initial commit: previous was empty
          if (isMounted) setPrevVersionContent('');
        }
      } catch (err: unknown) {
        if (isMounted) {
          setFeedback({ type: 'error', message: (err as Error).message || 'Fehler beim Laden der Version' });
        }
      } finally {
        if (isMounted) setLoadingVersion(false);
      }
    };

    fetchVersion();

    return () => {
      isMounted = false;
    };
  }, [filePath, selectedHash, commits]);

  // Handle Initial Commit Creation
  const handleCreateInitialCommit = async () => {
    if (!filePath) return;
    setCreatingCommit(true);
    setFeedback(null);
    try {
      await api.commitGit({ reason: `initial commit: ${filePath}` });
      await loadHistory();
    } catch (err: unknown) {
      setFeedback({ type: 'error', message: (err as Error).message || 'Fehler beim Erstellen des Commits' });
    } finally {
      setCreatingCommit(false);
    }
  };

  // Handle Restore Version
  const handleRestore = async () => {
    if (!filePath || !selectedHash) return;
    setRestoring(true);
    setFeedback(null);
    setShowConfirmRestore(false);

    try {
      const res = await api.restoreFileGitVersion(filePath, selectedHash);
      if (res.ok && res.note) {
        onRestore(res.note);
        setFeedback({
          type: 'success',
          message: t('history.restoreSuccess', { hash: selectedHash.slice(0, 7) }),
        });
        await loadHistory();
      }
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: t('history.restoreError', { error: (err as Error).message }),
      });
    } finally {
      setRestoring(false);
    }
  };

  const selectedCommit = useMemo(() => {
    return commits.find((c) => c.hash === selectedHash) || null;
  }, [commits, selectedHash]);

  // Compute Diff Lines
  const diffLines = useMemo<DiffLine[]>(() => {
    if (!selectedVersion) return [];

    if (viewMode === 'full') {
      const lines = selectedVersion.content.replace(/\r\n/g, '\n').split('\n');
      return lines.map((line, idx) => ({
        type: 'unchanged',
        oldLineNumber: idx + 1,
        newLineNumber: idx + 1,
        content: line,
      }));
    }

    if (viewMode === 'diff-previous') {
      const base = prevVersionContent ?? '';
      const target = selectedVersion.content ?? '';
      return computeLineDiff(base, target);
    }

    // Default: 'diff-current'
    // Historical state is base, current file on disk is target
    const historical = selectedVersion.content ?? '';
    const current = selectedVersion.currentContent ?? '';
    return computeLineDiff(historical, current);
  }, [selectedVersion, prevVersionContent, viewMode]);

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const line of diffLines) {
      if (line.type === 'added') additions++;
      else if (line.type === 'removed') deletions++;
    }
    return { additions, deletions };
  }, [diffLines]);

  if (!isOpen || !filePath) return null;

  return (
    <div className="version-history-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="version-history-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="version-history-header">
          <div className="version-history-header-title">
            <History size={18} className="version-history-header-icon" />
            <div>
              <h2>{t('history.title')}</h2>
              <span className="version-history-file-path" title={filePath}>
                {filePath}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="version-history-close-btn"
            onClick={onClose}
            title={t('history.close')}
            aria-label={t('history.close')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div className={`version-history-alert ${feedback.type}`}>
            {feedback.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
            <span>{feedback.message}</span>
            <button type="button" className="alert-dismiss-btn" onClick={() => setFeedback(null)}>
              <X size={14} />
            </button>
          </div>
        )}

        {/* Modal Body / Split Layout */}
        <div className="version-history-layout">
          {/* Left Pane: Commit Timeline */}
          <aside className="version-history-sidebar">
            <div className="version-history-sidebar-header">
              <span className="sidebar-section-label">
                <GitCommitIcon size={14} />
                {t('history.commits')} ({commits.length})
              </span>
            </div>

            {loading ? (
              <div className="version-history-loading">
                <span>{t('history.loading')}</span>
              </div>
            ) : !gitEnabled ? (
              <div className="version-history-empty-state">
                <AlertCircle size={24} className="empty-state-icon warning" />
                <p>{t('history.gitDisabled')}</p>
              </div>
            ) : commits.length === 0 ? (
              <div className="version-history-empty-state">
                <Clock size={24} className="empty-state-icon" />
                <p>{t('history.noCommits')}</p>
                <span className="empty-state-subtext">{t('history.noCommitsHint')}</span>
                <button
                  type="button"
                  className="version-history-primary-btn compact"
                  onClick={handleCreateInitialCommit}
                  disabled={creatingCommit}
                >
                  {creatingCommit ? t('history.creatingCommit') : t('history.createInitialCommit')}
                </button>
              </div>
            ) : (
              <div className="version-history-commit-list scroller">
                {commits.map((c, idx) => {
                  const isSelected = c.hash === selectedHash;
                  const dateObj = new Date(c.date);
                  const formattedDate = !isNaN(dateObj.getTime())
                    ? `${dateObj.toLocaleDateString()} ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : c.date;

                  return (
                    <button
                      key={c.hash}
                      type="button"
                      className={`version-history-commit-item ${isSelected ? 'active' : ''}`}
                      onClick={() => setSelectedHash(c.hash)}
                    >
                      <div className="commit-item-top">
                        <span className="commit-message" title={c.message}>
                          {c.message}
                        </span>
                        <span className="commit-hash-badge">{c.shortHash}</span>
                      </div>
                      <div className="commit-item-meta">
                        <span className="commit-author" title={c.author}>
                          <User size={12} />
                          {c.author}
                        </span>
                        <span className="commit-date">
                          <Clock size={12} />
                          {formattedDate}
                        </span>
                      </div>
                      {idx === 0 && <span className="commit-latest-badge">Neueste</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          {/* Right Pane: Diff & Content Viewer */}
          <main className="version-history-content-pane">
            {selectedCommit ? (
              <>
                {/* View Toolbar */}
                <div className="version-history-toolbar">
                  <div className="version-history-view-switcher" role="group">
                    <button
                      type="button"
                      className={`vh-toggle-btn ${viewMode === 'diff-current' ? 'active' : ''}`}
                      onClick={() => setViewMode('diff-current')}
                    >
                      {t('history.diffToCurrent')}
                    </button>
                    <button
                      type="button"
                      className={`vh-toggle-btn ${viewMode === 'diff-previous' ? 'active' : ''}`}
                      onClick={() => setViewMode('diff-previous')}
                    >
                      {t('history.diffToPrevious')}
                    </button>
                    <button
                      type="button"
                      className={`vh-toggle-btn ${viewMode === 'full' ? 'active' : ''}`}
                      onClick={() => setViewMode('full')}
                    >
                      {t('history.fullContent')}
                    </button>
                  </div>

                  <div className="version-history-actions">
                    {viewMode !== 'full' && (
                      <div className="vh-stats-badge" title="Hinzugefügte und entfernte Zeilen">
                        <span className="stat-add">+{stats.additions}</span>
                        <span className="stat-del">-{stats.deletions}</span>
                      </div>
                    )}

                    <button
                      type="button"
                      className="vh-restore-btn"
                      onClick={() => setShowConfirmRestore(true)}
                      disabled={restoring}
                      title={t('history.restore')}
                    >
                      <RotateCcw size={14} className={restoring ? 'spinning' : ''} />
                      <span>{restoring ? t('history.restoring') : t('history.restore')}</span>
                    </button>
                  </div>
                </div>

                {/* Inline Restore Confirmation Dialog */}
                {showConfirmRestore && (
                  <div className="vh-inline-confirm-dialog">
                    <div className="confirm-dialog-content">
                      <AlertCircle size={18} className="confirm-icon" />
                      <span>
                        {t('history.restoreConfirm', {
                          path: filePath,
                          date: new Date(selectedCommit.date).toLocaleDateString(),
                          hash: selectedCommit.shortHash,
                        })}
                      </span>
                    </div>
                    <div className="confirm-dialog-actions">
                      <button
                        type="button"
                        className="confirm-cancel-btn"
                        onClick={() => setShowConfirmRestore(false)}
                        disabled={restoring}
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        className="confirm-restore-btn"
                        onClick={handleRestore}
                        disabled={restoring}
                      >
                        <RotateCcw size={13} />
                        {t('history.restore')}
                      </button>
                    </div>
                  </div>
                )}

                {/* Diff / Code Viewer */}
                <div className="version-history-diff-viewport scroller">
                  {loadingVersion ? (
                    <div className="diff-loading-state">
                      <span>{t('history.loading')}</span>
                    </div>
                  ) : diffLines.length === 0 ? (
                    <div className="diff-empty-state">
                      <FileText size={28} className="empty-icon" />
                      <span>{t('history.noChanges')}</span>
                    </div>
                  ) : (
                    <div className="diff-table">
                      {diffLines.map((line, idx) => (
                        <div key={idx} className={`diff-line diff-line-${line.type}`}>
                          <div className="diff-gutter-num old-num">
                            {line.oldLineNumber ?? ''}
                          </div>
                          <div className="diff-gutter-num new-num">
                            {line.newLineNumber ?? ''}
                          </div>
                          <div className="diff-gutter-marker">
                            {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                          </div>
                          <div className="diff-line-content">
                            <code>{line.content || ' '}</code>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="diff-no-selection">
                <GitBranch size={32} className="no-selection-icon" />
                <span>{t('history.noCommitsHint')}</span>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};
