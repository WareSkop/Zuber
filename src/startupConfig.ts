import { syncEngine } from './sync/syncEngine';

export type StartupBehavior = 'last' | 'daily' | 'specific';

export interface StartupConfig {
  behavior: StartupBehavior; // Standard: 'last'
  specificNotePath?: string; // Relativer Pfad für 'specific'
  dailyFolder?: string;      // Optionaler Zielordner für 'daily' (z.B. "" oder "Tägliche Notizen")
}

export interface DailyNoteConfig {
  dailyFolder: string;          // Zielordner (z. B. "Tägliche Notizen" oder "" für Root)
  templatePath?: string;        // Relativer Pfad zur Template-Datei (z. B. "Templates/Daily.md")
}

export const STARTUP_CONFIG_KEY = 'zuber_startup_config';
export const LAST_ACTIVE_NOTE_KEY = 'zuber_last_active_note';
export const DAILY_NOTE_CONFIG_KEY = 'zuber_daily_config';
export const MOBILE_READING_DEFAULT_KEY = 'zuber_mobile_reading_default';

export function getMobileReadingDefault(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const val = localStorage.getItem(MOBILE_READING_DEFAULT_KEY);
    if (val === null) return true;
    return val !== 'false';
  } catch {
    return true;
  }
}

export function setMobileReadingDefault(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MOBILE_READING_DEFAULT_KEY, enabled ? 'true' : 'false');
  } catch {}
}

export const DEFAULT_STARTUP_CONFIG: StartupConfig = {
  behavior: 'last',
  dailyFolder: '',
};

export const DEFAULT_DAILY_NOTE_CONFIG: DailyNoteConfig = {
  dailyFolder: '',
  templatePath: '',
};

export function getStartupConfig(): StartupConfig {
  if (typeof window === 'undefined') return DEFAULT_STARTUP_CONFIG;
  try {
    const raw = localStorage.getItem(STARTUP_CONFIG_KEY) || localStorage.getItem('knowmesh_startup_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.behavior === 'last' || parsed.behavior === 'daily' || parsed.behavior === 'specific')) {
        return { ...DEFAULT_STARTUP_CONFIG, ...parsed };
      }
    }
  } catch {}
  return DEFAULT_STARTUP_CONFIG;
}

export function saveStartupConfig(config: StartupConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STARTUP_CONFIG_KEY, JSON.stringify(config));
  } catch {}
}

export function getDailyNoteConfig(): DailyNoteConfig {
  if (typeof window === 'undefined') return DEFAULT_DAILY_NOTE_CONFIG;
  try {
    const raw =
      localStorage.getItem(DAILY_NOTE_CONFIG_KEY) ||
      localStorage.getItem('knowmesh_daily_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          dailyFolder: typeof parsed.dailyFolder === 'string' ? parsed.dailyFolder : '',
          templatePath: typeof parsed.templatePath === 'string' ? parsed.templatePath : '',
        };
      }
    }
  } catch {}
  // Fallback to startup config's dailyFolder if present
  const startup = getStartupConfig();
  if (startup.dailyFolder) {
    return { dailyFolder: startup.dailyFolder, templatePath: '' };
  }
  return DEFAULT_DAILY_NOTE_CONFIG;
}

export function saveDailyNoteConfig(config: DailyNoteConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DAILY_NOTE_CONFIG_KEY, JSON.stringify(config));
    // Keep startupConfig.dailyFolder in sync
    const startup = getStartupConfig();
    if (startup.dailyFolder !== config.dailyFolder) {
      saveStartupConfig({ ...startup, dailyFolder: config.dailyFolder });
    }
  } catch {}
}

export function recordLastActiveNote(notePath: string): void {
  if (typeof window === 'undefined' || !notePath) return;
  try {
    localStorage.setItem(LAST_ACTIVE_NOTE_KEY, notePath);
  } catch {}
}

