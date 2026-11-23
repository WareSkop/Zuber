import { getDefaultCanvasAssetsFolder } from '../../shared/canvasTypes';
import type { CanvasTreeMetadata, ExternalLinkRef, FileTreeNode } from '../../shared/types';
import { stripZencExt } from '../crypto/folderCrypto';
import { sortTreeNodes, type TreeSortMode } from './treeSort';

export interface CanvasVirtualChildren {
  assetsFolder: string;
  directFiles: FileTreeNode[];
  linkedFiles: FileTreeNode[];
  externalLinks: ExternalLinkRef[];
  hasChildren: boolean;
}

export interface CanvasTreeModel {
  suppressedFolderPaths: Set<string>;
  canvasChildrenByPath: Map<string, CanvasVirtualChildren>;
}

/**
 * Extracts a clean display domain (without leading `www.`) from an HTTP(S) URL.
 */
export function extractDisplayDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, '') || url;
  } catch {
    return url;
  }
}

function isCanvasFileNode(node: FileTreeNode): boolean {
  if (node.type !== 'file') return false;
  if (node.attachmentKind === 'canvas') return true;
  return stripZencExt(node.path).toLowerCase().endsWith('.canvas');
}

function collectDirectDescendants(nodes: FileTreeNode[], out: Set<string>): void {
  for (const n of nodes) {
    out.add(n.path);
    if (n.children) collectDirectDescendants(n.children, out);
  }
}

/**
 * Builds the virtual companion tree model for all `.canvas` files in the file tree:
 * - Suppresses standalone `<Canvas>.canvas.assets/` directories from top-level/folder rendering.
 * - Attaches direct companion files, linked external-folder vault files, and external URLs
 *   under the owning `.canvas` file node.
 */
export function buildCanvasTreeModel(
  tree: FileTreeNode[],
  canvasMeta: Record<string, CanvasTreeMetadata> = {},
  sortMode: TreeSortMode = 'name-asc'
): CanvasTreeModel {
  const folderMap = new Map<string, FileTreeNode>();
  const fileNodeMap = new Map<string, FileTreeNode>();
  const canvasNodes: FileTreeNode[] = [];

  const walk = (nodes: FileTreeNode[]) => {
    for (const node of nodes) {
      if (node.type === 'folder') {
        folderMap.set(node.path, node);
        if (node.children) walk(node.children);
      } else {
        fileNodeMap.set(node.path, node);
        if (isCanvasFileNode(node)) {
          canvasNodes.push(node);
        }
      }
    }
  };
  walk(tree);

  const suppressedFolderPaths = new Set<string>();
  const canvasChildrenByPath = new Map<string, CanvasVirtualChildren>();

  for (const canvasNode of canvasNodes) {
    const meta = canvasMeta[canvasNode.path];
    const defaultAssetsFolder = getDefaultCanvasAssetsFolder(canvasNode.path);
    if (defaultAssetsFolder && folderMap.has(defaultAssetsFolder)) {
      suppressedFolderPaths.add(defaultAssetsFolder);
    }

    const effectiveAssetsFolder = meta?.assetsFolder || defaultAssetsFolder;
    const assetsDirNode = effectiveAssetsFolder ? folderMap.get(effectiveAssetsFolder) : undefined;
    const directFiles = assetsDirNode?.children
      ? sortTreeNodes(assetsDirNode.children, sortMode)
      : [];

    const directPathSet = new Set<string>();
    collectDirectDescendants(directFiles, directPathSet);
    const assetsPrefix = effectiveAssetsFolder ? `${effectiveAssetsFolder}/` : '';

    const linkedFiles: FileTreeNode[] = [];
    const seenLinked = new Set<string>();
    for (const refPath of meta?.referencedFiles || []) {
      if (!refPath || refPath === canvasNode.path || seenLinked.has(refPath)) continue;
      if (assetsPrefix && refPath.startsWith(assetsPrefix)) continue;
      if (directPathSet.has(refPath)) continue;
      const targetNode = fileNodeMap.get(refPath);
      if (targetNode) {
        seenLinked.add(refPath);
        linkedFiles.push(targetNode);
      }
    }

    const sortedLinkedFiles = sortTreeNodes(linkedFiles, sortMode);
    const externalLinks = Array.isArray(meta?.externalLinks) ? meta.externalLinks : [];
    const hasChildren =
      directFiles.length > 0 || sortedLinkedFiles.length > 0 || externalLinks.length > 0;

    canvasChildrenByPath.set(canvasNode.path, {
      assetsFolder: effectiveAssetsFolder,
      directFiles,
      linkedFiles: sortedLinkedFiles,
      externalLinks,
      hasChildren,
    });
  }

  return {
    suppressedFolderPaths,
    canvasChildrenByPath,
  };
}

/**
 * Finds the owning `.canvas` file path if `filePath` resides inside its companion assets directory.
 */
export function findParentCanvasForCompanionFile(
  filePath: string,
  treeModel: CanvasTreeModel
): string | null {
  for (const [canvasPath, children] of treeModel.canvasChildrenByPath.entries()) {
    if (children.assetsFolder && filePath.startsWith(`${children.assetsFolder}/`)) {
      return canvasPath;
    }
  }
  return null;
}
