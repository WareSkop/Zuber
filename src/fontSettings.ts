export interface DeviceFontSettings {
  uiFontSize: number;     // Menus, topbar, sidebars, buttons
  editorFontSize: number; // Note text, editor, reading view
}

export interface FontSettings {
  desktop: DeviceFontSettings;
  mobile: DeviceFontSettings;
}

export const FONT_SETTINGS_STORAGE_KEY = 'zuber_font_settings';

export const DEFAULT_FONT_SETTINGS: FontSettings = {
  desktop: {
    uiFontSize: 14,
    editorFontSize: 16,
  },
  mobile: {
    uiFontSize: 15,
    editorFontSize: 16,
  },
};

export function getFontSettings(): FontSettings {
  if (typeof window === 'undefined') return DEFAULT_FONT_SETTINGS;
  try {
    const raw = localStorage.getItem(FONT_SETTINGS_STORAGE_KEY) || localStorage.getItem('knowmesh_font_settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          desktop: {
            uiFontSize: clamp(Number(parsed.desktop?.uiFontSize) || DEFAULT_FONT_SETTINGS.desktop.uiFontSize, 10, 26),
            editorFontSize: clamp(Number(parsed.desktop?.editorFontSize) || DEFAULT_FONT_SETTINGS.desktop.editorFontSize, 10, 32),
          },
          mobile: {
            uiFontSize: clamp(Number(parsed.mobile?.uiFontSize) || DEFAULT_FONT_SETTINGS.mobile.uiFontSize, 10, 28),
            editorFontSize: clamp(Number(parsed.mobile?.editorFontSize) || DEFAULT_FONT_SETTINGS.mobile.editorFontSize, 10, 34),
          },
        };
      }
    }
  } catch {}
  return DEFAULT_FONT_SETTINGS;
}

export function saveFontSettings(settings: FontSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(FONT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

export function applyFontSettingsToDOM(settings: FontSettings, isMobile: boolean): void {
  if (typeof document === 'undefined') return;
  const activeConfig = isMobile ? settings.mobile : settings.desktop;
  document.documentElement.style.setProperty('--km-font-size-ui', `${activeConfig.uiFontSize}px`);
  document.documentElement.style.setProperty('--km-font-size-editor', `${activeConfig.editorFontSize}px`);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
