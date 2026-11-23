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

/**
 * Additively expands all ancestor folders (and the folder itself if `options.isFolder` is true,
 * plus any owning `.canvas` virtual tree) without collapsing any currently expanded folders.
 */
export function revealPathInExpandedFolders(
  prev: Record<string, boolean>,
  targetPath: string,
  options?: { isFolder?: boolean; owningCanvasPath?: string | null }
): Record<string, boolean> {
  const normalized = targetPath.replace(/^\/+|\/+$/g, '');
  if (!normalized && !options?.owningCanvasPath) return prev;

  let ancestors: string[] = [];
  if (normalized) {
    if (options?.isFolder) {
      ancestors = collectAncestorFolders(normalized);
    } else {
      const slashIdx = normalized.lastIndexOf('/');
      if (slashIdx > 0) {
        ancestors = collectAncestorFolders(normalized.slice(0, slashIdx));
      }
    }
  }

  const pathsToExpand = options?.owningCanvasPath
    ? [...ancestors, options.owningCanvasPath]
    : ancestors;

  if (pathsToExpand.length === 0) return prev;

  let changed = false;
  let next: Record<string, boolean> | null = null;
  for (const p of pathsToExpand) {
    if (!prev[p]) {
      if (!next) next = { ...prev };
      next[p] = true;
      changed = true;
    }
  }
  return changed && next ? next : prev;
}

/**
 * Escapes an attribute value for use in `querySelector` when `CSS.escape` may or may not exist.
 */
export function escapeTreePathSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * Scrolls only the given tree scroll container so `targetEl` aligns near its top edge (`topOffset` px).
 * Never scrolls the outer viewport/window.
 */
export function scrollTreeElementToTop(
  container: HTMLElement | null,
  targetEl: HTMLElement | null,
  topOffset = 4
): boolean {
  if (!container || !targetEl) return false;
  const containerRect = container.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();
  const nextScrollTop = Math.max(
    0,
    Math.round(container.scrollTop + (targetRect.top - containerRect.top) - topOffset)
  );
  container.scrollTop = nextScrollTop;
  return true;
}
