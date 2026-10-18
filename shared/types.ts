export type PropertyType = 'text' | 'list' | 'number' | 'checkbox' | 'date';
export type AttachmentKind = 'markdown' | 'canvas' | 'image' | 'pdf' | 'audio' | 'video' | 'other';

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
  attachmentKind?: AttachmentKind;
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

export interface NoteSaveRequest {
  path: string;
  body: string;
  properties: FrontmatterProperty[];
  baseMtime?: number;
  forceOverwrite?: boolean;
}

export interface ConflictErrorResponse {
  error: 'Conflict';
  serverNote: NoteData;
}

export interface SyncManifestEntry {
  path: string;
  type: 'markdown' | 'attachment';
  mtime: number;
  size: number;
}

export interface UploadResponse {
  ok: boolean;
  path: string;
  name: string;
  originalName: string;
  size: number;
  wikiEmbed: string;
}

export interface SecuritySettingsResponse {
  authEnabled: boolean;
}

export interface UpdateSecurityRequest {
  currentPassword?: string;
  authEnabled: boolean;
  newPassword?: string;
}

export interface VaultProfile {
  id: string;
  name: string;
  serverUrl: string;
  token?: string;
}

export interface GraphNode {
  id: string;
  label: string;
  path?: string;
  type: 'note' | 'tag' | 'unresolved' | 'canvas';
  kind?: AttachmentKind;
  folder?: string;
  degree: number;
  tags?: string[];
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

export interface GitRemoteConfig {
  enabled: boolean;
  url: string;
  username: string;
  token?: string;       // In client response only masked or omitted
  hasToken?: boolean;
  branch: string;       // Default: 'main'
  lastPushTime?: number | null;
  lastPushError?: string | null;
}

export interface GitConfig {
  enabled: boolean;
  userName: string;
  userEmail: string;
  autoCommitOnClose: boolean;
  remote: GitRemoteConfig;
}

export interface GitStatusInfo {
  isRepo: boolean;
  enabled: boolean;
  clean: boolean;
  modifiedCount: number;
  untrackedCount: number;
  lastCommit?: {
    hash: string;
    message: string;
    date: string;
    author: string;
  } | null;
  remoteConfigured: boolean;
  lastPushTime?: number | null;
  lastPushError?: string | null;
}