export function clearLastActiveNote(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(LAST_ACTIVE_NOTE_KEY);
    localStorage.removeItem('knowmesh_last_active_note');
  } catch {}
}

export function findDailyNoteFile<
  T extends { path: string; extension?: string; basename?: string }
>(files: T[], dailyFolder: string, datePrefix: string): T | undefined {
  const targetDailyFolder = (dailyFolder || '')
    .trim()
    .replace(/^[/\\]+|[/\\]+$/g, '');
  const targetLower = targetDailyFolder.toLowerCase();

  return files.find((f) => {
    if (f.extension !== undefined && f.extension !== 'md') return false;
    const rawDir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    const noteFolder = rawDir.replace(/^[/\\]+|[/\\]+$/g, '');
    const noteFolderLower = noteFolder.toLowerCase();

    if (noteFolderLower !== targetLower) return false;

    // Extra safeguard: never match Inbox items unless Inbox was explicitly configured as dailyFolder
    if (
      targetLower !== 'inbox' &&
      (noteFolderLower === 'inbox' || noteFolderLower.startsWith('inbox/'))
    ) {
      return false;
    }

    const fname =
      f.basename || (f.path.includes('/') ? f.path.slice(f.path.lastIndexOf('/') + 1) : f.path);
    return fname.slice(0, 10) === datePrefix;
  });
}

export async function resolveStartupNotePath(
  files: { path: string; extension: string; basename?: string }[]
): Promise<string | null> {
  const mdFiles = files.filter((f) => f.extension === 'md');
  if (mdFiles.length === 0) return null;

  const config = getStartupConfig();

  // 1. Specific note behavior
  if (config.behavior === 'specific' && config.specificNotePath) {
    const target = mdFiles.find((f) => f.path === config.specificNotePath);
    if (target) return target.path;
  }

  // 2. Daily note behavior (strict folder-scoped 10-char prefix search & template support)
  if (config.behavior === 'daily') {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const dailyConfig = getDailyNoteConfig();
    const folder = (dailyConfig.dailyFolder || config.dailyFolder || '')
      .trim()
      .replace(/^[/\\]+|[/\\]+$/g, '');

    const existing = findDailyNoteFile(mdFiles, folder, dateStr);

    if (existing) {
      return existing.path;
    }

    // Auto-create today's note if it does not exist
    const fileName = `${dateStr}.md`;
    const dailyPath = folder ? `${folder}/${fileName}` : fileName;

    let initialBody = `# ${dateStr}\n\n`;
    let initialProps: any[] = [
      { key: 'tags', type: 'list', value: ['daily'] },
      { key: 'erstellt', type: 'date', value: dateStr },
    ];

    if (dailyConfig.templatePath) {
      try {
        const templateNote = await syncEngine.getNote(dailyConfig.templatePath);
        if (templateNote) {
          const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
          const replacePlaceholders = (text: string) =>
            text.replace(/\{\{date\}\}/gi, dateStr).replace(/\{\{time\}\}/gi, timeStr);

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
        console.warn('[Zuber] Failed to load daily startup template:', err);
      }
    }

    try {
      const created = await syncEngine.saveNote({
        path: dailyPath,
        body: initialBody,
        properties: initialProps,
      });
      return created.path;
    } catch (err) {
      console.warn('[Zuber] Failed to auto-create daily startup note:', err);
    }
  }

  // 3. Last opened note behavior (default)
  if (config.behavior === 'last') {
    try {
      const last = localStorage.getItem(LAST_ACTIVE_NOTE_KEY) || localStorage.getItem('knowmesh_last_active_note');
      if (last) {
        const found = mdFiles.find((f) => f.path === last);
        if (found) return found.path;
      }
    } catch {}
  }

  // 4. Fallback: Note with "willkommen" / "welcome" or first markdown note
  const welcome = mdFiles.find((f) => {
    const b = (f.basename || f.path).toLowerCase();
    return b.includes('willkommen') || b.includes('welcome');
  });
  return (welcome || mdFiles[0]).path;
}
