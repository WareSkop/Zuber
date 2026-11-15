import { describe, it, expect } from 'vitest';
import type { FileTreeNode } from '../../shared/types';
import {
  resolveTargetFolder,
  collectAncestorFolders,
} from './fileTreeUtils';

const sampleTree: FileTreeNode[] = [
  {
    name: 'Testverzeichnis',
    path: 'Testverzeichnis',
    type: 'folder',
    children: [
      {
        name: 'Subfolder',
        path: 'Testverzeichnis/Subfolder',
        type: 'folder',
        children: [
          {
            name: 'Deep.md',
            path: 'Testverzeichnis/Subfolder/Deep.md',
            type: 'file',
            extension: 'md',
          },
        ],
      },
      {
        name: 'Todos.base',
        path: 'Testverzeichnis/Todos.base',
        type: 'file',
        extension: 'base',
      },
    ],
  },
  {
    name: 'RootNote.md',
    path: 'RootNote.md',
    type: 'file',
    extension: 'md',
  },
];

describe('fileTreeUtils – resolveTargetFolder & collectAncestorFolders', () => {
  it('returns the exact folder path when a folder is selected', () => {
    expect(resolveTargetFolder(new Set(['Testverzeichnis']), sampleTree)).toBe(
      'Testverzeichnis'
    );
    expect(
      resolveTargetFolder(new Set(['Testverzeichnis/Subfolder']), sampleTree)
    ).toBe('Testverzeichnis/Subfolder');
  });

  it('returns the parent directory when a file is selected', () => {
    expect(
      resolveTargetFolder(new Set(['Testverzeichnis/Todos.base']), sampleTree)
    ).toBe('Testverzeichnis');
    expect(
      resolveTargetFolder(
        new Set(['Testverzeichnis/Subfolder/Deep.md']),
        sampleTree
      )
    ).toBe('Testverzeichnis/Subfolder');
    expect(resolveTargetFolder(new Set(['RootNote.md']), sampleTree)).toBe('');
  });

  it('returns empty string (vault root) when selection is empty', () => {
    expect(resolveTargetFolder(new Set(), sampleTree)).toBe('');
  });

  it('collects all ancestor folders in order for auto-expansion', () => {
    expect(collectAncestorFolders('Testverzeichnis/Subfolder/Nested')).toEqual([
      'Testverzeichnis',
      'Testverzeichnis/Subfolder',
      'Testverzeichnis/Subfolder/Nested',
    ]);
    expect(collectAncestorFolders('')).toEqual([]);
  });
});
