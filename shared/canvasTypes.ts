/**
 * JSON Canvas 1.0 Specification + Knowmesh Workflow & Network Extensions
 * Compatible with Obsidian Canvas (.canvas)
 * Specification reference: https://jsoncanvas.org/spec/1.0/
 */

export type CanvasNodeType = 'text' | 'file' | 'link' | 'group';

export type CanvasShape =
  | 'rectangle'      // Standard card
  | 'rounded'        // Rounded process step / state
  | 'circle'         // Start / End / Junction
  | 'diamond'        // Decision / Condition (Workflow)
  | 'parallelogram'  // Input / Output (I/O)
  | 'hexagon'        // Preparation / Filter
  | 'cylinder'       // Database / Persistent Storage
  | 'cloud'          // Cloud / Internet / External Network
  | 'server'         // Server / Host / Virtual Machine
  | 'router'         // Router / Switch / Gateway / Firewall
  | 'workstation';   // Client / Workstation / Device

export type CanvasSide = 'top' | 'right' | 'bottom' | 'left';
export type CanvasEdgeStyle = 'bezier' | 'straight' | 'step';

export interface JsonCanvasNode {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;          // Obsidian Preset "1".."6" or Hex "#..."
  // Standard type-specific fields:
  text?: string;           // For type === 'text' (Markdown & [[Wiki-Links]])
  file?: string;           // For type === 'file' (Relative vault path)
  subpath?: string;        // Optional #Heading or #^block subpath
  url?: string;            // For type === 'link'
  label?: string;          // For type === 'group'
  // Knowmesh extensions (Graceful Degradation: preserved & ignored by Obsidian Desktop):
  shape?: CanvasShape;     // Default: 'rectangle'
  icon?: string;           // Optional Lucide icon name or badge
  zIndex?: number;
}

export interface JsonCanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: CanvasSide;
  fromEnd?: 'none' | 'arrow';
  toNode: string;
  toSide?: CanvasSide;
  toEnd?: 'none' | 'arrow';
  color?: string;
  label?: string;
  // Knowmesh extension:
  edgeStyle?: CanvasEdgeStyle; // 'bezier' (Default) | 'straight' | 'step'
}

export interface JsonCanvasDocument {
  nodes: JsonCanvasNode[];
  edges: JsonCanvasEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

/**
 * Obsidian 6 preset colors mapped to standard CSS hex values
 */
export const OBSIDIAN_CANVAS_COLORS: Record<string, { label: string; hex: string }> = {
  '1': { label: 'Red', hex: '#e93147' },
  '2': { label: 'Orange', hex: '#ec7500' },
  '3': { label: 'Yellow', hex: '#e0ac00' },
  '4': { label: 'Green', hex: '#08b94e' },
  '5': { label: 'Cyan', hex: '#00bfbc' },
  '6': { label: 'Purple', hex: '#7852ee' },
};

export function resolveCanvasColor(color?: string): string | undefined {
  if (!color) return undefined;
  if (OBSIDIAN_CANVAS_COLORS[color]) {
    return OBSIDIAN_CANVAS_COLORS[color].hex;
  }
  return color; // Already hex or CSS color
}
