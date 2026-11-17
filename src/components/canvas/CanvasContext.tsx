import React, { createContext, useContext } from 'react';

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
}

export const CanvasContext = createContext<CanvasContextType>({
  onOpenNote: () => {},
  allNotes: [],
  readOnly: false,
});

export const useCanvasContext = () => useContext(CanvasContext);
