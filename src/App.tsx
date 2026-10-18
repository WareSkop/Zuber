import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
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
  Layout,
  Maximize2,
  Minimize2,
} from 'lucide-react';
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
import { CanvasEditor } from './components/canvas/CanvasEditor';
import { GraphView } from './components/GraphView';
import { SettingsModal } from './components/SettingsModal';
import { ConflictModal } from './components/ConflictModal';
import { CommandPalette, type CommandItem } from './components/CommandPalette';
import { EditorToolbar } from './components/EditorToolbar';
import { syncEngine, type SyncState, type ConflictItem } from './sync/syncEngine';
import { useTranslation } from './i18n';
import { recordLastActiveNote, resolveStartupNotePath } from './startupConfig';
import {
  getFontSettings,
  applyFontSettingsToDOM,
  type FontSettings,
} from './fontSettings';

type MainWorkspaceView = 'editor' | 'graph' | 'split';
type RightSidebarTab = 'backlinks' | 'outline' | 'local-graph';

interface DialogState {
  type: 'create-note' | 'create-folder' | 'rename' | 'delete' | 'create-canvas';
  title?: string;
  prompt?: string;
  parentFolder?: string;
  targetPath?: string;
  initialValue: string;
}

export const App: React.FC = () => {
  const { t, language } = useTranslation();
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [httpsActive, setHttpsActive] = useState(true);
  const [vaultPath, setVaultPath] = useState('');

  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [allFiles, setAllFiles] = useState<
    { path: string; name: string; basename: string; extension: string }[]
  >([]);
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
  const [editorMode, setEditorMode] = useState<EditorMode>('live');
  const [workspaceView, setWorkspaceView] = useState<MainWorkspaceView>('editor');

  const [leftSidebarOpen, setLeftSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : false
  );
  const [rightSidebarOpen, setRightSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth > 1200 : false
  );
  const [rightTab, setRightTab] = useState<RightSidebarTab>('backlinks');
  const [zenMode, setZenMode] = useState(false);

  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [scrollToLine, setScrollToLine] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [wsConnected, setWsConnected] = useState(false);
  const [theme, setTheme] = useState<string>(() => localStorage.getItem('knowmesh_theme') || localStorage.getItem('basalt_theme') || 'knowmesh');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>('offline');
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
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
      alert('Tipp: Um Knowmesh als WebAPK auf Android/Chromebook oder Desktop zu installieren, tippe im Browser-Menü auf „App installieren“ oder „Zum Startbildschirm hinzufügen“.');
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

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || e.changedTouches.length === 0) return;
    const startX = touchStartRef.current.x;
    const startY = touchStartRef.current.y;
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
        // Neither sidebar is open: swipe right opens left sidebar
        const isEdgeStart = startX <= 35;
        const isStrongSwipe = deltaX > 65;
        if (isEdgeStart || isStrongSwipe) {
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
  const lastLocalSaveTimeRef = useRef<number>(0);
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
    pendingSaveTaskRef.current = null;
    if (task) {
      await task();
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
    (baseName: string, type: 'file' | 'folder' | 'canvas', parentFolder?: string): string => {
      const existing = collectExistingPaths();
      const buildPath = (name: string) => {
        const leaf = type === 'canvas' ? `${name}.canvas` : type === 'file' ? `${name}.md` : name;
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
    (parentFolder?: string) => {
      const baseName = language === 'de' ? 'Neue Notiz' : 'New Note';
      const defaultName = getUniqueDefaultName(baseName, 'file', parentFolder);
      setDialog({ type: 'create-note', parentFolder, initialValue: defaultName });
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
    localStorage.setItem('knowmesh_theme', theme);
  }, [theme]);

  const manualSaveRef = useRef<(() => void) | null>(null);

  // Global Keyboard shortcuts (Command Palette, Save, Settings, New Note, Sidebars)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
          vaultPath: 'Knowmesh Vault (Offline)',
        },
        graphRes: cachedGraph,
      };
    } catch (innerErr) {
      console.warn('Could not load from IndexedDB cache:', innerErr);
      const emptyTree: FileTreeNode[] = [];
      const emptyFiles: { path: string; name: string; basename: string; extension: string }[] = [];
      const emptyGraph: GraphData = { nodes: [], edges: [], tags: [] };
      setTree(emptyTree);
      setAllFiles(emptyFiles);
      setGraphData(emptyGraph);
      return {
        treeRes: { tree: emptyTree, files: emptyFiles, vaultPath: 'Knowmesh Vault (Offline)' },
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
      if (activePathRef.current === relPath) setBacklinks(res);
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
        if (activePathRef.current === relPath) setBacklinks({ linked, unlinked: [] });
      } catch {
        // ignore
      }
    }
  }, []);

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
          await refreshBacklinks(activePathRef.current);
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
      try {
        const note = await syncEngine.getNote(relPath);
        if (requestId !== openRequestRef.current) return; // a newer note was requested meanwhile
        setActiveNote(note);
        setSaveState('saved');
        recordLastActiveNote(relPath);
        refreshBacklinks(relPath);
      } catch (err) {
        console.error('Fehler beim Laden der Notiz:', err);
      }
    },
    [flushPendingSave, refreshBacklinks]
  );

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
      const am = a.extension === 'md' || a.extension === 'canvas' ? 0 : 1;
      const bm = b.extension === 'md' || b.extension === 'canvas' ? 0 : 1;
      return am - bm || a.path.length - b.path.length;
    });
    for (const f of sorted) {
      const lp = f.path.toLowerCase();
      byPath.set(lp, f.path);
      if (f.extension === 'md') byPath.set(lp.replace(/\.md$/, ''), f.path);
      if (f.extension === 'canvas') byPath.set(lp.replace(/\.canvas$/, ''), f.path);
      if (!byName.has(f.name.toLowerCase())) byName.set(f.name.toLowerCase(), f.path);
      if (!byName.has(f.basename.toLowerCase())) byName.set(f.basename.toLowerCase(), f.path);
    }
    return { byPath, byName };
  }, [allFiles]);

  const allNotesForEditor = useMemo(
    () =>
      allFiles
        .filter((f) => f.extension === 'md' || f.extension === 'canvas')
        .map((f) => ({ path: f.path, name: f.name, basename: f.basename })),
    [allFiles]
  );
  const allTagNames = useMemo(() => graphData.tags.map((t) => t.tag), [graphData.tags]);

  const sidebarHandlers = useMemo(
    () => ({
      onSelectNote: (path: string) => {
        openNoteByPath(path);
        if (workspaceViewRef.current === 'graph') setWorkspaceView('editor');
        if (isMobile) {
          setLeftSidebarOpen(false);
        }
      },
      onCreateNote: (parentFolder?: string) => {
        openCreateNoteDialog(parentFolder);
      },
      onCreateCanvas: (parentFolder?: string) => {
        openCreateCanvasDialog(parentFolder);
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
      onRefresh: () => {
        loadVaultIndex();
      },
      onSelectTagFilter: (tag: string | null) => setSelectedTagFilter(tag),
    }),
    [
      openNoteByPath,
      openCreateNoteDialog,
      openCreateCanvasDialog,
      openCreateFolderDialog,
      loadVaultIndex,
      isMobile,
      t,
      tree,
    ]
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

      const activateOfflineMode = async () => {
        if (cancelled) return;
        setAuthenticated(true);
        setAuthChecked(true);
        setSyncState('offline');
        try {
          const { treeRes } = await loadVaultIndex();
          const startupPath = await resolveStartupNotePath(treeRes.files);
          if (startupPath && !cancelled) {
            await openNoteByPath(startupPath);
          }
        } catch (offlineErr) {
          console.warn('Offline mode active, falling back to local cache:', offlineErr);
        }
      };

      // 1. Clearly offline according to navigator
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (canProceedOffline) {
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
            const startupPath = await resolveStartupNotePath(treeRes.files);
            if (startupPath && !cancelled) {
              await openNoteByPath(startupPath);
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
              if (
                currentPath &&
                paths.includes(currentPath) &&
                Date.now() - lastLocalSaveTimeRef.current > 1500
              ) {
                openNoteByPath(currentPath);
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
  }, [authenticated, loadVaultIndex, scheduleIndexRefresh, openNoteByPath]);

  const handleLogin = async (password: string) => {
    const loginRes = await api.login(password);
    setAuthenticated(true);
    if (!loginRes.offline) {
      syncEngine.notifyAuthenticatedOnline();
    }
    const { treeRes } = await loadVaultIndex();
    const targetPath = await resolveStartupNotePath(treeRes.files);
    if (targetPath) {
      await openNoteByPath(targetPath);
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

      const baseMtime =
        activeNoteRef.current?.path === path ? activeNoteRef.current.updatedAt : undefined;

      const executeSave = async () => {
        pendingSaveTaskRef.current = null;
        setSaveState('saving');
        lastLocalSaveTimeRef.current = Date.now();
        try {
          const saved = await syncEngine.saveNote({
            path,
            ...payload,
            baseMtime,
          });
          lastLocalSaveTimeRef.current = Date.now();
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
          setSaveState('saved');
          scheduleIndexRefresh(false, 1500);
        } catch (err) {
          console.error('Speicherfehler:', err);
        }
      };

      pendingSaveTaskRef.current = executeSave;
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        executeSave();
      }, 500);
    },
    [scheduleIndexRefresh]
  );

  const handlePropertiesChange = (updatedProps: FrontmatterProperty[]) => {
    if (!activeNote) return;
    const newRaw = serializeMarkdownWithFrontmatter(updatedProps, activeNote.body);
    setActiveNote({
      ...activeNote,
      properties: updatedProps,
      rawContent: newRaw,
    });
    scheduleSave(activeNote.path, {
      properties: updatedProps,
      body: activeNote.body,
    });
  };

  const handleBodyChange = (newBody: string) => {
    if (!activeNote) return;
    setActiveNote({
      ...activeNote,
      body: newBody,
    });
    scheduleSave(activeNote.path, {
      properties: activeNote.properties,
      body: newBody,
    });
  };

  const handleRawChange = (newRaw: string) => {
    if (!activeNote) return;
    const parsed = parseMarkdownWithFrontmatter(newRaw);
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
  const handleNavigateWikiLink = async (target: string) => {
    try {
      const trimmed = target.trim();
      if (/^(https?:|mailto:|tel:)/i.test(trimmed)) {
        window.open(trimmed, '_blank', 'noopener,noreferrer');
        return;
      }

      const currentFrom = activePathRef.current;

      // Fast path: resolve in the browser (no server round trip)
      const local = resolveLocally(trimmed, currentFrom);
      if (local) {
        if (local.toLowerCase().endsWith('.md') || local.toLowerCase().endsWith('.canvas')) {
          if (workspaceViewRef.current === 'graph') {
            setWorkspaceView('editor');
          }
          await openNoteByPath(local);
        } else {
          window.open(api.getAttachmentUrl(local, currentFrom || undefined), '_blank');
        }
        return;
      }

      // If it looks like a binary attachment (PDF, Office, Image, Archive), open attachment directly
      if (/\.(pdf|xlsx|xls|docx|doc|pptx|png|jpe?g|gif|webp|svg|zip|mp3|mp4)$/i.test(trimmed)) {
        window.open(api.getAttachmentUrl(trimmed, currentFrom || undefined), '_blank');
        return;
      }

      if (workspaceViewRef.current === 'graph') {
        setWorkspaceView('editor');
      }

      // Fallback (e.g. aliases): ask the server
      const res = await api.resolveWikiLink(trimmed, currentFrom || undefined);
      if (res.resolvedPath) {
        if (res.resolvedPath.toLowerCase().endsWith('.md') || res.resolvedPath.toLowerCase().endsWith('.canvas')) {
          await openNoteByPath(res.resolvedPath);
        } else {
          window.open(api.getAttachmentUrl(res.resolvedPath, currentFrom || undefined), '_blank');
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
      setActiveNote(created);
      refreshBacklinks(created.path);
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
        const created = await syncEngine.saveNote({
          path: relPath,
          properties: [
            { key: 'tags', type: 'list', value: [] },
            {
              key: 'erstellt',
              type: 'date',
              value: new Date().toISOString().slice(0, 10),
            },
          ],
          body: `# ${cleanTitle}\n\n`,
        });
        await loadVaultIndex();
        setActiveNote(created);
        setSaveState('saved');
        recordLastActiveNote(created.path);
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
        const { treeRes } = await loadVaultIndex();
        if (isActiveOrChild) {
          const nextFile = treeRes.files.find((f) => f.extension === 'md' || f.extension === 'canvas');
          if (nextFile) {
            await openNoteByPath(nextFile.path);
          } else {
            setActiveNote(null);
          }
        }
      }
    } catch (err) {
      console.error('Dialog-Aktion fehlgeschlagen:', err);
    }
  };

  const handleUploadImageFile = async (file: File): Promise<string> => {
    const uploaded = await api.uploadAttachment(file);
    await loadVaultIndex();
    return uploaded.wikiEmbed || (uploaded.path ? `![[${uploaded.path}]]` : `![[${uploaded.name}]]`);
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
    try {
      const saved = await syncEngine.saveNote({
        path: activeNote.path,
        body: activeNote.body,
        properties: activeNote.properties,
        rawContent: activeNote.rawContent,
      });
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

  const commands: CommandItem[] = useMemo(() => {
    return [
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

      // Navigation & Sidebars
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
        id: 'vault-new-canvas',
        title: 'Vault: Neues Canvas erstellen (Workflow / Diagramm)',
        category: 'Vault',
        icon: <Layout size={16} />,
        keywords: ['canvas', 'diagramm', 'flowchart', 'network', 'workflow', 'whiteboard'],
        action: () => openCreateCanvasDialog(),
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
        title: 'Darstellung: Theme „Knowmesh Dark“ (Standard)',
        category: 'Einstellungen',
        icon: <Palette size={16} />,
        keywords: ['theme', 'dark', 'dunkel', 'knowmesh', 'basalt'],
        action: () => setTheme('knowmesh'),
      },
      {
        id: 'theme-light',
        title: 'Darstellung: Theme „Knowmesh Hell“',
        category: 'Einstellungen',
        icon: <Palette size={16} />,
        keywords: ['theme', 'light', 'hell', 'weiß', 'knowmesh'],
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
    handleUploadImageClick,
    handleManualSave,
    handleDownloadNote,
  ]);

  if (!authChecked) {
    return <div className="loading-screen">Lade Knowmesh...</div>;
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
          onClick={() => {
            setWorkspaceView((v) => (v === 'split' ? 'editor' : 'split'));
            if (isMobile) setLeftSidebarOpen(false);
          }}
          title={t('nav.split')}
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

  return (
    <div
      className={`knowmesh-app-shell obsidian-app-shell ${zenMode ? 'zen-mode-active zen-mode' : ''}`}
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
              <span>{t('header.noNoteSelected')}</span>
            )}
          </div>

          <div className="topbar-controls">
            {workspaceView !== 'graph' && activeNote && (
              isCanvasNote ? (
                <div className="canvas-mode-indicator" title="Canvas & Diagramm-Editor">
                  <Layout size={14} />
                  <span>Canvas</span>
                </div>
              ) : (
                <div className="editor-mode-switcher" role="group" aria-label={t('header.modeGroupAria')}>
                  <button
                    type="button"
                    className={`mode-btn ${editorMode === 'live' ? 'active' : ''}`}
                    onClick={() => setEditorMode('live')}
                    title={t('header.livePreviewTitle')}
                  >
                    <Eye size={14} />
                    <span>{t('header.livePreview')}</span>
                  </button>
                  <button
                    type="button"
                    className={`mode-btn ${editorMode === 'reading' ? 'active' : ''}`}
                    onClick={() => setEditorMode('reading')}
                    title={t('header.readingTitle')}
                  >
                    <BookOpen size={14} />
                    <span>{t('header.reading')}</span>
                  </button>
                  <button
                    type="button"
                    className={`mode-btn ${editorMode === 'source' ? 'active' : ''}`}
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
                  >
                    <Code2 size={14} />
                    <span>{t('header.source')}</span>
                  </button>
                </div>
              )
            )}

            <button
              type="button"
              className="topbar-action-btn"
              onClick={() => setZenMode(true)}
              title={t('header.zenTitle')}
              aria-label={t('header.zenTitle')}
            >
              <Maximize2 size={15} />
              <span>{t('header.zen')}</span>
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

        <div className={`workspace-panes view-${workspaceView}`}>
          {(workspaceView === 'editor' || workspaceView === 'split') && (
            <section className="editor-pane-container">
              {isCanvasNote && activeNote ? (
                <div className="canvas-workspace-pane">
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
                      });
                    }}
                    onOpenNote={(targetPath) => {
                      openNoteByPath(targetPath);
                      if (isMobile) setLeftSidebarOpen(false);
                    }}
                    onSelectTag={(tag) => {
                      setSelectedTagFilter(tag.replace(/^#+/, ''));
                      setLeftSidebarOpen(true);
                    }}
                    allNotes={allNotesForEditor}
                  />
                </div>
              ) : (
                <>
                  {/* Sticky Formatting Toolbar at the top */}
                  {activeNote && editorMode !== 'reading' && !zenMode && (
                    <EditorToolbar
                      editorRef={editorRef}
                      onUploadImage={handleUploadImageFile}
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
                          onChangeBody={handleBodyChange}
                          onChangeRaw={handleRawChange}
                          onNavigateWikiLink={handleNavigateWikiLink}
                          onSelectTag={(tag) => {
                            setSelectedTagFilter(tag.replace(/^#+/, ''));
                            setLeftSidebarOpen(true);
                          }}
                        />
                      </div>
                    ) : (
                      <div className="empty-workspace-state">
                        <FileText size={42} />
                        <h2>Keine Notiz geöffnet</h2>
                        <p>
                          Wähle links im Dateibaum eine Notiz aus oder erstelle eine neue Notiz.
                        </p>
                        <div className="empty-state-btn-row">
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => openCreateNoteDialog()}
                          >
                            + Neue Notiz erstellen
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => openCreateCanvasDialog()}
                          >
                            <Layout size={15} />
                            <span>+ Neues Canvas</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          {(workspaceView === 'graph' || workspaceView === 'split') && (
            <section className="graph-pane">
              <GraphView
                graphData={graphData}
                activeNotePath={activeNote?.path ?? null}
                isLocalGraph={false}
                onSelectNote={(pathOrTitle, isUnresolved) => {
                  if (isUnresolved) {
                    handleNavigateWikiLink(pathOrTitle);
                  } else {
                    openNoteByPath(pathOrTitle);
                    if (workspaceView === 'graph') {
                      setWorkspaceView('editor');
                    }
                  }
                }}
                onSelectTag={(tag) => {
                  setSelectedTagFilter(tag);
                  setLeftSidebarOpen(true);
                }}
              />
            </section>
          )}
        </div>
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
                      onClick={() => openNoteByPath(item.sourcePath)}
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
                      onClick={() => openNoteByPath(item.sourcePath)}
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
              <GraphView
                graphData={graphData}
                activeNotePath={activeNote?.path ?? null}
                isLocalGraph={true}
                onSelectNote={(pathOrTitle, isUnresolved) => {
                  if (isUnresolved) {
                    handleNavigateWikiLink(pathOrTitle);
                  } else {
                    openNoteByPath(pathOrTitle);
                  }
                }}
                onSelectTag={(tag) => {
                  setSelectedTagFilter(tag);
                  setLeftSidebarOpen(true);
                }}
              />
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
            <span
              className={`status-item ${wsConnected ? 'sync-online' : 'sync-offline'}`}
              title="Live Watcher"
            >
              <Radio size={12} />
              {wsConnected ? t('statusbar.synced') : t('statusbar.syncing')}
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
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentTheme={theme}
        onThemeChange={(newTheme) => setTheme(newTheme)}
        fileTree={tree}
        onInstallApp={handleInstallApp}
        isInstalledApp={isInstalledApp}
        onFontSettingsChange={setFontSettings}
      />

      {/* Interactive Conflict Resolution Modal */}
      <ConflictModal
        conflicts={conflicts}
        onClose={() => setConflicts([])}
      />

      {/* Command Palette (Strg+P) */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        commands={commands}
      />
    </div>
  );
};
