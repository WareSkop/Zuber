/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('File Tree Context Menu Viewport Clamping & Styling', () => {
  describe('1. Viewport boundary clamping logic', () => {
    // Pure calculation function representing the useLayoutEffect clamping in FileSidebar.tsx
    function clampContextMenu(
      initialX: number,
      initialY: number,
      menuWidth: number,
      menuHeight: number,
      viewportWidth: number,
      viewportHeight: number,
      margin = 12
    ) {
      let newTop = initialY;
      let newLeft = initialX;

      if (newTop + menuHeight > viewportHeight - margin) {
        newTop = Math.max(margin, viewportHeight - menuHeight - margin);
      }

      if (newLeft + menuWidth > viewportWidth - margin) {
        newLeft = Math.max(margin, viewportWidth - menuWidth - margin);
      }

      return { top: newTop, left: newLeft };
    }

    it('keeps position unchanged when menu fits completely inside viewport', () => {
      const result = clampContextMenu(100, 150, 240, 400, 1920, 1080);
      expect(result.left).toBe(100);
      expect(result.top).toBe(150);
    });

    it('shifts menu upwards when it protrudes below bottom viewport edge', () => {
      // User clicks at y = 900 on a 1000px high viewport, menu is 450px high
      const result = clampContextMenu(50, 900, 240, 450, 1920, 1000, 12);
      // Expected newTop = 1000 - 450 - 12 = 538
      expect(result.top).toBe(538);
      expect(result.left).toBe(50);
      expect(result.top + 450).toBeLessThanOrEqual(1000 - 12);
    });

    it('shifts menu leftwards when it protrudes past right viewport edge', () => {
      // User clicks at x = 1800 on a 1920px wide viewport, menu is 240px wide
      const result = clampContextMenu(1800, 100, 240, 300, 1920, 1080, 12);
      // Expected newLeft = 1920 - 240 - 12 = 1668
      expect(result.left).toBe(1668);
      expect(result.top).toBe(100);
      expect(result.left + 240).toBeLessThanOrEqual(1920 - 12);
    });

    it('clamps to top/left margin when viewport is smaller than the menu', () => {
      // Small viewport: 300x300, menu is 350px tall
      const result = clampContextMenu(20, 200, 200, 350, 400, 300, 12);
      // Should not go into negative top; Math.max(12, ...) protects it
      expect(result.top).toBe(12);
    });
  });

  describe('2. FileSidebar.tsx implementation', () => {
    it('contains useLayoutEffect with getBoundingClientRect measurement for contextMenu', () => {
      const fileSidebarPath = path.resolve(__dirname, 'components/FileSidebar.tsx');
      const content = fs.readFileSync(fileSidebarPath, 'utf-8');

      expect(content).toContain('useLayoutEffect');
      expect(content).toContain('contextMenuRef.current.getBoundingClientRect()');
      expect(content).toContain('contextMenuRef.current.style.top =');
      expect(content).toContain('contextMenuRef.current.style.left =');
      expect(content).toContain('window.innerHeight - margin');
      expect(content).toContain('window.innerWidth - margin');
    });
  });

  describe('3. CSS styling rules in src/styles.css', () => {
    it('enforces fixed positioning, high z-index, max-height, and scrolling for context menu', () => {
      const stylesPath = path.resolve(__dirname, 'styles.css');
      const css = fs.readFileSync(stylesPath, 'utf-8');

      expect(css).toContain('.tree-context-menu');
      expect(css).toContain('.file-context-menu');
      expect(css).toContain('.sidebar-context-menu');
      expect(css).toMatch(/max-height:\s*calc\(100vh\s*-\s*24px\)\s*!important/);
      expect(css).toMatch(/overflow-y:\s*auto\s*!important/);
      expect(css).toMatch(/overscroll-behavior:\s*contain/);
      expect(css).toMatch(/z-index:\s*1200\s*!important/);
      expect(css).toMatch(/position:\s*fixed\s*!important/);
    });
  });
});
