import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_FONT_SETTINGS,
  getFontSettings,
  saveFontSettings,
  applyFontSettingsToDOM,
  type FontSettings,
} from './fontSettings';

describe('Font Settings Module', () => {
  let mockStorage: Record<string, string> = {};
  let setPropertyCalls: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    setPropertyCalls = {};

    (globalThis as any).window = globalThis;
    (globalThis as any).localStorage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value;
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {
        mockStorage = {};
      },
    };

    (globalThis as any).document = {
      documentElement: {
        style: {
          setProperty: (prop: string, val: string) => {
            setPropertyCalls[prop] = val;
          },
        },
      },
    };
  });

  it('returns default font settings when nothing is stored', () => {
    const settings = getFontSettings();
    expect(settings).toEqual(DEFAULT_FONT_SETTINGS);
    expect(settings.desktop.uiFontSize).toBe(14);
    expect(settings.desktop.editorFontSize).toBe(16);
    expect(settings.mobile.uiFontSize).toBe(15);
    expect(settings.mobile.editorFontSize).toBe(16);
  });

  it('saves and loads custom font settings in localStorage', () => {
    const custom: FontSettings = {
      desktop: { uiFontSize: 16, editorFontSize: 18 },
      mobile: { uiFontSize: 17, editorFontSize: 20 },
    };
    saveFontSettings(custom);
    const loaded = getFontSettings();
    expect(loaded).toEqual(custom);
    expect(mockStorage['zuber_font_settings']).toBe(JSON.stringify(custom));
  });

  it('falls back to legacy knowmesh_font_settings when zuber_font_settings is not set', () => {
    const legacy: FontSettings = {
      desktop: { uiFontSize: 18, editorFontSize: 20 },
      mobile: { uiFontSize: 19, editorFontSize: 22 },
    };
    mockStorage['knowmesh_font_settings'] = JSON.stringify(legacy);
    const loaded = getFontSettings();
    expect(loaded).toEqual(legacy);
  });

  it('handles partial or corrupted localStorage data gracefully with fallback defaults', () => {
    mockStorage['zuber_font_settings'] = '{ invalid json';
    const settings = getFontSettings();
    expect(settings).toEqual(DEFAULT_FONT_SETTINGS);
  });

  it('applies desktop font size CSS variables to document.documentElement when isMobile=false', () => {
    const custom: FontSettings = {
      desktop: { uiFontSize: 15, editorFontSize: 18 },
      mobile: { uiFontSize: 17, editorFontSize: 21 },
    };
    applyFontSettingsToDOM(custom, false);
    expect(setPropertyCalls['--km-font-size-ui']).toBe('15px');
    expect(setPropertyCalls['--km-font-size-editor']).toBe('18px');
  });

  it('applies mobile font size CSS variables to document.documentElement when isMobile=true', () => {
    const custom: FontSettings = {
      desktop: { uiFontSize: 15, editorFontSize: 18 },
      mobile: { uiFontSize: 17, editorFontSize: 21 },
    };
    applyFontSettingsToDOM(custom, true);
    expect(setPropertyCalls['--km-font-size-ui']).toBe('17px');
    expect(setPropertyCalls['--km-font-size-editor']).toBe('21px');
  });
});
