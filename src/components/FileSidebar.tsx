import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { resolveTargetFolder, collectAncestorFolders } from '../utils/fileTreeUtils';
import {
  ArrowUpDown,
  Calendar,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Clock,
  Columns,
  ArrowLeft,
  Copy,
  Database,
  ExternalLink,
  FileDown,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  Hash,
  Image as ImageIcon,
  LayoutTemplate,
  Link2,
  Mail,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Star,
  Target,
  Trash2,
  Upload,
  Download,
  History,
  Lock,
  LockOpen,
  X,
} from 'lucide-react';
import type { AggregatedExternalLink, CanvasTreeMetadata, FileTreeNode } from '../../shared/types';
import { getAttachmentKind } from '../../shared/markdownUtils';
import { LOCK_FILENAME, getLogicalExtension, isZencPath, stripZencExt } from '../crypto/folderCrypto';
import { unlockedFoldersStore } from '../crypto/unlockedFoldersStore';
import { api } from '../api';
import { useTranslation } from '../i18n';
import { WorkflowCanvasIcon } from './canvas/WorkflowCanvasIcon';
import { MoveToModal } from './MoveToModal';
import { BottomSheet, useIsMobile } from './BottomSheet';
import {
  buildCanvasTreeModel,
  extractDisplayDomain,
  findParentCanvasForCompanionFile,
  type CanvasTreeModel,
} from '../utils/canvasTreeUtils';
import { routeExternalLinkClick } from '../utils/researchLinkUtils';
import {
  sortTreeNodes,
  getTreeSortMode,
  saveTreeSortMode,
  type TreeSortMode,
} from '../utils/treeSort';
import {
  loadFavorites,
  saveFavorites,
  loadRecentNotes,
  notifyVaultEntryRenamed,
  notifyVaultEntryDeleted,
  FavoriteItem,
} from '../utils/vaultNavigation';

export type { FavoriteItem } from '../utils/vaultNavigation';

function getVisiblePaths(
  nodes: FileTreeNode[],
  expanded: Record<string, boolean>,
  canvasTreeModel?: CanvasTreeModel
): string[] {
  const result: string[] = [];
  for (const node of nodes) {
    if (node.type === 'folder' && canvasTreeModel?.suppressedFolderPaths.has(node.path)) {
      continue;
    }
    result.push(node.path);
    if (node.type === 'folder' && expanded[node.path] && node.children) {
      result.push(...getVisiblePaths(node.children, expanded, canvasTreeModel));
    } else if (node.type === 'file' && expanded[node.path]) {
      const virtual = canvasTreeModel?.canvasChildrenByPath.get(node.path);
      if (virtual && virtual.directFiles.length > 0) {
        result.push(...getVisiblePaths(virtual.directFiles, expanded, canvasTreeModel));
      }
    }
  }
  return result;
}

export interface ClipboardItem {
  path: string;
  name: string;
  type: 'file' | 'folder';
  mode: 'copy';
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
  onSelectNote: (path: string, event?: React.MouseEvent | { altKey?: boolean; preventDefault?: () => void }) => void;
  isResearchOpen?: boolean;
  onOpenInResearch?: (path: string) => void;
  onCreateNote: (parentFolder?: string) => void;
  onCreateCanvas?: (parentFolder?: string) => void;
  onCreateBase?: (parentFolder?: string) => void;
  onCreateFolder: (parentFolder?: string) => void;
  onRenameEntry: (oldPath: string, currentName: string) => void;
  onDeleteEntry: (path: string, name: string) => void;
  onActiveNoteDeleted?: () => void;
  onRefresh: () => void;
  onSelectTagFilter: (tag: string | null) => void;
  onClose?: () => void;
  onOpenVersionHistory?: (path: string) => void;
  onToggleSendTarget?: (path: string, currentStatus: boolean) => Promise<void>;
  onToggleTemplate?: (path: string, currentStatus: boolean) => Promise<void>;
  onOpenTemplateSelect?: (parentFolder?: string) => void;
  onOpenDailyNote?: () => void;
  onLeftResizeStart?: (e: React.MouseEvent) => void;
  isResizingLeft?: boolean;
  onEncryptFolder?: (folderPath: string) => void;
  onDecryptFolder?: (folderPath: string) => void;
  onUnlockFolder?: (folderPath: string) => void;
  onLockFolder?: (folderPath: string) => void;
  onTargetFolderChange?: (folder: string) => void;
  onExportPdf?: (path: string) => void;
  onSendEmail?: (path: string) => void;
  canvasMeta?: Record<string, CanvasTreeMetadata>;
  externalLinks?: AggregatedExternalLink[];
  onOpenExternalUrl?: (url: string, event?: React.MouseEvent) => void;
}

