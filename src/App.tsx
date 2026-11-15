import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  Code2,
  Columns,
  Eye,
  FilePlus,
  FileText,
  GitFork,
  ImagePlus,
  Link2,
  ListTree,
  Lock,
  LogOut,
  Moon,
  PanelLeft,
  PanelRight,
  Radio,
  Settings,
  Sun,
  Upload,
  X,
  Bold,
  Italic,
  Strikethrough,
  Highlighter,
  Table,
  CheckSquare,
  Quote,
  Heading1,
  Heading2,
  Heading3,
  Minus,
  Palette,
  RefreshCw,
  Trash2,
  Edit3,
  Download,
  Maximize2,
  Minimize2,
  History,
  Target,
  Calendar,
  Database,
  LayoutTemplate,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { WorkflowCanvasIcon } from './components/canvas/WorkflowCanvasIcon';
import { useMobileBackHandler } from './components/BottomSheet';
import {
  recordRecentNote,
  notifyVaultEntryRenamed,
  notifyVaultEntryDeleted,
} from './utils/vaultNavigation';
import type {
  BacklinkItem,
  FileTreeNode,
  FrontmatterProperty,
  GraphData,
  NoteData,
} from '../shared/types';
import {
  parseMarkdownWithFrontmatter,
  serializeMarkdownWithFrontmatter,
} from '../shared/markdownUtils';
import {
  getTableWidthsFromProperties,
  pruneOrphanedTableWidths,
  renameTableWidthSignature,
  setTableWidthsInProperties,
} from '../shared/markdownTableUtils';
import {
  api,
  rawApi,
  getStoredToken,
  setStoredToken,
  hasOfflineAuthVerifier,
  ApiHttpError,
} from './api';
import { LoginModal } from './components/LoginModal';
import { FileSidebar } from './components/FileSidebar';
import { PropertiesEditor } from './components/PropertiesEditor';
import {
  LivePreviewEditor,
  type EditorMode,
  type LivePreviewEditorRef,
} from './components/LivePreviewEditor';
import { ConflictModal } from './components/ConflictModal';
import { VersionHistoryModal } from './components/VersionHistoryModal';
import { SendToTargetModal } from './components/SendToTargetModal';
import { TemplateSelectModal } from './components/TemplateSelectModal';
import { NewBaseModal } from './components/NewBaseModal';
import { extractVaultFolders, stringifyBaseYaml } from './base/baseConfig';
import { ResearchPane, type ResearchTarget, type ResearchContentType, detectFileType } from './components/ResearchPane';

const CanvasEditor = React.lazy(() =>
  import('./components/canvas/CanvasEditor').then((m) => ({ default: m.CanvasEditor }))
);
const GraphView = React.lazy(() =>
  import('./components/GraphView').then((m) => ({ default: m.GraphView }))
);
const SettingsModal = React.lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const BaseEditor = React.lazy(() =>
  import('./components/BaseEditor').then((m) => ({ default: m.BaseEditor }))
);
import { CommandPalette, type CommandItem } from './components/CommandPalette';
import { MobileSearchModal } from './components/MobileSearchModal';
import type { SettingsTab } from './components/SettingsModal';
import { wrapMatchIndex } from './utils/mobileSearchUtils';
import { EditorToolbar } from './components/EditorToolbar';
import { MobileBottomNav } from './components/MobileBottomNav';
import { MobileEditBar } from './components/MobileEditBar';
import { syncEngine, isFastForwardCompatible, type SyncState, type ConflictItem } from './sync/syncEngine';
import { cleanShareUrlQuery } from './sync/shareTargetService';
import { clientLogger } from './utils/logger';
import { useTranslation } from './i18n';
import {
  recordLastActiveNote,
  clearLastActiveNote,
  resolveStartupNotePath,
  getDailyNoteConfig,
  getMobileReadingDefault,
} from './startupConfig';
import {
  getFontSettings,
  applyFontSettingsToDOM,
  type FontSettings,
} from './fontSettings';

type MainWorkspaceView = 'editor' | 'graph' | 'split';
type RightSidebarTab = 'backlinks' | 'outline' | 'local-graph';

interface DialogState {
  type: 'create-note' | 'create-folder' | 'rename' | 'delete' | 'create-canvas' | 'create-base';
  title?: string;
  prompt?: string;
  parentFolder?: string;
  targetPath?: string;
  initialValue: string;
  initialProperties?: FrontmatterProperty[];
}

