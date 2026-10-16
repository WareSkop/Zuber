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
  Terminal,
  Palette,
  RefreshCw,
  Trash2,
  Edit3,
  Download,
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
import { api, getStoredToken } from './api';
import { LoginModal } from './components/LoginModal';
import { FileSidebar } from './components/FileSidebar';
import { PropertiesEditor } from './components/PropertiesEditor';
import {
  LivePreviewEditor,
  type EditorMode,
  type LivePreviewEditorRef,
} from './components/LivePreviewEditor';
import { GraphView } from './components/GraphView';
import { SettingsModal } from './components/SettingsModal';
import { ConflictModal } from './components/ConflictModal';
import { CommandPalette, type CommandItem } from './components/CommandPalette';
import { EditorToolbar } from './components/EditorToolbar';
import { syncEngine, type SyncState, type ConflictItem } from './sync/syncEngine';

type MainWorkspaceView = 'editor' | 'graph' | 'split';
type RightSidebarTab = 'backlinks' | 'outline' | 'local-graph';

interface DialogState {
  type: 'create-note' | 'create-folder' | 'rename' | 'delete';
  parentFolder?: string;
  targetPath?: string;
  initialValue: string;
}

export const App: React.FC = () => {
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
    typeof window !== 'undefined' ? window.innerWidth > 900 : true
  );
  const [rightSidebarOpen, setRightSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth > 1200 : false
  );
  const [rightTab, setRightTab] = useState<RightSidebarTab>('backlinks');

  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [scrollToLine, setScrollToLine] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [wsConnected, setWsConnected] = useState(false);
  const [theme, setTheme] = useState<string>(() => localStorage.getItem('basalt_theme') || 'basalt');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>('offline');
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const editorRef = useRef<LivePreviewEditorRef>(null);

  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogInput, setDialogInput] = useState('');

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLocalSaveTimeRef = useRef<number>(0);
  const activePathRef = useRef<string | null>(null);
  activePathRef.current = activeNote?.path ?? null;
  const workspaceViewRef = useRef<MainWorkspaceView>('editor');
  workspaceViewRef.current = workspaceView;
  const openRequestRef = useRef(0);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme.startsWith('light') ? 'light' : 'dark';
    localStorage.setItem('basalt_theme', theme);
  }, [theme]);

  useEffect(() => {
    const unsubSync = syncEngine.subscribe(setSyncState);
    const unsubConflicts = syncEngine.subscribeConflicts(setConflicts);
    return () => {
      unsubSync();
      unsubConflicts();
    };
  }, []);

  const manualSaveRef = useRef<(() => void) | null>(null);

  // Global Keyboard shortcuts (Command Palette, Save, Settings, New Note, Sidebars)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
        setDialog({ type: 'create-note', initialValue: '' });
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
    const [treeRes, graphRes] = await Promise.all([api.getTree(), api.getGraph()]);
    setTree(treeRes.tree);
    setAllFiles(treeRes.files);
    setVaultPath(treeRes.vaultPath);
    setGraphData(graphRes);
    return { treeRes, graphRes };
  }, []);

  const refreshBacklinks = useCallback(async (relPath: string | null) => {
    if (!relPath) {
      setBacklinks({ linked: [], unlinked: [] });
      return;
    }
    try {
      const res = await api.getBacklinks(relPath);
      if (activePathRef.current === relPath) setBacklinks(res);
    } catch {
      // ignore
    }
  }, []);

  // Debounced background refresh of graph (+ tree if structure changed) and backlinks.
  // Never blocks opening/editing notes.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStructuralRef = useRef(false);
  const scheduleIndexRefresh = useCallback(
    (structural: boolean, delay = 600) => {
      pendingStructuralRef.current ||= structural;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(async () => {
        const doTree = pendingStructuralRef.current;
        pendingStructuralRef.current = false;
        try {
          if (doTree) {
            await loadVaultIndex();
          } else {
            setGraphData(await api.getGraph());
          }
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
      const requestId = ++openRequestRef.current;
      try {
        const note = await api.getNote(relPath);
        if (requestId !== openRequestRef.current) return; // a newer note was requested meanwhile
        setActiveNote(note);
        setSaveState('saved');
        refreshBacklinks(relPath);
      } catch (err) {
        console.error('Fehler beim Laden der Notiz:', err);
      }
    },
    [refreshBacklinks]
  );

  // Memoized lookup maps for instant client-side [[Wiki-Link]] resolution
  const linkLookup = useMemo(() => {
    const byPath = new Map<string, string>();
    const byName = new Map<string, string>();
    const sorted = [...allFiles].sort((a, b) => {
      const am = a.extension === 'md' ? 0 : 1;
      const bm = b.extension === 'md' ? 0 : 1;
      return am - bm || a.path.length - b.path.length;
    });
    for (const f of sorted) {
      const lp = f.path.toLowerCase();
      byPath.set(lp, f.path);
      if (f.extension === 'md') byPath.set(lp.replace(/\.md$/, ''), f.path);
      if (!byName.has(f.name.toLowerCase())) byName.set(f.name.toLowerCase(), f.path);
      if (!byName.has(f.basename.toLowerCase())) byName.set(f.basename.toLowerCase(), f.path);
    }
    return { byPath, byName };
  }, [allFiles]);

  const allNotesForEditor = useMemo(
    () =>
      allFiles
        .filter((f) => f.extension === 'md')
        .map((f) => ({ path: f.path, name: f.name, basename: f.basename })),
    [allFiles]
  );
  const allTagNames = useMemo(() => graphData.tags.map((t) => t.tag), [graphData.tags]);

  const sidebarHandlers = useMemo(
    () => ({
      onSelectNote: (path: string) => {
        openNoteByPath(path);
        if (workspaceViewRef.current === 'graph') setWorkspaceView('editor');
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
          setLeftSidebarOpen(false);
        }
      },
      onCreateNote: (parentFolder?: string) => {
        setDialog({ type: 'create-note', parentFolder, initialValue: 'Neue Notiz' });
        setDialogInput('Neue Notiz');
      },
      onCreateFolder: (parentFolder?: string) => {
        setDialog({ type: 'create-folder', parentFolder, initialValue: 'Neuer Ordner' });
        setDialogInput('Neuer Ordner');
      },
      onRenameEntry: (oldPath: string, currentName: string) => {
        setDialog({ type: 'rename', targetPath: oldPath, initialValue: currentName });
        setDialogInput(currentName);
      },
      onDeleteEntry: (path: string, name: string) => {
        setDialog({ type: 'delete', targetPath: path, initialValue: name });
      },
      onRefresh: () => {
        loadVaultIndex();
      },
      onSelectTagFilter: (tag: string | null) => setSelectedTagFilter(tag),
    }),
    [openNoteByPath, loadVaultIndex]
  );

  // Initial authentication check
  useEffect(() => {
    api
      .checkAuthStatus()
      .then(async (status) => {
        setHttpsActive(status.https);
        setVaultPath(status.vaultPath);
        setAuthenticated(status.authenticated);
        setAuthChecked(true);

        if (status.authenticated) {
          const { treeRes } = await loadVaultIndex();
          const welcome = treeRes.files.find(
            (f) => f.extension === 'md' && f.basename.toLowerCase().includes('willkommen')
          );
          const firstMd = welcome || treeRes.files.find((f) => f.extension === 'md');
          if (firstMd) {
            await openNoteByPath(firstMd.path);
          }
        }
      })
      .catch(() => {
        setAuthChecked(true);
      });
  }, [loadVaultIndex, openNoteByPath]);

  // WebSocket live file-watcher connection
  useEffect(() => {
    if (!authenticated) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connectWs = () => {
      if (disposed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = getStoredToken();
      const wsUrl = `${proto}//${window.location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'vault:changed') {
            const paths: string[] = Array.isArray(msg.paths) ? msg.paths : [];
            scheduleIndexRefresh(Boolean(msg.structural));
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
        if (!disposed) {
          reconnectTimer = setTimeout(connectWs, 2500);
        }
      };
    };

    connectWs();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [authenticated, scheduleIndexRefresh, openNoteByPath]);

  const handleLogin = async (password: string) => {
    await api.login(password);
    setAuthenticated(true);
    const { treeRes } = await loadVaultIndex();
    const welcome = treeRes.files.find(
      (f) => f.extension === 'md' && f.basename.toLowerCase().includes('willkommen')
    );
    const firstMd = welcome || treeRes.files.find((f) => f.extension === 'md');
    if (firstMd) {
      await openNoteByPath(firstMd.path);
    }
  };

  const handleLogout = async () => {
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

      saveTimerRef.current = setTimeout(async () => {
        setSaveState('saving');
        lastLocalSaveTimeRef.current = Date.now();
        try {
          const saved = await syncEngine.saveNote({
            path,
            ...payload,
            baseMtime: activeNote?.updatedAt,
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

  // Navigate to a [[Wiki-Link]] or Markdown [Link](target); if the note does not exist yet, create it just like Obsidian!
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
        if (local.toLowerCase().endsWith('.md')) {
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
        if (res.resolvedPath.toLowerCase().endsWith('.md')) {
          await openNoteByPath(res.resolvedPath);
        } else {
          window.open(api.getAttachmentUrl(res.resolvedPath, currentFrom || undefined), '_blank');
        }
        return;
      }

      // Create new note for unresolved Wiki-Link
      let decodedName = trimmed;
      try {
        decodedName = decodeURIComponent(trimmed);
      } catch {
        // ignore
      }
      const cleanName = decodedName.split('#')[0].replace(/\.md$/i, '').trim();
      const newPath = `${cleanName}.md`;
      const created = await api.saveNote({
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
    const val = dialogInput.trim();

    try {
      if (dialog.type === 'create-note') {
        if (!val) return;
        const cleanTitle = val.replace(/\.md$/i, '');
        const relPath = dialog.parentFolder
          ? `${dialog.parentFolder}/${cleanTitle}.md`
          : `${cleanTitle}.md`;
        const created = await api.saveNote({
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
        if (workspaceView === 'graph') setWorkspaceView('editor');
      } else if (dialog.type === 'create-folder') {
        if (!val) return;
        const relPath = dialog.parentFolder ? `${dialog.parentFolder}/${val}` : val;
        await api.createFolder(relPath);
        await loadVaultIndex();
      } else if (dialog.type === 'rename' && dialog.targetPath) {
        if (!val) return;
        const parts = dialog.targetPath.split('/');
        parts[parts.length - 1] = val;
        const newRelPath = parts.join('/');
        const res = await api.renameEntry(dialog.targetPath, newRelPath);
        await loadVaultIndex();
        if (activeNote?.path === dialog.targetPath) {
          await openNoteByPath(res.newPath);
        }
      } else if (dialog.type === 'delete' && dialog.targetPath) {
        await api.deleteEntry(dialog.targetPath);
        const { treeRes } = await loadVaultIndex();
        if (activeNote?.path === dialog.targetPath) {
          const nextMd = treeRes.files.find((f) => f.extension === 'md');
          if (nextMd) {
            await openNoteByPath(nextMd.path);
          } else {
            setActiveNote(null);
          }
        }
      }
    } finally {
      setDialog(null);
      setDialogInput('');
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
    const content =
      activeNote.rawContent ||
      serializeMarkdownWithFrontmatter(activeNote.properties, activeNote.body);
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeNote.name.endsWith('.md')
      ? activeNote.name
      : `${activeNote.name}.md`;
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
        action: () => setDialog({ type: 'create-note', initialValue: '' }),
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
          setDialog({
            type: 'rename',
            targetPath: activeNote.path,
            initialValue: activeNote.name.replace(/\.md$/i, ''),
          });
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
            initialValue: '',
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
        title: 'Darstellung: Theme „Basalt Dark“ (Standard)',
        category: 'Einstellungen',
        icon: <Palette size={16} />,
        keywords: ['theme', 'dark', 'dunkel', 'basalt'],
        action: () => setTheme('basalt'),
      },
      {
        id: 'theme-light',
        title: 'Darstellung: Theme „Obsidian Light“',
        category: 'Einstellungen',
        icon: <Palette size={16} />,
        keywords: ['theme', 'light', 'hell', 'weiß'],
        action: () => setTheme('theme-obsidian-light'),
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
    handleUploadImageClick,
    handleManualSave,
    handleDownloadNote,
  ]);

  if (!authChecked) {
    return <div className="loading-screen">Lade Basalt...</div>;
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

  const wordCount = activeNote
    ? activeNote.body
        .trim()
        .split(/\s+/)
        .filter(Boolean).length
    : 0;

  return (
    <div className="obsidian-app-shell">
      {/* Leftmost Icon Ribbon (like Obsidian) */}
      <nav className="obsidian-ribbon" aria-label="Hauptnavigation">
        <div className="ribbon-top">
          <button
            type="button"
            className={`ribbon-btn ${leftSidebarOpen ? 'active' : ''}`}
            onClick={() => setLeftSidebarOpen((o) => !o)}
            title="Dateibaum & Suche ein-/ausblenden"
          >
            <PanelLeft size={19} />
          </button>

          <button
            type="button"
            className="ribbon-btn"
            onClick={() => {
              setDialog({
                type: 'create-note',
                initialValue: 'Unbenannte Notiz',
              });
              setDialogInput('Unbenannte Notiz');
            }}
            title="Neue Notiz erstellen"
          >
            <FilePlus size={19} />
          </button>

          <button
            type="button"
            className={`ribbon-btn ${workspaceView === 'editor' ? 'active' : ''}`}
            onClick={() => setWorkspaceView('editor')}
            title="Editor-Ansicht"
          >
            <FileText size={19} />
          </button>

          <button
            type="button"
            className={`ribbon-btn ${workspaceView === 'graph' ? 'active' : ''}`}
            onClick={() => setWorkspaceView('graph')}
            title="Globale Graph-Ansicht öffnen"
          >
            <GitFork size={19} />
          </button>

          <button
            type="button"
            className={`ribbon-btn ${workspaceView === 'split' ? 'active' : ''}`}
            onClick={() =>
              setWorkspaceView((v) => (v === 'split' ? 'editor' : 'split'))
            }
            title="Split-Screen: Editor + Graph nebeneinander"
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
                ? 'Zum hellen Design wechseln'
                : 'Zum dunklen Design wechseln'
            }
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <button
            type="button"
            className={`ribbon-btn ${rightSidebarOpen ? 'active' : ''}`}
            onClick={() => setRightSidebarOpen((o) => !o)}
            title="Rechte Seitenleiste (Backlinks, Gliederung & Lokaler Graph)"
          >
            <PanelRight size={19} />
          </button>

          <button
            type="button"
            className="ribbon-btn logout-btn"
            onClick={handleLogout}
            title="Abmelden / Vault sperren"
          >
            <LogOut size={18} />
          </button>
        </div>
      </nav>

      {/* Left Sidebar: File Explorer, Search, Tags */}
      {leftSidebarOpen && (
        <>
          <div
            className="mobile-drawer-backdrop"
            onClick={() => setLeftSidebarOpen(false)}
            aria-hidden="true"
          />
          <FileSidebar
            tree={tree}
            activePath={activeNote?.path ?? null}
            tags={graphData.tags}
            selectedTagFilter={selectedTagFilter}
            onClose={() => setLeftSidebarOpen(false)}
            {...sidebarHandlers}
          />
        </>
      )}

      {/* Center Workspace: Editor / Global Graph / Split */}
      <main className="workspace-center">
        <header className="workspace-topbar">
          <div className="topbar-left-cluster">
            <button
              type="button"
              className={`topbar-sidebar-toggle ${leftSidebarOpen ? 'active' : ''}`}
              onClick={() => setLeftSidebarOpen((o) => !o)}
              title="Linke Leiste (Dateibaum & Suche) ein-/ausblenden (Ctrl+B)"
              aria-label="Linke Leiste umschalten"
            >
              <PanelLeft size={16} />
            </button>
            <div className="topbar-brand">
              <img src="/basalt-logo.svg" alt="Basalt" style={{ width: 20, height: 20 }} />
              <span className="topbar-brand-title">Basalt</span>
              <span className="topbar-vault-badge">{vaultPath ? vaultPath.split('/').filter(Boolean).pop() : 'Vault'}</span>
            </div>
          </div>
          <div className="topbar-breadcrumbs">
            {workspaceView === 'graph' ? (
              <span className="breadcrumb-active">
                <GitFork size={15} /> Wissensgraph (Alle Verknüpfungen)
              </span>
            ) : activeNote ? (
              <>
                <span className="breadcrumb-path">{activeNote.path}</span>
                <span className={`save-indicator ${saveState}`}>
                  {saveState === 'saved' && (
                    <>
                      <Check size={12} /> Gespeichert
                    </>
                  )}
                  {saveState === 'saving' && 'Speichere...'}
                  {saveState === 'dirty' && 'Ungespeichert'}
                </span>
              </>
            ) : (
              <span>Keine Notiz ausgewählt</span>
            )}
          </div>

          <div className="topbar-controls">
            {workspaceView !== 'graph' && activeNote && (
              <>
                <button
                  type="button"
                  className="topbar-action-btn"
                  onClick={handleUploadImageClick}
                  title="Bild oder Anhang in den Vault hochladen & einbetten"
                >
                  <ImagePlus size={15} />
                  <span>Bild einfügen</span>
                </button>

                <div className="editor-mode-switcher" role="group" aria-label="Editor-Modus">
                  <button
                    type="button"
                    className={`mode-btn ${editorMode === 'live' ? 'active' : ''}`}
                    onClick={() => setEditorMode('live')}
                    title="Obsidian Live-Preview (Syntax nur in aktiver Zeile)"
                  >
                    <Eye size={14} />
                    <span>Live-Preview</span>
                  </button>
                  <button
                    type="button"
                    className={`mode-btn ${editorMode === 'reading' ? 'active' : ''}`}
                    onClick={() => setEditorMode('reading')}
                    title="Lese-Ansicht (Komplett gerendert)"
                  >
                    <BookOpen size={14} />
                    <span>Lesen</span>
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
                    title="Quellcode-Modus (Inkl. Roh-Markdown/YAML)"
                  >
                    <Code2 size={14} />
                    <span>Quellcode</span>
                  </button>
                </div>
              </>
            )}

            <button
              type="button"
              className={`topbar-graph-toggle ${workspaceView === 'graph' ? 'active' : ''}`}
              onClick={() =>
                setWorkspaceView((v) => (v === 'graph' ? 'editor' : 'graph'))
              }
            >
              <GitFork size={15} />
              <span>{workspaceView === 'graph' ? 'Zurück zur Notiz' : 'Graph-Ansicht'}</span>
            </button>

            <button
              type="button"
              className="topbar-action-btn"
              onClick={() => setCommandPaletteOpen(true)}
              title="Befehlspalette öffnen (Strg+P)"
            >
              <Terminal size={15} />
              <span>Befehle</span>
            </button>

            {/* Sync & Settings */}
            <div className="topbar-sync-settings">
              <button
                type="button"
                className={`topbar-sync-indicator status-${syncState}`}
                onClick={() => setSettingsOpen(true)}
                title={`Verbindungs- und Sync-Status: ${
                  syncState === 'synced'
                    ? 'Synchronisiert'
                    : syncState === 'offline'
                    ? 'Offline-Modus'
                    : syncState === 'syncing'
                    ? 'Synchronisiere...'
                    : syncState === 'conflict'
                    ? 'Konflikt vorhanden'
                    : 'Online'
                }`}
              >
                <span className={`sync-status-dot ${syncState}`} />
                <span className="sync-status-text">
                  {syncState === 'synced' && 'Synchronisiert'}
                  {syncState === 'syncing' && 'Sync...'}
                  {syncState === 'offline' && 'Offline'}
                  {syncState === 'conflict' && 'Konflikt'}
                  {syncState === 'online' && 'Online'}
                </span>
              </button>

              <button
                type="button"
                className="topbar-settings-btn"
                onClick={() => setSettingsOpen(true)}
                title="Einstellungen & Farb-Themes (Zahnrad)"
              >
                <Settings size={16} />
              </button>

              <button
                type="button"
                className={`topbar-sidebar-toggle ${rightSidebarOpen ? 'active' : ''}`}
                onClick={() => setRightSidebarOpen((o) => !o)}
                title="Rechte Leiste (Backlinks, Gliederung & Graph) ein-/ausblenden (Ctrl+J)"
                aria-label="Rechte Leiste umschalten"
              >
                <PanelRight size={16} />
              </button>
            </div>
          </div>
        </header>

        <div className={`workspace-panes view-${workspaceView}`}>
          {(workspaceView === 'editor' || workspaceView === 'split') && (
            <section className="editor-pane scroller">
              {activeNote ? (
                <div className="note-document-container">
                  <div className="note-title-row">
                    <h1
                      className="note-inline-title"
                      title="Klicken zum Umbenennen"
                      onClick={() => {
                        setDialog({
                          type: 'rename',
                          targetPath: activeNote.path,
                          initialValue: activeNote.name,
                        });
                        setDialogInput(activeNote.name);
                      }}
                    >
                      {activeNote.name}
                    </h1>
                  </div>

                  {/* Visual Frontmatter Properties UI (No raw YAML shown!) */}
                  {editorMode !== 'source' && (
                    <PropertiesEditor
                      properties={activeNote.properties}
                      allTags={allTagNames}
                      onChange={handlePropertiesChange}
                      onTagClick={(tag) => {
                        setSelectedTagFilter(tag.replace(/^#+/, ''));
                        setLeftSidebarOpen(true);
                      }}
                    />
                  )}

                  {/* Mobile / Touch Markdown Formatting Toolbar */}
                  {editorMode !== 'reading' && (
                    <EditorToolbar
                      editorRef={editorRef}
                      onUploadImage={handleUploadImageFile}
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
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      setDialog({
                        type: 'create-note',
                        initialValue: 'Neue Notiz',
                      });
                      setDialogInput('Neue Notiz');
                    }}
                  >
                    + Neue Notiz erstellen
                  </button>
                </div>
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

      {/* Right Sidebar: Backlinks, Outline (Gliederung), and Local Graph */}
      {rightSidebarOpen && (
        <>
          <div
            className="mobile-drawer-backdrop right-backdrop"
            onClick={() => setRightSidebarOpen(false)}
            aria-hidden="true"
          />
          <aside className="right-sidebar">
          <div className="sidebar-tabs">
            <button
              type="button"
              className={`sidebar-tab-btn ${rightTab === 'backlinks' ? 'active' : ''}`}
              onClick={() => setRightTab('backlinks')}
              title="Backlinks & Erwähnungen"
            >
              <Link2 size={15} />
              <span>Backlinks ({linkedMentions.length})</span>
            </button>
            <button
              type="button"
              className={`sidebar-tab-btn ${rightTab === 'outline' ? 'active' : ''}`}
              onClick={() => setRightTab('outline')}
              title="Gliederung der Notiz"
            >
              <ListTree size={15} />
              <span>Gliederung</span>
            </button>
            <button
              type="button"
              className={`sidebar-tab-btn ${rightTab === 'local-graph' ? 'active' : ''}`}
              onClick={() => setRightTab('local-graph')}
              title="Lokaler Graph"
            >
              <GitFork size={15} />
              <span>Graph</span>
            </button>
            <button
              type="button"
              className="sidebar-tab-btn close-sidebar-btn"
              onClick={() => setRightSidebarOpen(false)}
              title="Rechte Leiste schließen"
              aria-label="Rechte Leiste schließen"
            >
              <X size={15} />
            </button>
          </div>

          {rightTab === 'backlinks' && (
            <div className="right-sidebar-content scroller">
              <div className="backlinks-section">
                <h3 className="right-section-title">
                  Verlinkte Erwähnungen ({linkedMentions.length})
                </h3>
                {linkedMentions.length === 0 ? (
                  <p className="sidebar-empty-hint">
                    Keine anderen Notizen verlinken direkt auf diese Notiz.
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
                  Unverlinkte Erwähnungen ({unlinkedMentions.length})
                </h3>
                {unlinkedMentions.length === 0 ? (
                  <p className="sidebar-empty-hint">
                    Keine unverlinkten Text-Erwähnungen gefunden.
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
              <h3 className="right-section-title">Gliederung</h3>
              {!activeNote || activeNote.headings.length === 0 ? (
                <p className="sidebar-empty-hint">
                  Keine Überschriften (# H1–H6) in dieser Notiz.
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

      {/* Bottom Obsidian Status Bar */}
      <footer className="obsidian-statusbar">
        <div className="statusbar-left">
          <span className="status-item" title="Verschlüsselte Verbindung">
            <Lock size={12} />
            {httpsActive ? 'HTTPS / TLS aktiv' : 'HTTP'}
          </span>
          <span
            className={`status-item ${wsConnected ? 'sync-online' : 'sync-offline'}`}
            title="Live File-Watcher (Chokidar + WebSockets)"
          >
            <Radio size={12} />
            {wsConnected ? 'Live-Vault-Sync aktiv' : 'Verbinde Watcher...'}
          </span>
        </div>

        <div className="statusbar-right">
          {activeNote && (
            <>
              <span className="status-item">
                { currentBacklinks.length } Backlinks
              </span>
              <span className="status-item">{wordCount} Wörter</span>
              <span className="status-item">
                {activeNote.body.length} Zeichen
              </span>
            </>
          )}
          <span className="status-item">
            {allNotesForEditor.length} Notizen im Vault
          </span>
        </div>
      </footer>

      {/* Modal Dialog for Create / Rename / Delete */}
      {dialog && (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>
              {dialog.type === 'create-note' && 'Neue Notiz erstellen'}
              {dialog.type === 'create-folder' && 'Neuen Ordner erstellen'}
              {dialog.type === 'rename' && 'Eintrag umbenennen'}
              {dialog.type === 'delete' && 'Eintrag löschen'}
            </h3>

            <form onSubmit={handleDialogConfirm}>
              {dialog.type === 'delete' ? (
                <p className="modal-confirm-text">
                  Möchtest du <strong>{dialog.initialValue}</strong> wirklich unwiderruflich aus
                  dem Vault löschen?
                </p>
              ) : (
                <>
                  {dialog.parentFolder && (
                    <p className="modal-subfolder-hint">
                      Ordner: <code>{dialog.parentFolder}/</code>
                    </p>
                  )}
                  <input
                    type="text"
                    className="modal-input"
                    value={dialogInput}
                    onChange={(e) => setDialogInput(e.target.value)}
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
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className={dialog.type === 'delete' ? 'btn-danger' : 'btn-primary'}
                >
                  {dialog.type === 'delete' ? 'Löschen' : 'Bestätigen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mobile backdrop to dismiss drawer sidebars when clicking outside */}
      {(leftSidebarOpen || rightSidebarOpen) && (
        <div
          className="mobile-sidebar-backdrop"
          onClick={() => {
            setLeftSidebarOpen(false);
            setRightSidebarOpen(false);
          }}
          aria-hidden="true"
        />
      )}

      {/* Settings Modal (Theme, Security, Profiles, Sync) */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentTheme={theme}
        onThemeChange={(newTheme) => setTheme(newTheme)}
        fileTree={tree}
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
