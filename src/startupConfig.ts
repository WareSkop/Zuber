import { syncEngine } from './sync/syncEngine';

export type StartupBehavior = 'last' | 'daily' | 'specific';

export interface StartupConfig {
  behavior: StartupBehavior; // Standard: 'last'
  specificNotePath?: string; // Relativer Pfad für 'specific'
  dailyFolder?: string;      // Optionaler Zielordner für 'daily' (z.B. "" oder "Tägliche Notizen")
}

export const STARTUP_CONFIG_KEY = 'knowmesh_startup_config';
export const LAST_ACTIVE_NOTE_KEY = 'knowmesh_last_active_note';

export const DEFAULT_STARTUP_CONFIG: StartupConfig = {
  behavior: 'last',
  dailyFolder: '',
};

export function getStartupConfig(): StartupConfig {
  if (typeof window === 'undefined') return DEFAULT_STARTUP_CONFIG;
  try {
    const raw = localStorage.getItem(STARTUP_CONFIG_KEY);
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

export function recordLastActiveNote(notePath: string): void {
  if (typeof window === 'undefined' || !notePath) return;
  try {
    localStorage.setItem(LAST_ACTIVE_NOTE_KEY, notePath);
  } catch {}
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

  // 2. Daily note behavior
  if (config.behavior === 'daily') {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const fileName = `${dateStr}.md`;
    const folder = (config.dailyFolder || '').trim().replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');
    const dailyPath = folder ? `${folder}/${fileName}` : fileName;

    const existing = mdFiles.find((f) => f.path.toLowerCase() === dailyPath.toLowerCase());
    if (existing) {
      return existing.path;
    }

    // Auto-create today's note if it does not exist
    try {
      const created = await syncEngine.saveNote({
        path: dailyPath,
        body: `# ${dateStr}\n\n`,
        properties: [
          { key: 'tags', type: 'list', value: ['daily'] },
          { key: 'erstellt', type: 'date', value: dateStr },
        ],
      });
      return created.path;
    } catch (err) {
      console.warn('[Knowmesh] Failed to auto-create daily startup note:', err);
    }
  }

  // 3. Last opened note behavior (default)
  if (config.behavior === 'last') {
    try {
      const last = localStorage.getItem(LAST_ACTIVE_NOTE_KEY);
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
