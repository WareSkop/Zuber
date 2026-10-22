import type { FileTreeNode } from '../../shared/types';

export type TreeSortMode = 'name-asc' | 'name-desc' | 'mtime-desc' | 'mtime-asc';

export const TREE_SORT_STORAGE_KEY = 'zuber_tree_sort';

export function getTreeSortMode(): TreeSortMode {
  if (typeof window === 'undefined') return 'name-asc';
  try {
    const saved =
      localStorage.getItem(TREE_SORT_STORAGE_KEY) ||
      localStorage.getItem('knowmesh_tree_sort');
    if (
      saved === 'name-asc' ||
      saved === 'name-desc' ||
      saved === 'mtime-desc' ||
      saved === 'mtime-asc'
    ) {
      return saved;
    }
  } catch {}
  return 'name-asc';
}

export function saveTreeSortMode(mode: TreeSortMode): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(TREE_SORT_STORAGE_KEY, mode);
  } catch {}
}

/**
 * Returns the effective modification timestamp of a node.
 * For files: node.updatedAt ?? node.mtimeMs ?? 0.
 * For folders: the maximum timestamp among all its recursive descendants.
 */
export function getNodeTimestamp(node: FileTreeNode): number {
  if (node.type === 'file') {
    return node.updatedAt ?? node.mtimeMs ?? 0;
  }
  let max = node.updatedAt ?? node.mtimeMs ?? 0;
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      const childTime = getNodeTimestamp(child);
      if (childTime > max) {
        max = childTime;
      }
    }
  }
  return max;
}

/**
 * Recursively sorts tree nodes based on the specified sort mode.
 * Folders always stay at the top and are sorted amongst each other.
 * Files are sorted according to the mode (by name or by mtime).
 */
export function sortTreeNodes(nodes: FileTreeNode[], mode: TreeSortMode): FileTreeNode[] {
  const sorted = [...nodes].sort((a, b) => {
    // 1. Folders always remain above files
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1;
    }

    // 2. Sorting logic
    if (mode === 'name-asc') {
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    }
    if (mode === 'name-desc') {
      return b.name.localeCompare(a.name, undefined, { sensitivity: 'base', numeric: true });
    }
    if (mode === 'mtime-desc') {
      const timeDiff = getNodeTimestamp(b) - getNodeTimestamp(a);
      if (timeDiff !== 0) return timeDiff;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    }
    if (mode === 'mtime-asc') {
      const timeDiff = getNodeTimestamp(a) - getNodeTimestamp(b);
      if (timeDiff !== 0) return timeDiff;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    }
    return 0;
  });

  // Recursively sort children of folders
  return sorted.map((node) => {
    if (node.type === 'folder' && node.children) {
      return {
        ...node,
        children: sortTreeNodes(node.children, mode),
      };
    }
    return node;
  });
}
