/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

describe('Editor Shortcut CTRL+. & Canvas Edge Layering', () => {
  describe('1. CTRL+. Date & Timestamp Shortcut', () => {
    it('formats timestamp as YYYY-MM-DD HH:mm:ss', () => {
      const fixedDate = new Date(2026, 9, 26, 20, 45, 0); // Month is 0-indexed: 9 = October
      const pad = (n: number) => String(n).padStart(2, '0');
      const timestamp = `${fixedDate.getFullYear()}-${pad(fixedDate.getMonth() + 1)}-${pad(fixedDate.getDate())} ${pad(fixedDate.getHours())}:${pad(fixedDate.getMinutes())}:${pad(fixedDate.getSeconds())}`;

      expect(timestamp).toBe('2026-10-26 20:45:00');
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('replaces selection with timestamp and advances cursor directly after it', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 9, 26, 20, 45, 0));

      const runTimestampShortcut = (view: EditorView) => {
        const d = new Date();
        const p = (n: number) => String(n).padStart(2, '0');
        const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        view.dispatch(view.state.replaceSelection(ts));
        return true;
      };

      const expectedTimestamp = '2026-10-26 20:45:00';

      const parent = document.createElement('div');
      const state = EditorState.create({
        doc: 'Hello world',
        selection: { anchor: 6, head: 11 }, // selects 'world'
      });

      const view = new EditorView({ state, parent });
      const handled = runTimestampShortcut(view);

      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe(`Hello ${expectedTimestamp}`);
      // Selection cursor should be directly at 6 + timestamp length
      expect(view.state.selection.main.head).toBe(6 + expectedTimestamp.length);

      view.destroy();
      vi.useRealTimers();
    });

    it('verifies LivePreviewEditor.tsx includes Prec.highest and Mod-. binding', () => {
      const editorFile = path.resolve(__dirname, 'components/LivePreviewEditor.tsx');
      const content = fs.readFileSync(editorFile, 'utf-8');

      expect(content).toContain("key: 'Mod-.'");
      expect(content).toContain('Prec.highest');
      expect(content).toContain('view.state.replaceSelection(timestamp)');
    });
  });

  describe('2. Canvas Layering & ReactFlow Stacking Hierarchy', () => {
    it('verifies CanvasEditor.tsx configures elevateEdgesOnSelect={false} and elevateNodesOnSelect={true}', () => {
      const canvasFile = path.resolve(__dirname, 'components/canvas/CanvasEditor.tsx');
      const content = fs.readFileSync(canvasFile, 'utf-8');

      expect(content).toContain('elevateEdgesOnSelect={false}');
      expect(content).toContain('elevateNodesOnSelect={true}');
    });

    it('verifies src/styles.css enforces strict z-index strata for canvas nodes and edges', () => {
      const cssFile = path.resolve(__dirname, 'styles.css');
      const content = fs.readFileSync(cssFile, 'utf-8');

      // Group nodes at bottom (z-index: 0)
      expect(content).toMatch(/\.react-flow__node-canvasGroup[\s\S]*?z-index:\s*0\s*!important/);

      // Edges above groups but behind content nodes (z-index: 10)
      expect(content).toMatch(/\.react-flow__edges[\s\S]*?z-index:\s*10\s*!important/);

      // Content nodes above edges (z-index: 20)
      expect(content).toMatch(/\.react-flow__node:not\(\.react-flow__node-canvasGroup\)[\s\S]*?z-index:\s*20\s*!important/);

      // Selected content nodes higher (z-index: 25)
      expect(content).toMatch(/\.react-flow__node:not\(\.react-flow__node-canvasGroup\)[\s\S]*?\.selected[\s\S]*?z-index:\s*25\s*!important/);

      // Handles and resize controls topmost (z-index: 30)
      expect(content).toMatch(/\.react-flow__handle[\s\S]*?z-index:\s*30\s*!important/);
    });

    it('verifies CanvasShapeNode renders an opaque base background to prevent edge lines shining through', () => {
      const shapeNodeFile = path.resolve(__dirname, 'components/canvas/nodes/CanvasShapeNode.tsx');
      const geometryFile = path.resolve(__dirname, 'components/canvas/nodes/canvasShapeGeometry.tsx');
      const content = fs.readFileSync(shapeNodeFile, 'utf-8');
      const geometryContent = fs.readFileSync(geometryFile, 'utf-8');

      // Opaque base fill definition
      expect(content).toContain("const baseFill = 'var(--bg-secondary, #1e293b)'");
      // All shapes render baseFill under tint
      expect(geometryContent).toContain('fill={baseFill}');
    });
  });
});
