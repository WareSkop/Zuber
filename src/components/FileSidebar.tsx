import React, { useState, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Hash,
  Image as ImageIcon,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { FileTreeNode } from '../../shared/types';
import { api } from '../api';

interface FileSidebarProps {
  tree: FileTreeNode[];
  activePath: string | null;
  tags: { tag: string; count: number }[];
  selectedTagFilter: string | null;
  onSelectNote: (path: string) => void;
  onCreateNote: (parentFolder?: string) => void;
  onCreateFolder: (parentFolder?: string) => void;
  onRenameEntry: (oldPath: string, currentName: string) => void;
  onDeleteEntry: (path: string, name: string) => void;
  onRefresh: () => void;
  onSelectTagFilter: (tag: string | null) => void;
}

const FileSidebarImpl: React.FC<FileSidebarProps> = ({
  tree,
  activePath,
  tags,
  selectedTagFilter,
  onSelectNote,
  onCreateNote,
  onCreateFolder,
  onRenameEntry,
  onDeleteEntry,
  onRefresh,
  onSelectTagFilter,
}) => {
  const [activeTab, setActiveTab] = useState<'files' | 'search' | 'tags'>('files');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    Projekte: true,
    Wissensbasis: true,
    'Tägliche Notizen': true,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    {
      path: string;
      name: string;
      matches: { line: number; text: string }[];
      tags: string[];
    }[]
  >([]);
  const [searching, setSearching] = useState(false);

  // Switch to search tab automatically when a tag filter is selected externally
  useEffect(() => {
    if (selectedTagFilter) {
      setActiveTab('search');
    }
  }, [selectedTagFilter]);

  useEffect(() => {
    if (activeTab !== 'search' && !selectedTagFilter) return;

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.search(searchQuery, selectedTagFilter || undefined);
        setSearchResults(res.results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [searchQuery, selectedTagFilter, activeTab]);

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderPath]: !prev[folderPath],
    }));
  };

  const renderTreeNode = (node: FileTreeNode, depth = 0) => {
    if (node.type === 'folder') {
      const isExpanded = Boolean(expandedFolders[node.path]);
      return (
        <div key={node.path} className="tree-folder-group">
          <div
            className="tree-item tree-folder-item"
            style={{ paddingLeft: `${10 + depth * 14}px` }}
            onClick={() => toggleFolder(node.path)}
          >
            <span className="tree-chevron">
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
            <span className="tree-icon folder-icon">
              {isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}
            </span>
            <span className="tree-label" title={node.path}>
              {node.name}
            </span>
            <div className="tree-item-actions" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                title="Neue Notiz in diesem Ordner"
                onClick={() => {
                  setExpandedFolders((prev) => ({ ...prev, [node.path]: true }));
                  onCreateNote(node.path);
                }}
              >
                <FilePlus size={13} />
              </button>
              <button
                type="button"
                title="Ordner umbenennen"
                onClick={() => onRenameEntry(node.path, node.name)}
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                title="Ordner löschen"
                onClick={() => onDeleteEntry(node.path, node.name)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>

          {isExpanded && node.children && (
            <div className="tree-folder-children">
              {node.children.map((child) => renderTreeNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    const isMd = node.extension === 'md';
    const isActive = activePath === node.path;
    const displayName = isMd ? node.name.replace(/\.md$/i, '') : node.name;

    return (
      <div
        key={node.path}
        className={`tree-item tree-file-item ${isActive ? 'active' : ''} ${!isMd ? 'attachment-item' : ''}`}
        style={{ paddingLeft: `${26 + depth * 14}px` }}
        onClick={() => {
          if (isMd) {
            onSelectNote(node.path);
          } else {
            window.open(api.getAttachmentUrl(node.path), '_blank');
          }
        }}
      >
        <span className="tree-icon">
          {isMd ? <FileText size={14} /> : <ImageIcon size={14} />}
        </span>
        <span className="tree-label" title={node.path}>
          {displayName}
        </span>
        {!isMd && <span className="file-ext-badge">{node.extension}</span>}
        <div className="tree-item-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            title="Umbenennen"
            onClick={() => onRenameEntry(node.path, displayName)}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            title="Löschen"
            onClick={() => onDeleteEntry(node.path, displayName)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <aside className="left-sidebar">
      <div className="sidebar-tabs">
        <button
          type="button"
          className={`sidebar-tab-btn ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
          title="Dateibaum"
        >
          <Folder size={15} />
          <span>Dateien</span>
        </button>
        <button
          type="button"
          className={`sidebar-tab-btn ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveTab('search')}
          title="Vault durchsuchen"
        >
          <Search size={15} />
          <span>Suche</span>
        </button>
        <button
          type="button"
          className={`sidebar-tab-btn ${activeTab === 'tags' ? 'active' : ''}`}
          onClick={() => setActiveTab('tags')}
          title="Alle Tags"
        >
          <Hash size={15} />
          <span>Tags</span>
        </button>
      </div>

      {activeTab === 'files' && (
        <>
          <div className="sidebar-action-bar">
            <button
              type="button"
              className="sidebar-icon-btn"
              title="Neue Notiz erstellen"
              onClick={() => onCreateNote()}
            >
              <FilePlus size={16} />
              <span>Neue Notiz</span>
            </button>
            <div className="sidebar-action-right">
              <button
                type="button"
                className="sidebar-icon-btn icon-only"
                title="Neuer Ordner"
                onClick={() => onCreateFolder()}
              >
                <FolderPlus size={16} />
              </button>
              <button
                type="button"
                className="sidebar-icon-btn icon-only"
                title="Vault neu laden"
                onClick={onRefresh}
              >
                <RefreshCw size={15} />
              </button>
            </div>
          </div>

          <div className="file-tree-scroller scroller">
            {tree.map((node) => renderTreeNode(node, 0))}
          </div>
        </>
      )}

      {activeTab === 'search' && (
        <div className="sidebar-search-pane">
          <div className="search-input-box">
            <Search size={15} className="search-box-icon" />
            <input
              type="text"
              placeholder="Notizen & Eigenschaften durchsuchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchQuery('')}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {selectedTagFilter && (
            <div className="active-tag-filter-bar">
              <span>Filter: #{selectedTagFilter}</span>
              <button type="button" onClick={() => onSelectTagFilter(null)}>
                <X size={13} />
              </button>
            </div>
          )}

          <div className="search-results-list scroller">
            {searching ? (
              <div className="sidebar-empty-hint">Suche läuft...</div>
            ) : searchResults.length === 0 ? (
              <div className="sidebar-empty-hint">Keine Treffer gefunden.</div>
            ) : (
              searchResults.map((res) => (
                <div
                  key={res.path}
                  className={`search-result-card ${activePath === res.path ? 'active' : ''}`}
                  onClick={() => onSelectNote(res.path)}
                >
                  <div className="search-result-title">
                    <FileText size={14} />
                    <span>{res.name}</span>
                  </div>
                  {res.matches.map((m, idx) => (
                    <div key={idx} className="search-result-snippet">
                      {m.line > 0 && <span className="line-num">Z.{m.line}:</span>} {m.text}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'tags' && (
        <div className="sidebar-tags-pane scroller">
          {tags.length === 0 ? (
            <div className="sidebar-empty-hint">Noch keine #Tags im Vault vorhanden.</div>
          ) : (
            tags.map((item) => (
              <button
                key={item.tag}
                type="button"
                className={`tag-list-row ${selectedTagFilter === item.tag ? 'active' : ''}`}
                onClick={() => {
                  onSelectTagFilter(item.tag);
                  setActiveTab('search');
                }}
              >
                <span className="tag-list-name">#{item.tag}</span>
                <span className="tag-list-count">{item.count}</span>
              </button>
            ))
          )}
        </div>
      )}
    </aside>
  );
};

// Memoized: the (potentially huge) file tree only re-renders when its props change
export const FileSidebar = React.memo(FileSidebarImpl);
