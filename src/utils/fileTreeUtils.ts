import type { FileTreeNode } from '../../shared/types';

/**
 * Recursively finds a FileTreeNode by its exact relative path.
 */
export function findTreeNodeByPath(
  nodes: FileTreeNode[],
  targetPath: string
): FileTreeNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.type === 'folder' && node.children?.length) {
      const found = findTreeNodeByPath(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Resolves the target directory for creating a new file or subfolder based on
 * the current selection in `FileSidebar`:
 * - Selected folder -> returns that folder's exact path
 * - Selected file -> returns its parent directory (or "" for vault root)
 * - Empty selection -> returns "" (vault root)
 */
export function resolveTargetFolder(
  selectedPaths: Iterable<string>,
  tree: FileTreeNode[]
): string {
  const paths = Array.from(selectedPaths);
  if (paths.length === 0) return '';

  const primaryPath = paths[0];
  if (!primaryPath) return '';

  const node = findTreeNodeByPath(tree, primaryPath);
  if (node?.type === 'folder') {
    return node.path;
  }

  const slashIdx = primaryPath.lastIndexOf('/');
  return slashIdx > 0 ? primaryPath.slice(0, slashIdx) : '';
}

/**
 * Collects a folder path and all of its ancestor folder paths so they can be
 * expanded in the file tree at once.
 */
export function collectAncestorFolders(folderPath: string): string[] {
  const trimmed = folderPath.replace(/^\/+|\/+$/g, '');
  if (!trimmed) return [];
  const parts = trimmed.split('/').filter(Boolean);
  const result: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    result.push(parts.slice(0, i + 1).join('/'));
  }
  return result;
}
