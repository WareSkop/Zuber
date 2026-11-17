import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Folder, FolderOpen, Search, X } from 'lucide-react';
import type { FileTreeNode } from '../../shared/types';
import { useTranslation } from '../i18n';

export interface MoveToModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourcePaths: string[];
  tree: FileTreeNode[];
  onMove: (targetFolder: string) => Promise<void>;
}

interface FolderItem {
  path: string;
  name: string;
  depth: number;
}

export const MoveToModal: React.FC<MoveToModalProps> = ({
  isOpen,
  onClose,
  sourcePaths,
  tree,
  onMove,
}) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Extract all folders recursively
  const allFolders = useMemo(() => {
    const list: FolderItem[] = [
      { path: '', name: t('moveToModal.rootFolder', { defaultValue: '/ (Vault Root)' }), depth: 0 },
    ];

    const traverse = (nodes: FileTreeNode[], depth: number) => {
      for (const node of nodes) {
        if (node.type === 'folder') {
          list.push({ path: node.path, name: node.name, depth });
          if (node.children) {
            traverse(node.children, depth + 1);
          }
        }
      }
    };
    traverse(tree, 1);
    return list;
  }, [tree, t]);

  // Filter out invalid folders (e.g. self or descendant of any selected folder)
  const validFolders = useMemo(() => {
    return allFolders.filter((f) => {
      for (const src of sourcePaths) {
        // If src is a folder, cannot move into itself or its descendants
        if (f.path === src || f.path.startsWith(`${src}/`)) {
          return false;
        }
      }
      return true;
    });
  }, [allFolders, sourcePaths]);

  // Filter by search query
  const filteredFolders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return validFolders;
    return validFolders.filter(
      (f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    );
  }, [validFolders, searchQuery]);

  // Reset selectedIndex when filter changes
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
    const activeEl = listRef.current.querySelector<HTMLElement>(`.move-to-folder-item.selected`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  const handleSelectFolder = async (folderPath: string) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onMove(folderPath);
      onClose();
    } catch (err) {
      console.error('[MoveToModal] Error:', err);
      alert((err as Error).message || t('moveToModal.moveError'));
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
      setSelectedIndex((prev) => (prev < filteredFolders.length - 1 ? prev + 1 : prev));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredFolders[selectedIndex]) {
        handleSelectFolder(filteredFolders[selectedIndex].path);
      }
    }
  };

  const title =
    sourcePaths.length > 1
      ? t('sidebar.moveItems', { count: sourcePaths.length, defaultValue: `${sourcePaths.length} Elemente verschieben nach...` })
      : t('sidebar.moveTo', { defaultValue: 'Verschieben nach...' });

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-box move-to-modal-box"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="modal-header">
          <div className="modal-header-title">
            <FolderOpen size={18} className="modal-icon" />
            <h3>{title}</h3>
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

        <div className="move-to-search-box">
          <Search size={15} className="search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="modal-input move-to-search-input"
            placeholder={t('moveToModal.searchPlaceholder', { defaultValue: 'Ordner filtern...' })}
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

        <div className="move-to-folder-list scroller" ref={listRef}>
          {filteredFolders.length === 0 ? (
            <div className="move-to-empty-hint">
              {t('moveToModal.noFoldersFound', { defaultValue: 'Keine passenden Ordner gefunden' })}
            </div>
          ) : (
            filteredFolders.map((folder, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={folder.path || '__root__'}
                  className={`move-to-folder-item ${isSelected ? 'selected' : ''}`}
                  style={{ paddingLeft: `${12 + folder.depth * 14}px` }}
                  onClick={() => handleSelectFolder(folder.path)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <Folder size={15} className="folder-icon" />
                  <span className="folder-name">{folder.name}</span>
                  {folder.path && (
                    <span className="folder-subpath">
                      {folder.path}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="modal-footer">
          <span className="move-to-hint">
            <kbd>↑</kbd> <kbd>↓</kbd> navigieren • <kbd>Enter</kbd> verschieben • <kbd>Esc</kbd> abbrechen
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {t('common.cancel', { defaultValue: 'Abbrechen' })}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (filteredFolders[selectedIndex]) {
                handleSelectFolder(filteredFolders[selectedIndex].path);
              }
            }}
            disabled={isSubmitting || filteredFolders.length === 0}
          >
            {isSubmitting
              ? t('moveToModal.moving', { defaultValue: 'Wird verschoben...' })
              : t('sidebar.moveTo', { defaultValue: 'Verschieben' })}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
