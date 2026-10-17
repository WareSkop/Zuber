import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Hash,
  Image as ImageIcon,
  MoreVertical,
  Pencil,
  RefreshCw,
  Scissors,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { FileTreeNode } from '../../shared/types';
import { api } from '../api';
import { useTranslation } from '../i18n';

export interface ClipboardItem {
  path: string;
  name: string;
  type: 'file' | 'folder';
  mode: 'copy' | 'move';
}

interface ContextMenuState {
  x: number;
  y: number;
  node: FileTreeNode | null; // null represents Vault Root
}

interface FileSidebarProps {
  tree: FileTreeNode[];
  activePath: string | null;
  tags: { tag: string; count: number }[];
  selectedTagFilter: string | null;
  onSelectNote: (path: string) => void;
  onCreateNote: (parentFolder?: string) => void;
  onCreateFolder: (parentFolder?: string) => void;
  onRenameEntry: (oldPath: string, currentName: string) => void;
  onDeleteEntry: (path: string, name: string) => void;
  onRefresh: () => void;
  onSelectTagFilter: (tag: string | null) => void;
  onClose?: () => void;
}

const FileSidebarImpl: React.FC<FileSidebarProps> = ({
  tree,
  activePath,
  tags,
  selectedTagFilter,
  onSelectNote,
  onCreateNote,
  onCreateFolder,
  onRenameEntry,
  onDeleteEntry,
  onRefresh,
  onSelectTagFilter,
  onClose,
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'files' | 'search' | 'tags'>('files');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    Projekte: true,
    Wissensbasis: true,
    'Tägliche Notizen': true,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    {
      path: string;
      name: string;
      matches: { line: number; text: string }[];
      tags: string[];
    }[]
  >([]);
  const [searching, setSearching] = useState(false);

  // Clipboard & Context menu states
  const [clipboard, setClipboard] = useState<ClipboardItem | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close context menu on click outside or escape key
  useEffect(() => {
    if (!contextMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current?.contains(e.target as Node)) return;
      setContextMenu(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  // Switch to search tab automatically when a tag filter is selected externally
  useEffect(() => {
    if (selectedTagFilter) {
      setActiveTab('search');
    }
  }, [selectedTagFilter]);

  useEffect(() => {
    if (activeTab !== 'search' && !selectedTagFilter) return;

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.search(searchQuery, selectedTagFilter || undefined);
        setSearchResults(res.results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [searchQuery, selectedTagFilter, activeTab]);

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderPath]: !prev[folderPath],
    }));
  };

  const openContextMenu = (node: FileTreeNode | null, clientX: number, clientY: number) => {
    const menuWidth = 220;
    const menuHeight = 280;
    const x = Math.max(10, Math.min(clientX, window.innerWidth - menuWidth - 10));
    const y = Math.max(10, Math.min(clientY, window.innerHeight - menuHeight - 10));
    setContextMenu({ x, y, node });
  };

  const handleTouchStart = (e: React.TouchEvent, node: FileTreeNode) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const { clientX, clientY } = touch;
    touchTimerRef.current = setTimeout(() => {
      openContextMenu(node, clientX, clientY);
    }, 450);
  };

  const handleTouchEnd = () => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  };

  const handleCopy = (node: FileTreeNode) => {
    const displayName = node.type === 'file' && node.extension === 'md' ? node.name.replace(/\.md$/i, '') : node.name;
    setClipboard({
      path: node.path,
      name: displayName,
      type: node.type,
      mode: 'copy',
    });
    setContextMenu(null);
  };

  const handleCut = (node: FileTreeNode) => {
    const displayName = node.type === 'file' && node.extension === 'md' ? node.name.replace(/\.md$/i, '') : node.name;
    setClipboard({
      path: node.path,
      name: displayName,
      type: node.type,
      mode: 'move',
    });
    setContextMenu(null);
  };

  const handlePaste = async (targetNode: FileTreeNode | null) => {
    if (!clipboard) return;
    setContextMenu(null);

    // Determine destination folder
    let targetFolder = '';
    if (targetNode) {
      if (targetNode.type === 'folder') {
        targetFolder = targetNode.path;
      } else {
        const parts = targetNode.path.split('/');
        parts.pop();
        targetFolder = parts.join('/');
      }
    }

    const fileName = clipboard.path.split('/').pop() || '';
    const destinationPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;

    try {
      if (clipboard.mode === 'move') {
        if (clipboard.path === destinationPath) return;
        await api.renameEntry(clipboard.path, destinationPath);
        setClipboard(null);
      } else {
        await api.copyEntry(clipboard.path, destinationPath);
      }
      onRefresh();
    } catch (err) {
      console.error('[Knowmesh] Paste error:', err);
      alert((err as Error).message || 'Fehler beim Einfügen');
    }
  };

  const renderTreeNode = (node: FileTreeNode, depth = 0) => {
    if (node.type === 'folder') {
      const isExpanded = Boolean(expandedFolders[node.path]);
      return (
        <div key={node.path} className="tree-folder-group">
          <div
            className="tree-item tree-folder-item"
            style={{ paddingLeft: `${10 + depth * 14}px` }}
            onClick={() => toggleFolder(node.path)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openContextMenu(node, e.clientX, e.clientY);
            }}
            onTouchStart={(e) => handleTouchStart(e, node)}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchEnd}
          >
            <span className="tree-chevron">
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
            <span className="tree-icon folder-icon">
              {isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}
            </span>
            <span className="tree-label" title={node.path}>
              {node.name}
            </span>
            <button
              type="button"
              className="tree-item-more-btn"
              title="Menü"
              aria-label="Menü"
              onClick={(e) => {
                e.stopPropagation();
                openContextMenu(node, e.clientX, e.clientY);
              }}
            >
              <MoreVertical size={14} />
            </button>
          </div>

          {isExpanded && node.children && (
            <div className="tree-folder-children">
              {node.children.map((child) => renderTreeNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    const isMd = node.extension === 'md';
    const isActive = activePath === node.path;
    const displayName = isMd ? node.name.replace(/\.md$/i, '') : node.name;

    return (
      <div
        key={node.path}
        className={`tree-item tree-file-item ${isActive ? 'active' : ''} ${!isMd ? 'attachment-item' : ''}`}
        style={{ paddingLeft: `${26 + depth * 14}px` }}
        onClick={() => {
          if (isMd) {
            onSelectNote(node.path);
          } else {
            window.open(api.getAttachmentUrl(node.path), '_blank');
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openContextMenu(node, e.clientX, e.clientY);
        }}
        onTouchStart={(e) => handleTouchStart(e, node)}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
      >
        <span className="tree-icon">
          {isMd ? <FileText size={14} /> : <ImageIcon size={14} />}
        </span>
        <span className="tree-label" title={node.path}>
          {displayName}
        </span>
        {!isMd && <span className="file-ext-badge">{node.extension}</span>}
        <button
          type="button"
          className="tree-item-more-btn"
          title="Menü"
          aria-label="Menü"
          onClick={(e) => {
            e.stopPropagation();
            openContextMenu(node, e.clientX, e.clientY);
          }}
        >
          <MoreVertical size={14} />
        </button>
      </div>
    );
  };

  return (
    <aside className="left-sidebar">
      <div className="sidebar-tabs">
        <button
          type="button"
          className={`sidebar-tab-btn ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
          title={t('sidebar.filesTitle')}
        >
          <Folder size={15} />
          <span>{t('sidebar.files')}</span>
        </button>
        <button
          type="button"
          className={`sidebar-tab-btn ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveTab('search')}
          title={t('sidebar.searchTitle')}
        >
          <Search size={15} />
          <span>{t('sidebar.search')}</span>
        </button>
        <button
          type="button"
          className={`sidebar-tab-btn ${activeTab === 'tags' ? 'active' : ''}`}
          onClick={() => setActiveTab('tags')}
          title={t('sidebar.tagsTitle')}
        >
          <Hash size={15} />
          <span>{t('sidebar.tags')}</span>
        </button>
        {onClose && (
          <button
            type="button"
            className="sidebar-tab-btn close-sidebar-btn"
            onClick={onClose}
            title={t('sidebar.closeLeft')}
            aria-label={t('sidebar.closeLeft')}
          >
            <X size={15} />
          </button>
        )}
      </div>

      {activeTab === 'files' && (
        <>
          <div className="sidebar-action-bar">
            <button
              type="button"
              className="sidebar-icon-btn"
              title={t('sidebar.newNoteTitle')}
              onClick={() => onCreateNote()}
            >
              <FilePlus size={16} />
              <span>{t('sidebar.newNote')}</span>
            </button>
            <div className="sidebar-action-right">
              <button
                type="button"
                className="sidebar-icon-btn icon-only"
                title={t('sidebar.newFolder')}
                onClick={() => onCreateFolder()}
              >
                <FolderPlus size={16} />
              </button>
              <button
                type="button"
                className="sidebar-icon-btn icon-only"
                title={t('sidebar.refreshTitle')}
                onClick={onRefresh}
              >
                <RefreshCw size={15} />
              </button>
            </div>
          </div>

          <div
            className="file-tree-scroller scroller"
            onContextMenu={(e) => {
              if ((e.target as HTMLElement).closest('.tree-item')) return;
              e.preventDefault();
              openContextMenu(null, e.clientX, e.clientY);
            }}
          >
            {tree.map((node) => renderTreeNode(node, 0))}
          </div>
        </>
      )}

      {activeTab === 'search' && (
        <div className="sidebar-search-pane">
          <div className="search-input-box">
            <Search size={15} className="search-box-icon" />
            <input
              type="text"
              placeholder={t('sidebar.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
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

          {selectedTagFilter && (
            <div className="active-tag-filter-bar">
              <span>{t('sidebar.filterTag')}: #{selectedTagFilter}</span>
              <button type="button" onClick={() => onSelectTagFilter(null)}>
                <X size={13} />
              </button>
            </div>
          )}

          <div className="search-results-list scroller">
            {searching ? (
              <div className="sidebar-empty-hint">{t('sidebar.searching')}</div>
            ) : searchResults.length === 0 ? (
              <div className="sidebar-empty-hint">{t('sidebar.noResults')}</div>
            ) : (
              searchResults.map((res) => (
                <div
                  key={res.path}
                  className={`search-result-card ${activePath === res.path ? 'active' : ''}`}
                  onClick={() => onSelectNote(res.path)}
                >
                  <div className="search-result-title">
                    <FileText size={14} />
                    <span>{res.name}</span>
                  </div>
                  {res.matches.map((m, idx) => (
                    <div key={idx} className="search-result-snippet">
                      {m.line > 0 && <span className="line-num">{t('sidebar.line')}{m.line}:</span>} {m.text}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'tags' && (
        <div className="sidebar-tags-pane scroller">
          {tags.length === 0 ? (
            <div className="sidebar-empty-hint">{t('sidebar.noTags')}</div>
          ) : (
            tags.map((item) => (
              <button
                key={item.tag}
                type="button"
                className={`tag-list-row ${selectedTagFilter === item.tag ? 'active' : ''}`}
                onClick={() => {
                  onSelectTagFilter(item.tag);
                  setActiveTab('search');
                }}
              >
                <span className="tag-list-name">#{item.tag}</span>
                <span className="tag-list-count">{item.count}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Context Menu Portal */}
      {contextMenu &&
        createPortal(
          <div
            ref={contextMenuRef}
            className="tree-context-menu"
            style={{
              top: `${contextMenu.y}px`,
              left: `${contextMenu.x}px`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.node ? (
              <>
                {contextMenu.node.type === 'folder' ? (
                  <>
                    <button
                      type="button"
                      className="tree-context-item"
                      onClick={() => {
                        const path = contextMenu.node!.path;
                        setExpandedFolders((prev) => ({ ...prev, [path]: true }));
                        onCreateNote(path);
                        setContextMenu(null);
                      }}
                    >
                      <FilePlus size={15} />
                      <span>{t('sidebar.newNoteInFolder')}</span>
                    </button>
                    <button
                      type="button"
                      className="tree-context-item"
                      onClick={() => {
                        const path = contextMenu.node!.path;
                        setExpandedFolders((prev) => ({ ...prev, [path]: true }));
                        onCreateFolder(path);
                        setContextMenu(null);
                      }}
                    >
                      <FolderPlus size={15} />
                      <span>{t('sidebar.newFolderInFolder')}</span>
                    </button>
                    <div className="tree-context-separator" />
                  </>
                ) : null}

                {/* Copy */}
                <button
                  type="button"
                  className="tree-context-item"
                  onClick={() => handleCopy(contextMenu.node!)}
                >
                  <Copy size={15} />
                  <span>{t('common.copy')}</span>
                </button>

                {/* Move / Cut */}
                <button
                  type="button"
                  className="tree-context-item"
                  onClick={() => handleCut(contextMenu.node!)}
                >
                  <Scissors size={15} />
                  <span>{t('sidebar.moveOrCut')}</span>
                </button>

                {/* Paste */}
                {clipboard && (
                  <button
                    type="button"
                    className="tree-context-item"
                    onClick={() => handlePaste(contextMenu.node)}
                  >
                    <Clipboard size={15} />
                    <span>
                      {contextMenu.node.type === 'folder'
                        ? t('sidebar.pasteIntoFolder', { name: contextMenu.node.name })
                        : t('common.paste')}
                    </span>
                  </button>
                )}

                {/* Rename */}
                <button
                  type="button"
                  className="tree-context-item"
                  onClick={() => {
                    const node = contextMenu.node!;
                    const displayName =
                      node.type === 'file' && node.extension === 'md'
                        ? node.name.replace(/\.md$/i, '')
                        : node.name;
                    onRenameEntry(node.path, displayName);
                    setContextMenu(null);
                  }}
                >
                  <Pencil size={15} />
                  <span>{t('common.rename')}</span>
                </button>

                <div className="tree-context-separator" />

                {/* Delete */}
                <button
                  type="button"
                  className="tree-context-item danger"
                  onClick={() => {
                    const node = contextMenu.node!;
                    const displayName =
                      node.type === 'file' && node.extension === 'md'
                        ? node.name.replace(/\.md$/i, '')
                        : node.name;
                    onDeleteEntry(node.path, displayName);
                    setContextMenu(null);
                  }}
                >
                  <Trash2 size={15} />
                  <span>{t('common.delete')}</span>
                </button>
              </>
            ) : (
              /* Context menu on root / empty space */
              <>
                <button
                  type="button"
                  className="tree-context-item"
                  onClick={() => {
                    onCreateNote();
                    setContextMenu(null);
                  }}
                >
                  <FilePlus size={15} />
                  <span>{t('sidebar.newNote')}</span>
                </button>
                <button
                  type="button"
                  className="tree-context-item"
                  onClick={() => {
                    onCreateFolder();
                    setContextMenu(null);
                  }}
                >
                  <FolderPlus size={15} />
                  <span>{t('sidebar.newFolder')}</span>
                </button>
                {clipboard && (
                  <>
                    <div className="tree-context-separator" />
                    <button
                      type="button"
                      className="tree-context-item"
                      onClick={() => handlePaste(null)}
                    >
                      <Clipboard size={15} />
                      <span>{t('sidebar.pasteIntoRoot')}</span>
                    </button>
                  </>
                )}
              </>
            )}
          </div>,
          document.body
        )}
    </aside>
  );
};

export const FileSidebar = React.memo(FileSidebarImpl);
