import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  Clock,
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
  Star,
  Trash2,
  Upload,
  Download,
  X,
} from 'lucide-react';
import type { FileTreeNode } from '../../shared/types';
import { api } from '../api';
import { useTranslation } from '../i18n';
import { WorkflowCanvasIcon } from './canvas/WorkflowCanvasIcon';
import {
  loadFavorites,
  saveFavorites,
  loadRecentNotes,
  notifyVaultEntryRenamed,
  FavoriteItem,
} from '../utils/vaultNavigation';

export type { FavoriteItem } from '../utils/vaultNavigation';

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
  onCreateCanvas?: (parentFolder?: string) => void;
  onCreateFolder: (parentFolder?: string) => void;
  onRenameEntry: (oldPath: string, currentName: string) => void;
  onDeleteEntry: (path: string, name: string) => void;
  onRefresh: () => void;
  onSelectTagFilter: (tag: string | null) => void;
  onClose?: () => void;
  onLeftResizeStart?: (e: React.MouseEvent) => void;
  isResizingLeft?: boolean;
}

const FileSidebarImpl: React.FC<FileSidebarProps> = ({
  tree,
  activePath,
  tags,
  selectedTagFilter,
  onSelectNote,
  onCreateNote,
  onCreateCanvas,
  onCreateFolder,
  onRenameEntry,
  onDeleteEntry,
  onRefresh,
  onSelectTagFilter,
  onClose,
  onLeftResizeStart,
  isResizingLeft = false,
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

  // Favorites & Recent panels latching states
  const [showFavoritesPanel, setShowFavoritesPanel] = useState<boolean>(() => {
    try {
      return localStorage.getItem('knowmesh_show_favorites_panel') === 'true';
    } catch {
      return false;
    }
  });

  const [showRecentPanel, setShowRecentPanel] = useState<boolean>(() => {
    try {
      return localStorage.getItem('knowmesh_show_recent_panel') === 'true';
    } catch {
      return false;
    }
  });

  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => loadFavorites());
  const [recentNotesList, setRecentNotesList] = useState<string[]>(() => loadRecentNotes());

  const reloadFavorites = useCallback(() => {
    setFavorites(loadFavorites());
  }, []);

  const reloadRecentNotes = useCallback(() => {
    setRecentNotesList(loadRecentNotes());
  }, []);

  useEffect(() => {
    const handleFavChange = () => reloadFavorites();
    const handleRecentChange = () => reloadRecentNotes();

    window.addEventListener('knowmesh_favorites_changed', handleFavChange);
    window.addEventListener('knowmesh_recent_changed', handleRecentChange);
    window.addEventListener('storage', handleFavChange);
    window.addEventListener('storage', handleRecentChange);

    return () => {
      window.removeEventListener('knowmesh_favorites_changed', handleFavChange);
      window.removeEventListener('knowmesh_recent_changed', handleRecentChange);
      window.removeEventListener('storage', handleFavChange);
      window.removeEventListener('storage', handleRecentChange);
    };
  }, [reloadFavorites, reloadRecentNotes]);

  useEffect(() => {
    reloadRecentNotes();
  }, [activePath, reloadRecentNotes]);

  const toggleFavorite = (path: string, type: 'file' | 'folder') => {
    setFavorites((prev) => {
      let next: FavoriteItem[];
      if (prev.some((f) => f.path === path)) {
        next = prev.filter((f) => f.path !== path);
      } else {
        next = [...prev, { path, type }];
      }
      saveFavorites(next);
      return next;
    });
  };

  const isFavorite = (path: string) => favorites.some((f) => f.path === path);

  // Clipboard & Context menu states
  const [clipboard, setClipboard] = useState<ClipboardItem | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Upload & Download states
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [targetUploadFolder, setTargetUploadFolder] = useState<string>('');
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  const getParentFolder = (filePath: string) => {
    const parts = filePath.split('/');
    parts.pop();
    return parts.join('/');
  };

  const triggerUploadFiles = (folder: string) => {
    setTargetUploadFolder(folder);
    setContextMenu(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const triggerUploadFolder = (folder: string) => {
    setTargetUploadFolder(folder);
    setContextMenu(null);
    if (folderInputRef.current) {
      folderInputRef.current.value = '';
      folderInputRef.current.click();
    }
  };

  const handleFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    try {
      setUploadStatus(t('sidebar.uploading'));
      const res = await api.uploadEntries(targetUploadFolder, files);
      if (targetUploadFolder) {
        setExpandedFolders((prev) => ({ ...prev, [targetUploadFolder]: true }));
      }
      onRefresh();
      setUploadStatus(t('sidebar.uploadSuccess', { count: res.count }));
      setTimeout(() => setUploadStatus(null), 3500);
    } catch (err: unknown) {
      console.error('[Knowmesh] Upload error:', err);
      alert((err as Error).message || 'Fehler beim Hochladen.');
      setUploadStatus(null);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    try {
      setUploadStatus(t('sidebar.uploading'));
      const paths = files.map((f) => (f as any).webkitRelativePath || f.name);
      const res = await api.uploadEntries(targetUploadFolder, files, paths);
      if (targetUploadFolder) {
        setExpandedFolders((prev) => ({ ...prev, [targetUploadFolder]: true }));
      }
      onRefresh();
      setUploadStatus(t('sidebar.uploadSuccess', { count: res.count }));
      setTimeout(() => setUploadStatus(null), 3500);
    } catch (err: unknown) {
      console.error('[Knowmesh] Folder upload error:', err);
      alert((err as Error).message || 'Fehler beim Hochladen des Ordners.');
      setUploadStatus(null);
    } finally {
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const handleDownload = async (path: string, isDirectory: boolean) => {
    setContextMenu(null);
    try {
      await api.downloadEntry(path, isDirectory);
    } catch (err: unknown) {
      console.error('[Knowmesh] Download error:', err);
      alert((err as Error).message || 'Fehler beim Download.');
    }
  };

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

  // Automatically expand ancestor folders when activePath changes
  useEffect(() => {
    if (!activePath || !activePath.includes('/')) return;
    const parts = activePath.split('/');
    parts.pop(); // remove filename
    if (parts.length === 0) return;
    setExpandedFolders((prev) => {
      let changed = false;
      const next = { ...prev };
      let current = '';
      for (const p of parts) {
        current = current ? `${current}/${p}` : p;
        if (!next[current]) {
          next[current] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activePath]);

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
    const menuWidth = 230;
    const menuHeight = 360;
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
    const displayName =
      node.type === 'file' && (node.extension === 'md' || node.extension === 'canvas')
        ? node.name.replace(/\.(md|canvas)$/i, '')
        : node.name;
    setClipboard({
      path: node.path,
      name: displayName,
      type: node.type,
      mode: 'copy',
    });
    setContextMenu(null);
  };

  const handleCut = (node: FileTreeNode) => {
    const displayName =
      node.type === 'file' && (node.extension === 'md' || node.extension === 'canvas')
        ? node.name.replace(/\.(md|canvas)$/i, '')
        : node.name;
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
        notifyVaultEntryRenamed(clipboard.path, destinationPath);
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
    const isCanvas =
      node.extension === 'canvas' ||
      node.path.endsWith('.canvas') ||
      node.attachmentKind === 'canvas';
    const isActive = activePath === node.path;
    const displayName = isMd
      ? node.name.replace(/\.md$/i, '')
      : isCanvas
      ? node.name.replace(/\.canvas$/i, '')
      : node.name;

    return (
      <div
        key={node.path}
        className={`tree-item tree-file-item ${isActive ? 'active' : ''} ${!isMd && !isCanvas ? 'attachment-item' : ''} ${isCanvas ? 'canvas-item' : ''}`}
        style={{ paddingLeft: `${26 + depth * 14}px` }}
        onClick={() => {
          if (isMd || isCanvas) {
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
          {isCanvas ? (
            <WorkflowCanvasIcon size={14} className="tree-canvas-icon" />
          ) : isMd ? (
            <FileText size={14} />
          ) : (
            <ImageIcon size={14} />
          )}
        </span>
        <span className="tree-label" title={node.path}>
          {displayName}
        </span>
        {isCanvas && <span className="file-ext-badge canvas-badge">CANVAS</span>}
        {!isMd && !isCanvas && <span className="file-ext-badge">{node.extension}</span>}
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
          className={`sidebar-tab-btn icon-only ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
          title={t('sidebar.files')}
          aria-label={t('sidebar.files')}
        >
          <Folder size={15} />
        </button>
        <button
          type="button"
          className={`sidebar-tab-btn icon-only ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveTab('search')}
          title={t('sidebar.search')}
          aria-label={t('sidebar.search')}
        >
          <Search size={15} />
        </button>
        <button
          type="button"
          className={`sidebar-tab-btn icon-only ${activeTab === 'tags' ? 'active' : ''}`}
          onClick={() => setActiveTab('tags')}
          title={t('sidebar.tags')}
          aria-label={t('sidebar.tags')}
        >
          <Hash size={15} />
        </button>
        <button
          type="button"
          className={`sidebar-tab-btn icon-only latch-btn ${showFavoritesPanel ? 'active' : ''}`}
          onClick={() => {
            setShowFavoritesPanel((prev) => {
              const next = !prev;
              try {
                localStorage.setItem('knowmesh_show_favorites_panel', String(next));
              } catch {}
              return next;
            });
            setActiveTab('files');
          }}
          title={t('sidebar.favoritesTitle')}
          aria-label={t('sidebar.favorites')}
        >
          <Star size={15} className={showFavoritesPanel ? 'starred-icon' : ''} fill={showFavoritesPanel ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          className={`sidebar-tab-btn icon-only latch-btn ${showRecentPanel ? 'active' : ''}`}
          onClick={() => {
            setShowRecentPanel((prev) => {
              const next = !prev;
              try {
                localStorage.setItem('knowmesh_show_recent_panel', String(next));
              } catch {}
              return next;
            });
            setActiveTab('files');
          }}
          title={t('sidebar.recentNotesTitle')}
          aria-label={t('sidebar.recentNotes')}
        >
          <Clock size={15} />
        </button>
        {onClose && (
          <button
            type="button"
            className="sidebar-tab-btn close-sidebar-btn icon-only"
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
              {onCreateCanvas && (
                <button
                  type="button"
                  className="sidebar-icon-btn icon-only"
                  title={t('canvas.newCanvas')}
                  onClick={() => onCreateCanvas()}
                >
                  <WorkflowCanvasIcon size={15} />
                </button>
              )}
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

          {/* Latching Favorites Panel */}
          {showFavoritesPanel && (
            <div className="sidebar-favorites-panel">
              <div className="sidebar-section-header">
                <div className="sidebar-section-title">
                  <Star size={13} className="section-header-icon starred-icon" fill="currentColor" />
                  <span>{t('sidebar.favorites')}</span>
                </div>
                <span className="sidebar-section-count">({favorites.length})</span>
              </div>
              <div className="sidebar-favorites-list scroller">
                {favorites.length === 0 ? (
                  <div className="sidebar-empty-hint small">{t('sidebar.noFavorites')}</div>
                ) : (
                  favorites.map((fav) => {
                    const name = fav.path.split('/').pop() || fav.path;
                    const isCanvas = fav.path.endsWith('.canvas');
                    const isMd = fav.path.endsWith('.md');
                    const displayName =
                      fav.type === 'file' ? name.replace(/\.(md|canvas)$/i, '') : name;
                    return (
                      <div
                        key={fav.path}
                        className={`tree-item favorite-item ${activePath === fav.path ? 'active' : ''}`}
                        onClick={() => {
                          if (fav.type === 'file') {
                            onSelectNote(fav.path);
                          } else {
                            const parts = fav.path.split('/');
                            setExpandedFolders((prev) => {
                              const next = { ...prev };
                              let current = '';
                              for (const p of parts) {
                                current = current ? `${current}/${p}` : p;
                                next[current] = true;
                              }
                              return next;
                            });
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openContextMenu(
                            {
                              path: fav.path,
                              name,
                              type: fav.type,
                              extension: isCanvas ? 'canvas' : isMd ? 'md' : undefined,
                            },
                            e.clientX,
                            e.clientY
                          );
                        }}
                        title={fav.path}
                      >
                        <span className="tree-icon">
                          {fav.type === 'folder' ? (
                            expandedFolders[fav.path] ? (
                              <FolderOpen size={14} />
                            ) : (
                              <Folder size={14} />
                            )
                          ) : isCanvas ? (
                            <WorkflowCanvasIcon size={14} className="tree-canvas-icon" />
                          ) : isMd ? (
                            <FileText size={14} />
                          ) : (
                            <ImageIcon size={14} />
                          )}
                        </span>
                        <span className="tree-label">{displayName}</span>
                        <button
                          type="button"
                          className="favorite-remove-btn"
                          title={t('sidebar.removeFromFavorites')}
                          aria-label={t('sidebar.removeFromFavorites')}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(fav.path, fav.type);
                          }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Latching Recent Notes Panel */}
          {showRecentPanel && (
            <div className="sidebar-recent-panel">
              <div className="sidebar-section-header">
                <div className="sidebar-section-title">
                  <Clock size={13} className="section-header-icon" />
                  <span>{t('sidebar.recentNotes')}</span>
                </div>
                <span className="sidebar-section-count">({recentNotesList.length})</span>
              </div>
              <div className="sidebar-recent-list scroller">
                {recentNotesList.length === 0 ? (
                  <div className="sidebar-empty-hint small">{t('sidebar.noRecentNotes')}</div>
                ) : (
                  recentNotesList.map((notePath) => {
                    const name = notePath.split('/').pop() || notePath;
                    const isCanvas = notePath.endsWith('.canvas');
                    const isMd = notePath.endsWith('.md');
                    const displayName = name.replace(/\.(md|canvas)$/i, '');
                    return (
                      <div
                        key={notePath}
                        className={`tree-item recent-item ${activePath === notePath ? 'active' : ''}`}
                        onClick={() => onSelectNote(notePath)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openContextMenu(
                            {
                              path: notePath,
                              name,
                              type: 'file',
                              extension: isCanvas ? 'canvas' : isMd ? 'md' : undefined,
                            },
                            e.clientX,
                            e.clientY
                          );
                        }}
                        title={notePath}
                      >
                        <span className="tree-icon">
                          {isCanvas ? (
                            <WorkflowCanvasIcon size={14} className="tree-canvas-icon" />
                          ) : (
                            <FileText size={14} />
                          )}
                        </span>
                        <span className="tree-label">{displayName}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

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
                    {onCreateCanvas && (
                      <button
                        type="button"
                        className="tree-context-item"
                        onClick={() => {
                          const path = contextMenu.node!.path;
                          setExpandedFolders((prev) => ({ ...prev, [path]: true }));
                          onCreateCanvas(path);
                          setContextMenu(null);
                        }}
                      >
                        <WorkflowCanvasIcon size={15} />
                        <span>{t('canvas.newCanvasInFolder')}</span>
                      </button>
                    )}
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
                    <button
                      type="button"
                      className="tree-context-item"
                      onClick={() => triggerUploadFiles(contextMenu.node!.path)}
                    >
                      <Upload size={15} />
                      <span>{t('sidebar.uploadFiles')}</span>
                    </button>
                    <button
                      type="button"
                      className="tree-context-item"
                      onClick={() => triggerUploadFolder(contextMenu.node!.path)}
                    >
                      <Upload size={15} />
                      <span>{t('sidebar.uploadFolder')}</span>
                    </button>
                    <button
                      type="button"
                      className="tree-context-item"
                      onClick={() => handleDownload(contextMenu.node!.path, true)}
                    >
                      <Download size={15} />
                      <span>{t('sidebar.downloadFolder')}</span>
                    </button>
                    <div className="tree-context-separator" />
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="tree-context-item"
                      onClick={() => handleDownload(contextMenu.node!.path, false)}
                    >
                      <Download size={15} />
                      <span>{t('sidebar.downloadFile')}</span>
                    </button>
                    <button
                      type="button"
                      className="tree-context-item"
                      onClick={() => triggerUploadFiles(getParentFolder(contextMenu.node!.path))}
                    >
                      <Upload size={15} />
                      <span>{t('sidebar.uploadFiles')}</span>
                    </button>
                    <button
                      type="button"
                      className="tree-context-item"
                      onClick={() => triggerUploadFolder(getParentFolder(contextMenu.node!.path))}
                    >
                      <Upload size={15} />
                      <span>{t('sidebar.uploadFolder')}</span>
                    </button>
                    <div className="tree-context-separator" />
                  </>
                )}

                {/* Favorite Toggle Button in Context Menu */}
                <button
                  type="button"
                  className="tree-context-item"
                  onClick={() => {
                    toggleFavorite(contextMenu.node!.path, contextMenu.node!.type);
                    setContextMenu(null);
                  }}
                >
                  <Star
                    size={15}
                    className={isFavorite(contextMenu.node!.path) ? 'starred-icon' : ''}
                    fill={isFavorite(contextMenu.node!.path) ? 'currentColor' : 'none'}
                  />
                  <span>
                    {isFavorite(contextMenu.node!.path)
                      ? t('sidebar.removeFromFavorites')
                      : t('sidebar.addToFavorites')}
                  </span>
                </button>
                <div className="tree-context-separator" />

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
                      node.type === 'file' && (node.extension === 'md' || node.extension === 'canvas')
                        ? node.name.replace(/\.(md|canvas)$/i, '')
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
                      node.type === 'file' && (node.extension === 'md' || node.extension === 'canvas')
                        ? node.name.replace(/\.(md|canvas)$/i, '')
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
                {onCreateCanvas && (
                  <button
                    type="button"
                    className="tree-context-item"
                    onClick={() => {
                      onCreateCanvas();
                      setContextMenu(null);
                    }}
                  >
                    <WorkflowCanvasIcon size={15} />
                    <span>{t('canvas.newCanvas')}</span>
                  </button>
                )}
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
                <div className="tree-context-separator" />
                <button
                  type="button"
                  className="tree-context-item"
                  onClick={() => triggerUploadFiles('')}
                >
                  <Upload size={15} />
                  <span>{t('sidebar.uploadFiles')}</span>
                </button>
                <button
                  type="button"
                  className="tree-context-item"
                  onClick={() => triggerUploadFolder('')}
                >
                  <Upload size={15} />
                  <span>{t('sidebar.uploadFolder')}</span>
                </button>
                <button
                  type="button"
                  className="tree-context-item"
                  onClick={() => handleDownload('', true)}
                >
                  <Download size={15} />
                  <span>{t('sidebar.downloadVault')}</span>
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

      {/* Hidden file & folder inputs for tree uploads */}
      <input
        type="file"
        multiple
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFilesChange}
      />
      <input
        type="file"
        multiple
        ref={folderInputRef}
        style={{ display: 'none' }}
        {...({ webkitdirectory: '', directory: '' } as any)}
        onChange={handleFolderChange}
      />

      {/* Upload toast indicator */}
      {uploadStatus && (
        <div className="sidebar-upload-status-toast">
          <span>{uploadStatus}</span>
        </div>
      )}

      {/* Desktop Resize Handle on right edge */}
      {onLeftResizeStart && (
        <div
          className={`sidebar-resizer-left ${isResizingLeft ? 'resizing' : ''}`}
          onMouseDown={onLeftResizeStart}
        />
      )}
    </aside>
  );
};

export const FileSidebar = React.memo(FileSidebarImpl);
