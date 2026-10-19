import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Knowmesh Phase 4 - Canvas Responsive Toolbar, Resize Hit-Areas & Theme Adaptation', () => {
  const stylesPath = path.resolve(__dirname, 'styles.css');
  const graphViewPath = path.resolve(__dirname, 'components/GraphView.tsx');
  const canvasToolbarPath = path.resolve(__dirname, 'components/canvas/CanvasToolbar.tsx');
  const canvasEditorPath = path.resolve(__dirname, 'components/canvas/CanvasEditor.tsx');

  const stylesContent = fs.readFileSync(stylesPath, 'utf-8');
  const graphViewContent = fs.readFileSync(graphViewPath, 'utf-8');
  const canvasToolbarContent = fs.readFileSync(canvasToolbarPath, 'utf-8');
  const canvasEditorContent = fs.readFileSync(canvasEditorPath, 'utf-8');

  describe('Part 1: Responsive Canvas Top Toolbar & Boundary Clamping', () => {
    it('constrains .canvas-toolbar to container width and allows clean flex wrapping', () => {
      expect(stylesContent).toContain('max-width: calc(100% - 24px) !important;');
      expect(stylesContent).toContain('flex-wrap: wrap !important;');
      expect(stylesContent).toContain('width: max-content;');
      expect(stylesContent).toContain('justify-content: center;');
      // Must not use 100vw for toolbar max-width since sidebars narrow the canvas container
      const toolbarSection = stylesContent.match(/\.canvas-toolbar,\s*\.canvas-dock-toolbar\s*\{([^}]+)\}/);
      expect(toolbarSection).not.toBeNull();
      expect(toolbarSection![1]).not.toContain('100vw');
    });

    it('clamps canvas dropdown menus to prevent overflowing container bounds', () => {
      // styles.css constraint
      expect(stylesContent).toContain('max-width: min(340px, calc(100vw - 32px));');
      // CanvasToolbar.tsx dynamic boundary clamping effect
      expect(canvasToolbarContent).toContain('dropdownRef');
      expect(canvasToolbarContent).toContain('containerRect.right - 12');
      expect(canvasToolbarContent).toContain('containerRect.left + 12');
    });
  });

  describe('Part 2: 14px Node Resize Hit-Areas & Handle z-index for Linux/KDE/Chrome', () => {
    it('sets 14px width and height on resize handles with z-index 25', () => {
      expect(stylesContent).toContain('.react-flow__resize-control.handle');
      expect(stylesContent).toContain('.canvas-resizer-handle');
      expect(stylesContent).toMatch(/width:\s*14px\s*!important/);
      expect(stylesContent).toMatch(/height:\s*14px\s*!important/);
      expect(stylesContent).toMatch(/z-index:\s*25\s*!important/);
    });

    it('expands invisible hit-lines for edges to 14px thickness with z-index 20', () => {
      expect(stylesContent).toContain('.react-flow__resize-control.line');
      expect(stylesContent).toContain('.canvas-resizer-line');
      expect(stylesContent).toMatch(/top:\s*-7px\s*!important/);
      expect(stylesContent).toMatch(/bottom:\s*-7px\s*!important/);
      expect(stylesContent).toMatch(/left:\s*-7px\s*!important/);
      expect(stylesContent).toMatch(/right:\s*-7px\s*!important/);
      expect(stylesContent).toMatch(/z-index:\s*20\s*!important/);
    });

    it('ensures connection handles sit at z-index 30 above resizer lines', () => {
      const handleMatch = stylesContent.match(/\.canvas-handle,\s*\.canvas-node-handle\s*\{([^}]+)\}/);
      expect(handleMatch).not.toBeNull();
      expect(handleMatch![1]).toContain('z-index: 30 !important;');
    });
  });

  describe('Part 3: Graph Controls & Search Bar Theme Adaptation', () => {
    it('uses CSS theme variables for graph toolbar panels and popover', () => {
      const toolbarMatch = stylesContent.match(/\.graph-toolbar-left,\s*\.graph-toolbar-right\s*\{([^}]+)\}/);
      expect(toolbarMatch).not.toBeNull();
      expect(toolbarMatch![1]).toContain('background: var(--bg-secondary);');
      expect(toolbarMatch![1]).not.toContain('rgba(24, 24, 37');

      const popoverMatch = stylesContent.match(/\.graph-controls-popover\s*\{([^}]+)\}/);
      expect(popoverMatch).not.toBeNull();
      expect(popoverMatch![1]).toContain('background: var(--bg-secondary);');
    });

    it('uses CSS theme variables for graph control rows and group rows', () => {
      const rowMatch = stylesContent.match(/\.graph-control-row\s*\{([^}]+)\}/);
      expect(rowMatch).not.toBeNull();
      expect(rowMatch![1]).toContain('background: var(--bg-primary);');

      const groupMatch = stylesContent.match(/\.graph-group-row\s*\{([^}]+)\}/);
      expect(groupMatch).not.toBeNull();
      expect(groupMatch![1]).toContain('background: var(--bg-primary);');
    });

    it('uses CSS theme variables for graph legend and dots', () => {
      const legendMatch = stylesContent.match(/\.graph-legend\s*\{([^}]+)\}/);
      expect(legendMatch).not.toBeNull();
      expect(legendMatch![1]).toContain('background: var(--bg-secondary);');

      expect(stylesContent).toContain('.legend-dot.note-dot {\n  background: var(--text-secondary, #9ca3af);\n}');
      expect(stylesContent).toContain('.legend-dot.active-dot {\n  background: var(--accent-color, #d4af37);\n}');
      expect(stylesContent).toContain('.legend-dot.tag-dot {\n  background: var(--accent-secondary, #29b6c8);\n}');
      expect(stylesContent).toContain('.legend-dot.unresolved-dot {\n  background: var(--text-muted, #8b949e);\n}');
    });

    it('queries document.documentElement for computed styles and observes theme changes in GraphView.tsx', () => {
      expect(graphViewContent).toContain('getComputedStyle(document.documentElement)');
      expect(graphViewContent).toContain('themeVersion');
      expect(graphViewContent).toContain('MutationObserver');
      expect(graphViewContent).toContain('spotlightBg');
    });
  });

  describe('Part 4: Canvas Inspector & Controls Theme Adaptation', () => {
    it('uses CSS theme variables for floating inspector and dropdowns without hardcoded dark background overrides', () => {
      const inspectorMatch = stylesContent.match(/\.canvas-floating-inspector\s*\{([^}]+)\}/);
      expect(inspectorMatch).not.toBeNull();
      expect(inspectorMatch![1]).toContain('background: var(--bg-secondary);');
      expect(inspectorMatch![1]).not.toContain('background-color: rgba(22, 27, 34');
      expect(inspectorMatch![1]).toContain('max-width: calc(100% - 32px);');

      const inspectorDropdownMatch = stylesContent.match(/\.inspector-dropdown-menu\s*\{([^}]+)\}/);
      expect(inspectorDropdownMatch).not.toBeNull();
      expect(inspectorDropdownMatch![1]).toContain('background: var(--bg-secondary);');
      expect(inspectorDropdownMatch![1]).not.toContain('background-color: rgba(22, 27, 34');
    });

    it('styles inspector inputs and buttons using theme variables', () => {
      const edgeInputMatch = stylesContent.match(/\.inspector-edge-input\s*\{([^}]+)\}/);
      expect(edgeInputMatch).not.toBeNull();
      expect(edgeInputMatch![1]).toContain('background: var(--bg-primary);');

      const gridItemMatch = stylesContent.match(/\.inspector-grid-item\s*\{([^}]+)\}/);
      expect(gridItemMatch).not.toBeNull();
      expect(gridItemMatch![1]).toContain('background: var(--bg-primary);');
    });

    it('styles React Flow Controls and MiniMap with theme variables', () => {
      expect(stylesContent).toContain('.canvas-rf-controls');
      expect(stylesContent).toContain('.canvas-rf-minimap');
      expect(stylesContent).toContain('.react-flow__minimap-mask');
      expect(stylesContent).toContain('.react-flow__minimap-node');

      expect(canvasEditorContent).toContain('className="canvas-rf-controls"');
      expect(canvasEditorContent).toContain('className="canvas-rf-minimap"');
      expect(canvasEditorContent).toContain('maskColor="var(--border-subtle, rgba(0, 0, 0, 0.45))"');
    });
  });
});
