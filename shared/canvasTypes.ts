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

export interface CanvasBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CanvasZoomArc = 'none' | 'subtle' | 'medium' | 'strong';

export interface CanvasPresentationConfig {
  zoomDuration: number;     // Camera transition duration in ms (default: 850, range: 200–3000)
  zoomArc: CanvasZoomArc;   // Parabolic zoom-out arc between distant slides (default: 'medium')
  revealDuration: number;   // Fade/scale-in duration for newly revealed nodes/edges in ms (default: 400, range: 100–2000)
  revealDelay: number;      // Delay after camera finishes moving before revealing elements in ms (default: 100, range: 0–1500)
  staggerDelay: number;     // Optional stagger between multiple newly revealed nodes in ms (default: 0, range: 0–500)
}

export interface CanvasPresentationSlide {
  id: string;
  title: string;
  bounds: CanvasBounds;     // World-space rectangle (resolution-independent!)
  hiddenNodeIds: string[];  // Node IDs hidden on this slide
  zoomDuration?: number;    // Optional per-slide override
  revealDuration?: number;  // Optional per-slide override
}

export interface CanvasPresentation {
  config: CanvasPresentationConfig;
  slides: CanvasPresentationSlide[];
}

export interface JsonCanvasDocument {
  nodes: JsonCanvasNode[];
  edges: JsonCanvasEdge[];
  viewport?: { x: number; y: number; zoom: number };
  presentation?: CanvasPresentation;
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