const FileSidebarImpl: React.FC<FileSidebarProps> = ({
  tree,
  activePath,
  tags,
  selectedTagFilter,
  onSelectNote,
  isResearchOpen = false,
  onOpenInResearch,
  onCreateNote,
  onCreateCanvas,
  onCreateBase,
  onCreateFolder,
  onRenameEntry,
  onDeleteEntry,
  onActiveNoteDeleted,
  onRefresh,
  onSelectTagFilter,
  onClose,
  onOpenVersionHistory,
  onToggleSendTarget,
  onToggleTemplate,
  onOpenTemplateSelect,
  onOpenDailyNote,
  onLeftResizeStart,
  isResizingLeft = false,
  onEncryptFolder,
  onDecryptFolder,
  onUnlockFolder,
  onLockFolder,
  onTargetFolderChange,
  onExportPdf,
  onSendEmail,
  canvasMeta = {},
  externalLinks = [],
  onOpenExternalUrl,
}) => {
  const { t } = useTranslation();
  const [, setLockTick] = useState(0);

  useEffect(() => {
    return unlockedFoldersStore.subscribe(() => setLockTick((n) => n + 1));
  }, []);

  const encryptedFolders = useMemo(() => {
    const set = new Set<string>();
    const walk = (nodes: FileTreeNode[]) => {
      for (const n of nodes) {
        if (n.type === 'folder' && n.children) {
          if (n.children.some((c) => c.type === 'file' && c.name === LOCK_FILENAME)) {
            set.add(n.path);
          }
          walk(n.children);
        }
      }
    };
    walk(tree);
    return set;
  }, [tree]);
  const [activeTab, setActiveTab] = useState<'files' | 'search' | 'tags'>('files');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    Projekte: true,
    Wissensbasis: true,
    'Tägliche Notizen': true,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSort, setSearchSort] = useState<'relevance' | 'newest'>('relevance');
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
      const v = localStorage.getItem('zuber_show_favorites_panel');
      if (v !== null) return v === 'true';
      return localStorage.getItem('knowmesh_show_favorites_panel') === 'true';
    } catch {
      return false;
    }
  });

  const [showRecentPanel, setShowRecentPanel] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('zuber_show_recent_panel');
      if (v !== null) return v === 'true';
      return localStorage.getItem('knowmesh_show_recent_panel') === 'true';
    } catch {
      return false;
    }
  });

  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => loadFavorites());
  const [recentNotesList, setRecentNotesList] = useState<string[]>(() => loadRecentNotes());
  const [showExternalLinksPanel, setShowExternalLinksPanel] = useState<boolean>(() => {
    try {
      return localStorage.getItem('zuber_show_external_links_panel') === 'true';
    } catch {
      return false;
    }
  });
  const [externalLinksFilter, setExternalLinksFilter] = useState('');
  const [expandedExternalUrls, setExpandedExternalUrls] = useState<Record<string, boolean>>({});

  // File tree sorting state
  const [treeSortMode, setTreeSortMode] = useState<TreeSortMode>(getTreeSortMode);
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const sortBtnRef = useRef<HTMLButtonElement>(null);

  const sortedTree = useMemo<FileTreeNode[]>(() => {
    return sortTreeNodes(tree, treeSortMode);
  }, [tree, treeSortMode]);

  const canvasTreeModel = useMemo(
    () => buildCanvasTreeModel(sortedTree, canvasMeta, treeSortMode),
    [sortedTree, canvasMeta, treeSortMode]
  );

  const filteredExternalLinks = useMemo(() => {
    const q = externalLinksFilter.trim().toLowerCase();
    if (!q) return externalLinks;
    return externalLinks.filter((item) => {
      if (item.url.toLowerCase().includes(q)) return true;
      if (item.domain.toLowerCase().includes(q)) return true;
      if (item.title && item.title.toLowerCase().includes(q)) return true;
      return item.sources.some(
        (s) => s.name.toLowerCase().includes(q) || s.path.toLowerCase().includes(q)
      );
    });
  }, [externalLinks, externalLinksFilter]);

  const handleSelectSortMode = (mode: TreeSortMode) => {
    setTreeSortMode(mode);
    saveTreeSortMode(mode);
    setIsSortMenuOpen(false);
  };

  useEffect(() => {
    if (!isSortMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        sortMenuRef.current &&
        !sortMenuRef.current.contains(e.target as Node) &&
        sortBtnRef.current &&
        !sortBtnRef.current.contains(e.target as Node)
      ) {
        setIsSortMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSortMenuOpen]);

  const reloadFavorites = useCallback(() => {
    setFavorites(loadFavorites());
  }, []);

  const reloadRecentNotes = useCallback(() => {
    setRecentNotesList(loadRecentNotes());
  }, []);

  useEffect(() => {
    const handleFavChange = () => reloadFavorites();
    const handleRecentChange = () => reloadRecentNotes();

    window.addEventListener('zuber_favorites_changed', handleFavChange);
    window.addEventListener('knowmesh_favorites_changed', handleFavChange);
    window.addEventListener('zuber_recent_changed', handleRecentChange);
    window.addEventListener('knowmesh_recent_changed', handleRecentChange);
    window.addEventListener('storage', handleFavChange);
    window.addEventListener('storage', handleRecentChange);

    return () => {
      window.removeEventListener('zuber_favorites_changed', handleFavChange);
      window.removeEventListener('knowmesh_favorites_changed', handleFavChange);
      window.removeEventListener('zuber_recent_changed', handleRecentChange);
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

  // Multi-Select state
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const lastClickedPathRef = useRef<string | null>(null);

  // Drag & Drop state
  const [dropTargetFolder, setDropTargetFolder] = useState<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // MoveToModal state
  const [moveToModalPaths, setMoveToModalPaths] = useState<string[] | null>(null);

  // Clipboard & Context menu states
  const isMobile = useIsMobile();
  const [isMobileNewMenuOpen, setIsMobileNewMenuOpen] = useState(false);
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
      console.error('[Zuber] Upload error:', err);
      alert((err as Error).message || t('sidebar.uploadError'));
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
      console.error('[Zuber] Folder upload error:', err);
      alert((err as Error).message || t('sidebar.uploadFolderError'));
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
      console.error('[Zuber] Download error:', err);
      alert((err as Error).message || t('sidebar.downloadError'));
    }
  };

  const handleDownloadBatch = async (paths: string[]) => {
    setContextMenu(null);
    try {
      await api.downloadBatch(paths);
    } catch (err: unknown) {
      console.error('[Zuber] Batch download error:', err);
      alert((err as Error).message || t('sidebar.downloadBatchError'));
    }
  };

  // Close context menu on click outside or escape key (desktop only; mobile uses BottomSheet)
  useEffect(() => {
    if (!contextMenu || isMobile) return;

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
  }, [contextMenu, isMobile]);

  // Dynamic viewport collision detection & smart positioning for context menu
  useLayoutEffect(() => {
    if (!contextMenuRef.current || !contextMenu) return;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const margin = 12;

    let newTop = contextMenu.y;
    let newLeft = contextMenu.x;

    // If the menu protrudes below the bottom viewport edge, shift it upwards:
    if (newTop + rect.height > window.innerHeight - margin) {
      newTop = Math.max(margin, window.innerHeight - rect.height - margin);
    }

    // Also prevent overflow off the right edge:
    if (newLeft + rect.width > window.innerWidth - margin) {
      newLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    }

    // Apply corrected position
    contextMenuRef.current.style.top = `${newTop}px`;
    contextMenuRef.current.style.left = `${newLeft}px`;
  }, [contextMenu]);

  // Switch to search tab automatically when a tag filter is selected externally
  useEffect(() => {
    if (selectedTagFilter) {
      setActiveTab('search');
    }
  }, [selectedTagFilter]);

  // Automatically expand ancestor folders (and owning .canvas virtual tree) when activePath changes
  useEffect(() => {
    if (!activePath) return;
    const owningCanvas = findParentCanvasForCompanionFile(activePath, canvasTreeModel);
    const parts = activePath.includes('/') ? activePath.split('/') : [];
    if (parts.length > 0) parts.pop(); // remove filename
    if (parts.length === 0 && !owningCanvas) return;

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
      if (owningCanvas && !next[owningCanvas]) {
        next[owningCanvas] = true;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [activePath, canvasTreeModel]);

  // Synchronize activePath with selectedPaths
  useEffect(() => {
    if (activePath) {
      setSelectedPaths(new Set([activePath]));
      lastClickedPathRef.current = activePath;
    }
  }, [activePath]);

  const targetFolder = useMemo(() => resolveTargetFolder(selectedPaths, tree), [selectedPaths, tree]);

  useEffect(() => {
    onTargetFolderChange?.(targetFolder);
  }, [targetFolder, onTargetFolderChange]);

  const expandTargetFolderAncestors = useCallback((folder: string) => {
    const ancestors = collectAncestorFolders(folder);
    if (ancestors.length === 0) return;
    setExpandedFolders((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const p of ancestors) {
        if (!next[p]) {
          next[p] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const triggerCreateInTarget = useCallback(
    (fn?: (parentFolder?: string) => void) => {
      if (!fn) return;
      if (targetFolder) {
        expandTargetFolderAncestors(targetFolder);
      }
      fn(targetFolder || undefined);
    },
    [targetFolder, expandTargetFolderAncestors]
  );

  // Global Escape key listener to clear selection
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedPaths(new Set());
        lastClickedPathRef.current = null;
      }
    };
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    if (activeTab !== 'search' && !selectedTagFilter) return;

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.search(searchQuery, selectedTagFilter || undefined, searchSort);
        setSearchResults(res.results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [searchQuery, selectedTagFilter, activeTab, searchSort]);

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderPath]: !prev[folderPath],
    }));
  };

  const openContextMenu = (node: FileTreeNode | null, clientX: number, clientY: number) => {
    if (node) {
      setSelectedPaths((prev) => {
        if (!prev.has(node.path)) {
          lastClickedPathRef.current = node.path;
          return new Set([node.path]);
        }
        return prev;
      });
    } else {
      setSelectedPaths(new Set());
    }

    const x = typeof clientX === 'number' && !isNaN(clientX) ? clientX : 20;
    const y = typeof clientY === 'number' && !isNaN(clientY) ? clientY : 20;

    const estimatedWidth = 240;
    const estimatedHeight = 420;
    const initialX = Math.max(12, Math.min(x, window.innerWidth - estimatedWidth - 12));
    const initialY = Math.max(12, Math.min(y, window.innerHeight - estimatedHeight - 12));
    setContextMenu({ x: initialX, y: initialY, node });
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

  const handleFolderClick = (e: React.MouseEvent, node: FileTreeNode) => {
    e.stopPropagation();

    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    if (isCtrlOrCmd) {
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(node.path)) {
          next.delete(node.path);
        } else {
          next.add(node.path);
        }
        return next;
      });
      lastClickedPathRef.current = node.path;
      return;
    }

    if (isShift && lastClickedPathRef.current) {
      const visible = getVisiblePaths(sortedTree, expandedFolders, canvasTreeModel);
      const anchorIdx = visible.indexOf(lastClickedPathRef.current);
      const targetIdx = visible.indexOf(node.path);
      if (anchorIdx !== -1 && targetIdx !== -1) {
        const start = Math.min(anchorIdx, targetIdx);
        const end = Math.max(anchorIdx, targetIdx);
        const range = visible.slice(start, end + 1);
        setSelectedPaths(new Set(range));
        return;
      }
    }

    // Normal click on folder
    toggleFolder(node.path);
    setSelectedPaths(new Set([node.path]));
    lastClickedPathRef.current = node.path;
  };

  const handleFileClick = (e: React.MouseEvent, node: FileTreeNode) => {
    e.stopPropagation();

    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    if (isCtrlOrCmd) {
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(node.path)) {
          next.delete(node.path);
        } else {
          next.add(node.path);
        }
        return next;
      });
      lastClickedPathRef.current = node.path;
      return;
    }

    if (isShift && lastClickedPathRef.current) {
      const visible = getVisiblePaths(sortedTree, expandedFolders, canvasTreeModel);
      const anchorIdx = visible.indexOf(lastClickedPathRef.current);
      const targetIdx = visible.indexOf(node.path);
      if (anchorIdx !== -1 && targetIdx !== -1) {
        const start = Math.min(anchorIdx, targetIdx);
        const end = Math.max(anchorIdx, targetIdx);
        const range = visible.slice(start, end + 1);
        setSelectedPaths(new Set(range));
        return;
      }
    }

    if (e.altKey) {
      e.preventDefault();
    }

    // Normal click on file (without modifier or with Alt)
    setSelectedPaths(new Set([node.path]));
    lastClickedPathRef.current = node.path;

    const logicalPath = stripZencExt(node.path);
    const logicalExt = getLogicalExtension(node.path) || node.extension;
    const isDoc =
      logicalExt === 'md' ||
      logicalExt === 'canvas' ||
      logicalPath.endsWith('.canvas') ||
      logicalExt === 'base' ||
      logicalPath.endsWith('.base');
    const isMediaOrPdf = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|pdf)$/i.test(logicalPath);

    if (isDoc || isZencPath(node.path) || (isResearchOpen && isMediaOrPdf)) {
      if (e.altKey) {
        onSelectNote(node.path, { altKey: true });
      } else {
        onSelectNote(node.path);
      }
    } else {
      window.open(api.getAttachmentUrl(node.path), '_blank');
    }
  };

  const handleCopy = (node: FileTreeNode) => {
    const logicalName = stripZencExt(node.name);
    const logicalExt = getLogicalExtension(node.name);
    const displayName =
      node.type === 'file' &&
      (logicalExt === 'md' || logicalExt === 'canvas' || logicalExt === 'base')
        ? logicalName.replace(/\.(md|canvas|base)$/i, '')
        : logicalName;
    setClipboard({
      path: node.path,
      name: displayName,
      type: node.type,
      mode: 'copy',
    });
    setContextMenu(null);
  };

  const handlePaste = async (targetNode: FileTreeNode | null) => {
    if (!clipboard) return;
    setContextMenu(null);

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
      await api.copyEntry(clipboard.path, destinationPath);
      onRefresh();
    } catch (err) {
      console.error('[Zuber] Paste error:', err);
      alert((err as Error).message || t('sidebar.pasteError'));
    }
  };

  const handleDeleteSelected = async () => {
    const paths = Array.from(selectedPaths);
    if (paths.length === 0) return;
    const confirmed = window.confirm(
      t('sidebar.deleteItemsConfirm', {
        count: paths.length,
        defaultValue: `Möchtest du die ${paths.length} ausgewählten Elemente wirklich löschen?`,
      })
    );
    if (!confirmed) return;

    let activeDeleted = false;
    for (const p of paths) {
      try {
        await api.deleteEntry(p);
        notifyVaultEntryDeleted(p);
        if (activePath && (activePath === p || activePath.startsWith(p + '/'))) {
          activeDeleted = true;
        }
      } catch (err) {
        console.error(`[Zuber] Delete error for ${p}:`, err);
      }
    }
    setSelectedPaths(new Set());
    onRefresh();
    if (activeDeleted && onActiveNoteDeleted) {
      onActiveNoteDeleted();
    }
  };

  const handleMoveTo = async (targetFolder: string) => {
    if (!moveToModalPaths || moveToModalPaths.length === 0) return;

    const validMoves = moveToModalPaths.filter((srcPath) => {
      const currentParent = getParentFolder(srcPath);
      if (currentParent === targetFolder) return false;
      if (targetFolder === srcPath || targetFolder.startsWith(`${srcPath}/`)) return false;
      return true;
    });

    if (validMoves.length === 0) return;

    const moves = validMoves.map((srcPath) => {
      const fileName = srcPath.split('/').pop() || '';
      const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
      return { oldPath: srcPath, newPath };
    });

    await api.moveBatch(moves);
    for (const m of moves) {
      notifyVaultEntryRenamed(m.oldPath, m.newPath);
    }
    if (targetFolder) {
      setExpandedFolders((prev) => ({ ...prev, [targetFolder]: true }));
    }
    setSelectedPaths(new Set());
    onRefresh();
  };

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, node: FileTreeNode) => {
    let pathsToMove: string[];
    if (selectedPaths.has(node.path)) {
      pathsToMove = Array.from(selectedPaths);
    } else {
      pathsToMove = [node.path];
      setSelectedPaths(new Set([node.path]));
      lastClickedPathRef.current = node.path;
    }

    e.dataTransfer.setData('application/x-knowmesh-paths', JSON.stringify(pathsToMove));
    e.dataTransfer.setData('application/x-knowmesh-file-path', node.path);
    if (node.type === 'file') {
      const kind = node.attachmentKind || getAttachmentKind(stripZencExt(node.path));
      e.dataTransfer.setData(
        'application/x-zuber-file',
        JSON.stringify({
          path: node.path,
          name: node.name,
          kind,
          extension: node.extension || getLogicalExtension(node.path),
        })
      );
    }
    e.dataTransfer.setData('text/plain', node.path);
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleDragOverItem = (e: React.DragEvent, node: FileTreeNode) => {
    e.preventDefault();
    e.stopPropagation();

    const targetFolder = node.type === 'folder' ? node.path : getParentFolder(node.path);
    if (dropTargetFolder !== targetFolder) {
      setDropTargetFolder(targetFolder);
    }

    if (node.type === 'folder' && !expandedFolders[node.path]) {
      if (!hoverTimerRef.current) {
        hoverTimerRef.current = setTimeout(() => {
          setExpandedFolders((prev) => ({ ...prev, [node.path]: true }));
          hoverTimerRef.current = null;
        }, 500);
      }
    } else {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    }

    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragOverScroller = (e: React.DragEvent) => {
    if ((e.target as HTMLElement).closest('.tree-item')) return;
    e.preventDefault();
    if (dropTargetFolder !== '') {
      setDropTargetFolder('');
    }
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const handleDrop = async (e: React.DragEvent, targetFolder: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTargetFolder(null);
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    // Case A: Internal move
    if (e.dataTransfer.types.includes('application/x-knowmesh-paths')) {
      try {
        const raw = e.dataTransfer.getData('application/x-knowmesh-paths');
        const pathsToMove: string[] = JSON.parse(raw);
        if (!Array.isArray(pathsToMove) || pathsToMove.length === 0) return;

        const validMoves = pathsToMove.filter((srcPath) => {
          const currentParent = getParentFolder(srcPath);
          if (currentParent === targetFolder) return false;
          if (targetFolder === srcPath || targetFolder.startsWith(`${srcPath}/`)) return false;
          return true;
        });

        if (validMoves.length === 0) return;

        const moves = validMoves.map((srcPath) => {
          const fileName = srcPath.split('/').pop() || '';
          const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
          return { oldPath: srcPath, newPath };
        });

        await api.moveBatch(moves);
        for (const m of moves) {
          notifyVaultEntryRenamed(m.oldPath, m.newPath);
        }
        if (targetFolder) {
          setExpandedFolders((prev) => ({ ...prev, [targetFolder]: true }));
        }
        setSelectedPaths(new Set());
        onRefresh();
      } catch (err) {
        console.error('[Zuber] Drag drop internal move error:', err);
        alert((err as Error).message || t('sidebar.moveError'));
      }
      return;
    }

    // Case B: External file upload from OS
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      try {
        setUploadStatus(t('sidebar.uploading'));
        const res = await api.uploadEntries(targetFolder, files);
        if (targetFolder) {
          setExpandedFolders((prev) => ({ ...prev, [targetFolder]: true }));
        }
        onRefresh();
        setUploadStatus(t('sidebar.uploadSuccess', { count: res.count }));
        setTimeout(() => setUploadStatus(null), 3500);
      } catch (err: unknown) {
        console.error('[Zuber] Drop upload error:', err);
        alert((err as Error).message || t('sidebar.uploadError'));
        setUploadStatus(null);
      }
    }
  };

  const handleOpenExternalLinkItem = (url: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onOpenExternalUrl) {
      onOpenExternalUrl(url, e);
      return;
    }
    routeExternalLinkClick({
      url,
      isResearchOpen,
      event: e,
      openExternal: (u) => window.open(u, '_blank', 'noopener,noreferrer'),
    });
  };

  const renderFileNodeIcon = (
    isCanvasFile: boolean,
    isBaseFile: boolean,
    isMdFile: boolean,
    isPdfFile: boolean
  ) => {
    if (isCanvasFile) return <WorkflowCanvasIcon size={14} className="tree-canvas-icon" />;
    if (isBaseFile) return <Database size={14} className="tree-base-icon" />;
    if (isMdFile || isPdfFile) return <FileText size={14} />;
    return <ImageIcon size={14} />;
  };

  const renderTreeNode = (node: FileTreeNode, depth = 0) => {
    if (node.type === 'file' && node.name === LOCK_FILENAME) {
      return null;
    }
    if (node.type === 'folder') {
      if (canvasTreeModel.suppressedFolderPaths.has(node.path)) {
        return null;
      }
      const isExpanded = Boolean(expandedFolders[node.path]);
      const isSelected = selectedPaths.has(node.path);
      const isDropTarget = dropTargetFolder === node.path;
      const isEncrypted = encryptedFolders.has(node.path);
      const isUnlocked = isEncrypted && unlockedFoldersStore.isFolderUnlocked(node.path);
      return (
        <div key={node.path} className="tree-folder-group">
          <div
            className={`tree-item tree-folder-item ${isSelected ? 'is-selected' : ''} ${isDropTarget ? 'is-drop-target' : ''}`}
            style={{ paddingLeft: `${10 + depth * 14}px` }}
            draggable={true}
            onDragStart={(e) => handleDragStart(e, node)}
            onDragOver={(e) => handleDragOverItem(e, node)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, node.path)}
            onClick={(e) => {
              handleFolderClick(e, node);
              if (isEncrypted && !isUnlocked && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                onUnlockFolder?.(node.path);
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
            <span className="tree-chevron">
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
            <span className="tree-icon folder-icon">
              {isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}
            </span>
            <span className="tree-label" title={node.path}>
              {node.name}
            </span>
            {isEncrypted && (
              isUnlocked ? (
                <button
                  type="button"
                  className="tree-folder-lock-badge is-unlocked"
                  title={t('encryption.lockFolder')}
                  aria-label={t('encryption.lockFolder')}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onLockFolder) {
                      onLockFolder(node.path);
                    } else {
                      unlockedFoldersStore.lockFolder(node.path);
                    }
                  }}
                >
                  <LockOpen size={13} />
                </button>
              ) : (
                <span
                  className="tree-folder-lock-badge is-locked"
                  title={t('encryption.unlockFolder')}
                >
                  <Lock size={13} />
                </span>
              )
            )}
            <button
              type="button"
              className="tree-item-more-btn"
              title={t('sidebar.menu')}
              aria-label={t('sidebar.menu')}
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

    const logicalName = stripZencExt(node.name);
    const logicalExt = getLogicalExtension(node.name);
    const isMd = logicalExt === 'md';
    const isPdf = logicalExt === 'pdf';
    const isCanvas =
      logicalExt === 'canvas' ||
      stripZencExt(node.path).endsWith('.canvas') ||
      node.attachmentKind === 'canvas';
    const isBase =
      logicalExt === 'base' ||
      stripZencExt(node.path).endsWith('.base') ||
      node.attachmentKind === 'base';
    const isActive = activePath === node.path;
    const isSelected = selectedPaths.has(node.path);
    const isDropTarget = dropTargetFolder === getParentFolder(node.path);
    const displayName = isMd
      ? logicalName.replace(/\.md$/i, '')
      : isCanvas
      ? logicalName.replace(/\.canvas$/i, '')
      : isBase
      ? logicalName.replace(/\.base$/i, '')
      : logicalName;

    const virtualChildren = isCanvas ? canvasTreeModel.canvasChildrenByPath.get(node.path) : undefined;
    const hasCanvasChildren = Boolean(isCanvas && virtualChildren?.hasChildren);
    const isCanvasExpanded = Boolean(hasCanvasChildren && expandedFolders[node.path]);

    const fileRow = (
      <div
        key={hasCanvasChildren ? undefined : node.path}
        className={`tree-item tree-file-item ${isActive ? 'active' : ''} ${isSelected ? 'is-selected' : ''} ${isDropTarget ? 'is-drop-target' : ''} ${!isMd && !isCanvas && !isBase ? 'attachment-item' : ''} ${isCanvas ? 'canvas-item' : ''} ${isBase ? 'base-item' : ''}`}
        style={{ paddingLeft: `${(hasCanvasChildren ? 10 : 26) + depth * 14}px` }}
        draggable={true}
        onDragStart={(e) => handleDragStart(e, node)}
        onDragOver={(e) => handleDragOverItem(e, node)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, getParentFolder(node.path))}
        onClick={(e) => handleFileClick(e, node)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openContextMenu(node, e.clientX, e.clientY);
        }}
        onTouchStart={(e) => handleTouchStart(e, node)}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
      >
        {hasCanvasChildren && (
          <button
            type="button"
            className="tree-chevron tree-canvas-chevron-btn"
            aria-expanded={isCanvasExpanded}
            aria-label={isCanvasExpanded ? t('sidebar.collapseCanvas') : t('sidebar.expandCanvas')}
            title={isCanvasExpanded ? t('sidebar.collapseCanvas') : t('sidebar.expandCanvas')}
            onClick={(e) => {
              e.stopPropagation();
              toggleFolder(node.path);
            }}
          >
            {isCanvasExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        <span className="tree-icon">
          {renderFileNodeIcon(isCanvas, isBase, isMd, isPdf)}
        </span>
        <span className="tree-label" title={node.path}>
          {displayName}
        </span>
        {node.isSendTarget && (
          <span className="tree-send-target-badge" title={t('sidebar.sendTargetBadge') || 'Sende-Ziel Notiz'}>
            <Target size={12} className="send-target-icon" />
          </span>
        )}
        {node.isTemplate && (
          <span className="tree-template-badge" title={t('sidebar.templateBadge') || 'Vorlage'}>
            <LayoutTemplate size={12} className="template-icon" />
          </span>
        )}
        {isCanvas && <span className="file-ext-badge canvas-badge">CANVAS</span>}
        {isBase && <span className="file-ext-badge base-badge">BASE</span>}
        {!isMd && !isCanvas && !isBase && <span className="file-ext-badge">{getLogicalExtension(node.path) || node.extension}</span>}
        <button
          type="button"
          className="tree-item-more-btn"
          title={t('sidebar.menu')}
          aria-label={t('sidebar.menu')}
          onClick={(e) => {
            e.stopPropagation();
            openContextMenu(node, e.clientX, e.clientY);
          }}
        >
          <MoreVertical size={14} />
        </button>
      </div>
    );

    if (!hasCanvasChildren || !virtualChildren) {
      return fileRow;
    }

    return (
      <div key={node.path} className="tree-canvas-group">
        {fileRow}
        {isCanvasExpanded && (
          <div className="tree-canvas-children">
            {/* 1. Physical companion files inside <Canvas>.canvas.assets/ */}
            {virtualChildren.directFiles.map((child) => renderTreeNode(child, depth + 1))}

            {/* 2. Linked vault files residing outside the companion folder */}
            {virtualChildren.linkedFiles.map((linkedNode) => {
              const linkedLogicalName = stripZencExt(linkedNode.name);
              const linkedExt = getLogicalExtension(linkedNode.name);
              const linkedIsMd = linkedExt === 'md';
              const linkedIsPdf = linkedExt === 'pdf';
              const linkedIsCanvas = linkedExt === 'canvas';
              const linkedIsBase = linkedExt === 'base';
              const linkedDisplayName = linkedIsMd
                ? linkedLogicalName.replace(/\.md$/i, '')
                : linkedIsCanvas
                ? linkedLogicalName.replace(/\.canvas$/i, '')
                : linkedIsBase
                ? linkedLogicalName.replace(/\.base$/i, '')
                : linkedLogicalName;

              return (
                <div
                  key={`linked::${node.path}::${linkedNode.path}`}
                  className={`tree-item tree-file-item canvas-linked-file-item ${
                    activePath === linkedNode.path ? 'active' : ''
                  }`}
                  style={{ paddingLeft: `${26 + (depth + 1) * 14}px` }}
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, linkedNode)}
                  onClick={(e) => handleFileClick(e, linkedNode)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openContextMenu(linkedNode, e.clientX, e.clientY);
                  }}
                >
                  <span className="tree-icon">
                    {renderFileNodeIcon(linkedIsCanvas, linkedIsBase, linkedIsMd, linkedIsPdf)}
                  </span>
                  <span
                    className="tree-label"
                    title={`${t('sidebar.linkedFromCanvas')}: ${linkedNode.path}`}
                  >
                    {linkedDisplayName}
                  </span>
                  <span
                    className="canvas-linked-indicator"
                    title={`${t('sidebar.linkedFromCanvas')}: ${linkedNode.path}`}
                  >
                    <Link2 size={12} />
                  </span>
                </div>
              );
            })}

            {/* 3. External Web Links referenced on the canvas */}
            {virtualChildren.externalLinks.map((ext) => {
              const label = ext.title || extractDisplayDomain(ext.url);
              return (
                <div
                  key={`ext::${node.path}::${ext.url}`}
                  className="tree-item canvas-external-link-item"
                  style={{ paddingLeft: `${26 + (depth + 1) * 14}px` }}
                  title={ext.url}
                  onClick={(e) => handleOpenExternalLinkItem(ext.url, e)}
                >
                  <span className="tree-icon external-link-icon">
                    <Globe size={13} />
                  </span>
                  <span className="tree-label">{label}</span>
                  <span className="external-link-open-icon">
                    <ExternalLink size={11} />
                  </span>
                </div>
              );
            })}
          </div>
        )}
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
          <Folder size={isMobile ? 20 : 15} />
        </button>
        <button
          type="button"
          className={`sidebar-tab-btn icon-only ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveTab('search')}
          title={t('sidebar.search')}
          aria-label={t('sidebar.search')}
        >
          <Search size={isMobile ? 20 : 15} />
        </button>
        <button
          type="button"
          className={`sidebar-tab-btn icon-only ${activeTab === 'tags' ? 'active' : ''}`}
          onClick={() => setActiveTab('tags')}
          title={t('sidebar.tags')}
          aria-label={t('sidebar.tags')}
        >
          <Hash size={isMobile ? 20 : 15} />
        </button>
        <button
          type="button"
          className={`sidebar-tab-btn icon-only latch-btn ${showFavoritesPanel ? 'active' : ''}`}
          onClick={() => {
            setShowFavoritesPanel((prev) => {
              const next = !prev;
              try {
                localStorage.setItem('zuber_show_favorites_panel', String(next));
              } catch {}
              return next;
            });
            setActiveTab('files');
          }}
          title={t('sidebar.favoritesTitle')}
          aria-label={t('sidebar.favorites')}
        >
          <Star size={isMobile ? 20 : 15} className={showFavoritesPanel ? 'starred-icon' : ''} fill={showFavoritesPanel ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          className={`sidebar-tab-btn icon-only latch-btn ${showRecentPanel ? 'active' : ''}`}
          onClick={() => {
            setShowRecentPanel((prev) => {
              const next = !prev;
              try {
                localStorage.setItem('zuber_show_recent_panel', String(next));
              } catch {}
              return next;
            });
            setActiveTab('files');
          }}
          title={t('sidebar.recentNotesTitle')}
          aria-label={t('sidebar.recentNotes')}
        >
          <Clock size={isMobile ? 20 : 15} />
        </button>
        {onClose && (
          <button
            type="button"
            className="sidebar-tab-btn close-sidebar-btn icon-only"
            onClick={onClose}
            title={t('sidebar.closeLeft')}
            aria-label={t('sidebar.closeLeft')}
          >
            <X size={isMobile ? 20 : 15} />
          </button>
        )}
      </div>

      {activeTab === 'files' && (
        <>
          <div className={`sidebar-action-bar${isMobile ? ' is-mobile' : ''}`}>
            <div className="sidebar-action-left">
              {isMobile ? (
                <button
                  type="button"
                  className="sidebar-mobile-new-btn"
                  aria-label={`+ ${t('sidebar.newMenu')}`}
                  aria-expanded={isMobileNewMenuOpen}
                  onClick={() => setIsMobileNewMenuOpen(true)}
                >
                  <Plus size={18} />
                  <span>{t('sidebar.newMenu')}</span>
                  <ChevronDown size={16} />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="sidebar-icon-btn icon-only"
                    title={t('sidebar.newNoteTitle')}
                    aria-label={t('sidebar.newNote')}
                    onClick={() => triggerCreateInTarget(onCreateNote)}
                  >
                    <FilePlus size={16} />
                  </button>
                  {onOpenTemplateSelect && (
                    <button
                      type="button"
                      className="sidebar-icon-btn icon-only"
                      title={t('sidebar.newFromTemplate')}
                      aria-label={t('sidebar.newFromTemplate')}
                      onClick={() => triggerCreateInTarget(onOpenTemplateSelect)}
                    >
                      <LayoutTemplate size={15} />
                    </button>
                  )}
                </>
              )}
            </div>
            <div className="sidebar-action-right">
              {onOpenDailyNote && (
                <button
                  type="button"
                  className="sidebar-icon-btn icon-only"
                  title={t('sidebar.openDailyNote')}
                  aria-label={t('sidebar.openDailyNote')}
                  onClick={onOpenDailyNote}
                >
                  <Calendar size={isMobile ? 19 : 15} />
                </button>
              )}
              <div className="sidebar-sort-container">
                <button
                  ref={sortBtnRef}
                  type="button"
                  className={`sidebar-icon-btn icon-only ${isSortMenuOpen ? 'active' : ''}`}
                  title={t('sidebar.sort')}
                  aria-label={t('sidebar.sort')}
                  onClick={() => setIsSortMenuOpen((prev) => !prev)}
                >
                  <ArrowUpDown size={isMobile ? 19 : 15} />
                </button>
                {isSortMenuOpen && (
                  <div className="tree-sort-menu" ref={sortMenuRef}>
                    <div className="tree-sort-header">{t('sidebar.sort')}</div>
                    <button
                      type="button"
                      className={`sort-menu-item ${treeSortMode === 'name-asc' ? 'active' : ''}`}
                      onClick={() => handleSelectSortMode('name-asc')}
                    >
                      <span className="sort-menu-check">{treeSortMode === 'name-asc' ? '✓' : ''}</span>
                      <span>{t('sidebar.sortNameAsc')}</span>
                    </button>
                    <button
                      type="button"
                      className={`sort-menu-item ${treeSortMode === 'name-desc' ? 'active' : ''}`}
                      onClick={() => handleSelectSortMode('name-desc')}
                    >
                      <span className="sort-menu-check">{treeSortMode === 'name-desc' ? '✓' : ''}</span>
                      <span>{t('sidebar.sortNameDesc')}</span>
                    </button>
                    <div className="sort-menu-divider" />
                    <button
                      type="button"
                      className={`sort-menu-item ${treeSortMode === 'mtime-desc' ? 'active' : ''}`}
                      onClick={() => handleSelectSortMode('mtime-desc')}
                    >
                      <span className="sort-menu-check">{treeSortMode === 'mtime-desc' ? '✓' : ''}</span>
                      <span>{t('sidebar.sortDateDesc')}</span>
                    </button>
                    <button
                      type="button"
                      className={`sort-menu-item ${treeSortMode === 'mtime-asc' ? 'active' : ''}`}
                      onClick={() => handleSelectSortMode('mtime-asc')}
                    >
                      <span className="sort-menu-check">{treeSortMode === 'mtime-asc' ? '✓' : ''}</span>
                      <span>{t('sidebar.sortDateAsc')}</span>
                    </button>
                  </div>
                )}
              </div>
              {!isMobile && onCreateCanvas && (
                <button
                  type="button"
                  className="sidebar-icon-btn icon-only"
                  title={t('canvas.newCanvas')}
                  onClick={() => triggerCreateInTarget(onCreateCanvas)}
                >
                  <WorkflowCanvasIcon size={15} />
                </button>
              )}
              {!isMobile && onCreateBase && (
                <button
                  type="button"
                  className="sidebar-icon-btn icon-only"
                  title={t('sidebar.newBase') || 'Neue Base'}
                  aria-label={t('sidebar.newBase') || 'Neue Base'}
                  onClick={() => triggerCreateInTarget(onCreateBase)}
                >
                  <Database size={15} />
                </button>
              )}
              {!isMobile && (
                <button
                  type="button"
                  className="sidebar-icon-btn icon-only"
                  title={t('sidebar.newFolder')}
                  onClick={() => triggerCreateInTarget(onCreateFolder)}
                >
                  <FolderPlus size={16} />
                </button>
              )}
              <button
                type="button"
                className="sidebar-icon-btn icon-only"
                title={t('sidebar.refreshTitle')}
                aria-label={t('sidebar.refreshTitle')}
                onClick={onRefresh}
              >
                <RefreshCw size={isMobile ? 19 : 15} />
              </button>
            </div>
          </div>

          <BottomSheet
            isOpen={isMobile && isMobileNewMenuOpen}
            onClose={() => setIsMobileNewMenuOpen(false)}
            title={`+ ${t('sidebar.newMenu')}`}
          >
            <div className="bottom-sheet-action-list">
              {targetFolder && (
                <div className="bottom-sheet-target-folder">
                  {t('sidebar.createIn', { folder: targetFolder })}
                </div>
              )}
              <button
                type="button"
                className="bottom-sheet-action-row"
                onClick={() => {
                  setIsMobileNewMenuOpen(false);
                  triggerCreateInTarget(onCreateNote);
                }}
              >
                <FilePlus size={18} />
                <span>{t('sidebar.newNote')}</span>
              </button>
              {onOpenTemplateSelect && (
                <button
                  type="button"
                  className="bottom-sheet-action-row"
                  onClick={() => {
                    setIsMobileNewMenuOpen(false);
                    triggerCreateInTarget(onOpenTemplateSelect);
                  }}
                >
                  <LayoutTemplate size={18} />
                  <span>{t('sidebar.newFromTemplate')}</span>
                </button>
              )}
              {onCreateCanvas && (
                <button
                  type="button"
                  className="bottom-sheet-action-row"
                  onClick={() => {
                    setIsMobileNewMenuOpen(false);
                    triggerCreateInTarget(onCreateCanvas);
                  }}
                >
                  <WorkflowCanvasIcon size={18} />
                  <span>{t('canvas.newCanvas')}</span>
                </button>
              )}
              {onCreateBase && (
                <button
                  type="button"
                  className="bottom-sheet-action-row"
                  onClick={() => {
                    setIsMobileNewMenuOpen(false);
                    triggerCreateInTarget(onCreateBase);
                  }}
                >
                  <Database size={18} />
                  <span>{t('sidebar.newBase')}</span>
                </button>
              )}
              <button
                type="button"
                className="bottom-sheet-action-row"
                onClick={() => {
                  setIsMobileNewMenuOpen(false);
                  triggerCreateInTarget(onCreateFolder);
                }}
              >
                <FolderPlus size={18} />
                <span>{t('sidebar.newFolder')}</span>
              </button>
            </div>
          </BottomSheet>

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
                        onClick={(e) => {
                          if (fav.type === 'file') {
                            if (e.altKey) {
                              e.preventDefault();
                              onSelectNote(fav.path, { altKey: true });
                            } else {
                              onSelectNote(fav.path);
                            }
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
                        onClick={(e) => {
                          if (e.altKey) {
                            e.preventDefault();
                            onSelectNote(notePath, { altKey: true });
                          } else {
                            onSelectNote(notePath);
                          }
                        }}
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
            className={`file-tree-scroller scroller ${dropTargetFolder === '' ? 'is-drop-target' : ''}`}
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest('.tree-item')) {
                setSelectedPaths(new Set());
                lastClickedPathRef.current = null;
              }
            }}
            onDragOver={handleDragOverScroller}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, '')}
            onContextMenu={(e) => {
              if ((e.target as HTMLElement).closest('.tree-item')) return;
              e.preventDefault();
              openContextMenu(null, e.clientX, e.clientY);
            }}
          >
            {sortedTree.map((node) => renderTreeNode(node, 0))}
          </div>

          {/* Collapsible Vault-Wide External Links Section */}
          <div className={`sidebar-external-links-section ${showExternalLinksPanel ? 'is-expanded' : ''}`}>
            <button
              type="button"
              className="sidebar-external-links-header"
              aria-expanded={showExternalLinksPanel}
              onClick={() => {
                setShowExternalLinksPanel((prev) => {
                  const next = !prev;
                  try {
                    localStorage.setItem('zuber_show_external_links_panel', String(next));
                  } catch {}
                  return next;
                });
              }}
            >
              <span className="sidebar-external-links-header-left">
                {showExternalLinksPanel ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Globe size={13} />
                <span>{t('sidebar.externalLinks')}</span>
              </span>
              <span className="sidebar-section-count">({externalLinks.length})</span>
            </button>

            {showExternalLinksPanel && (
              <div className="sidebar-external-links-body">
                <div className="sidebar-external-links-filter">
                  <Search size={13} className="external-filter-icon" />
                  <input
                    type="search"
                    placeholder={t('sidebar.externalLinksFilterPlaceholder')}
                    value={externalLinksFilter}
                    onChange={(e) => setExternalLinksFilter(e.target.value)}
                  />
                  {externalLinksFilter && (
                    <button
                      type="button"
                      className="search-clear-btn"
                      onClick={() => setExternalLinksFilter('')}
                      aria-label={t('common.close')}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                <div className="sidebar-external-links-list scroller">
                  {filteredExternalLinks.length === 0 ? (
                    <div className="sidebar-empty-hint small">
                      {externalLinks.length === 0
                        ? t('sidebar.noExternalLinks')
                        : t('sidebar.noMatchingExternalLinks')}
                    </div>
                  ) : (
                    filteredExternalLinks.map((link) => {
                      const isSourcesExpanded = Boolean(expandedExternalUrls[link.url]);
                      const primaryLabel = link.title || link.domain;
                      return (
                        <div key={link.url} className="external-link-entry">
                          <div
                            className="external-link-row"
                            onClick={(e) => handleOpenExternalLinkItem(link.url, e)}
                            title={link.url}
                          >
                            <Globe size={13} className="external-link-globe-icon" />
                            <div className="external-link-text">
                              <span className="external-link-title">{primaryLabel}</span>
                              <span className="external-link-domain">{link.domain}</span>
                            </div>
                            <button
                              type="button"
                              className={`external-link-sources-btn ${isSourcesExpanded ? 'active' : ''}`}
                              title={t('sidebar.referencedBy')}
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedExternalUrls((prev) => ({
                                  ...prev,
                                  [link.url]: !prev[link.url],
                                }));
                              }}
                            >
                              {link.sources.length}
                            </button>
                          </div>
                          {isSourcesExpanded && (
                            <div className="external-link-sources-list">
                              {link.sources.map((src) => (
                                <button
                                  key={`${link.url}::${src.path}`}
                                  type="button"
                                  className="external-link-source-chip"
                                  title={src.path}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (e.altKey) {
                                      e.preventDefault();
                                      onSelectNote(src.path, { altKey: true });
                                    } else {
                                      onSelectNote(src.path);
                                    }
                                  }}
                                >
                                  {src.kind === 'canvas' ? (
                                    <WorkflowCanvasIcon size={11} />
                                  ) : (
                                    <FileText size={11} />
                                  )}
                                  <span>{src.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
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

          <div className="search-sort-bar" style={{ padding: '4px 10px 6px' }}>
            <div className="search-sort-toggle" role="group" aria-label="Sort">
              <button
                type="button"
                className={`search-sort-btn ${searchSort === 'relevance' ? 'active' : ''}`}
                onClick={() => setSearchSort('relevance')}
              >
                {t('search.sortRelevance')}
              </button>
              <button
                type="button"
                className={`search-sort-btn ${searchSort === 'newest' ? 'active' : ''}`}
                onClick={() => setSearchSort('newest')}
              >
                {t('search.sortNewest')}
              </button>
            </div>
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
                  onClick={(e) => {
                    if (e.altKey) {
                      e.preventDefault();
                      onSelectNote(res.path, { altKey: true });
                    } else {
                      onSelectNote(res.path);
                    }
                  }}
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

      {/* Context Menu: BottomSheet on Mobile, Floating Portal on Desktop */}
      {contextMenu && (() => {
        const menuItems = (
          <>
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
                    {onOpenTemplateSelect && (
                      <button
                        type="button"
                        className="tree-context-item"
                        onClick={() => {
                          const path = contextMenu.node!.path;
                          setExpandedFolders((prev) => ({ ...prev, [path]: true }));
                          onOpenTemplateSelect(path);
                          setContextMenu(null);
                        }}
                      >
                        <LayoutTemplate size={15} />
                        <span>{t('sidebar.newFromTemplate')}</span>
                      </button>
                    )}
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
                    {onCreateBase && (
                      <button
                        type="button"
                        className="tree-context-item"
                        onClick={() => {
                          const path = contextMenu.node!.path;
                          setExpandedFolders((prev) => ({ ...prev, [path]: true }));
                          onCreateBase(path);
                          setContextMenu(null);
                        }}
                      >
                        <Database size={15} />
                        <span>{t('sidebar.newBaseInFolder') || t('sidebar.newBase')}</span>
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
                    {(() => {
                      const folderP = contextMenu.node!.path;
                      const isEnc = encryptedFolders.has(folderP);
                      const isUnl = isEnc && unlockedFoldersStore.isFolderUnlocked(folderP);
                      return (
                        <>
                          {!isEnc && onEncryptFolder && (
                            <button
                              type="button"
                              className="tree-context-item"
                              onClick={() => {
                                onEncryptFolder(folderP);
                                setContextMenu(null);
                              }}
                            >
                              <Lock size={15} />
                              <span>{t('encryption.encryptFolder')}</span>
                            </button>
                          )}
                          {isEnc && !isUnl && onUnlockFolder && (
                            <button
                              type="button"
                              className="tree-context-item"
                              onClick={() => {
                                onUnlockFolder(folderP);
                                setContextMenu(null);
                              }}
                            >
                              <LockOpen size={15} />
                              <span>{t('encryption.unlockFolder')}</span>
                            </button>
                          )}
                          {isEnc && isUnl && (
                            <>
                              <button
                                type="button"
                                className="tree-context-item"
                                onClick={() => {
                                  if (onLockFolder) {
                                    onLockFolder(folderP);
                                  } else {
                                    unlockedFoldersStore.lockFolder(folderP);
                                  }
                                  setContextMenu(null);
                                }}
                              >
                                <Lock size={15} />
                                <span>{t('encryption.lockFolder')}</span>
                              </button>
                              {onDecryptFolder && (
                                <button
                                  type="button"
                                  className="tree-context-item"
                                  onClick={() => {
                                    onDecryptFolder(folderP);
                                    setContextMenu(null);
                                  }}
                                >
                                  <LockOpen size={15} />
                                  <span>{t('encryption.decryptFolder')}</span>
                                </button>
                              )}
                            </>
                          )}
                        </>
                      );
                    })()}
                    <div className="tree-context-separator" />
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="tree-context-item"
                      onClick={() => {
                        onOpenInResearch?.(contextMenu.node!.path);
                        setContextMenu(null);
                      }}
                    >
                      <Columns size={15} />
                      <span>{t('research.openInResearch', 'In Rechercheansicht öffnen')}</span>
                    </button>
                    {isResearchOpen && (
                      <button
                        type="button"
                        className="tree-context-item"
                        onClick={() => {
                          onSelectNote(contextMenu.node!.path, { altKey: true, preventDefault: () => {} });
                          setContextMenu(null);
                        }}
                      >
                        <ArrowLeft size={15} />
                        <span>{t('research.openInMain', 'Im Haupteditor öffnen (Alt+Klick)')}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="tree-context-item"
                      onClick={() => handleDownload(contextMenu.node!.path, false)}
                    >
                      <Download size={15} />
                      <span>{t('sidebar.downloadFile')}</span>
                    </button>
                    {(() => {
                      const ctxLogical = stripZencExt(contextMenu.node.path);
                      const ctxExt = getLogicalExtension(contextMenu.node.path) || contextMenu.node.extension;
                      return (
                        <>
                          {onExportPdf && (ctxExt === 'md' || ctxLogical.endsWith('.md')) && (
                            <button
                              type="button"
                              className="tree-context-item"
                              onClick={() => {
                                const p = contextMenu.node!.path;
                                setContextMenu(null);
                                onExportPdf(p);
                              }}
                            >
                              <FileDown size={15} />
                              <span>{t('sidebar.exportPdf')}</span>
                            </button>
                          )}
                          {onSendEmail && (ctxExt === 'md' || ctxLogical.endsWith('.md')) && (
                            <button
                              type="button"
                              className="tree-context-item"
                              onClick={() => {
                                const p = contextMenu.node!.path;
                                setContextMenu(null);
                                onSendEmail(p);
                              }}
                            >
                              <Mail size={15} />
                              <span>{t('sidebar.sendEmail')}</span>
                            </button>
                          )}
                          {(ctxExt === 'md' ||
                            ctxExt === 'canvas' ||
                            ctxLogical.endsWith('.md') ||
                            ctxLogical.endsWith('.canvas')) && (
                            <button
                              type="button"
                              className="tree-context-item"
                              onClick={() => {
                                const p = contextMenu.node!.path;
                                onOpenVersionHistory?.(p);
                                setContextMenu(null);
                              }}
                            >
                              <History size={15} />
                              <span>{t('sidebar.versionHistory')}</span>
                            </button>
                          )}
                        </>
                      );
                    })()}
                    {onCreateBase && (
                      <button
                        type="button"
                        className="tree-context-item"
                        onClick={() => {
                          const parent = getParentFolder(contextMenu.node!.path);
                          onCreateBase(parent || undefined);
                          setContextMenu(null);
                        }}
                      >
                        <Database size={15} />
                        <span>{t('sidebar.newBase')}</span>
                      </button>
                    )}
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

                {/* Send Target Quick-Toggle in Context Menu for .md notes */}
                {contextMenu.node.type === 'file' &&
                  (contextMenu.node.extension === 'md' || contextMenu.node.path.endsWith('.md')) && (
                    <button
                      type="button"
                      className="tree-context-item"
                      onClick={async () => {
                        const node = contextMenu.node!;
                        setContextMenu(null);
                        if (onToggleSendTarget) {
                          await onToggleSendTarget(node.path, !!node.isSendTarget);
                        } else {
                          try {
                            const note = await api.getNote(node.path);
                            const nextStatus = !node.isSendTarget;
                            const existingProps = [...(note.properties || [])];
                            const idx = existingProps.findIndex((p) => p.key.toLowerCase() === 'sendtarget');
                            if (nextStatus) {
                              if (idx >= 0) existingProps[idx] = { key: 'sendtarget', value: true, type: 'checkbox' };
                              else existingProps.push({ key: 'sendtarget', value: true, type: 'checkbox' });
                            } else {
                              if (idx >= 0) existingProps.splice(idx, 1);
                            }
                            await api.saveNote({
                              path: note.path,
                              body: note.body,
                              properties: existingProps,
                              forceOverwrite: true,
                            });
                            onRefresh();
                          } catch (err) {
                            console.error('Failed to toggle sendtarget:', err);
                          }
                        }
                      }}
                    >
                      <Target size={15} />
                      <span>
                        {contextMenu.node.isSendTarget
                          ? (t('sidebar.removeAsSendTarget') || 'Als Sende-Ziel entfernen 🎯')
                          : (t('sidebar.setAsSendTarget') || 'Als Sende-Ziel festlegen 🎯')}
                      </span>
                    </button>
                  )}

                {/* Template Quick-Toggle in Context Menu for .md notes */}
                {contextMenu.node.type === 'file' &&
                  (contextMenu.node.extension === 'md' || contextMenu.node.path.endsWith('.md')) && (
                    <button
                      type="button"
                      className="tree-context-item"
                      onClick={async () => {
                        const node = contextMenu.node!;
                        setContextMenu(null);
                        if (onToggleTemplate) {
                          await onToggleTemplate(node.path, !!node.isTemplate);
                        } else {
                          try {
                            const note = await api.getNote(node.path);
                            const nextStatus = !node.isTemplate;
                            const existingProps = [...(note.properties || [])];
                            const idx = existingProps.findIndex((p) => p.key.toLowerCase() === 'istemplate');
                            if (nextStatus) {
                              if (idx >= 0) existingProps[idx] = { key: 'isTemplate', value: true, type: 'checkbox' };
                              else existingProps.push({ key: 'isTemplate', value: true, type: 'checkbox' });
                            } else {
                              if (idx >= 0) existingProps.splice(idx, 1);
                            }
                            await api.saveNote({
                              path: note.path,
                              body: note.body,
                              properties: existingProps,
                              forceOverwrite: true,
                            });
                            onRefresh();
                          } catch (err) {
                            console.error('Failed to toggle isTemplate:', err);
                          }
                        }
                      }}
                    >
                      <LayoutTemplate size={15} />
                      <span>
                        {contextMenu.node.isTemplate
                          ? (t('sidebar.removeAsTemplate') || 'Als Vorlage entfernen 📄')
                          : (t('sidebar.setAsTemplate') || 'Als Vorlage festlegen 📄')}
                      </span>
                    </button>
                  )}
                <div className="tree-context-separator" />

                {/* If multiple items are selected and clicked node is among them */}
                {selectedPaths.has(contextMenu.node.path) && selectedPaths.size > 1 ? (
                  <>
                    <button
                      type="button"
                      className="tree-context-item"
                      onClick={() => handleDownloadBatch(Array.from(selectedPaths))}
                    >
                      <Download size={15} />
                      <span>{t('sidebar.downloadSelection', { count: selectedPaths.size })}</span>
                    </button>
                    <button
                      type="button"
                      className="tree-context-item"
                      onClick={() => {
                        setMoveToModalPaths(Array.from(selectedPaths));
                        setContextMenu(null);
                      }}
                    >
                      <FolderPlus size={15} />
                      <span>{t('sidebar.moveItems', { count: selectedPaths.size })}</span>
                    </button>
                    <div className="tree-context-separator" />
                    <button
                      type="button"
                      className="tree-context-item danger"
                      onClick={() => {
                        handleDeleteSelected();
                        setContextMenu(null);
                      }}
                    >
                      <Trash2 size={15} />
                      <span>{t('sidebar.deleteItems', { count: selectedPaths.size })}</span>
                    </button>
                  </>
                ) : (
                  <>
                    {/* Copy */}
                    <button
                      type="button"
                      className="tree-context-item"
                      onClick={() => handleCopy(contextMenu.node!)}
                    >
                      <Copy size={15} />
                      <span>{t('common.copy')}</span>
                    </button>

                    {/* Move to... */}
                    <button
                      type="button"
                      className="tree-context-item"
                      onClick={() => {
                        setMoveToModalPaths([contextMenu.node!.path]);
                        setContextMenu(null);
                      }}
                    >
                      <FolderPlus size={15} />
                      <span>{t('sidebar.moveTo')}</span>
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
                          node.type === 'file' && (node.extension === 'md' || node.extension === 'canvas' || node.extension === 'base')
                            ? node.name.replace(/\.(md|canvas|base)$/i, '')
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
                          node.type === 'file' && (node.extension === 'md' || node.extension === 'canvas' || node.extension === 'base')
                            ? node.name.replace(/\.(md|canvas|base)$/i, '')
                            : node.name;
                        onDeleteEntry(node.path, displayName);
                        setContextMenu(null);
                      }}
                    >
                      <Trash2 size={15} />
                      <span>{t('common.delete')}</span>
                    </button>
                  </>
                )}
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
                {onOpenTemplateSelect && (
                  <button
                    type="button"
                    className="tree-context-item"
                    onClick={() => {
                      onOpenTemplateSelect();
                      setContextMenu(null);
                    }}
                  >
                    <LayoutTemplate size={15} />
                    <span>{t('sidebar.newFromTemplate')}</span>
                  </button>
                )}
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
                {onCreateBase && (
                  <button
                    type="button"
                    className="tree-context-item"
                    onClick={() => {
                      onCreateBase();
                      setContextMenu(null);
                    }}
                  >
                    <Database size={15} />
                    <span>{t('sidebar.newBase')}</span>
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
          </>
        );

        if (isMobile) {
          return (
            <BottomSheet
              isOpen={true}
              onClose={() => setContextMenu(null)}
              title={contextMenu.node ? contextMenu.node.name : t('sidebar.files', 'Files')}
            >
              <div className="bottom-sheet-context-list">{menuItems}</div>
            </BottomSheet>
          );
        }

        return createPortal(
          <div
            ref={contextMenuRef}
            className="tree-context-menu"
            style={{
              top: `${contextMenu.y}px`,
              left: `${contextMenu.x}px`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {menuItems}
          </div>,
          document.body
        );
      })()}

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
      {/* MoveTo Modal */}
      <MoveToModal
        isOpen={moveToModalPaths !== null}
        sourcePaths={moveToModalPaths || []}
        tree={tree}
        onClose={() => setMoveToModalPaths(null)}
        onMove={handleMoveTo}
      />
    </aside>
  );
};

export const FileSidebar = React.memo(FileSidebarImpl);
