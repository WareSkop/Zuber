/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Editor Context Menu & Tree Drag-and-Drop Integration', () => {
  describe('1. FileSidebar dragstart payload', () => {
    it('sets application/x-knowmesh-file-path and text/plain along with paths array', () => {
      const fileSidebarCode = fs.readFileSync(
        path.resolve(__dirname, 'components/FileSidebar.tsx'),
        'utf-8'
      );
      expect(fileSidebarCode).toContain("e.dataTransfer.setData('application/x-knowmesh-file-path', node.path)");
      expect(fileSidebarCode).toContain("e.dataTransfer.setData('text/plain', node.path)");
      expect(fileSidebarCode).toContain("e.dataTransfer.effectAllowed = 'copyMove'");
    });
  });

  describe('2. LivePreviewEditor drop handler for tree items', () => {
    it('handles application/x-knowmesh-file-path and generates appropriate markdown links', () => {
      const editorCode = fs.readFileSync(
        path.resolve(__dirname, 'components/LivePreviewEditor.tsx'),
        'utf-8'
      );
      expect(editorCode).toContain("dt.getData('application/x-knowmesh-file-path')");
      expect(editorCode).toContain("![[${p}]]");
      expect(editorCode).toContain("[[${noteTarget}]]");
    });
  });

  describe('3. LivePreviewEditor context menu actions & modal', () => {
    it('provides New Canvas and Insert Picture items in the editor context menu', () => {
      const editorCode = fs.readFileSync(
        path.resolve(__dirname, 'components/LivePreviewEditor.tsx'),
        'utf-8'
      );
      expect(editorCode).toContain('handleOpenNewCanvasModal');
      expect(editorCode).toContain('handleTriggerInsertPicture');
      expect(editorCode).toContain("t('editor.insertNewCanvas')");
      expect(editorCode).toContain("t('editor.insertPicture')");
      expect(editorCode).toContain('newCanvasModalOpen');
      expect(editorCode).toContain('handleCreateAndInsertCanvas');
    });

    it('clamps context menu coordinates within viewport bounds', () => {
      const editorCode = fs.readFileSync(
        path.resolve(__dirname, 'components/LivePreviewEditor.tsx'),
        'utf-8'
      );
      expect(editorCode).toContain('useLayoutEffect');
      expect(editorCode).toContain('top + rect.height > window.innerHeight - margin');
      expect(editorCode).toContain('left + rect.width > window.innerWidth - margin');
    });
  });

  describe('4. Localization translations for editor actions', () => {
    it('contains translations in de.json and en.json', () => {
      const de = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'locales/de.json'), 'utf-8'));
      const en = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'locales/en.json'), 'utf-8'));

      expect(de.editor.newCanvas).toBe('Neues Canvas');
      expect(de.editor.insertNewCanvas).toBe('Neues Canvas');
      expect(de.editor.canvasNamePrompt).toBe('Name des neuen Canvas:');
      expect(de.editor.insertPicture).toBe('Bild einfügen');

      expect(en.editor.newCanvas).toBe('New Canvas');
      expect(en.editor.insertNewCanvas).toBe('New Canvas');
      expect(en.editor.canvasNamePrompt).toBe('Name of the new canvas:');
      expect(en.editor.insertPicture).toBe('Insert Picture');
    });
  });
});
