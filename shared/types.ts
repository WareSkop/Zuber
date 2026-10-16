export type PropertyType = 'text' | 'list' | 'number' | 'checkbox' | 'date';

export interface FrontmatterProperty {
  key: string;
  value: unknown;
  type: PropertyType;
}

export interface FileTreeNode {
  name: string;
  path: string; // relative path inside vault, e.g. "Projekte/Architektur.md"
  type: 'file' | 'folder';
  extension?: string;
  children?: FileTreeNode[];
  updatedAt?: number;
}

export interface NoteHeading {
  level: number;
  text: string;
  line: number;
}

export interface BacklinkItem {
  sourcePath: string;
  sourceTitle: string;
  line: number;
  snippet: string;
  isUnlinked?: boolean;
}

export interface NoteData {
  path: string;
  name: string;
  rawContent: string;
  body: string;
  frontmatter: Record<string, unknown>;
  properties: FrontmatterProperty[];
  links: string[];
  embeds: string[];
  tags: string[];
  headings: NoteHeading[];
  updatedAt: number;
}

export interface GraphNode {
  id: string;
  label: string;
  path?: string;
  type: 'note' | 'tag' | 'unresolved';
  folder?: string;
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'wikilink' | 'tag';
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  tags: { tag: string; count: number }[];
}

export interface WsEventMessage {
  type: 'vault:changed' | 'file:updated' | 'file:Created' | 'file:deleted';
  path?: string;
  timestamp: number;
}
