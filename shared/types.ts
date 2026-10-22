export type PropertyType = 'text' | 'list' | 'number' | 'checkbox' | 'date';
export type AttachmentKind = 'markdown' | 'canvas' | 'base' | 'image' | 'pdf' | 'audio' | 'video' | 'other';

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
  mtimeMs?: number;
  isSendTarget?: boolean;
  isTemplate?: boolean;
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
  isSendTarget?: boolean;
  isTemplate?: boolean;
}

export interface NoteSummary {
  path: string;
  name: string;
  basename: string;
  extension?: string;
  isSendTarget?: boolean;
  isTemplate?: boolean;
}

export interface NoteSaveRequest {
  path: string;
  body: string;
  properties: FrontmatterProperty[];
  baseMtime?: number;
  forceOverwrite?: boolean;
  explicitClear?: boolean;
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

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: string; // ISO timestamp
  level: LogLevel;
  source: 'client' | 'server';
  category: string;  // e.g., 'sync', 'api', 'vault', 'websocket', 'editor', 'auth'
  message: string;
  details?: string;  // Optional JSON/stack details
}

export interface LogsResponse {
  level: LogLevel;
  entries: LogEntry[];
}

export interface GitFileCommit {
  hash: string;
  shortHash: string;
  date: string;       // ISO date string
  author: string;
  message: string;
}

export interface GitFileHistoryResponse {
  path: string;
  gitEnabled: boolean;
  commits: GitFileCommit[];
}

export interface GitFileVersionResponse {
  path: string;
  hash: string;
  content: string;        // Full raw file content at that commit
  currentContent: string; // Current raw file content on disk for diffing
}

// ==========================================
// Obsidian Bases (.base / ```base) Data Types
// ==========================================

export interface BasePropertyConfig {
  displayName?: string;
  type?: string;
  width?: number;
}

export interface BaseSortRule {
  property: string;
  direction?: 'ASC' | 'DESC' | 'asc' | 'desc';
}

export interface BaseGroupBy {
  property: string;
  direction?: 'ASC' | 'DESC' | 'asc' | 'desc';
}

export type BaseFilterCondition =
  | string
  | { and?: BaseFilterCondition[] }
  | { or?: BaseFilterCondition[] }
  | { not?: BaseFilterCondition | BaseFilterCondition[] }
  | Record<string, unknown>;

export interface BaseViewConfig {
  type: 'table' | 'cards' | 'list' | string;
  name?: string;
  limit?: number;
  order?: string[];
  columnSize?: Record<string, number>;
  filters?: BaseFilterCondition;
  groupBy?: BaseGroupBy;
  sort?: BaseSortRule[];
  summaries?: Record<string, string>;
}

export interface BaseDefinition {
  filters?: BaseFilterCondition;
  formulas?: Record<string, string>;
  properties?: Record<string, BasePropertyConfig>;
  summaries?: Record<string, string>;
  views?: BaseViewConfig[];
}




