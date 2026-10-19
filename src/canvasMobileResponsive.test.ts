import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Knowmesh Mobile Canvas & Responsive Toolbar Verification', () => {
  const stylesPath = path.resolve(__dirname, 'styles.css');
  const canvasToolbarPath = path.resolve(__dirname, 'components/canvas/CanvasToolbar.tsx');
  const canvasInspectorPath = path.resolve(__dirname, 'components/canvas/CanvasInspector.tsx');
  const canvasEditorPath = path.resolve(__dirname, 'components/canvas/CanvasEditor.tsx');
  const appPath = path.resolve(__dirname, 'App.tsx');

  const stylesContent = fs.readFileSync(stylesPath, 'utf-8');
  const canvasToolbarContent = fs.readFileSync(canvasToolbarPath, 'utf-8');
  const canvasInspectorContent = fs.readFileSync(canvasInspectorPath, 'utf-8');
  const canvasEditorContent = fs.readFileSync(canvasEditorPath, 'utf-8');
  const appContent = fs.readFileSync(appPath, 'utf-8');

  describe('Part 1: Canvas Toolbar & Inner Group Wrapping on Narrow Screens', () => {
    it('allows toolbar and inner button groups to wrap cleanly without overflowing 360px viewports', () => {
      // Toolbar group wrapping
      const groupMatch = stylesContent.match(/\.canvas-toolbar-group\s*\{([^}]+)\}/);
      expect(groupMatch).not.toBeNull();
      expect(groupMatch![1]).toContain('flex-wrap: wrap !important;');
      expect(groupMatch![1]).toContain('max-width: 100% !important;');

      // Toolbar boundary containment
      const toolbarMatch = stylesContent.match(/\.canvas-toolbar,\s*\.canvas-dock-toolbar\s*\{([^}]+)\}/);
      expect(toolbarMatch).not.toBeNull();
      expect(toolbarMatch![1]).toContain('left: 12px;');
      expect(toolbarMatch![1]).toContain('right: 12px;');
      expect(toolbarMatch![1]).toContain('margin: 0 auto;');
      expect(toolbarMatch![1]).toContain('max-width: calc(100% - 24px) !important;');
    });

    it('enforces dropdown menus and file picker to never exceed viewport width', () => {
      expect(stylesContent).toContain('.canvas-dropdown-menu');
      expect(stylesContent).toContain('max-width: calc(100vw - 24px) !important;');
      expect(stylesContent).toContain('.canvas-file-picker-menu');
      expect(stylesContent).toContain('.inspector-dropdown-menu');
    });

    it('clamps dropdown popovers within container and viewport in CanvasToolbar.tsx', () => {
      expect(canvasToolbarContent).toContain('dropdownRef');
      expect(canvasToolbarContent).toContain('containerRect.left + 12');
      expect(canvasToolbarContent).toContain('containerRect.right - 12');
      expect(canvasToolbarContent).toContain('window.innerWidth - 8');
      expect(canvasToolbarContent).toContain('requestAnimationFrame(clamp)');
    });
  });

  describe('Part 2: Bottom Floating Inspector & Collision Avoidance', () => {
    it('wraps floating inspector content and sets safe horizontal centering', () => {
      const inspectorMatch = stylesContent.match(/\.canvas-inspector,\s*\.canvas-selection-toolbar\s*\{([^}]+)\}/);
      expect(inspectorMatch).not.toBeNull();
      expect(inspectorMatch![1]).toContain('flex-wrap: wrap !important;');
      expect(inspectorMatch![1]).toContain('left: 12px;');
      expect(inspectorMatch![1]).toContain('right: 12px;');
      expect(inspectorMatch![1]).toContain('margin: 0 auto;');
      expect(inspectorMatch![1]).toContain('max-width: calc(100% - 24px) !important;');

      const rowMatch = stylesContent.match(/\.inspector-content-row\s*\{([^}]+)\}/);
      expect(rowMatch).not.toBeNull();
      expect(rowMatch![1]).toContain('flex-wrap: wrap !important;');
    });

    it('clamps inspector popovers within viewport bounds in CanvasInspector.tsx', () => {
      expect(canvasInspectorContent).toContain('popoverRef');
      expect(canvasInspectorContent).toContain('window.innerWidth - 8');
      expect(canvasInspectorContent).toContain('requestAnimationFrame(clampPopover)');
    });

    it('moves React Flow controls up when selection is active to avoid overlapping bottom inspector', () => {
      expect(stylesContent).toContain('.has-selection .canvas-rf-controls');
      expect(stylesContent).toContain('bottom: 76px !important;');
      expect(canvasEditorContent).toContain('canvas-editor-wrapper ${selectedNode || selectedEdge ? \'has-selection\' : \'\'}');
    });
  });

  describe('Part 3: Mobile Touch (< 768px) Rules for Canvas', () => {
    it('hides minimap and divider and raises zoom controls on mobile screens', () => {
      const canvasMobileIndex = stylesContent.indexOf('/* Canvas Mobile & Responsive Adjustments (< 768px) */');
      expect(canvasMobileIndex).toBeGreaterThan(-1);
      const mobileRules = stylesContent.slice(canvasMobileIndex);

      expect(mobileRules).toContain('.canvas-toolbar-divider');
      expect(mobileRules).toContain('display: none !important;');

      expect(mobileRules).toContain('.react-flow__minimap,');
      expect(mobileRules).toContain('.canvas-rf-minimap');

      expect(mobileRules).toContain('.react-flow__controls,');
      expect(mobileRules).toContain('.canvas-rf-controls');
      expect(mobileRules).toContain('bottom: 76px !important;');
      expect(mobileRules).toContain('left: 10px !important;');

      expect(mobileRules).toContain('.inspector-edge-input');
      expect(mobileRules).toContain('min-width: 90px;');
      expect(mobileRules).toContain('max-width: 130px;');
    });
  });

  describe('Part 4: Compact Mobile Header & Save Status Badge (< 600px)', () => {
    it('renders mobile sync icon and provides desktop hide rule', () => {
      expect(stylesContent).toContain('.sync-status-icon-mobile {\n  display: none;\n}');
      expect(appContent).toContain('className="sync-status-icon-mobile"');
      expect(appContent).toContain("syncState === 'synced' ? '✓'");
    });

    it('shows compact check icon and hides text in header on narrow viewports', () => {
      const smallMedia = stylesContent.match(/@media\s*\(max-width:\s*600px\)\s*\{([\s\S]*?)\n\}/);
      expect(smallMedia).not.toBeNull();
      const smallRules = smallMedia![1];

      expect(smallRules).toContain('.topbar-sync-indicator .sync-status-text {\n    display: none !important;\n  }');
      expect(smallRules).toContain('.topbar-sync-indicator .sync-status-icon-mobile {\n    display: inline-block;');
      expect(smallRules).toContain('.canvas-mode-indicator span {\n    display: none;\n  }');
      expect(smallRules).toContain('.topbar-breadcrumbs');
      expect(smallRules).toContain('max-width: 120px;');
    });
  });
});