export const App: React.FC = () => {
  const { t, language } = useTranslation();
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [httpsActive, setHttpsActive] = useState(true);
  const [vaultPath, setVaultPath] = useState('');

  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [allFiles, setAllFiles] = useState<
    {
      path: string;
      name: string;
      basename: string;
      extension: string;
      folder?: string;
      frontmatter?: Record<string, any>;
      tags?: string[];
      mtime?: number;
      isSendTarget?: boolean;
      isTemplate?: boolean;
    }[]
  >([]);
  const allFilesRef = useRef(allFiles);
  allFilesRef.current = allFiles;
  const [graphData, setGraphData] = useState<GraphData>({
    nodes: [],
    edges: [],
    tags: [],
  });
  const [backlinks, setBacklinks] = useState<{ linked: BacklinkItem[]; unlinked: BacklinkItem[] }>({
    linked: [],
    unlinked: [],
  });

  const [activeNote, setActiveNote] = useState<NoteData | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const isHistoryNavigatingRef = useRef<boolean>(false);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  historyRef.current = history;
  historyIndexRef.current = historyIndex;
  const [editorMode, setEditorMode] = useState<EditorMode>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 && getMobileReadingDefault()
      ? 'reading'
      : 'live'
  );
  const [workspaceView, setWorkspaceView] = useState<MainWorkspaceView>('editor');

  // Asymmetric Research Split-View (70/30) State & Orientation
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('zuber_split_ratio');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 20 && parsed <= 80) {
          return parsed;
        }
      }
    } catch {}
    return 70;
  });
  const [splitOrientation, setSplitOrientation] = useState<'horizontal' | 'vertical'>(() => {
    return typeof window !== 'undefined' && window.innerWidth < 768 ? 'vertical' : 'horizontal';
  });
  const [researchTarget, setResearchTarget] = useState<ResearchTarget | null>(null);
  const [researchHistory, setResearchHistory] = useState<ResearchTarget[]>([]);
  const [researchHistoryIndex, setResearchHistoryIndex] = useState<number>(-1);
  const isResearchNavigatingRef = useRef<boolean>(false);
  const researchHistoryRef = useRef<ResearchTarget[]>([]);
  const researchHistoryIndexRef = useRef<number>(-1);
  researchHistoryRef.current = researchHistory;
  researchHistoryIndexRef.current = researchHistoryIndex;

  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const workspacePanesRef = useRef<HTMLDivElement>(null);

  const [leftSidebarOpen, setLeftSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : false
  );
  const [rightSidebarOpen, setRightSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth > 1200 : false
  );
  const [rightTab, setRightTab] = useState<RightSidebarTab>('backlinks');

  const isResearchOpen = workspaceView === 'split';
  const rightSidebarTargetPath = useMemo(() => {
    if (isResearchOpen && researchTarget?.path && researchTarget.type !== 'web') {
      return researchTarget.path;
    }
    return activeNote?.path ?? null;
  }, [isResearchOpen, researchTarget?.path, researchTarget?.type, activeNote?.path]);

  const rightSidebarTargetPathRef = useRef<string | null>(null);
  rightSidebarTargetPathRef.current = rightSidebarTargetPath;
  const [zenMode, setZenMode] = useState(false);
  const [versionHistoryPath, setVersionHistoryPath] = useState<string | null>(null);
  const [isSendToTargetModalOpen, setIsSendToTargetModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [templateParentFolder, setTemplateParentFolder] = useState<string | undefined>(undefined);
  const [isNewBaseModalOpen, setIsNewBaseModalOpen] = useState(false);
  const [newBaseInitialFolder, setNewBaseInitialFolder] = useState<string | undefined>(undefined);
  const [toastNotification, setToastNotification] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastNotification(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastNotification(null);
    }, 3500);
  }, []);

  // Resizable Sidebars (State & localStorage persistence)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('zuber_sidebar_widths') || localStorage.getItem('knowmesh_sidebar_widths');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.left === 'number') {
          return Math.min(600, Math.max(180, parsed.left));
        }
      }
    } catch {}
    return 280;
  });

  const [rightSidebarWidth, setRightSidebarWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('zuber_sidebar_widths') || localStorage.getItem('knowmesh_sidebar_widths');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.right === 'number') {
          return Math.min(650, Math.max(200, parsed.right));
        }
      }
    } catch {}
    return 300;
  });

  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);

  const leftSidebarWidthRef = useRef(leftSidebarWidth);
  leftSidebarWidthRef.current = leftSidebarWidth;
  const rightSidebarWidthRef = useRef(rightSidebarWidth);
  rightSidebarWidthRef.current = rightSidebarWidth;

  const handleLeftResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingLeft(true);
    const startX = e.clientX;
    const startWidth = leftSidebarWidthRef.current;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.min(600, Math.max(180, startWidth + delta));
      setLeftSidebarWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      try {
        localStorage.setItem(
          'zuber_sidebar_widths',
          JSON.stringify({ left: leftSidebarWidthRef.current, right: rightSidebarWidthRef.current })
        );
      } catch {}
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  const handleRightResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingRight(true);
    const startX = e.clientX;
    const startWidth = rightSidebarWidthRef.current;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const nextWidth = Math.min(650, Math.max(200, startWidth + delta));
      setRightSidebarWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizingRight(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      try {
        localStorage.setItem(
          'zuber_sidebar_widths',
          JSON.stringify({ left: leftSidebarWidthRef.current, right: rightSidebarWidthRef.current })
        );
      } catch {}
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [scrollToLine, setScrollToLine] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [wsConnected, setWsConnected] = useState(false);
  const [theme, setTheme] = useState<string>(() => localStorage.getItem('zuber_theme') || localStorage.getItem('knowmesh_theme') || localStorage.getItem('basalt_theme') || 'zuber');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab | undefined>(undefined);
  const [syncState, setSyncState] = useState<SyncState>('offline');
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [inNoteSearchQuery, setInNoteSearchQuery] = useState('');
  const [inNoteSearchIndex, setInNoteSearchIndex] = useState(0);
  const [inNoteMatchCount, setInNoteMatchCount] = useState(0);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  const [fontSettings, setFontSettings] = useState<FontSettings>(getFontSettings);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isInstalledApp, setIsInstalledApp] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
  });

  useEffect(() => {
    applyFontSettingsToDOM(fontSettings, window.innerWidth < 768);
  }, [fontSettings]);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setIsInstalledApp(true);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallApp = useCallback(async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        setInstallPrompt(null);
        setIsInstalledApp(true);
      }
    } else {
      alert('Tipp: Um Zuber als WebAPK auf Android/Chromebook oder Desktop zu installieren, tippe im Browser-Menü auf „App installieren“ oder „Zum Startbildschirm hinzufügen“.');
    }
  }, [installPrompt]);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      applyFontSettingsToDOM(fontSettings, mobile);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fontSettings]);

  // Sync Android / mobile visual viewport dynamically to prevent keyboard clipping
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const updateViewport = () => {
      document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
      document.documentElement.style.setProperty('--vv-offset-top', `${vv.offsetTop}px`);
    };
    updateViewport();
    vv.addEventListener('resize', updateViewport);
    vv.addEventListener('scroll', updateViewport);
    return () => {
      vv.removeEventListener('resize', updateViewport);
      vv.removeEventListener('scroll', updateViewport);
    };
  }, []);

  useMobileBackHandler(isMobile && leftSidebarOpen, () => setLeftSidebarOpen(false));
  useMobileBackHandler(isMobile && rightSidebarOpen, () => setRightSidebarOpen(false));
  useMobileBackHandler(
    isMobile &&
      workspaceView !== 'graph' &&
      Boolean(activeNote) &&
      !activeNote?.path.endsWith('.base') &&
      !activeNote?.path.endsWith('.canvas') &&
      (editorMode === 'live' || editorMode === 'source'),
    () => {
      editorRef.current?.blur();
      setEditorMode('reading');
    }
  );

  const touchStartRef = useRef<{ x: number; y: number; allowSwipeOpen: boolean } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const target = e.target as HTMLElement | null;
      const startedInSwipeIgnore = Boolean(target?.closest('[data-swipe-ignore="true"]'));
      const startedInHeader = Boolean(
        target?.closest('.workspace-topbar, .top-bar, .app-header, .editor-header')
      );
      const isCanvasView = Boolean(
        activeNote?.path.endsWith('.canvas') ||
          target?.closest('.canvas-editor-wrapper, .react-flow')
      );
      const allowSwipeOpen = !startedInSwipeIgnore && (!isCanvasView || startedInHeader);

      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        allowSwipeOpen,
      };
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || e.changedTouches.length === 0) return;
    const startX = touchStartRef.current.x;
    const startY = touchStartRef.current.y;
    const allowSwipeOpen = touchStartRef.current.allowSwipeOpen;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    touchStartRef.current = null;

    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Scroll protection: if vertical motion is dominant or equal, ignore swipe
    if (absY >= absX) return;

    // Horizontal movement must be dominant and at least 50px
    if (absX < 50 || absX <= absY * 1.4) return;

    if (isMobile) {
      if (leftSidebarOpen) {
        // Swipe left closes left sidebar
        if (deltaX < -50) {
          setLeftSidebarOpen(false);
        }
      } else if (rightSidebarOpen) {
        // Swipe right closes right sidebar
        if (deltaX > 50) {
          setRightSidebarOpen(false);
        }
      } else {
        // Neither sidebar is open: swipe right opens left sidebar (restricted to header exclusively on canvases)
        const isEdgeStart = startX <= 35;
        const isStrongSwipe = deltaX > 65 && absX > absY * 1.5;
        if (allowSwipeOpen && (isEdgeStart || isStrongSwipe)) {
          setLeftSidebarOpen(true);
        }
      }
    }
  };

  const editorRef = useRef<LivePreviewEditorRef>(null);

  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogInput, setDialogInput] = useState('');

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveTaskRef = useRef<(() => Promise<void>) | null>(null);
  const isSavingFileRef = useRef<Map<string, boolean>>(new Map());
  const pendingSavePayloadRef = useRef<
    Map<
      string,
      {
        body?: string;
        properties?: FrontmatterProperty[];
        rawContent?: string;
      }
    >
  >(new Map());
  const inFlightSavePromiseRef = useRef<Map<string, Promise<void>>>(new Map());
  const lastLocalSaveTimeRef = useRef<number>(0);
  const recentSelfWritesRef = useRef<Map<string, number>>(new Map());
  const isUploadingAttachmentRef = useRef<boolean>(false);
  const explicitUserClearRef = useRef<boolean>(false);
  const activeNoteRef = useRef<NoteData | null>(null);
  activeNoteRef.current = activeNote;
  const activePathRef = useRef<string | null>(null);
  activePathRef.current = activeNote?.path ?? null;
  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;
  const workspaceViewRef = useRef<MainWorkspaceView>('editor');
  workspaceViewRef.current = workspaceView;
  const openRequestRef = useRef(0);

  const flushPendingSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const task = pendingSaveTaskRef.current;
    if (task) {
      await task();
    }
    const inFlights = Array.from(inFlightSavePromiseRef.current.values());
    if (inFlights.length > 0) {
      await Promise.all(inFlights);
    }
  }, []);

  const collectExistingPaths = useCallback((): Set<string> => {
    const existing = new Set<string>();
    for (const f of allFiles) {
      if (f?.path) existing.add(f.path.toLowerCase());
    }
    const walk = (nodes: FileTreeNode[]) => {
      for (const n of nodes) {
        if (n.path) existing.add(n.path.toLowerCase());
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
    return existing;
  }, [allFiles, tree]);

  const getUniqueDefaultName = useCallback(
    (baseName: string, type: 'file' | 'folder' | 'canvas' | 'base', parentFolder?: string): string => {
      const existing = collectExistingPaths();
      const buildPath = (name: string) => {
        const leaf = type === 'canvas' ? `${name}.canvas` : type === 'base' ? `${name}.base` : type === 'file' ? `${name}.md` : name;
        return (parentFolder ? `${parentFolder}/${leaf}` : leaf).toLowerCase();
      };
      if (!existing.has(buildPath(baseName))) {
        return baseName;
      }
      let counter = 2;
      while (existing.has(buildPath(`${baseName} ${counter}`))) {
        counter++;
      }
      return `${baseName} ${counter}`;
    },
    [collectExistingPaths]
  );

  const openCreateNoteDialog = useCallback(
    (parentFolder?: string, initialProperties?: FrontmatterProperty[]) => {
      const baseName = language === 'de' ? 'Neue Notiz' : 'New Note';
      const defaultName = getUniqueDefaultName(baseName, 'file', parentFolder);
      setDialog({ type: 'create-note', parentFolder, initialValue: defaultName, initialProperties });
      setDialogInput(defaultName);
    },
    [language, getUniqueDefaultName]
  );

  const openCreateCanvasDialog = useCallback(
    (parentFolder?: string) => {
      const baseName = language === 'de' ? 'Neues Canvas' : 'New Canvas';
      const defaultName = getUniqueDefaultName(baseName, 'canvas', parentFolder);
      setDialog({
        type: 'create-canvas',
        title: t('canvas.createDialogTitle'),
        prompt: t('canvas.createDialogPrompt'),
        parentFolder,
        initialValue: defaultName,
      });
      setDialogInput(defaultName);
    },
    [language, getUniqueDefaultName, t]
  );

  const openCreateBaseDialog = useCallback((parentFolder?: string) => {
    setNewBaseInitialFolder(parentFolder);
    setIsNewBaseModalOpen(true);
  }, []);

  const openCreateFolderDialog = useCallback(
    (parentFolder?: string) => {
      const baseName = language === 'de' ? 'Neuer Ordner' : 'New Folder';
      const defaultName = getUniqueDefaultName(baseName, 'folder', parentFolder);
      setDialog({ type: 'create-folder', parentFolder, initialValue: defaultName });
      setDialogInput(defaultName);
    },
    [language, getUniqueDefaultName]
  );

  const openCreateNoteDialogRef = useRef(openCreateNoteDialog);
  openCreateNoteDialogRef.current = openCreateNoteDialog;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme.startsWith('light') ? 'light' : 'dark';
    localStorage.setItem('zuber_theme', theme);
  }, [theme]);

  const manualSaveRef = useRef<(() => void) | null>(null);
  const handleOpenDailyNoteRef = useRef<(() => Promise<void>) | null>(null);
  const handleGoBackRef = useRef<(() => void) | null>(null);

  // Global Keyboard shortcuts (Command Palette, Save, Settings, New Note, Sidebars, Go Back)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Navigate Back (Alt+ArrowLeft)
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowLeft' || e.code === 'ArrowLeft')) {
        const target = e.target as HTMLElement;
        if (target && target.tagName === 'INPUT') {
          return;
        }
        e.preventDefault();
        handleGoBackRef.current?.();
        return;
      }

      // Zen Mode (Alt+Z)
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ')) {
        e.preventDefault();
        setZenMode((prev) => !prev);
        return;
      }

      // Exit Zen Mode on Escape
      if (e.key === 'Escape') {
        setZenMode((prev) => {
          if (prev) {
            e.preventDefault();
            return false;
          }
          return prev;
        });
      }

      // Command Palette (Ctrl+P / Cmd+P)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
        return;
      }

      // Quick Save (Ctrl+S / Cmd+S)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        manualSaveRef.current?.();
        return;
      }

      // Quick Settings (Ctrl+,)
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }

      // Quick New Note (Ctrl+N)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !e.shiftKey) {
        e.preventDefault();
        openCreateNoteDialogRef.current();
        return;
      }

      // Quick Daily Note (Alt+D)
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'd' || e.key === 'D' || e.code === 'KeyD')) {
        e.preventDefault();
        handleOpenDailyNoteRef.current?.();
        return;
      }

      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && !e.shiftKey) {
        e.preventDefault();
        setLeftSidebarOpen((o) => !o);
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'j' || (e.shiftKey && e.key.toLowerCase() === 'b'))
      ) {
        e.preventDefault();
        setRightSidebarOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadVaultIndex = useCallback(async () => {
    const isOffline =
      syncEngine.getSyncState() === 'offline' ||
      (typeof navigator !== 'undefined' && !navigator.onLine);

    if (!isOffline) {
      try {
        const outbox = await syncEngine.getLocalDb().getOutbox();
        if (outbox.length > 0) {
          await syncEngine.flushOutbox();
        }

        const [treeRes, graphRes] = await Promise.all([rawApi.getTree(), api.getGraph()]);
        await syncEngine.getLocalDb().setMeta('tree', treeRes.tree);
        await syncEngine.getLocalDb().setMeta('files', treeRes.files);
        const notesMeta = treeRes.notes ?? (treeRes.files || []).filter((f: any) => f.extension === 'md');
        await syncEngine.getLocalDb().setMeta('allNotes', notesMeta);
        await syncEngine.getLocalDb().setMeta('graph', graphRes);

        const remainingOutbox = await syncEngine.getLocalDb().getOutbox();
        let finalTree = treeRes.tree;
        let finalFiles = treeRes.files;
        if (remainingOutbox.length > 0) {
          const reconciled = await syncEngine.getLocalDb().reconcileTreeWithLocalState();
          finalTree = reconciled.tree;
          finalFiles = reconciled.files;
        }

        setTree(finalTree);
        setAllFiles(finalFiles);
        setVaultPath(treeRes.vaultPath);
        setGraphData(graphRes);
        return {
          treeRes: { ...treeRes, tree: finalTree, files: finalFiles },
          graphRes,
        };
      } catch (err) {
        console.warn('Offline mode active, falling back to local cache:', err);
      }
    }

    // Offline / pending outbox fallback: load and reconcile from local IndexedDB
    try {
      const reconciled = await syncEngine.getLocalDb().reconcileTreeWithLocalState();
      const cachedGraph = (await syncEngine.getLocalDb().getMeta<GraphData>('graph')) || {
        nodes: [],
        edges: [],
        tags: [],
      };

      setTree(reconciled.tree);
      setAllFiles(reconciled.files);
      setGraphData(cachedGraph);
      return {
        treeRes: {
          tree: reconciled.tree,
          files: reconciled.files,
          vaultPath: 'Zuber Vault (Offline)',
        },
        graphRes: cachedGraph,
      };
    } catch (innerErr) {
      console.warn('Could not load from IndexedDB cache:', innerErr);
      const emptyTree: FileTreeNode[] = [];
      const emptyFiles: { path: string; name: string; basename: string; extension: string; isSendTarget?: boolean; isTemplate?: boolean }[] = [];
      const emptyGraph: GraphData = { nodes: [], edges: [], tags: [] };
      setTree(emptyTree);
      setAllFiles(emptyFiles);
      setGraphData(emptyGraph);
      return {
        treeRes: { tree: emptyTree, files: emptyFiles, vaultPath: 'Zuber Vault (Offline)' },
        graphRes: emptyGraph,
      };
    }
  }, []);

  const refreshBacklinks = useCallback(async (relPath: string | null) => {
    if (!relPath) {
      setBacklinks({ linked: [], unlinked: [] });
      return;
    }
    const isOffline =
      syncEngine.getSyncState() === 'offline' ||
      (typeof navigator !== 'undefined' && !navigator.onLine);
    try {
      if (isOffline) throw new Error('offline');
      const res = await api.getBacklinks(relPath);
      if (rightSidebarTargetPathRef.current === relPath) setBacklinks(res);
    } catch {
      // Offline fallback: compute local backlinks from cached notes
      try {
        const localNotes = await syncEngine.getLocalDb().getAllNotes();
        const targetClean = relPath.replace(/\.md$/, '').toLowerCase();
        const linked: BacklinkItem[] = [];
        for (const note of localNotes) {
          if (note.path === relPath) continue;
          const linksToTarget = note.links.some((l) => {
            const cl = l.replace(/\.md$/, '').toLowerCase();
            return cl === targetClean || cl.endsWith(`/${targetClean}`);
          });
          if (linksToTarget) {
            linked.push({
              sourcePath: note.path,
              sourceTitle: note.name,
              line: 1,
              snippet: `${note.name} verlinkt auf diese Notiz`,
            });
          }
        }
        if (rightSidebarTargetPathRef.current === relPath) setBacklinks({ linked, unlinked: [] });
      } catch {
        // ignore
      }
    }
  }, []);

  // Sync right-sidebar backlinks whenever the active target note (Research pane or Main editor) changes
  useEffect(() => {
    refreshBacklinks(rightSidebarTargetPath);
  }, [rightSidebarTargetPath, refreshBacklinks]);

  // Debounced background refresh of graph (+ tree if structure changed) and backlinks.
  // Never blocks opening/editing notes.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStructuralRef = useRef(false);
  const scheduleIndexRefresh = useCallback(
    (_structural: boolean, delay = 400) => {
      pendingStructuralRef.current = true;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(async () => {
        pendingStructuralRef.current = false;
        try {
          await loadVaultIndex();
          await refreshBacklinks(rightSidebarTargetPathRef.current);
        } catch {
          // ignore
        }
      }, delay);
    },
    [loadVaultIndex, refreshBacklinks]
  );

  const openNoteByPath = useCallback(
    async (relPath: string) => {
      const prevPath = activePathRef.current;
      const wasDirty = saveStateRef.current === 'dirty' || Boolean(pendingSaveTaskRef.current);
      await flushPendingSave();

      // Auto-commit on note switch if previous note had pending modifications
      if (prevPath && prevPath !== relPath && wasDirty && navigator.onLine) {
        api.commitGit({ reason: `auto: update ${prevPath}` }).catch(() => {});
      }

      const requestId = ++openRequestRef.current;
      explicitUserClearRef.current = false;
      try {
        const note = await syncEngine.getNote(relPath);
        if (requestId !== openRequestRef.current) return; // a newer note was requested meanwhile
        setActiveNote(note);
        if (
          isMobile &&
          getMobileReadingDefault() &&
          !relPath.endsWith('.base') &&
          !relPath.endsWith('.canvas')
        ) {
          setEditorMode('reading');
        }
        setSaveState('saved');
        recordLastActiveNote(relPath);
        recordRecentNote(relPath);
        refreshBacklinks(relPath);
      } catch (err) {
        console.error('Fehler beim Laden der Notiz:', err);
      }
    },
    [flushPendingSave, refreshBacklinks]
  );

  const openNote = openNoteByPath;

  const handleGoBackPrimary = useCallback(() => {
    if (historyIndexRef.current > 0) {
      const prevIndex = historyIndexRef.current - 1;
      const targetPath = historyRef.current[prevIndex];
      if (targetPath) {
        isHistoryNavigatingRef.current = true;
        setHistoryIndex(prevIndex);
        historyIndexRef.current = prevIndex;
        if (workspaceViewRef.current === 'graph') {
          setWorkspaceView('editor');
        }
        openNote(targetPath).finally(() => {
          isHistoryNavigatingRef.current = false;
        });
      }
    }
  }, [openNote]);

  const handleGoBackResearch = useCallback(() => {
    if (researchHistoryIndexRef.current > 0) {
      const prevIndex = researchHistoryIndexRef.current - 1;
      const target = researchHistoryRef.current[prevIndex];
      if (target) {
        isResearchNavigatingRef.current = true;
        setResearchHistoryIndex(prevIndex);
        researchHistoryIndexRef.current = prevIndex;
        setResearchTarget(target);
        setTimeout(() => {
          isResearchNavigatingRef.current = false;
        }, 50);
      }
    }
  }, []);

  const handleGoBack = useCallback(
    (e?: React.MouseEvent | { altKey?: boolean; preventDefault?: () => void }) => {
      const isSplit = workspaceViewRef.current === 'split';
      if (isSplit) {
        if (e?.altKey) {
          e.preventDefault?.();
          handleGoBackPrimary();
        } else {
          handleGoBackResearch();
        }
      } else {
        handleGoBackPrimary();
      }
    },
    [handleGoBackPrimary, handleGoBackResearch]
  );

  handleGoBackRef.current = handleGoBack;

  const openInResearch = useCallback((path: string) => {
    const type = detectFileType(path);
    setResearchTarget({ path, type });
    if (workspaceViewRef.current !== 'split') {
      setWorkspaceView('split');
    }
  }, []);

  const handleToggleSplit = useCallback(() => {
    setWorkspaceView((prev) => {
      if (prev === 'split') {
        return 'editor';
      } else {
        setResearchTarget((cur) => cur ?? { path: '', type: 'graph' });
        return 'split';
      }
    });
    if (isMobile) setLeftSidebarOpen(false);
  }, [isMobile]);

  const handleSplitRatioChange = useCallback((newRatio: number) => {
    const clamped = Math.min(80, Math.max(20, Math.round(newRatio)));
    setSplitRatio(clamped);
    try {
      localStorage.setItem('zuber_split_ratio', String(clamped));
    } catch {}
  }, []);

  const handleSplitResizeStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      setIsResizingSplit(true);

      const container = workspacePanesRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const currentOrientation = splitOrientation;

      const prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';

      const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
        const clientX = 'touches' in moveEvent ? moveEvent.touches[0].clientX : (moveEvent as MouseEvent).clientX;
        const clientY = 'touches' in moveEvent ? moveEvent.touches[0].clientY : (moveEvent as MouseEvent).clientY;

        if (currentOrientation === 'horizontal') {
          const ratio = ((clientX - rect.left) / rect.width) * 100;
          handleSplitRatioChange(ratio);
        } else {
          // Vertical: Top is Research Pane, Bottom is Primary Editor
          const researchHeightRatio = ((clientY - rect.top) / rect.height) * 100;
          const primaryRatio = 100 - researchHeightRatio;
          handleSplitRatioChange(primaryRatio);
        }
      };

      const handleEnd = () => {
        setIsResizingSplit(false);
        document.body.style.userSelect = prevUserSelect;
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleEnd);
        window.removeEventListener('touchmove', handleMove);
        window.removeEventListener('touchend', handleEnd);
      };

      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleEnd);
      window.addEventListener('touchmove', handleMove, { passive: false });
      window.addEventListener('touchend', handleEnd);
    },
    [splitOrientation, handleSplitRatioChange]
  );

  // Track navigation history for active notes & canvases (max 50 entries)
  useEffect(() => {
    const currentPath = activeNote?.path;
    if (!currentPath) return;

    if (isHistoryNavigatingRef.current) {
      return;
    }

    const curIndex = historyIndexRef.current;
    const curHist = historyRef.current;

    // If the new path is identical to history[historyIndex], do nothing
    if (curIndex >= 0 && curHist[curIndex] === currentPath) {
      return;
    }

    // Otherwise, slice off any forward history, push new path, limit to 50
    const sliced = curHist.slice(0, curIndex + 1);
    let newHistory = [...sliced, currentPath];
    if (newHistory.length > 50) {
      newHistory = newHistory.slice(newHistory.length - 50);
    }
    const newIndex = newHistory.length - 1;

    historyRef.current = newHistory;
    historyIndexRef.current = newIndex;
    setHistory(newHistory);
    setHistoryIndex(newIndex);
  }, [activeNote?.path]);

  // Track navigation history for Research Pane (max 50 entries)
  useEffect(() => {
    if (!researchTarget) return;
    if (isResearchNavigatingRef.current) return;

    const curIndex = researchHistoryIndexRef.current;
    const curHist = researchHistoryRef.current;

    // If identical to current, do nothing
    if (
      curIndex >= 0 &&
      curHist[curIndex] &&
      curHist[curIndex].path === researchTarget.path &&
      curHist[curIndex].type === researchTarget.type
    ) {
      return;
    }

    const sliced = curHist.slice(0, curIndex + 1);
    let newHistory = [...sliced, researchTarget];
    if (newHistory.length > 50) {
      newHistory = newHistory.slice(newHistory.length - 50);
    }
    const newIndex = newHistory.length - 1;

    researchHistoryRef.current = newHistory;
    researchHistoryIndexRef.current = newIndex;
    setResearchHistory(newHistory);
    setResearchHistoryIndex(newIndex);
  }, [researchTarget]);

  useEffect(() => {
    const unsubSync = syncEngine.subscribe((state) => {
      setSyncState(state);
      if (state === 'synced') {
        loadVaultIndex().catch(() => {});
        if (activePathRef.current) {
          openNoteByPath(activePathRef.current).catch(() => {});
        }
      }
    });
    const unsubConflicts = syncEngine.subscribeConflicts(setConflicts);
    return () => {
      unsubSync();
      unsubConflicts();
    };
  }, [loadVaultIndex, openNoteByPath]);

  // Memoized lookup maps for instant client-side [[Wiki-Link]] resolution
  const linkLookup = useMemo(() => {
    const byPath = new Map<string, string>();
    const byName = new Map<string, string>();
    const sorted = [...allFiles].sort((a, b) => {
      const am = a.extension === 'md' || a.extension === 'canvas' || a.extension === 'base' ? 0 : 1;
      const bm = b.extension === 'md' || b.extension === 'canvas' || b.extension === 'base' ? 0 : 1;
      return am - bm || a.path.length - b.path.length;
    });
    for (const f of sorted) {
      const lp = f.path.toLowerCase();
      byPath.set(lp, f.path);
      if (f.extension === 'md') byPath.set(lp.replace(/\.md$/, ''), f.path);
      if (f.extension === 'canvas') byPath.set(lp.replace(/\.canvas$/, ''), f.path);
      if (f.extension === 'base') byPath.set(lp.replace(/\.base$/, ''), f.path);
      if (!byName.has(f.name.toLowerCase())) byName.set(f.name.toLowerCase(), f.path);
      if (!byName.has(f.basename.toLowerCase())) byName.set(f.basename.toLowerCase(), f.path);
    }
    return { byPath, byName };
  }, [allFiles]);

  const allNotesForEditor = useMemo(
    () =>
      allFiles
        .filter((f) => f.extension === 'md' || f.extension === 'canvas' || f.extension === 'base')
        .map((f) => ({
          path: f.path,
          name: f.name,
          basename: f.basename,
          extension: f.extension,
          folder: f.folder !== undefined ? f.folder : (f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''),
          frontmatter: f.frontmatter || {},
          tags: f.tags || [],
          mtime: f.mtime || 0,
          isSendTarget: f.isSendTarget,
          isTemplate: f.isTemplate,
        })),
    [allFiles]
  );

  const templateNotes = useMemo(() => {
    return allFiles
      .filter((f) => f.isTemplate && (f.extension === 'md' || f.path.endsWith('.md')))
      .map((f) => ({
        path: f.path,
        name: f.name.replace(/\.md$/i, ''),
        basename: f.basename,
        folder: f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '',
      }));
  }, [allFiles]);
  const allTagNames = useMemo(() => graphData.tags.map((t) => t.tag), [graphData.tags]);
  const vaultFolders = useMemo(() => extractVaultFolders(allFiles), [allFiles]);
  const vaultNotes = useMemo(
    () =>
      allFiles
        .filter((f) => f.extension === 'md' || f.path.endsWith('.md'))
        .map((f) => ({
          path: f.path,
          name: f.name ? f.name.replace(/\.md$/i, '') : f.path.replace(/\.md$/i, '').split('/').pop() || '',
        })),
    [allFiles]
  );

  const handleOpenSendToTarget = useCallback(() => {
    const selectedText = editorRef.current?.getSelectedText();
    if (!selectedText || !selectedText.trim()) {
      showToast(t('editor.noTextSelected') || 'Bitte markiere zuerst einen Textbereich im Editor.');
      return;
    }
    setIsSendToTargetModalOpen(true);
  }, [showToast, t]);

  const handleToggleSendTarget = useCallback(
    async (path: string, currentStatus?: boolean) => {
      try {
        let noteToUpdate: NoteData;
        if (activeNoteRef.current && activeNoteRef.current.path === path) {
          noteToUpdate = activeNoteRef.current;
        } else {
          noteToUpdate = await syncEngine.getNote(path);
        }
        const willBeTarget = currentStatus !== undefined ? !currentStatus : !noteToUpdate.isSendTarget;
        const existingProps = [...(noteToUpdate.properties || [])];
        const idx = existingProps.findIndex((p) => p.key.toLowerCase() === 'sendtarget');
        if (willBeTarget) {
          if (idx >= 0) existingProps[idx] = { key: 'sendtarget', value: true, type: 'checkbox' };
          else existingProps.push({ key: 'sendtarget', value: true, type: 'checkbox' });
        } else {
          if (idx >= 0) existingProps.splice(idx, 1);
        }

        const saved = await syncEngine.saveNote({
          path: noteToUpdate.path,
          body: noteToUpdate.body,
          properties: existingProps,
          forceOverwrite: true,
        });

        if (activeNoteRef.current && activeNoteRef.current.path === path) {
          setActiveNote(saved);
        }
        await syncEngine.getLocalDb().updateNodeSendTarget(path, willBeTarget);
        loadVaultIndex().catch(() => {});
      } catch (err) {
        console.error('Failed to toggle sendtarget:', err);
      }
    },
    [loadVaultIndex]
  );

  const handleToggleTemplate = useCallback(
    async (path: string, currentStatus?: boolean) => {
      try {
        let noteToUpdate: NoteData;
        if (activeNoteRef.current && activeNoteRef.current.path === path) {
          noteToUpdate = activeNoteRef.current;
        } else {
          noteToUpdate = await syncEngine.getNote(path);
        }
        const willBeTemplate = currentStatus !== undefined ? !currentStatus : !noteToUpdate.isTemplate;
        const existingProps = [...(noteToUpdate.properties || [])];
        const idx = existingProps.findIndex((p) => p.key.toLowerCase() === 'istemplate');
        if (willBeTemplate) {
          if (idx >= 0) existingProps[idx] = { key: 'isTemplate', value: true, type: 'checkbox' };
          else existingProps.push({ key: 'isTemplate', value: true, type: 'checkbox' });
        } else {
          if (idx >= 0) existingProps.splice(idx, 1);
        }

        const saved = await syncEngine.saveNote({
          path: noteToUpdate.path,
          body: noteToUpdate.body,
          properties: existingProps,
          forceOverwrite: true,
        });

        if (activeNoteRef.current && activeNoteRef.current.path === path) {
          setActiveNote(saved);
        }
        await syncEngine.getLocalDb().updateNodeTemplate(path, willBeTemplate);
        loadVaultIndex().catch(() => {});
        showToast(
          willBeTemplate
            ? (t('sidebar.templateSetToast') || 'Notiz als Vorlage festgelegt 📄')
            : (t('sidebar.templateRemovedToast') || 'Vorlage-Markierung entfernt')
        );
      } catch (err) {
        console.error('Failed to toggle isTemplate:', err);
      }
    },
    [loadVaultIndex, showToast, t]
  );

  const handleOpenTemplateModal = useCallback((parentFolder?: string) => {
    setTemplateParentFolder(parentFolder);
    setIsTemplateModalOpen(true);
  }, []);

  const handleSelectTemplate = useCallback(
    async (templatePath: string) => {
      setIsTemplateModalOpen(false);
      try {
        const defaultTitle = t('templates.newNoteDefaultTitle') || 'Neue Notiz';
        const inputTitle = window.prompt(
          t('templates.promptTitle') || 'Titel der neuen Notiz eingeben:',
          defaultTitle
        );
        if (inputTitle === null) return;
        const cleanTitle = inputTitle.trim() || defaultTitle;

        const templateNote = await syncEngine.getNote(templatePath);
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const timeStr = `${hours}:${minutes}`;

        const replaceVars = (str: string) =>
          str
            .replace(/\{\{date\}\}/gi, dateStr)
            .replace(/\{\{time\}\}/gi, timeStr)
            .replace(/\{\{title\}\}/gi, cleanTitle);

        const newBody = replaceVars(templateNote.body || '');

        // Strip isTemplate property and substitute variables
        const newProperties = (templateNote.properties || [])
          .filter((p) => p.key.toLowerCase() !== 'istemplate')
          .map((p) => {
            if (typeof p.value === 'string') {
              return { ...p, value: replaceVars(p.value) };
            }
            return p;
          });

        const parent = templateParentFolder ? templateParentFolder.replace(/\/+$/, '') : '';
        const fileName = cleanTitle.toLowerCase().endsWith('.md') ? cleanTitle : `${cleanTitle}.md`;
        const targetPath = parent ? `${parent}/${fileName}` : fileName;

        await syncEngine.saveNote({
          path: targetPath,
          body: newBody,
          properties: newProperties,
          forceOverwrite: true,
        });

        await loadVaultIndex();
        await openNoteByPath(targetPath);
        showToast(t('templates.noteCreatedToast') || `Notiz "${cleanTitle}" aus Vorlage erstellt.`);
      } catch (err) {
        console.error('Failed to create note from template:', err);
        alert((err as Error).message || 'Fehler beim Erstellen der Notiz aus Vorlage');
      }
    },
    [templateParentFolder, openNoteByPath, loadVaultIndex, showToast, t]
  );

  const handleSendToTarget = useCallback(
    async (targetPath: string) => {
      const selectedText = editorRef.current?.getSelectedText();
      if (!selectedText || !selectedText.trim()) {
        showToast(t('editor.noTextSelected') || 'Bitte markiere zuerst einen Textbereich im Editor.');
        return;
      }
      if (!activeNoteRef.current) return;

      const originPath = activeNoteRef.current.path;
      const originName = originPath.split('/').pop()?.replace(/\.md$/, '') || originPath;
      const targetName = targetPath.split('/').pop()?.replace(/\.md$/, '') || targetPath;

      const isDe =
        typeof localStorage !== 'undefined' &&
        (localStorage.getItem('zuber_language') === 'de' ||
          localStorage.getItem('knowmesh_language') === 'de');
      const replacementText = isDe ? `→ Verschoben nach [[${targetName}]]` : `→ Moved to [[${targetName}]]`;

      // 1. In source note: replace selection with backlink
      editorRef.current?.replaceSelection(replacementText);

      // 2. In target note: load, append timestamped block, save
      try {
        const targetNote = await syncEngine.getNote(targetPath);
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const headerPrefix = isDe ? 'Aus' : 'From';
        const header = `### ${timestamp} – ${headerPrefix} [[${originName}]]`;
        const trimmedTargetBody = (targetNote.body || '').trimEnd();
        const separator = trimmedTargetBody.length > 0 ? '\n\n' : '';
        const newTargetBody = `${trimmedTargetBody}${separator}${header}\n\n${selectedText.trim()}\n`;

        await syncEngine.saveNote({
          path: targetNote.path,
          body: newTargetBody,
          properties: targetNote.properties,
          forceOverwrite: true,
        });

        loadVaultIndex().catch(() => {});
        refreshBacklinks(originPath).catch(() => {});

        showToast(
          isDe
            ? `Text erfolgreich an [[${targetName}]] gesendet.`
            : `Text successfully sent to [[${targetName}]].`
        );
      } catch (err) {
        console.error('Failed to send text to target note:', err);
        showToast(
          isDe ? 'Fehler beim Senden an die Ziel-Notiz' : 'Failed to send text to target note'
        );
      }
    },
    [loadVaultIndex, refreshBacklinks, showToast, t]
  );

  const handleOpenDailyNote = useCallback(async () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const todayPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    const config = getDailyNoteConfig();
    const folder = (config.dailyFolder || '').trim().replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');

    const mdFiles = allFilesRef.current.filter((f) => f.extension === 'md');

    // Search 1: In the configured dailyFolder
    let found = mdFiles.find((f) => {
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
      if (folder) {
        if (dir.toLowerCase() !== folder.toLowerCase()) return false;
      }
      const fname = f.basename || (f.path.includes('/') ? f.path.slice(f.path.lastIndexOf('/') + 1) : f.path);
      return fname.slice(0, 10) === todayPrefix;
    });

    // Search 2: Fallback across the whole vault if not found in folder
    if (!found && folder) {
      found = mdFiles.find((f) => {
        const fname = f.basename || (f.path.includes('/') ? f.path.slice(f.path.lastIndexOf('/') + 1) : f.path);
        return fname.slice(0, 10) === todayPrefix;
      });
    }

    if (found) {
      await openNoteByPath(found.path);
      if (workspaceViewRef.current === 'graph') setWorkspaceView('editor');
      if (isMobile) setLeftSidebarOpen(false);
      return;
    }

    // Daily note does not exist yet: create new note
    const targetFileName = `${todayPrefix}.md`;
    const targetPath = folder ? `${folder}/${targetFileName}` : targetFileName;

    let initialBody = `# ${todayPrefix}\n\n`;
    let initialProps: FrontmatterProperty[] = [
      { key: 'tags', type: 'list', value: ['daily'] },
      { key: 'erstellt', type: 'date', value: todayPrefix },
    ];

    if (config.templatePath) {
      try {
        const templateNote = await syncEngine.getNote(config.templatePath);
        if (templateNote) {
          const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
          const replacePlaceholders = (text: string) =>
            text.replace(/\{\{date\}\}/gi, todayPrefix).replace(/\{\{time\}\}/gi, timeStr);

          initialBody = replacePlaceholders(templateNote.body || '');
          if (templateNote.properties && templateNote.properties.length > 0) {
            initialProps = templateNote.properties.map((p) => {
              if (typeof p.value === 'string') {
                return { ...p, value: replacePlaceholders(p.value) };
              }
              if (Array.isArray(p.value)) {
                return {
                  ...p,
                  value: p.value.map((v) => (typeof v === 'string' ? replacePlaceholders(v) : v)),
                };
              }
              return { ...p };
            });
          }
        }
      } catch (err) {
        console.warn('Failed to load daily note template:', err);
      }
    }

    try {
      const created = await syncEngine.saveNote({
        path: targetPath,
        body: initialBody,
        properties: initialProps,
        forceOverwrite: true,
      });
      await loadVaultIndex();
      setActiveNote(created);
      setSaveState('saved');
      recordLastActiveNote(created.path);
      recordRecentNote(created.path);
      if (workspaceViewRef.current === 'graph') setWorkspaceView('editor');
      if (isMobile) setLeftSidebarOpen(false);
    } catch (err) {
      console.error('Failed to create daily note:', err);
      showToast(`Fehler beim Erstellen der Tagesnotiz: ${String(err)}`);
    }
  }, [openNoteByPath, isMobile, loadVaultIndex, showToast]);

  handleOpenDailyNoteRef.current = handleOpenDailyNote;

  const handleActiveNoteDeleted = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveTaskRef.current = null;
    setSaveState('saved');
    explicitUserClearRef.current = true;
    activePathRef.current = null;
    setActiveNote(null);
    clearLastActiveNote();
    if (workspaceViewRef.current === 'graph') {
      setWorkspaceView('editor');
    }
  }, []);

  const sidebarHandlers = useMemo(
    () => ({
      onSelectNote: (path: string, event?: React.MouseEvent | { altKey?: boolean; preventDefault?: () => void }) => {
        if (event?.altKey) {
          event.preventDefault?.();
        }
        if (workspaceViewRef.current === 'split' && !event?.altKey) {
          openInResearch(path);
        } else {
          const isDoc =
            path.endsWith('.md') ||
            path.endsWith('.canvas') ||
            path.endsWith('.base') ||
            !path.includes('.');
          if (isDoc) {
            openNoteByPath(path);
            if (workspaceViewRef.current === 'graph') setWorkspaceView('editor');
          } else {
            window.open(api.getAttachmentUrl(path), '_blank');
          }
        }
        if (isMobile) {
          setLeftSidebarOpen(false);
        }
      },
      isResearchOpen: workspaceView === 'split',
      onOpenInResearch: openInResearch,
      onCreateNote: (parentFolder?: string) => {
        openCreateNoteDialog(parentFolder);
      },
      onCreateCanvas: (parentFolder?: string) => {
        openCreateCanvasDialog(parentFolder);
      },
      onCreateBase: (parentFolder?: string) => {
        openCreateBaseDialog(parentFolder);
      },
      onCreateFolder: (parentFolder?: string) => {
        openCreateFolderDialog(parentFolder);
      },
      onRenameEntry: (oldPath: string, currentName: string) => {
        setDialog({ type: 'rename', targetPath: oldPath, initialValue: currentName });
        setDialogInput(currentName);
      },
      onDeleteEntry: (path: string, name: string) => {
        const isFolder = tree.some((n) => n.path === path && n.type === 'folder');
        setDialog({
          type: 'delete',
          targetPath: path,
          initialValue: name,
          prompt: isFolder
            ? t('dialogs.deleteFolderPrompt', { name })
            : t('dialogs.deleteNotePrompt', { name }),
        });
      },
      onActiveNoteDeleted: handleActiveNoteDeleted,
      onRefresh: () => {
        loadVaultIndex();
      },
      onSelectTagFilter: (tag: string | null) => setSelectedTagFilter(tag),
      onOpenVersionHistory: (path: string) => setVersionHistoryPath(path),
      onToggleSendTarget: handleToggleSendTarget,
      onToggleTemplate: handleToggleTemplate,
      onOpenTemplateSelect: handleOpenTemplateModal,
      onOpenDailyNote: handleOpenDailyNote,
    }),
    [
      openNoteByPath,
      openCreateNoteDialog,
      openCreateCanvasDialog,
      openCreateBaseDialog,
      openCreateFolderDialog,
      loadVaultIndex,
      handleToggleSendTarget,
      handleToggleTemplate,
      handleOpenTemplateModal,
      handleOpenDailyNote,
      handleActiveNoteDeleted,
      openInResearch,
      workspaceView,
      tree,
      t,
      isMobile,
    ]
  );

  const isProcessingSharesRef = useRef(false);

  const consumeIncomingShares = useCallback(
    async (existingFiles?: string[]): Promise<string | null> => {
      if (isProcessingSharesRef.current) return null;
      isProcessingSharesRef.current = true;

      try {
        // 1. Immediately clean up URL query parameter to avoid re-triggering
        cleanShareUrlQuery();

        const files = existingFiles || allFilesRef.current.map((f) => f.path);
        const sharedPath = await syncEngine.processIncomingShares({
          existingFiles: files,
        });

        if (sharedPath) {
          await loadVaultIndex();
          await openNoteByPath(sharedPath);
        }
        return sharedPath;
      } catch (err) {
        console.error('[Zuber Share] Failed to process incoming shares:', err);
        return null;
      } finally {
        isProcessingSharesRef.current = false;
      }
    },
    [loadVaultIndex, openNoteByPath]
  );

  // Initial authentication check
  useEffect(() => {
    let cancelled = false;

    const initAuth = async () => {
      let storedToken: string | null = null;
      let hasLocalNotes = false;
      let hasVerifier = false;

      try {
        storedToken = getStoredToken();
        hasLocalNotes = await syncEngine.hasLocalData();
        hasVerifier = hasOfflineAuthVerifier();
      } catch (e) {
        console.warn('Offline mode active, falling back to local cache: Could not read local auth metadata:', e);
      }

      const canProceedOffline = Boolean(storedToken || hasLocalNotes || hasVerifier);

      // Fast initial hydration from local IndexedDB cache to prevent UI delay/flicker
      if (canProceedOffline) {
        try {
          const [cachedTree, cachedFiles] = await Promise.all([
            syncEngine.getLocalDb().getMeta<FileTreeNode[]>('tree'),
            syncEngine.getLocalDb().getMeta<any[]>('files'),
          ]);
          if (!cancelled) {
            if (cachedTree && cachedTree.length > 0) setTree(cachedTree);
            if (cachedFiles && cachedFiles.length > 0) setAllFiles(cachedFiles);
          }
        } catch {}
      }

      const activateOfflineMode = async () => {
        if (cancelled) return;
        setAuthenticated(true);
        setAuthChecked(true);
        setSyncState('offline');
        try {
          const { treeRes } = await loadVaultIndex();
          const sharedPath = await consumeIncomingShares(treeRes.files.map((f) => f.path));
          if (!sharedPath) {
            const startupPath = await resolveStartupNotePath(treeRes.files);
            if (startupPath && !cancelled) {
              await openNoteByPath(startupPath);
            }
          }
        } catch (offlineErr) {
          console.warn('Offline mode active, falling back to local cache:', offlineErr);
        }
      };

      let forceOfflineBoot = false;
      try {
        if (localStorage.getItem('zuber_force_offline_boot') === '1') {
          forceOfflineBoot = true;
          localStorage.removeItem('zuber_force_offline_boot');
        }
      } catch {}

      // 1. Clearly offline according to navigator or forced offline cache boot from ErrorBoundary
      if (forceOfflineBoot || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        if (canProceedOffline || forceOfflineBoot) {
          await activateOfflineMode();
        } else {
          if (cancelled) return;
          setAuthenticated(false);
          setAuthChecked(true);
        }
        return;
      }

      // 2. Online or browser reports online: attempt checkAuthStatus with fast 2500ms timeout
      try {
        const status = await api.checkAuthStatus(2500);
        if (cancelled) return;
        setHttpsActive(status.https);
        setVaultPath(status.vaultPath);
        setAuthenticated(status.authenticated);
        setAuthChecked(true);

        if (status.authenticated) {
          // Ensure syncEngine immediately transitions to online & starts delta sync
          syncEngine.notifyAuthenticatedOnline();
          try {
            const { treeRes } = await loadVaultIndex();
            const sharedPath = await consumeIncomingShares(treeRes.files.map((f) => f.path));
            if (!sharedPath) {
              const startupPath = await resolveStartupNotePath(treeRes.files);
              if (startupPath && !cancelled) {
                await openNoteByPath(startupPath);
              }
            }
          } catch (loadErr) {
            console.warn('Offline mode active, falling back to local cache:', loadErr);
          }
        }
      } catch (err: any) {
        if (cancelled) return;
        console.warn('Offline mode active, falling back to local cache:', err);

        // Check if server actively rejected with HTTP 401 Unauthorized
        if (err instanceof ApiHttpError && err.status === 401) {
          setStoredToken(null);
          setAuthenticated(false);
          setAuthChecked(true);
          return;
        }

        // Otherwise: Network error (Failed to fetch, connection refused, DNS error, offline, timeout)
        if (canProceedOffline) {
          await activateOfflineMode();
        } else {
          setAuthenticated(false);
          setAuthChecked(true);
        }
      }
    };

    initAuth().catch((err) => {
      console.warn('Offline mode active, falling back to local cache:', err);
      if (!cancelled) {
        setAuthenticated(true);
        setAuthChecked(true);
        setSyncState('offline');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loadVaultIndex, openNoteByPath]);

  // Reconcile active note state on window focus or tab visibility change
  const reconcileActiveNoteOnFocus = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!authenticated) return;
    const currentPath = activePathRef.current;
    if (!currentPath) return;

    const isDirty =
      saveStateRef.current === 'dirty' ||
      saveStateRef.current === 'saving' ||
      Boolean(saveTimerRef.current) ||
      pendingSavePayloadRef.current.has(currentPath) ||
      Boolean(isSavingFileRef.current.get(currentPath));

    try {
      if (!isDirty) {
        // Active note is clean: pull latest note from server / cache
        const latest = await syncEngine.getNote(currentPath);
        if (
          activePathRef.current === currentPath &&
          latest.updatedAt > (activeNoteRef.current?.updatedAt || 0)
        ) {
          clientLogger.info('sync', `Reconciling clean note "${currentPath}" on focus/visibility.`);
          setActiveNote(latest);
        }
      } else {
        // Active note has uncommitted local edits: reconcile baseMtime with server without clobbering editor
        if (navigator.onLine) {
          const manifest = await api.getSyncManifest();
          const entry = manifest.find((m) => m.path === currentPath);
          if (entry && activeNoteRef.current && activeNoteRef.current.path === currentPath) {
            const currentUpdatedAt = activeNoteRef.current.updatedAt;
            if (entry.mtime > currentUpdatedAt) {
              try {
                const serverNote = await rawApi.getNote(currentPath);
                const ff = isFastForwardCompatible(activeNoteRef.current.body, serverNote.body);
                if (ff.compatible && ff.winner === 'local') {
                  clientLogger.info(
                    'sync',
                    `Fast-forwarding dirty note "${currentPath}" base mtime to server mtime.`
                  );
                  activeNoteRef.current.updatedAt = serverNote.updatedAt;
                }
              } catch {}
            }
          }
        }
      }
    } catch (err) {
      clientLogger.warn('sync', `Failed to reconcile active note on focus:`, err);
    }
  }, [authenticated]);

  // WebSocket live file-watcher connection
  useEffect(() => {
    if (!authenticated) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connectWs = () => {
      if (disposed) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setWsConnected(false);
        return;
      }

      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const token = getStoredToken();
        const wsUrl = `${proto}//${window.location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setWsConnected(true);
          if (syncEngine.getSyncState() === 'offline') {
            syncEngine.checkConnectionAndSync().catch(() => {});
          }
        };

        ws.onerror = () => {
          // Suppress unhandled error log when offline / server unreachable
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (
              msg.type === 'vault:changed' ||
              msg.type === 'add' ||
              msg.type === 'unlink' ||
              msg.type === 'addDir' ||
              msg.type === 'unlinkDir'
            ) {
              const paths: string[] = Array.isArray(msg.paths) ? msg.paths : [];
              loadVaultIndex().catch(() => {});
              scheduleIndexRefresh(true, 200);
              // If the currently open file was modified externally (not by our own save), reload it
              const currentPath = activePathRef.current;
              if (currentPath && paths.includes(currentPath)) {
                const selfWriteTime = recentSelfWritesRef.current.get(currentPath) || 0;
                const isWithinSelfWriteWindow = Date.now() - selfWriteTime < 3000;
                const isRecentLocalSave = Date.now() - lastLocalSaveTimeRef.current < 3000;
                const isActivelyUploading = isUploadingAttachmentRef.current;

                if (isWithinSelfWriteWindow || isRecentLocalSave || isActivelyUploading) {
                  clientLogger.debug('sync', `Echo suppressed for active note "${currentPath}" (within self-write window).`);
                } else if (
                  saveStateRef.current === 'dirty' ||
                  saveStateRef.current === 'saving' ||
                  Boolean(saveTimerRef.current) ||
                  pendingSavePayloadRef.current.has(currentPath) ||
                  Boolean(isSavingFileRef.current.get(currentPath))
                ) {
                  clientLogger.info(
                    'sync',
                    `External change detected on active note "${currentPath}" while editing: reconciling base mtime.`
                  );
                  reconcileActiveNoteOnFocus();
                } else {
                  clientLogger.info('sync', `External change detected on open note "${currentPath}". Reloading.`);
                  openNoteByPath(currentPath);
                }
              }
            }
          } catch {
            // ignore
          }
        };

        ws.onclose = () => {
          setWsConnected(false);
          if (!disposed && (typeof navigator === 'undefined' || navigator.onLine)) {
            reconnectTimer = setTimeout(connectWs, 3500);
          }
        };
      } catch {
        setWsConnected(false);
      }
    };

    connectWs();

    const handleOnline = () => {
      connectWs();
      syncEngine.checkConnectionAndSync();
    };
    window.addEventListener('online', handleOnline);

    return () => {
      disposed = true;
      window.removeEventListener('online', handleOnline);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        try {
          ws.close();
        } catch {}
      }
    };
  }, [authenticated, loadVaultIndex, scheduleIndexRefresh, openNoteByPath, reconcileActiveNoteOnFocus]);

  // Ingest handler for incoming Web Share Target items & focus/visibility reconciliation while app is running
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!authenticated) return;

    const handleFocusOrVisibility = () => {
      if (window.location.search.includes('incoming_share')) {
        consumeIncomingShares();
      }
      reconcileActiveNoteOnFocus();
    };

    handleFocusOrVisibility();
    window.addEventListener('focus', handleFocusOrVisibility);
    window.addEventListener('visibilitychange', handleFocusOrVisibility);
    return () => {
      window.removeEventListener('focus', handleFocusOrVisibility);
      window.removeEventListener('visibilitychange', handleFocusOrVisibility);
    };
  }, [authenticated, consumeIncomingShares, reconcileActiveNoteOnFocus]);

  const handleLogin = async (password: string) => {
    const loginRes = await api.login(password);
    setAuthenticated(true);
    if (!loginRes.offline) {
      syncEngine.notifyAuthenticatedOnline();
    }
    const { treeRes } = await loadVaultIndex();
    const sharedPath = await consumeIncomingShares(treeRes.files.map((f) => f.path));
    if (!sharedPath) {
      const targetPath = await resolveStartupNotePath(treeRes.files);
      if (targetPath) {
        await openNoteByPath(targetPath);
      }
    }
  };

  const handleLogout = async () => {
    const prevPath = activePathRef.current;
    const wasDirty = saveStateRef.current === 'dirty' || Boolean(pendingSaveTaskRef.current);
    await flushPendingSave();
    if (prevPath && wasDirty && navigator.onLine) {
      api.commitGit({ reason: `auto: close ${prevPath}` }).catch(() => {});
    }
    await api.logout();
    setAuthenticated(false);
    setActiveNote(null);
  };

  const performSaveForPath = useCallback(
    async (path: string): Promise<void> => {
      // If already saving this path, return existing in-flight promise;
      // when it completes its current request, its while-loop will process pendingSavePayloadRef
      const existingInFlight = inFlightSavePromiseRef.current.get(path);
      if (existingInFlight && isSavingFileRef.current.get(path)) {
        return existingInFlight;
      }

      const savePromise = (async () => {
        isSavingFileRef.current.set(path, true);
        setSaveState('saving');
        try {
          while (pendingSavePayloadRef.current.has(path)) {
            const currentPayload = pendingSavePayloadRef.current.get(path)!;
            pendingSavePayloadRef.current.delete(path);

            const now = Date.now();
            lastLocalSaveTimeRef.current = now;
            recentSelfWritesRef.current.set(path, now);
            const currentBaseMtime =
              activeNoteRef.current?.path === path ? activeNoteRef.current.updatedAt : undefined;

            const saved = await syncEngine.saveNote({
              path,
              ...currentPayload,
              baseMtime: currentBaseMtime,
              explicitClear: explicitUserClearRef.current,
            });

            const finishTime = Date.now();
            lastLocalSaveTimeRef.current = finishTime;
            recentSelfWritesRef.current.set(saved.path, finishTime);

            // Update activeNoteRef immediately if note path still matches
            if (activeNoteRef.current && activeNoteRef.current.path === saved.path) {
              activeNoteRef.current = {
                ...activeNoteRef.current,
                links: saved.links,
                embeds: saved.embeds,
                tags: saved.tags,
                headings: saved.headings,
                updatedAt: saved.updatedAt,
              };
            }

            // Only merge derived metadata – never overwrite text the user typed while saving
            setActiveNote((prev) =>
              prev && prev.path === saved.path
                ? {
                    ...prev,
                    links: saved.links,
                    embeds: saved.embeds,
                    tags: saved.tags,
                    headings: saved.headings,
                    updatedAt: saved.updatedAt,
                  }
                : prev
            );

            setAllFiles((prev) => {
              const idx = prev.findIndex((f) => f.path === saved.path);
              if (idx === -1) return prev;
              const updated = [...prev];
              const isSendTarget = Boolean(
                saved.frontmatter &&
                  (saved.frontmatter.sendtarget === true || saved.frontmatter.sendtarget === 'true')
              );
              const isTemplate = Boolean(
                saved.frontmatter &&
                  (saved.frontmatter.isTemplate === true || saved.frontmatter.isTemplate === 'true')
              );
              updated[idx] = {
                ...updated[idx],
                frontmatter: saved.frontmatter || {},
                tags: saved.tags || [],
                mtime: saved.updatedAt || Date.now(),
                isSendTarget,
                isTemplate,
              };
              return updated;
            });

            scheduleIndexRefresh(false, 1500);
          }

          if (pendingSavePayloadRef.current.size === 0) {
            setSaveState('saved');
          }
        } catch (err) {
          console.error('Speicherfehler:', err);
        } finally {
          isSavingFileRef.current.delete(path);
          inFlightSavePromiseRef.current.delete(path);
          pendingSaveTaskRef.current = null;
        }
      })();

      inFlightSavePromiseRef.current.set(path, savePromise);
      return savePromise;
    },
    [scheduleIndexRefresh]
  );

  // Debounced auto-save when note body, properties, or rawContent changes
  const scheduleSave = useCallback(
    (
      path: string,
      payload: {
        body?: string;
        properties?: FrontmatterProperty[];
        rawContent?: string;
      }
    ) => {
      setSaveState('dirty');
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      const existingPending = pendingSavePayloadRef.current.get(path);
      pendingSavePayloadRef.current.set(path, {
        ...existingPending,
        ...payload,
      });

      const executeSave = () => performSaveForPath(path);
      pendingSaveTaskRef.current = executeSave;

      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        executeSave();
      }, 500);
    },
    [performSaveForPath]
  );

  const handlePropertiesChange = (updatedProps: FrontmatterProperty[]) => {
    if (!activeNote) return;
    const targetPath = activeNote.path;
    setActiveNote((prev) => {
      if (!prev || prev.path !== targetPath) return prev;
      const cleanedProps = pruneOrphanedTableWidths(updatedProps, prev.body);
      const newRaw = serializeMarkdownWithFrontmatter(cleanedProps, prev.body);
      scheduleSave(targetPath, {
        properties: cleanedProps,
        body: prev.body,
      });
      return {
        ...prev,
        properties: cleanedProps,
        rawContent: newRaw,
      };
    });
  };

  const handleBodyChange = (newBody: string) => {
    if (!activeNote) return;
    if (newBody.trim() === '' && activeNote.body.trim().length > 0) {
      explicitUserClearRef.current = true;
    } else if (newBody.trim().length > 0) {
      explicitUserClearRef.current = false;
    }
    const targetPath = activeNote.path;
    setActiveNote((prev) => {
      if (!prev || prev.path !== targetPath) return prev;
      const cleanedProps = pruneOrphanedTableWidths(prev.properties, newBody);
      scheduleSave(targetPath, {
        properties: cleanedProps,
        body: newBody,
      });
      return {
        ...prev,
        body: newBody,
        properties: cleanedProps,
      };
    });
  };

  const handleUpdateTableWidths = (
    headerSignature: string,
    widths: number[],
    currentBody?: string
  ) => {
    if (!activeNote) return;
    const targetPath = activeNote.path;
    setActiveNote((prev) => {
      if (!prev || prev.path !== targetPath) return prev;
      const effectiveBody = currentBody ?? prev.body;
      const nextProps = setTableWidthsInProperties(
        prev.properties,
        headerSignature,
        widths,
        effectiveBody
      );
      const newRaw = serializeMarkdownWithFrontmatter(nextProps, effectiveBody);
      scheduleSave(targetPath, {
        properties: nextProps,
        body: effectiveBody,
      });
      return {
        ...prev,
        properties: nextProps,
        rawContent: newRaw,
      };
    });
  };

  const handleRenameTableWidthSignature = (
    oldSignature: string,
    newSignature: string,
    currentBody?: string
  ) => {
    if (!activeNote) return;
    const targetPath = activeNote.path;
    setActiveNote((prev) => {
      if (!prev || prev.path !== targetPath) return prev;
      const effectiveBody = currentBody ?? prev.body;
      const nextProps = renameTableWidthSignature(
        prev.properties,
        oldSignature,
        newSignature,
        effectiveBody
      );
      if (nextProps === prev.properties) return prev;
      const newRaw = serializeMarkdownWithFrontmatter(nextProps, effectiveBody);
      scheduleSave(targetPath, {
        properties: nextProps,
        body: effectiveBody,
      });
      return {
        ...prev,
        properties: nextProps,
        rawContent: newRaw,
      };
    });
  };

  const handleRawChange = (newRaw: string) => {
    if (!activeNote) return;
    const parsed = parseMarkdownWithFrontmatter(newRaw);
    if (parsed.body.trim() === '' && activeNote.body.trim().length > 0) {
      explicitUserClearRef.current = true;
    } else if (parsed.body.trim().length > 0) {
      explicitUserClearRef.current = false;
    }
    setActiveNote({
      ...activeNote,
      rawContent: newRaw,
      body: parsed.body,
      properties: parsed.properties,
      frontmatter: parsed.frontmatter,
    });
    scheduleSave(activeNote.path, {
      rawContent: newRaw,
    });
  };

  const resolveLocally = (target: string, fromPath?: string | null): string | null => {
    let decoded = target;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      // keep raw
    }
    const clean = decoded
      .split('#')[0]
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\/+/, '')
      .toLowerCase();
    if (!clean) return null;

    if (fromPath) {
      const lastSlash = fromPath.lastIndexOf('/');
      if (lastSlash > 0) {
        const dir = fromPath.slice(0, lastSlash).toLowerCase();
        const relMatch = linkLookup.byPath.get(`${dir}/${clean}`);
        if (relMatch) return relMatch;
      }
    }

    return linkLookup.byPath.get(clean) ?? linkLookup.byName.get(clean) ?? null;
  };

  // Navigate to a [[Wiki-Link]] or Markdown [Link](target); if the note does not exist yet, create it automatically!
  const handleNavigateWikiLink = async (
    target: string,
    event?: { altKey?: boolean; preventDefault?: () => void }
  ) => {
    try {
      if (event?.altKey) {
        event.preventDefault?.();
      }
      const isAlt = Boolean(event?.altKey);
      const targetInResearch = workspaceViewRef.current === 'split' && !isAlt;

      const trimmed = target.trim();
      if (/^(https?:|mailto:|tel:)/i.test(trimmed)) {
        window.open(trimmed, '_blank', 'noopener,noreferrer');
        return;
      }

      const currentFrom = activePathRef.current;

      // Fast path: resolve in the browser (no server round trip)
      const local = resolveLocally(trimmed, currentFrom);
      if (local) {
        if (targetInResearch) {
          openInResearch(local);
        } else {
          const isDoc =
            local.toLowerCase().endsWith('.md') ||
            local.toLowerCase().endsWith('.canvas') ||
            local.toLowerCase().endsWith('.base');
          if (isDoc) {
            if (workspaceViewRef.current === 'graph') {
              setWorkspaceView('editor');
            }
            await openNoteByPath(local);
          } else {
            window.open(api.getAttachmentUrl(local, currentFrom || undefined), '_blank');
          }
        }
        return;
      }

      // If it looks like a binary attachment (PDF, Office, Image, Archive), open attachment directly
      if (/\.(pdf|xlsx|xls|docx|doc|pptx|png|jpe?g|gif|webp|svg|zip|mp3|mp4)$/i.test(trimmed)) {
        if (targetInResearch) {
          openInResearch(trimmed);
        } else {
          window.open(api.getAttachmentUrl(trimmed, currentFrom || undefined), '_blank');
        }
        return;
      }

      // Fallback (e.g. aliases): ask the server
      const res = await api.resolveWikiLink(trimmed, currentFrom || undefined);
      if (res.resolvedPath) {
        if (targetInResearch) {
          openInResearch(res.resolvedPath);
        } else {
          const isDoc =
            res.resolvedPath.toLowerCase().endsWith('.md') ||
            res.resolvedPath.toLowerCase().endsWith('.canvas') ||
            res.resolvedPath.toLowerCase().endsWith('.base');
          if (isDoc) {
            if (workspaceViewRef.current === 'graph') {
              setWorkspaceView('editor');
            }
            await openNoteByPath(res.resolvedPath);
          } else {
            window.open(api.getAttachmentUrl(res.resolvedPath, currentFrom || undefined), '_blank');
          }
        }
        return;
      }

      // Create new note for unresolved Wiki-Link
      await flushPendingSave();
      let decodedName = trimmed;
      try {
        decodedName = decodeURIComponent(trimmed);
      } catch {
        // ignore
      }
      const cleanName = decodedName.split('#')[0].replace(/\.md$/i, '').trim();
      const newPath = `${cleanName}.md`;
      const created = await syncEngine.saveNote({
        path: newPath,
        properties: [
          { key: 'tags', type: 'list', value: ['notiz'] },
          {
            key: 'erstellt',
            type: 'date',
            value: new Date().toISOString().slice(0, 10),
          },
        ],
        body: `# ${cleanName}\n\n`,
      });
      if (targetInResearch) {
        openInResearch(created.path);
      } else {
        if (workspaceViewRef.current === 'graph') {
          setWorkspaceView('editor');
        }
        await openNoteByPath(created.path);
      }
      scheduleIndexRefresh(true, 100);
    } catch (err) {
      console.error('Fehler beim Öffnen des Wiki-Links:', err);
    }
  };

  const handleDialogConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dialog) return;
    const currentDialog = dialog;
    const val = dialogInput.trim();

    setDialog(null);
    setDialogInput('');

    try {
      if (currentDialog.type === 'create-note') {
        if (!val) return;
        await flushPendingSave();
        const rawTitle = val.replace(/\.md$/i, '').trim();
        if (!rawTitle) return;
        const cleanTitle = getUniqueDefaultName(rawTitle, 'file', currentDialog.parentFolder);
        const relPath = currentDialog.parentFolder
          ? `${currentDialog.parentFolder}/${cleanTitle}.md`
          : `${cleanTitle}.md`;
        const initialProperties = currentDialog.initialProperties || [];
        const baseProps: FrontmatterProperty[] = [
          { key: 'tags', type: 'list', value: [] },
          {
            key: 'erstellt',
            type: 'date',
            value: new Date().toISOString().slice(0, 10),
          },
        ];
        const mergedProps = [...baseProps];
        for (const p of initialProperties) {
          const idx = mergedProps.findIndex(
            (ep) => ep.key.toLowerCase() === p.key.toLowerCase()
          );
          if (idx >= 0) {
            mergedProps[idx] = p;
          } else {
            mergedProps.push(p);
          }
        }
        const created = await syncEngine.saveNote({
          path: relPath,
          properties: mergedProps,
          body: `# ${cleanTitle}\n\n`,
        });
        await loadVaultIndex();
        setActiveNote(created);
        setSaveState('saved');
        recordLastActiveNote(created.path);
        recordRecentNote(created.path);
        if (workspaceView === 'graph') setWorkspaceView('editor');
        if (isMobile) setLeftSidebarOpen(false);
      } else if (currentDialog.type === 'create-canvas') {
        if (!val) return;
        await flushPendingSave();
        const rawTitle = val.replace(/\.canvas$/i, '').trim();
        if (!rawTitle) return;
        const cleanTitle = getUniqueDefaultName(rawTitle, 'canvas', currentDialog.parentFolder);
        const relPath = currentDialog.parentFolder
          ? `${currentDialog.parentFolder}/${cleanTitle}.canvas`
          : `${cleanTitle}.canvas`;
        const initialJson = JSON.stringify({ nodes: [], edges: [] }, null, 2);
        const created = await syncEngine.saveNote({
          path: relPath,
          rawContent: initialJson,
          body: initialJson,
          properties: [],
        });
        await loadVaultIndex();
        setActiveNote(created);
        setSaveState('saved');
        recordLastActiveNote(created.path);
        recordRecentNote(created.path);
        if (workspaceView === 'graph') setWorkspaceView('editor');
        if (isMobile) setLeftSidebarOpen(false);
      } else if (currentDialog.type === 'create-base') {
        if (!val) return;
        await flushPendingSave();
        const rawTitle = val.replace(/\.base$/i, '').trim();
        if (!rawTitle) return;
        const cleanTitle = getUniqueDefaultName(rawTitle, 'base', currentDialog.parentFolder);
        const relPath = currentDialog.parentFolder
          ? `${currentDialog.parentFolder}/${cleanTitle}.base`
          : `${cleanTitle}.base`;
        const initialYaml = 'views:\n  - type: table\n    name: Table\n';
        const created = await syncEngine.saveNote({
          path: relPath,
          rawContent: initialYaml,
          body: initialYaml,
          properties: [],
        });
        await loadVaultIndex();
        setActiveNote(created);
        setSaveState('saved');
        recordLastActiveNote(created.path);
        recordRecentNote(created.path);
        if (workspaceView === 'graph') setWorkspaceView('editor');
        if (isMobile) setLeftSidebarOpen(false);
      } else if (currentDialog.type === 'create-folder') {
        if (!val) return;
        const cleanFolder = getUniqueDefaultName(val, 'folder', currentDialog.parentFolder);
        const relPath = currentDialog.parentFolder
          ? `${currentDialog.parentFolder}/${cleanFolder}`
          : cleanFolder;
        await syncEngine.createFolder(relPath);
        await loadVaultIndex();
      } else if (currentDialog.type === 'rename' && currentDialog.targetPath) {
        if (!val) return;
        await flushPendingSave();
        const parts = currentDialog.targetPath.split('/');
        parts[parts.length - 1] = val;
        const newRelPath = parts.join('/');
        const res = await syncEngine.renameEntry(currentDialog.targetPath, newRelPath);
        notifyVaultEntryRenamed(currentDialog.targetPath, res.newPath);
        await loadVaultIndex();
        if (activeNote?.path === currentDialog.targetPath) {
          await openNoteByPath(res.newPath);
        }
      } else if (currentDialog.type === 'delete' && currentDialog.targetPath) {
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        pendingSaveTaskRef.current = null;
        setSaveState('saved');

        const deletedPath = currentDialog.targetPath;
        const isActiveOrChild =
          activeNote &&
          (activeNote.path === deletedPath ||
            activeNote.path.startsWith(deletedPath + '/'));

        await syncEngine.deleteEntry(deletedPath);
        notifyVaultEntryDeleted(deletedPath);
        // Prune deleted path from history stack
        setHistory((prev) => {
          const filtered = prev.filter((p) => p !== deletedPath && !p.startsWith(deletedPath + '/'));
          const newIndex = Math.min(historyIndexRef.current, filtered.length - 1);
          historyRef.current = filtered;
          historyIndexRef.current = newIndex;
          setHistoryIndex(newIndex);
          return filtered;
        });
        // Prune deleted path from research history stack
        setResearchHistory((prev) => {
          const filtered = prev.filter((t) => t.path !== deletedPath && !t.path.startsWith(deletedPath + '/'));
          const newIndex = Math.min(researchHistoryIndexRef.current, filtered.length - 1);
          researchHistoryRef.current = filtered;
          researchHistoryIndexRef.current = newIndex;
          setResearchHistoryIndex(newIndex);
          return filtered;
        });
        if (researchTarget?.path === deletedPath || researchTarget?.path.startsWith(deletedPath + '/')) {
          setResearchTarget({ path: '', type: 'graph' });
        }
        await loadVaultIndex();
        if (isActiveOrChild) {
          explicitUserClearRef.current = true;
          activePathRef.current = null;
          setActiveNote(null);
          clearLastActiveNote();
          if (workspaceViewRef.current === 'graph') {
            setWorkspaceView('editor');
          }
        }
      }
    } catch (err) {
      console.error('Dialog-Aktion fehlgeschlagen:', err);
    }
  };

  const handleCreateNewBase = useCallback(
    async (options: {
      name: string;
      folder: string;
      scope: 'folder' | 'tag' | 'link' | 'all';
      scopeValue?: string;
      viewType: 'table' | 'cards';
    }) => {
      await flushPendingSave();
      const rawTitle = options.name.replace(/\.base$/i, '').trim();
      const cleanTitle = getUniqueDefaultName(rawTitle, 'base', options.folder || undefined);
      const relPath = options.folder
        ? `${options.folder}/${cleanTitle}.base`
        : `${cleanTitle}.base`;

      // Build initial filters:
      // Always exclude non-markdown files and the base file itself
      const filterRules: string[] = ['file.ext == "md"'];
      if (options.scope === 'folder' && options.scopeValue) {
        filterRules.push(`file.inFolder("${options.scopeValue.replace(/"/g, '\\"')}")`);
      } else if (options.scope === 'tag' && options.scopeValue) {
        const cleanTag = options.scopeValue.replace(/^#/, '').replace(/"/g, '\\"');
        filterRules.push(`file.hasTag("${cleanTag}")`);
      } else if (options.scope === 'link' && options.scopeValue) {
        const cleanLink = options.scopeValue.replace(/^\[\[/, '').replace(/\]\]$/, '').replace(/"/g, '\\"');
        filterRules.push(`file.hasLink("${cleanLink}")`);
      }

      const initialConfig = {
        filters: {
          and: filterRules,
        },
        views: [
          {
            type: options.viewType,
            name: options.viewType === 'cards' ? 'Cards' : 'Table',
            order: ['file.name'],
          },
        ],
      };

      const initialYaml = stringifyBaseYaml(initialConfig);
      const created = await syncEngine.saveNote({
        path: relPath,
        rawContent: initialYaml,
        body: initialYaml,
        properties: [],
      });
      await loadVaultIndex();
      setActiveNote(created);
      setSaveState('saved');
      recordLastActiveNote(created.path);
      recordRecentNote(created.path);
      if (workspaceViewRef.current === 'graph') setWorkspaceView('editor');
      if (isMobile) setLeftSidebarOpen(false);
    },
    [flushPendingSave, getUniqueDefaultName, loadVaultIndex, isMobile]
  );

  const handleUploadImageFile = async (file: File): Promise<string> => {
    // 1. Cancel pending saveTimerRef before starting upload
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    isUploadingAttachmentRef.current = true;
    try {
      const uploaded = await api.uploadAttachment(file);
      const now = Date.now();
      recentSelfWritesRef.current.set(uploaded.path, now);
      if (activeNoteRef.current) {
        recentSelfWritesRef.current.set(activeNoteRef.current.path, now);
      }
      await loadVaultIndex();
      return uploaded.wikiEmbed || (uploaded.path ? `![[${uploaded.path}]]` : `![[${uploaded.name}]]`);
    } finally {
      // Absorb immediate chokidar events
      setTimeout(() => {
        isUploadingAttachmentRef.current = false;
      }, 1000);
    }
  };

  const handleUploadImageClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.svg,.pdf';
    input.multiple = true;
    input.onchange = async () => {
      const files = input.files;
      if (!files || files.length === 0 || !activeNote) return;
      try {
        let tagsToInsert = '';
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const embedTag = await handleUploadImageFile(file);
          if (editorRef.current) {
            editorRef.current.insertImageEmbed(embedTag);
          } else {
            tagsToInsert += `${embedTag}\n`;
          }
        }
        if (!editorRef.current && tagsToInsert) {
          const nextBody = `${activeNote.body.trimEnd()}\n\n${tagsToInsert}`;
          handleBodyChange(nextBody);
        }
      } catch (err) {
        console.error('Fehler beim Hochladen des Bildes:', err);
      }
    };
    input.click();
  };

  const handleManualSave = useCallback(async () => {
    if (!activeNote) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setSaveState('saving');
    const now = Date.now();
    lastLocalSaveTimeRef.current = now;
    recentSelfWritesRef.current.set(activeNote.path, now);
    try {
      const saved = await syncEngine.saveNote({
        path: activeNote.path,
        body: activeNote.body,
        properties: activeNote.properties,
        rawContent: activeNote.rawContent,
        baseMtime: activeNote.updatedAt,
        explicitClear: explicitUserClearRef.current,
      });
      const finishTime = Date.now();
      lastLocalSaveTimeRef.current = finishTime;
      recentSelfWritesRef.current.set(saved.path, finishTime);

      if (activeNoteRef.current && activeNoteRef.current.path === saved.path) {
        activeNoteRef.current = {
          ...activeNoteRef.current,
          properties: saved.properties,
          frontmatter: saved.frontmatter,
          links: saved.links,
          embeds: saved.embeds,
          tags: saved.tags,
          headings: saved.headings,
          updatedAt: saved.updatedAt,
        };
      }

      setActiveNote((prev) =>
        prev && prev.path === saved.path
          ? {
              ...prev,
              properties: saved.properties,
              frontmatter: saved.frontmatter,
              links: saved.links,
              embeds: saved.embeds,
              tags: saved.tags,
              headings: saved.headings,
              updatedAt: saved.updatedAt,
            }
          : prev
      );
      setSaveState('saved');
    } catch (err) {
      console.error('Speicherfehler:', err);
    }
  }, [activeNote]);
  manualSaveRef.current = handleManualSave;

  const handleDownloadNote = useCallback(() => {
    if (!activeNote) return;
    const isCanvas = activeNote.path.endsWith('.canvas');
    const content =
      activeNote.rawContent ||
      (isCanvas
        ? activeNote.body
        : serializeMarkdownWithFrontmatter(activeNote.properties, activeNote.body));
    const mimeType = isCanvas
      ? 'application/json;charset=utf-8'
      : 'text/markdown;charset=utf-8';
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const defaultExt = isCanvas ? '.canvas' : '.md';
    a.download = activeNote.name.endsWith(defaultExt)
      ? activeNote.name
      : `${activeNote.name}${defaultExt}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeNote]);

  const handleVersionRestored = useCallback(
    async (restoredNote: NoteData) => {
      const now = Date.now();
      recentSelfWritesRef.current.set(restoredNote.path, now);
      try {
        await syncEngine.getLocalDb().putNote(restoredNote);
      } catch (e) {
        console.warn('Failed to update localDb with restored note:', e);
      }
      if (activePathRef.current === restoredNote.path) {
        setActiveNote(restoredNote);
        setSaveState('saved');
      }
      loadVaultIndex().catch(() => {});
      refreshBacklinks(restoredNote.path).catch(() => {});
    },
    [loadVaultIndex, refreshBacklinks]
  );

  const commands: CommandItem[] = useMemo(() => {
    return [
      {
        id: 'editor-send-to-target',
        title: t('commands.sendToTarget') || 'Markierten Text an Ziel-Notiz senden…',
        category: 'Editor',
        icon: <Target size={16} />,
        keywords: ['send', 'target', 'ziel', 'verschieben', 'move', 'backlink'],
        action: () => {
          handleOpenSendToTarget();
        },
      },
      // Formatting
      {
        id: 'format-bold',
        title: 'Fett umschalten (Bold)',
        category: 'Formatierung',
        shortcut: 'Strg+B',
        icon: <Bold size={16} />,
        keywords: ['bold', 'fett', 'stark', 'text'],
        action: () => {
          if (editorMode === 'reading') setEditorMode('live');
          setTimeout(() => editorRef.current?.applyFormat('bold'), 50);
        },
      },
      {
        id: 'format-italic',
        title: 'Kursiv umschalten (Italic)',
        category: 'Formatierung',
        shortcut: 'Strg+I',
        icon: <Italic size={16} />,
        keywords: ['italic', 'kursiv', 'schräg'],
        action: () => {
          if (editorMode === 'reading') setEditorMode('live');
          setTimeout(() => editorRef.current?.applyFormat('italic'), 50);
        },
      },
      {
        id: 'format-strikethrough',
        title: 'Durchgestrichen umschalten (Strikethrough)',
        category: 'Formatierung',
        shortcut: 'Strg+Shift+X',
        icon: <Strikethrough size={16} />,
        keywords: ['strikethrough', 'durchstreichen'],
        action: () => {
          if (editorMode === 'reading') setEditorMode('live');
          setTimeout(() => editorRef.current?.applyFormat('strikethrough'), 50);
        },
      },
      {
        id: 'format-highlight',
        title: 'Markierung einfügen (Highlight)',
        category: 'Formatierung',
        shortcut: 'Alt+H',
        icon: <Highlighter size={16} />,
        keywords: ['highlight', 'markieren', 'gelb', 'text'],
        action: () => {
          if (editorMode === 'reading') setEditorMode('live');
          setTimeout(() => editorRef.current?.applyFormat('highlight'), 50);
        },
      },
      {
        id: 'format-code',
        title: 'Inline-Code umschalten',
        category: 'Formatierung',
        shortcut: 'Strg+E',
        icon: <Code2 size={16} />,
        keywords: ['code', 'inline', 'backtick'],
        action: () => {
          if (editorMode === 'reading') setEditorMode('live');
          setTimeout(() => editorRef.current?.applyFormat('code'), 50);
        },
      },
      {
        id: 'insert-codeblock',
        title: 'Codeblock einfügen',
        category: 'Formatierung',
        shortcut: 'Strg+Shift+C',
        icon: <Code2 size={16} />,
        keywords: ['codeblock', 'pre', 'syntax', 'programmieren'],
        action: () => {
          if (editorMode === 'reading') setEditorMode('live');
          setTimeout(() => editorRef.current?.insertCodeBlock(), 50);
        },
      },
      {
        id: 'insert-table',
        title: 'Tabelle einfügen',
        category: 'Formatierung',
        shortcut: 'Alt+Shift+T',
        icon: <Table size={16} />,
        keywords: ['tabelle', 'table', 'grid', 'spalten'],
        action: () => {
          if (editorMode === 'reading') setEditorMode('live');
          setTimeout(() => editorRef.current?.insertTable(), 50);
        },
      },
      {
        id: 'insert-task',
        title: 'Aufgabenliste / Checkbox einfügen',
        category: 'Formatierung',
        shortcut: 'Strg+Shift+L',
        icon: <CheckSquare size={16} />,
        keywords: ['task', 'todo', 'aufgabe', 'checkbox', 'haken'],
        action: () => {
          if (editorMode === 'reading') setEditorMode('live');
          setTimeout(() => editorRef.current?.insertTask(), 50);
        },
      },
      {
        id: 'insert-image',
        title: 'Bild oder Anhang einfügen',
        category: 'Editor',
        shortcut: 'Strg+Shift+I',
        icon: <ImagePlus size={16} />,
        keywords: ['bild', 'image', 'foto', 'grafik', 'upload', 'anhang'],
        action: handleUploadImageClick,
      },
      {
        id: 'insert-wikilink',
        title: 'Wiki-Link einfügen',
        category: 'Formatierung',
        shortcut: 'Strg+K',
        icon: <Link2 size={16} />,
        keywords: ['link', 'wikilink', 'verweis', 'interne notiz'],
        action: () => {
          if (editorMode === 'reading') setEditorMode('live');
          setTimeout(() => editorRef.current?.insertWikiLink(), 50);
        },
      },
      {
        id: 'insert-quote',
        title: 'Zitatblock einfügen',
        category: 'Formatierung',
        shortcut: 'Strg+Shift+.',
        icon: <Quote size={16} />,
        keywords: ['quote', 'zitat', 'block'],
        action: () => {
          if (editorMode === 'reading') setEditorMode('live');
          setTimeout(() => editorRef.current?.insertQuote(), 50);
        },
      },
      {
        id: 'insert-timestamp',
        title: 'Datum & Zeitstempel einfügen (YYYY-MM-DD HH:mm:ss)',
        category: 'Editor',
        shortcut: 'Strg+.',
        icon: <Calendar size={16} />,
        keywords: ['zeit', 'datum', 'timestamp', 'uhrzeit', 'time', 'date', 'heute', 'now'],
        action: () => {
          if (editorMode === 'reading') setEditorMode('live');
          setTimeout(() => editorRef.current?.insertDateTime(), 50);
        },
      },
      {
        id: 'insert-h1',
        title: 'Überschrift 1 (H1) einfügen',
        category: 'Formatierung',
        icon: <Heading1 size={16} />,
        keywords: ['h1', 'titel', 'überschrift', 'heading'],
        action: () => {
          if (editorMode === 'reading') setEditorMode('live');
          setTimeout(() => editorRef.current?.insertHeading(1), 50);
        },
      },
      {
        id: 'insert-h2',
        title: 'Überschrift 2 (H2) einfügen',
        category: 'Formatierung',
        icon: <Heading2 size={16} />,
        keywords: ['h2', 'untertitel', 'überschrift'],
        action: () => {
          if (editorMode === 'reading') setEditorMode('live');
          setTimeout(() => editorRef.current?.insertHeading(2), 50);
        },
      },
      {
        id: 'insert-h3',
        title: 'Überschrift 3 (H3) einfügen',
        category: 'Formatierung',
        icon: <Heading3 size={16} />,
        keywords: ['h3', 'überschrift'],
        action: () => {
          if (editorMode === 'reading') setEditorMode('live');
          setTimeout(() => editorRef.current?.insertHeading(3), 50);
        },
      },
      {
        id: 'insert-hr',
        title: 'Trennlinie / Horizontale Linie einfügen',
        category: 'Formatierung',
        icon: <Minus size={16} />,
        keywords: ['linie', 'divider', 'hr', 'trennlinie'],
        action: () => {
          if (editorMode === 'reading') setEditorMode('live');
          setTimeout(() => editorRef.current?.insertHorizontalRule(), 50);
        },
      },

      // Views
      {
        id: 'view-zen',
        title: 'Ansicht: Zen-Modus umschalten (Fokus)',
        category: 'Ansicht',
        shortcut: 'Alt+Z',
        icon: <Maximize2 size={16} />,
        keywords: ['zen', 'fokus', 'vollbild', 'distraction free', 'schreiben'],
        action: () => setZenMode((prev) => !prev),
      },
      {
        id: 'view-live',
        title: 'Ansicht: Live-Preview-Modus aktivieren',
        category: 'Ansicht',
        shortcut: 'Alt+1',
        icon: <Eye size={16} />,
        keywords: ['live', 'preview', 'editor'],
        action: () => setEditorMode('live'),
      },
      {
        id: 'view-reading',
        title: 'Ansicht: Lese-Modus aktivieren',
        category: 'Ansicht',
        shortcut: 'Alt+2',
        icon: <BookOpen size={16} />,
        keywords: ['lesen', 'reading', 'read'],
        action: () => setEditorMode('reading'),
      },
      {
        id: 'view-source',
        title: 'Ansicht: Quellcode-Modus aktivieren',
        category: 'Ansicht',
        shortcut: 'Alt+3',
        icon: <Code2 size={16} />,
        keywords: ['source', 'quellcode', 'raw', 'markdown'],
        action: () => {
          if (editorMode !== 'source' && activeNote) {
            setActiveNote((prev) =>
              prev
                ? {
                    ...prev,
                    rawContent: serializeMarkdownWithFrontmatter(
                      prev.properties,
                      prev.body
                    ),
                  }
                : prev
            );
          }
          setEditorMode('source');
        },
      },
      {
        id: 'view-graph',
        title: 'Ansicht: Graph-Ansicht öffnen / umschalten',
        category: 'Ansicht',
        shortcut: 'Alt+G',
        icon: <GitFork size={16} />,
        keywords: ['graph', 'netzwerk', 'beziehungen', 'karte'],
        action: () =>
          setWorkspaceView((v) => (v === 'graph' ? 'editor' : 'graph')),
      },
      {
        id: 'view-split',
        title: 'Ansicht: Recherche-Split-View umschalten (70/30)',
        category: 'Ansicht',
        icon: <Columns size={16} />,
        keywords: ['split', 'recherche', 'referenz', 'zweigeteilt', 'nebeneinander'],
        action: handleToggleSplit,
      },

      // Navigation & Sidebars
      {
        id: 'nav-go-back',
        title:
          (workspaceView === 'split'
            ? t('nav.goBackResearch', 'Zurück in Rechercheansicht (Alt+←) / Alt+Klick für Haupteditor')
            : t('nav.goBack', 'Zurück (Alt+←)')) || 'Navigation: Zurück',
        category: 'Navigation',
        shortcut: 'Alt+←',
        icon: <ArrowLeft size={16} />,
        keywords: ['back', 'zurück', 'verlauf', 'history', 'navigation', 'recherche', 'research'],
        action: () => handleGoBack(),
      },
      {
        id: 'nav-left-sidebar',
        title: 'Navigation: Linke Seitenleiste ein-/ausblenden',
        category: 'Navigation',
        shortcut: 'Strg+B',
        icon: <PanelLeft size={16} />,
        keywords: ['dateien', 'ordner', 'sidebar', 'links'],
        action: () => setLeftSidebarOpen((o) => !o),
      },
      {
        id: 'nav-right-sidebar',
        title: 'Navigation: Rechte Seitenleiste ein-/ausblenden',
        category: 'Navigation',
        shortcut: 'Strg+J',
        icon: <PanelRight size={16} />,
        keywords: ['backlinks', 'gliederung', 'sidebar', 'rechts'],
        action: () => setRightSidebarOpen((o) => !o),
      },

      // Vault & Notes
      {
        id: 'vault-new-note',
        title: 'Vault: Neue Notiz erstellen',
        category: 'Vault',
        shortcut: 'Strg+N',
        icon: <FilePlus size={16} />,
        keywords: ['neu', 'notiz', 'anlegen', 'erstellen'],
        action: () => openCreateNoteDialog(),
      },
      {
        id: 'open-daily-note',
        title: t('sidebar.openDailyNote') || 'Tagesnotiz öffnen / erstellen',
        category: 'Vault',
        shortcut: 'Alt+D',
        icon: <Calendar size={16} />,
        keywords: ['daily', 'tagesnotiz', 'heute', 'today', 'kalender', 'calendar'],
        action: () => {
          handleOpenDailyNote();
        },
      },
      {
        id: 'vault-new-canvas',
        title: 'Vault: Neues Canvas erstellen (Workflow / Diagramm)',
        category: 'Vault',
        icon: <WorkflowCanvasIcon size={16} />,
        keywords: ['canvas', 'diagramm', 'flowchart', 'network', 'workflow', 'whiteboard'],
        action: () => openCreateCanvasDialog(),
      },
      {
        id: 'vault-new-base',
        title: language === 'de' ? 'Vault: Neue Base erstellen (Datenbank / Tabelle)' : 'Vault: Create new Base (Database / Table)',
        category: 'Vault',
        icon: <Database size={16} />,
        keywords: ['base', 'database', 'datenbank', 'table', 'tabelle'],
        action: () => openCreateBaseDialog(),
      },
      {
        id: 'vault-save-note',
        title: 'Vault: Notiz sofort speichern',
        category: 'Vault',
        shortcut: 'Strg+S',
        icon: <Check size={16} />,
        keywords: ['speichern', 'save', 'persistieren'],
        action: handleManualSave,
      },
      {
        id: 'vault-rename-note',
        title: 'Vault: Aktuelle Notiz umbenennen',
        category: 'Vault',
        icon: <Edit3 size={16} />,
        keywords: ['umbenennen', 'rename', 'titel'],
        action: () => {
          if (!activeNote) return;
          const cleanName = activeNote.name.replace(/\.(md|canvas)$/i, '');
          setDialog({
            type: 'rename',
            targetPath: activeNote.path,
            initialValue: cleanName,
          });
          setDialogInput(cleanName);
        },
      },
      {
        id: 'vault-delete-note',
        title: 'Vault: Aktuelle Notiz löschen',
        category: 'Vault',
        icon: <Trash2 size={16} />,
        keywords: ['löschen', 'delete', 'entfernen', 'papierkorb'],
        action: () => {
          if (!activeNote) return;
          setDialog({
            type: 'delete',
            targetPath: activeNote.path,
            initialValue: activeNote.name,
          });
        },
      },
      {
        id: 'vault-download-note',
        title: 'Vault: Aktuelle Notiz als .md herunterladen',
        category: 'Vault',
        icon: <Download size={16} />,
        keywords: ['export', 'download', 'herunterladen', 'datei'],
        action: handleDownloadNote,
      },
      {
        id: 'vault-version-history',
        title: 'Vault: Versionsverlauf für aktuelle Notiz öffnen',
        category: 'Vault',
        icon: <History size={16} />,
        keywords: ['history', 'versionsverlauf', 'git', 'diff', 'wiederherstellen', 'commits'],
        action: () => {
          if (activeNote) {
            setVersionHistoryPath(activeNote.path);
          }
        },
      },

      // Settings & Themes
      {
        id: 'settings-open',
        title: 'Einstellungen: Einstellungen & Profile öffnen',
        category: 'Einstellungen',
        shortcut: 'Strg+,',
        icon: <Settings size={16} />,
        keywords: ['settings', 'konfiguration', 'passwort', 'profile'],
        action: () => setSettingsOpen(true),
      },
      {
        id: 'sync-now',
        title: 'Synchronisation: Jetzt vollständigen Sync ausführen',
        category: 'Einstellungen',
        icon: <RefreshCw size={16} />,
        keywords: ['sync', 'abgleich', 'server', 'offline'],
        action: () => syncEngine.syncNow(),
      },
      {
        id: 'theme-dark',
        title: 'Darstellung: Theme „Zuber Dark“ (Standard)',
        category: 'Einstellungen',
        icon: <Palette size={16} />,
        keywords: ['theme', 'dark', 'dunkel', 'zuber', 'knowmesh', 'basalt'],
        action: () => setTheme('zuber'),
      },
      {
        id: 'theme-light',
        title: 'Darstellung: Theme „Zuber Hell“',
        category: 'Einstellungen',
        icon: <Palette size={16} />,
        keywords: ['theme', 'light', 'hell', 'weiß', 'zuber', 'knowmesh'],
        action: () => setTheme('light-cold'),
      },
      {
        id: 'theme-amoled',
        title: 'Darstellung: Theme „AMOLED Schwarz“',
        category: 'Einstellungen',
        icon: <Palette size={16} />,
        keywords: ['theme', 'amoled', 'oled', 'schwarz'],
        action: () => setTheme('theme-amoled-black'),
      },
      {
        id: 'theme-sepia',
        title: 'Darstellung: Theme „Warm Sepia“',
        category: 'Einstellungen',
        icon: <Palette size={16} />,
        keywords: ['theme', 'sepia', 'warm', 'papier'],
        action: () => setTheme('theme-warm-sepia'),
      },
      {
        id: 'theme-dracula',
        title: 'Darstellung: Theme „Dracula“',
        category: 'Einstellungen',
        icon: <Palette size={16} />,
        keywords: ['theme', 'dracula', 'lila', 'purple'],
        action: () => setTheme('theme-dracula'),
      },
    ];
  }, [
    editorMode,
    activeNote,
    openCreateNoteDialog,
    openCreateCanvasDialog,
    openCreateBaseDialog,
    handleUploadImageClick,
    handleManualSave,
    handleDownloadNote,
    handleOpenSendToTarget,
    t,
    language,
  ]);

  if (!authChecked) {
    return <div className="loading-screen">Lade Zuber...</div>;
  }

  if (!authenticated) {
    return (
      <LoginModal
        httpsActive={httpsActive}
        vaultPath={vaultPath}
        onLogin={handleLogin}
      />
    );
  }

  const linkedMentions = activeNote ? backlinks.linked : [];
  const unlinkedMentions = activeNote ? backlinks.unlinked : [];
  const currentBacklinks = linkedMentions;
  const isCanvasNote = Boolean(activeNote?.path.endsWith('.canvas'));
  const isBaseNote = Boolean(activeNote?.path.endsWith('.base'));

  const wordCount = activeNote
    ? activeNote.body
        .trim()
        .split(/\s+/)
        .filter(Boolean).length
    : 0;

  const renderRibbon = (extraClass = '') => (
    <nav className={`knowmesh-ribbon obsidian-ribbon ${extraClass}`} aria-label={t('nav.mainNavAria')}>
      <div className="ribbon-top">
        <button
          type="button"
          className="ribbon-btn ribbon-brand-btn"
          onClick={() => setSettingsOpen(true)}
          title="Zuber"
          aria-label="Zuber"
          style={{ padding: 0 }}
        >
          <img
            src="/knowmesh_icon.png"
            alt="Zuber"
            style={{ width: 22, height: 22, borderRadius: 5, display: 'block', objectFit: 'contain' }}
          />
        </button>

        <button
          type="button"
          className="ribbon-btn"
          onClick={() => openCreateNoteDialog()}
          title={t('nav.newNote')}
        >
          <FilePlus size={19} />
        </button>

        <button
          type="button"
          className={`ribbon-btn ${workspaceView === 'editor' ? 'active' : ''}`}
          onClick={() => {
            setWorkspaceView('editor');
            if (isMobile) setLeftSidebarOpen(false);
          }}
          title={t('nav.editor')}
        >
          <FileText size={19} />
        </button>

        <button
          type="button"
          className={`ribbon-btn ${workspaceView === 'graph' ? 'active' : ''}`}
          onClick={() => {
            setWorkspaceView('graph');
            if (isMobile) setLeftSidebarOpen(false);
          }}
          title={t('nav.graph')}
        >
          <GitFork size={19} />
        </button>

        <button
          type="button"
          className={`ribbon-btn ${workspaceView === 'split' ? 'active' : ''}`}
          onClick={handleToggleSplit}
          title={t('research.title', 'Rechercheansicht')}
        >
          <Columns size={19} />
        </button>
      </div>

      <div className="ribbon-bottom">
        <button
          type="button"
          className="ribbon-btn"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          title={
            theme === 'dark'
              ? 'Light Theme'
              : 'Dark Theme'
          }
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <button
          type="button"
          className={`ribbon-btn ${rightSidebarOpen ? 'active' : ''}`}
          onClick={() => {
            setRightSidebarOpen((o) => !o);
            if (isMobile) setLeftSidebarOpen(false);
          }}
          title={t('nav.rightSidebar')}
        >
          <PanelRight size={19} />
        </button>

        <button
          type="button"
          className="ribbon-btn logout-btn"
          onClick={handleLogout}
          title={t('nav.logout')}
        >
          <LogOut size={18} />
        </button>
      </div>
    </nav>
  );

  const renderPrimaryEditor = (customStyle?: React.CSSProperties) => (
    <section
      className="editor-pane-container"
      style={customStyle && typeof customStyle === 'object' ? customStyle : undefined}
    >
      {isCanvasNote && activeNote ? (
        <div className="canvas-workspace-pane">
          <Suspense fallback={<div className="empty-state">Lade Canvas…</div>}>
            <CanvasEditor
              filePath={activeNote.path}
              rawContent={activeNote.rawContent || activeNote.body || '{}'}
              onChange={(newJson) => {
                if (!activeNote) return;
                setActiveNote({
                  ...activeNote,
                  rawContent: newJson,
                  body: newJson,
                });
                scheduleSave(activeNote.path, {
                  rawContent: newJson,
                  body: newJson,
                });
              }}
              onOpenNote={(targetPath) => {
                handleNavigateWikiLink(targetPath);
                if (isMobile) setLeftSidebarOpen(false);
              }}
              onSelectTag={(tag) => {
                setSelectedTagFilter(tag.replace(/^#+/, ''));
                setLeftSidebarOpen(true);
              }}
              allNotes={allNotesForEditor}
            />
          </Suspense>
        </div>
      ) : isBaseNote && activeNote ? (
        <div className="base-workspace-pane">
          <Suspense fallback={<div className="empty-state">Lade Base…</div>}>
            <BaseEditor
              filePath={activeNote.path}
              rawContent={activeNote.rawContent || activeNote.body || ''}
              onChange={(newYaml) => {
                if (!activeNote) return;
                setActiveNote({
                  ...activeNote,
                  rawContent: newYaml,
                  body: newYaml,
                });
                scheduleSave(activeNote.path, {
                  rawContent: newYaml,
                  body: newYaml,
                });
              }}
              onSelectNote={(targetPath) => {
                handleNavigateWikiLink(targetPath);
                if (isMobile) setLeftSidebarOpen(false);
              }}
              allFiles={allFiles}
              onOpenCreateNoteDialog={openCreateNoteDialog}
            />
          </Suspense>
        </div>
      ) : (
        <>
          {/* Sticky Formatting Toolbar at the top (Desktop only; mobile uses MobileEditBar) */}
          {!isMobile && activeNote && editorMode !== 'reading' && !zenMode && (
            <EditorToolbar
              editorRef={editorRef}
              onUploadImage={handleUploadImageFile}
              onSendToTarget={handleOpenSendToTarget}
            />
          )}

          <div className="editor-pane scroller">
            {activeNote ? (
              <div className="note-document-container">
                {/* Visual Frontmatter Properties UI (No raw YAML shown!) */}
                {editorMode !== 'source' && !zenMode && (
                  <PropertiesEditor
                    notePath={activeNote.path}
                    properties={activeNote.properties}
                    allTags={allTagNames}
                    onChange={handlePropertiesChange}
                    onTagClick={(tag) => {
                      setSelectedTagFilter(tag.replace(/^#+/, ''));
                      setLeftSidebarOpen(true);
                    }}
                  />
                )}

                {/* Main Markdown Editor (Live-Preview / Reading / Source) */}
                <LivePreviewEditor
                  ref={editorRef}
                  notePath={activeNote.path}
                  body={activeNote.body}
                  rawContent={activeNote.rawContent}
                  mode={editorMode}
                  allNotes={allNotesForEditor}
                  allTags={allTagNames}
                  scrollToLine={scrollToLine}
                  inNoteSearchQuery={isMobile ? inNoteSearchQuery : ''}
                  inNoteSearchIndex={inNoteSearchIndex}
                  onInNoteMatchCountChange={setInNoteMatchCount}
                  tableWidths={getTableWidthsFromProperties(activeNote.properties)}
                  onUpdateTableWidths={handleUpdateTableWidths}
                  onRenameTableWidthSignature={handleRenameTableWidthSignature}
                  onChangeBody={handleBodyChange}
                  onChangeRaw={handleRawChange}
                  onNavigateWikiLink={handleNavigateWikiLink}
                  onSelectTag={(tag) => {
                    setSelectedTagFilter(tag.replace(/^#+/, ''));
                    setLeftSidebarOpen(true);
                  }}
                  onUploadAttachment={handleUploadImageFile}
                  onSendToTargetNote={handleOpenSendToTarget}
                  isResearchOpen={isResearchOpen}
                  onOpenExternalInResearch={(url) => setResearchTarget({ path: url, type: 'web' })}
                  onRequestEditMode={isMobile ? () => setEditorMode('live') : undefined}
                  onOpenNote={(targetPath) => {
                    handleNavigateWikiLink(targetPath);
                    if (isMobile) setLeftSidebarOpen(false);
                  }}
                />
              </div>
            ) : (
              <div className="empty-workspace-state">
                <FileText size={42} />
                <h2>{language === 'de' ? 'Keine Notiz geöffnet' : 'No note open'}</h2>
                <p>
                  {language === 'de'
                    ? 'Wähle links im Dateibaum eine Notiz aus oder erstelle ein neues Dokument.'
                    : 'Select a note from the file tree on the left or create a new document.'}
                </p>
                <div className="empty-state-btn-row">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => openCreateNoteDialog()}
                  >
                    <FileText size={15} />
                    <span>{language === 'de' ? 'Neue Notiz' : 'New Note'}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleOpenTemplateModal()}
                  >
                    <LayoutTemplate size={15} />
                    <span>{language === 'de' ? 'Aus Vorlage' : 'From Template'}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleOpenDailyNote()}
                  >
                    <Calendar size={15} />
                    <span>{language === 'de' ? 'Tagesnotiz' : 'Daily Note'}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => openCreateCanvasDialog()}
                  >
                    <WorkflowCanvasIcon size={15} />
                    <span>{language === 'de' ? 'Neues Canvas' : 'New Canvas'}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => openCreateBaseDialog()}
                  >
                    <Database size={15} />
                    <span>{language === 'de' ? 'Neue Base' : 'New Base'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );

  const renderResearchPane = (customStyle?: React.CSSProperties) => (
    <div
      className="research-pane-wrapper"
      style={customStyle && typeof customStyle === 'object' ? customStyle : undefined}
    >
      <ResearchPane
        target={researchTarget}
        orientation={splitOrientation}
        onToggleOrientation={() =>
          setSplitOrientation((o) => (o === 'horizontal' ? 'vertical' : 'horizontal'))
        }
        onOpenInMain={(path) => {
          openNoteByPath(path);
        }}
        onClose={() => setWorkspaceView('editor')}
        onNavigate={(target, ev) => {
          handleNavigateWikiLink(target, ev);
        }}
        onShowGraph={() => setResearchTarget({ path: '', type: 'graph' })}
        onOpenWebUrl={(url) => setResearchTarget({ path: url, type: 'web' })}
        graphData={graphData}
        allNotes={allNotesForEditor}
        activeNotePath={activeNote?.path ?? null}
        onSelectTag={(tag) => {
          setSelectedTagFilter(tag.replace(/^#+/, ''));
          setLeftSidebarOpen(true);
        }}
      />
    </div>
  );

  const renderSplitResizer = () => (
    <div
      className={`split-resizer ${splitOrientation} ${isResizingSplit ? 'resizing' : ''}`}
      onMouseDown={handleSplitResizeStart}
      onTouchStart={handleSplitResizeStart}
      title="Drag to resize split panes"
      role="separator"
      aria-orientation={splitOrientation}
    />
  );

  return (
    <div
      className={`knowmesh-app-shell obsidian-app-shell ${zenMode ? 'zen-mode-active zen-mode' : ''}`}
      style={{
        '--left-sidebar-width': `${leftSidebarWidth}px`,
        '--right-sidebar-width': `${rightSidebarWidth}px`,
        ...(isResizingLeft || isResizingRight ? { userSelect: 'none', cursor: 'col-resize' } : {}),
      } as React.CSSProperties}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Leftmost Icon Ribbon on Desktop */}
      {!zenMode && !isMobile && renderRibbon()}

      {/* Left Sidebar / Mobile Drawer: File Explorer, Search, Tags */}
      {!zenMode && leftSidebarOpen && (
        <>
          {isMobile && (
            <div
              className="mobile-drawer-backdrop"
              onClick={() => setLeftSidebarOpen(false)}
              aria-hidden="true"
            />
          )}
          {isMobile ? (
            <div className="left-drawer-panel">
              {renderRibbon('in-drawer')}
              <FileSidebar
                tree={tree}
                activePath={activeNote?.path ?? null}
                tags={graphData.tags}
                selectedTagFilter={selectedTagFilter}
                onClose={() => setLeftSidebarOpen(false)}
                onLeftResizeStart={handleLeftResizeStart}
                isResizingLeft={isResizingLeft}
                {...sidebarHandlers}
              />
            </div>
          ) : (
            <FileSidebar
              tree={tree}
              activePath={activeNote?.path ?? null}
              tags={graphData.tags}
              selectedTagFilter={selectedTagFilter}
              onClose={() => setLeftSidebarOpen(false)}
              onLeftResizeStart={handleLeftResizeStart}
              isResizingLeft={isResizingLeft}
              {...sidebarHandlers}
            />
          )}
        </>
      )}

      {/* Center Workspace: Editor / Global Graph / Split */}
      <main className="workspace-center">
        {zenMode ? (
          <button
            type="button"
            className="zen-mode-exit-btn"
            onClick={() => setZenMode(false)}
            title={t('header.exitZen')}
            aria-label={t('header.exitZen')}
          >
            <Minimize2 size={16} />
            <span>{t('header.exitZen')}</span>
          </button>
        ) : (
          <header className="workspace-topbar">
          <div className="topbar-left-cluster">
            <button
              type="button"
              className={`topbar-sidebar-toggle ${leftSidebarOpen ? 'active' : ''}`}
              onClick={() => setLeftSidebarOpen((o) => !o)}
              title={t('header.toggleLeftSidebar')}
              aria-label={t('header.toggleLeftSidebar')}
            >
              <PanelLeft size={16} />
            </button>
            <button
              type="button"
              className="topbar-nav-back-btn"
              onClick={handleGoBack}
              disabled={isResearchOpen ? researchHistoryIndex <= 0 : historyIndex <= 0}
              title={
                isResearchOpen
                  ? t('nav.goBackResearch', 'Zurück in Rechercheansicht (Alt+←) / Alt+Klick für Haupteditor')
                  : t('nav.goBack', 'Zurück (Alt+←)')
              }
              aria-label={
                isResearchOpen
                  ? t('nav.goBackResearch', 'Zurück in Rechercheansicht (Alt+←) / Alt+Klick für Haupteditor')
                  : t('nav.goBack', 'Zurück')
              }
            >
              <ArrowLeft size={18} />
            </button>
          </div>
          <div className="topbar-breadcrumbs">
            {workspaceView === 'graph' ? (
              <span className="breadcrumb-active">
                <GitFork size={15} /> {t('graph.title')}
              </span>
            ) : activeNote ? (
              <>
                <span className="breadcrumb-path">{activeNote.path}</span>
                <span className={`save-indicator ${saveState}`}>
                  {saveState === 'saved' && (
                    <>
                      <Check size={12} /> {t('editor.saved')}
                    </>
                  )}
                  {saveState === 'saving' && t('editor.saving')}
                  {saveState === 'dirty' && t('editor.unsaved')}
                </span>
              </>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <img src="/knowmesh_icon.png" alt="Zuber" style={{ width: 15, height: 15, borderRadius: 3, verticalAlign: 'middle' }} />
                {t('header.noNoteSelected')}
              </span>
            )}
          </div>

          <div className="topbar-controls">
            {workspaceView !== 'graph' && activeNote && (
              isCanvasNote ? (
                <div className="canvas-mode-indicator" title="Canvas & Diagramm-Editor">
                  <WorkflowCanvasIcon size={14} />
                  <span>Canvas</span>
                </div>
              ) : isBaseNote ? (
                <div className="base-mode-indicator" title="Base Database & Table View">
                  <Database size={14} />
                  <span>Base</span>
                </div>
              ) : (
                <div className="editor-mode-switcher" role="group" aria-label={t('header.modeGroupAria')}>
                  <button
                    type="button"
                    className={`mode-btn icon-only ${editorMode === 'live' ? 'active' : ''}`}
                    onClick={() => setEditorMode('live')}
                    title={t('header.livePreviewTitle')}
                    aria-label={t('header.livePreview')}
                  >
                    <Eye size={14} />
                  </button>
                  <button
                    type="button"
                    className={`mode-btn icon-only ${editorMode === 'reading' ? 'active' : ''}`}
                    onClick={() => setEditorMode('reading')}
                    title={t('header.readingTitle')}
                    aria-label={t('header.reading')}
                  >
                    <BookOpen size={14} />
                  </button>
                  <button
                    type="button"
                    className={`mode-btn icon-only ${editorMode === 'source' ? 'active' : ''}`}
                    onClick={() => {
                      if (editorMode !== 'source') {
                        setActiveNote((prev) =>
                          prev
                            ? { ...prev, rawContent: serializeMarkdownWithFrontmatter(prev.properties, prev.body) }
                            : prev
                        );
                      }
                      setEditorMode('source');
                    }}
                    title={t('header.sourceTitle')}
                    aria-label={t('header.source')}
                  >
                    <Code2 size={14} />
                  </button>
                </div>
              )
            )}

            <button
              type="button"
              className="topbar-action-btn icon-only"
              onClick={() => setZenMode(true)}
              title={t('header.zenTitle')}
              aria-label={t('header.zenTitle')}
            >
              <Maximize2 size={15} />
            </button>

            {/* Sync & Settings */}
            <div className="topbar-sync-settings">
              {installPrompt && !isInstalledApp && (
                <button
                  type="button"
                  className="topbar-action-btn pwa-topbar-install-btn"
                  onClick={handleInstallApp}
                  title={t('header.installAppTitle')}
                >
                  <Download size={14} />
                  <span>{t('header.installApp')}</span>
                </button>
              )}
              <button
                type="button"
                className={`topbar-sync-indicator status-${syncState}`}
                onClick={() => setSettingsOpen(true)}
                title={
                  syncState === 'synced'
                    ? t('statusbar.synced')
                    : syncState === 'offline'
                    ? t('statusbar.offline')
                    : syncState === 'syncing'
                    ? t('statusbar.syncing')
                    : syncState === 'conflict'
                    ? t('statusbar.conflict')
                    : t('common.online')
                }
              >
                <span className={`sync-status-dot ${syncState}`} />
                <span className="sync-status-icon-mobile" aria-hidden="true">
                  {syncState === 'synced' ? '✓' : syncState === 'syncing' ? '⟳' : syncState === 'offline' ? '⚡' : '!'}
                </span>
                <span className="sync-status-text">
                  {syncState === 'synced' && t('statusbar.synced')}
                  {syncState === 'syncing' && t('common.syncing')}
                  {syncState === 'offline' && t('common.offline')}
                  {syncState === 'conflict' && t('statusbar.conflict')}
                  {syncState === 'online' && t('common.online')}
                </span>
              </button>

              <button
                type="button"
                className="topbar-settings-btn"
                onClick={() => setSettingsOpen(true)}
                title={t('nav.settings')}
              >
                <Settings size={16} />
              </button>

              <button
                type="button"
                className={`topbar-sidebar-toggle ${rightSidebarOpen ? 'active' : ''}`}
                onClick={() => setRightSidebarOpen((o) => !o)}
                title={t('header.toggleRightSidebar')}
                aria-label={t('header.toggleRightSidebar')}
              >
                <PanelRight size={16} />
              </button>
            </div>
          </div>
        </header>
        )}

        <div
          ref={workspacePanesRef}
          className={`workspace-panes view-${workspaceView} split-${splitOrientation}`}
        >
          {workspaceView === 'editor' && renderPrimaryEditor()}

          {workspaceView === 'graph' && (
            <section className="graph-pane">
              <Suspense fallback={<div className="empty-state">Lade Graph…</div>}>
                <GraphView
                  graphData={graphData}
                  activeNotePath={activeNote?.path ?? null}
                  isLocalGraph={false}
                  onSelectNote={(pathOrTitle, isUnresolved, event) => {
                    if (event?.altKey) event.preventDefault?.();
                    if (isUnresolved) {
                      handleNavigateWikiLink(pathOrTitle, event);
                    } else {
                      openNoteByPath(pathOrTitle);
                      setWorkspaceView('editor');
                    }
                  }}
                  onSelectTag={(tag) => {
                    setSelectedTagFilter(tag);
                    setLeftSidebarOpen(true);
                  }}
                />
              </Suspense>
            </section>
          )}

          {workspaceView === 'split' && (
            splitOrientation === 'horizontal' ? (
              <>
                {renderPrimaryEditor({ width: `${splitRatio}%`, flex: `0 0 ${splitRatio}%` })}
                {renderSplitResizer()}
                {renderResearchPane({ width: `calc(100% - ${splitRatio}%)`, flex: '1 1 0' })}
              </>
            ) : (
              <>
                {renderResearchPane({ height: `${100 - splitRatio}%`, flex: `0 0 ${100 - splitRatio}%` })}
                {renderSplitResizer()}
                {renderPrimaryEditor({ height: `${splitRatio}%`, flex: '1 1 0' })}
              </>
            )
          )}
        </div>

        {/* Floating In-Note Match Jump Bar (Mobile) */}
        {isMobile && inNoteSearchQuery.trim() && activeNote && (
          <div className="in-note-search-jump-bar" data-testid="in-note-search-jump-bar">
            <span className="in-note-search-jump-query" title={inNoteSearchQuery}>
              {inNoteSearchQuery}
            </span>
            <span className="in-note-search-jump-counter" data-testid="in-note-search-jump-counter">
              {inNoteMatchCount > 0 ? `${(inNoteSearchIndex % inNoteMatchCount) + 1} / ${inNoteMatchCount}` : '0 / 0'}
            </span>
            <button
              type="button"
              className="in-note-search-jump-btn"
              data-testid="in-note-search-prev-btn"
              aria-label={t('search.prevMatch')}
              disabled={inNoteMatchCount === 0}
              onClick={() => setInNoteSearchIndex((prev) => wrapMatchIndex(prev, -1, inNoteMatchCount))}
            >
              <ChevronUp size={18} />
            </button>
            <button
              type="button"
              className="in-note-search-jump-btn"
              data-testid="in-note-search-next-btn"
              aria-label={t('search.nextMatch')}
              disabled={inNoteMatchCount === 0}
              onClick={() => setInNoteSearchIndex((prev) => wrapMatchIndex(prev, 1, inNoteMatchCount))}
            >
              <ChevronDown size={18} />
            </button>
            <button
              type="button"
              className="in-note-search-jump-btn"
              data-testid="in-note-search-clear-btn"
              aria-label={t('common.close')}
              onClick={() => {
                setInNoteSearchQuery('');
                setInNoteSearchIndex(0);
                setInNoteMatchCount(0);
              }}
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* Mobile Contextual Bottom Bar: State A (Navigation) vs State B (Keyboard-Docked Edit Bar) */}
        {isMobile && !zenMode && (
          activeNote &&
          !isBaseNote &&
          !isCanvasNote &&
          workspaceView !== 'graph' &&
          (editorMode === 'live' || editorMode === 'source') ? (
            <MobileEditBar
              editorRef={editorRef}
              onUploadImage={handleUploadImageFile}
              onSendToTarget={handleOpenSendToTarget}
              onDone={() => {
                editorRef.current?.blur();
                setEditorMode('reading');
              }}
            />
          ) : (
            <MobileBottomNav
              editorMode={editorMode}
              canEditNote={Boolean(activeNote && !isBaseNote && !isCanvasNote && workspaceView !== 'graph')}
              hasActiveNote={Boolean(activeNote)}
              activeNoteName={activeNote?.path.split('/').pop()}
              isResearchOpen={workspaceView === 'split'}
              zenMode={zenMode}
              onOpenFiles={() => setLeftSidebarOpen(true)}
              onOpenSearch={() => setMobileSearchOpen(true)}
              onStartEdit={() => {
                setEditorMode('live');
                requestAnimationFrame(() => editorRef.current?.focus());
              }}
              onQuickNote={() => openCreateNoteDialog()}
              onSwitchMode={(mode) => {
                setEditorMode(mode);
                if (mode !== 'reading') {
                  requestAnimationFrame(() => editorRef.current?.focus());
                } else {
                  editorRef.current?.blur();
                }
              }}
              onToggleResearch={handleToggleSplit}
              onOpenRightSidebar={() => setRightSidebarOpen(true)}
              onToggleZen={() => setZenMode((z) => !z)}
              onRenameActive={
                activeNote
                  ? () => {
                      const currentName = activeNote.path.split('/').pop() || activeNote.path;
                      setDialog({ type: 'rename', targetPath: activeNote.path, initialValue: currentName });
                      setDialogInput(currentName);
                    }
                  : undefined
              }
              onDeleteActive={
                activeNote
                  ? () => {
                      const name = activeNote.path.split('/').pop() || activeNote.path;
                      setDialog({
                        type: 'delete',
                        targetPath: activeNote.path,
                        initialValue: name,
                        prompt: t('dialogs.deleteNotePrompt', { name }),
                      });
                    }
                  : undefined
              }
              onOpenSettings={() => setSettingsOpen(true)}
            />
          )
        )}
      </main>

      {/* Right Sidebar: Backlinks, Outline, and Local Graph */}
      {!zenMode && rightSidebarOpen && (
        <>
          {isMobile && (
            <div
              className="mobile-drawer-backdrop right-backdrop"
              onClick={() => setRightSidebarOpen(false)}
              aria-hidden="true"
            />
          )}
          <aside className="right-sidebar">
          {/* Desktop Resize Handle on left edge */}
          <div
            className={`sidebar-resizer-right ${isResizingRight ? 'resizing' : ''}`}
            onMouseDown={handleRightResizeStart}
          />
          <div className="sidebar-tabs">
            <button
              type="button"
              className={`sidebar-tab-btn ${rightTab === 'backlinks' ? 'active' : ''}`}
              onClick={() => setRightTab('backlinks')}
              title={t('rightSidebar.backlinks')}
            >
              <Link2 size={15} />
              <span>{t('rightSidebar.backlinks')} ({linkedMentions.length})</span>
            </button>
            <button
              type="button"
              className={`sidebar-tab-btn ${rightTab === 'outline' ? 'active' : ''}`}
              onClick={() => setRightTab('outline')}
              title={t('rightSidebar.outline')}
            >
              <ListTree size={15} />
              <span>{t('rightSidebar.outline')}</span>
            </button>
            <button
              type="button"
              className={`sidebar-tab-btn ${rightTab === 'local-graph' ? 'active' : ''}`}
              onClick={() => setRightTab('local-graph')}
              title={t('rightSidebar.localGraph')}
            >
              <GitFork size={15} />
              <span>{t('rightSidebar.localGraph')}</span>
            </button>
            <button
              type="button"
              className="sidebar-tab-btn close-sidebar-btn"
              onClick={() => setRightSidebarOpen(false)}
              title={t('rightSidebar.close')}
              aria-label={t('rightSidebar.close')}
            >
              <X size={15} />
            </button>
          </div>

          {rightTab === 'backlinks' && (
            <div className="right-sidebar-content scroller">
              {rightSidebarTargetPath && (
                <div className="backlinks-target-indicator" title={rightSidebarTargetPath}>
                  <span className="backlinks-target-label">
                    {isResearchOpen && researchTarget?.path
                      ? `${t('rightSidebar.targetResearch', 'Recherche')}:`
                      : `${t('rightSidebar.targetNote', 'Notiz')}:`}
                  </span>
                  <span className="backlinks-target-filename">
                    {rightSidebarTargetPath.split('/').pop()}
                  </span>
                </div>
              )}
              <div className="backlinks-section">
                <h3 className="right-section-title">
                  {t('rightSidebar.linkedMentions')} ({linkedMentions.length})
                </h3>
                {linkedMentions.length === 0 ? (
                  <p className="sidebar-empty-hint">
                    {t('rightSidebar.noLinkedMentions')}
                  </p>
                ) : (
                  linkedMentions.map((item, idx) => (
                    <div
                      key={`${item.sourcePath}-${idx}`}
                      className="backlink-card"
                      onClick={(e) => {
                        if (e.altKey) e.preventDefault();
                        if (workspaceViewRef.current === 'split' && !e.altKey) {
                          openInResearch(item.sourcePath);
                        } else {
                          openNoteByPath(item.sourcePath);
                        }
                      }}
                    >
                      <div className="backlink-source">
                        <FileText size={13} />
                        <span>{item.sourceTitle}</span>
                      </div>
                      <div className="backlink-snippet">{item.snippet}</div>
                    </div>
                  ))
                )}
              </div>

              <div className="backlinks-section">
                <h3 className="right-section-title">
                  {t('rightSidebar.unlinkedMentions')} ({unlinkedMentions.length})
                </h3>
                {unlinkedMentions.length === 0 ? (
                  <p className="sidebar-empty-hint">
                    {t('rightSidebar.noUnlinkedMentions')}
                  </p>
                ) : (
                  unlinkedMentions.map((item, idx) => (
                    <div
                      key={`${item.sourcePath}-unlinked-${idx}`}
                      className="backlink-card unlinked"
                      onClick={(e) => {
                        if (e.altKey) e.preventDefault();
                        if (workspaceViewRef.current === 'split' && !e.altKey) {
                          openInResearch(item.sourcePath);
                        } else {
                          openNoteByPath(item.sourcePath);
                        }
                      }}
                    >
                      <div className="backlink-source">
                        <FileText size={13} />
                        <span>{item.sourceTitle}</span>
                      </div>
                      <div className="backlink-snippet">{item.snippet}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {rightTab === 'outline' && (
            <div className="right-sidebar-content scroller">
              <h3 className="right-section-title">{t('rightSidebar.outline')}</h3>
              {!activeNote || activeNote.headings.length === 0 ? (
                <p className="sidebar-empty-hint">
                  {t('rightSidebar.noOutline')}
                </p>
              ) : (
                <div className="outline-list">
                  {activeNote.headings.map((h, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="outline-item"
                      style={{ paddingLeft: `${(h.level - 1) * 14 + 10}px` }}
                      onClick={() => setScrollToLine(h.line)}
                    >
                      <span className="outline-level-badge">H{h.level}</span>
                      <span className="outline-text">{h.text}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {rightTab === 'local-graph' && (
            <div className="right-sidebar-graph-wrapper">
              <Suspense fallback={<div className="empty-state">Lade Graph…</div>}>
                <GraphView
                  graphData={graphData}
                  activeNotePath={rightSidebarTargetPath}
                  isLocalGraph={true}
                  onSelectNote={(pathOrTitle, isUnresolved, event) => {
                    if (event?.altKey) event.preventDefault?.();
                    if (isUnresolved) {
                      handleNavigateWikiLink(pathOrTitle, event);
                    } else {
                      if (workspaceViewRef.current === 'split' && !event?.altKey) {
                        openInResearch(pathOrTitle);
                      } else {
                        openNoteByPath(pathOrTitle);
                      }
                    }
                  }}
                  onSelectTag={(tag) => {
                    setSelectedTagFilter(tag);
                    setLeftSidebarOpen(true);
                  }}
                />
              </Suspense>
            </div>
          )}
        </aside>
      </>
      )}

      {/* Bottom Status Bar */}
      {!zenMode && (
        <footer className="knowmesh-statusbar obsidian-statusbar">
          <div className="statusbar-left">
            <span className="status-item" title="HTTPS / TLS">
              <Lock size={12} />
              {httpsActive ? 'HTTPS / TLS' : 'HTTP'}
            </span>
          </div>

          <div className="statusbar-right">
            {activeNote && (
              <>
                <span className="status-item">
                  { currentBacklinks.length } {t('rightSidebar.backlinks')}
                </span>
                <span className="status-item">{wordCount} {t('statusbar.words')}</span>
                <span className="status-item">
                  {activeNote.body.length} {t('statusbar.characters')}
                </span>
              </>
            )}
            <span className="status-item">
              {allNotesForEditor.length} {t('sidebar.files')}
            </span>
          </div>
        </footer>
      )}

      {/* Modal Dialog for Create / Rename / Delete */}
      {dialog && (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>
              {dialog.type === 'create-note' && t('dialogs.newNoteTitle')}
              {dialog.type === 'create-folder' && t('dialogs.newFolderTitle')}
              {dialog.type === 'rename' && t('dialogs.renameTitle')}
              {dialog.type === 'delete' && t('dialogs.deleteTitle')}
            </h3>

            <form onSubmit={handleDialogConfirm}>
              {dialog.type === 'delete' ? (
                <p className="modal-confirm-text">
                  {dialog.prompt || t('dialogs.deleteNotePrompt', { name: dialog.initialValue })}
                </p>
              ) : (
                <>
                  {dialog.parentFolder && (
                    <p className="modal-subfolder-hint">
                      {t('dialogs.moveTargetFolder')} <code>{dialog.parentFolder}/</code>
                    </p>
                  )}
                  <input
                    type="text"
                    className="modal-input"
                    value={dialogInput}
                    onChange={(e) => setDialogInput(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    autoFocus
                    required
                  />
                </>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setDialog(null)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className={dialog.type === 'delete' ? 'btn-danger' : 'btn-primary'}
                >
                  {dialog.type === 'delete' ? t('common.delete') : t('common.confirm')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* Settings Modal (Theme, Security, Profiles, Sync) */}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={settingsOpen}
            initialTab={settingsInitialTab}
            onClose={() => {
              setSettingsOpen(false);
              setSettingsInitialTab(undefined);
            }}
            currentTheme={theme}
            onThemeChange={(newTheme) => setTheme(newTheme)}
            fileTree={tree}
            onInstallApp={handleInstallApp}
            isInstalledApp={isInstalledApp}
            onFontSettingsChange={setFontSettings}
          />
        </Suspense>
      )}

      {/* Interactive Conflict Resolution Modal */}
      <ConflictModal
        conflicts={conflicts}
        onClose={() => setConflicts([])}
      />

      {/* Version History Modal (Git Commits & Visual Diff) */}
      <VersionHistoryModal
        filePath={versionHistoryPath}
        isOpen={Boolean(versionHistoryPath)}
        onClose={() => setVersionHistoryPath(null)}
        onRestore={handleVersionRestored}
      />

      {/* Send to Target Note Modal */}
      <SendToTargetModal
        isOpen={isSendToTargetModalOpen}
        onClose={() => setIsSendToTargetModalOpen(false)}
        activePath={activeNote?.path ?? null}
        allNotes={allNotesForEditor}
        onSelectTarget={handleSendToTarget}
      />

      {/* Template Selection Modal */}
      <TemplateSelectModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        templates={templateNotes}
        onSelectTemplate={handleSelectTemplate}
      />

      {/* New Base Creation Wizard Modal */}
      <NewBaseModal
        isOpen={isNewBaseModalOpen}
        onClose={() => setIsNewBaseModalOpen(false)}
        onCreate={handleCreateNewBase}
        initialFolder={newBaseInitialFolder}
        vaultFolders={vaultFolders}
        vaultTags={allTagNames}
        vaultNotes={vaultNotes}
      />

      {/* Toast Notification */}
      {toastNotification && (
        <div className="app-toast-container">
          <div className="app-toast">
            <span>{toastNotification}</span>
          </div>
        </div>
      )}

      {/* Command Palette (Strg+P) */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        commands={commands}
      />

      {/* Mobile 4-in-1 Search Modal */}
      {isMobile && (
        <MobileSearchModal
          isOpen={mobileSearchOpen}
          onClose={() => setMobileSearchOpen(false)}
          activeNote={activeNote ? { path: activeNote.path, body: activeNote.body, rawContent: activeNote.rawContent } : null}
          allFiles={allNotesForEditor}
          commands={commands}
          onOpenFile={(targetPath) => {
            openNote(targetPath);
            setLeftSidebarOpen(false);
          }}
          onJumpToInNoteMatch={(query, matchIndex) => {
            setInNoteSearchQuery(query);
            setInNoteSearchIndex(matchIndex);
          }}
          onJumpToNoteWithSearch={(targetPath, query, matchIndex) => {
            setInNoteSearchQuery(query);
            setInNoteSearchIndex(matchIndex);
            openNote(targetPath);
            setLeftSidebarOpen(false);
          }}
          onOpenSettingsTab={(tab) => {
            setSettingsInitialTab(tab);
            setSettingsOpen(true);
          }}
        />
      )}
    </div>
  );
};
