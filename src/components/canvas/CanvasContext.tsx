import React, { createContext, useContext } from 'react';
import { stripZencExt } from '../../crypto/folderCrypto';

export interface CanvasContextType {
  onOpenNote: (path: string) => void;
  onSelectTag?: (tag: string) => void;
  onUpdateNodeData?: (nodeId: string, partialData: Record<string, any>) => void;
  allNotes: { path: string; name: string; basename: string }[];
  readOnly?: boolean;
  editingNodeState?: { nodeId: string; initialChar: string } | null;
  setEditingNodeState?: (state: { nodeId: string; initialChar: string } | null) => void;
  hiddenNodeIdsOnSelectedSlide?: Set<string>;
  hasSelectedSlide?: boolean;
  onToggleNodeHiddenOnSlide?: (nodeId: string) => void;
  currentCanvasPath?: string;
  ancestorPaths?: string[];
}

/**
 * Normalizes a vault path for cycle detection (case-insensitive, forward slashes, without `.zenc`).
 */
export function normalizeCanvasCyclePath(rawPath?: string | null): string {
  if (!rawPath) return '';
  return stripZencExt(rawPath.trim().replace(/\\/g, '/').replace(/^\.?\/+/, '')).toLowerCase();
}

/**
 * Checks whether `targetPath` is already present in `ancestorPaths` (or matches by canvas filename when folderless).
 */
export function isCanvasAncestorCycle(targetPath: string, ancestorPaths: string[] = []): boolean {
  const normTarget = normalizeCanvasCyclePath(targetPath);
  if (!normTarget || ancestorPaths.length === 0) return false;
  const targetLastSeg = normTarget.split('/').pop() || '';
  const hasExtension = targetLastSeg.includes('.');
  const targetWithCanvas = !hasExtension ? `${normTarget}.canvas` : normTarget;
  const targetHasSlash = normTarget.includes('/');
  return ancestorPaths.some((anc) => {
    const normAnc = normalizeCanvasCyclePath(anc);
    if (!normAnc) return false;
    if (normAnc === normTarget || normAnc === targetWithCanvas) return true;
    if (!targetHasSlash && (normAnc.endsWith(`/${normTarget}`) || normAnc.endsWith(`/${targetWithCanvas}`))) {
      return true;
    }
    return false;
  });
}

export const CanvasContext = createContext<CanvasContextType>({
  onOpenNote: () => {},
  allNotes: [],
  readOnly: false,
  ancestorPaths: [],
});

export const useCanvasContext = () => useContext(CanvasContext);
