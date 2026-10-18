import React, { createContext, useContext } from 'react';

export interface CanvasContextType {
  onOpenNote: (path: string) => void;
  onSelectTag?: (tag: string) => void;
  allNotes: { path: string; name: string; basename: string }[];
  readOnly?: boolean;
}

export const CanvasContext = createContext<CanvasContextType>({
  onOpenNote: () => {},
  allNotes: [],
  readOnly: false,
});

export const useCanvasContext = () => useContext(CanvasContext);
