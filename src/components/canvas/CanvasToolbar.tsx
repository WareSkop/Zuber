import React, { useState, useRef, useEffect } from 'react';
import {
  FileText,
  FolderPlus,
  GitBranch,
  Network,
  Server,
  Cloud,
  Monitor,
  Database,
  Diamond,
  Circle,
  Square,
  Undo2,
  Redo2,
  Maximize2,
  Grid,
  Search,
  Plus,
  ChevronDown,
} from 'lucide-react';
import type { CanvasShape } from '../../../shared/canvasTypes';

interface CanvasToolbarProps {
  onAddTextNode: (shape?: CanvasShape) => void;
  onAddFileNode: (filePath: string) => void;
  onAddGroupNode: () => void;
  onFitView: () => void;
  onToggleGrid: () => void;
  gridMode: 'dots' | 'lines' | 'off';
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  allNotes: { path: string; name: string; basename: string }[];
}

export const CanvasToolbar: React.FC<CanvasToolbarProps> = ({
  onAddTextNode,
  onAddFileNode,
  onAddGroupNode,
  onFitView,
  onToggleGrid,
  gridMode,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  allNotes,
}) => {
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [fileSearch, setFileSearch] = useState('');
  const [showWorkflowMenu, setShowWorkflowMenu] = useState(false);
  const [showNetworkMenu, setShowNetworkMenu] = useState(false);

  const filePickerRef = useRef<HTMLDivElement>(null);
  const workflowMenuRef = useRef<HTMLDivElement>(null);
  const networkMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filePickerRef.current && !filePickerRef.current.contains(e.target as Node)) {
        setShowFilePicker(false);
      }
      if (workflowMenuRef.current && !workflowMenuRef.current.contains(e.target as Node)) {
        setShowWorkflowMenu(false);
      }
      if (networkMenuRef.current && !networkMenuRef.current.contains(e.target as Node)) {
        setShowNetworkMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredNotes = allNotes
    .filter(
      (n) =>
        !fileSearch ||
        n.name.toLowerCase().includes(fileSearch.toLowerCase()) ||
        n.path.toLowerCase().includes(fileSearch.toLowerCase())
    )
    .slice(0, 15);

  return (
    <div className="canvas-dock-toolbar">
      {/* Left items: Node creation */}
      <div className="canvas-toolbar-group">
        <button
          type="button"
          className="canvas-tb-btn"
          onClick={() => onAddTextNode('rectangle')}
          title="Text-Karte hinzufügen (+)"
        >
          <Plus size={15} />
          <span>Text</span>
        </button>

        {/* Embed note/file picker */}
        <div className="canvas-tb-popover-container" ref={filePickerRef}>
          <button
            type="button"
            className={`canvas-tb-btn ${showFilePicker ? 'active' : ''}`}
            onClick={() => setShowFilePicker((v) => !v)}
            title="Notiz / Datei einbetten"
          >
            <FileText size={15} />
            <span>Notiz einbetten</span>
          </button>

          {showFilePicker && (
            <div className="canvas-file-picker-popup">
              <div className="canvas-picker-search-row">
                <Search size={14} />
                <input
                  type="text"
                  autoFocus
                  placeholder="Notiz oder Datei suchen..."
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                />
              </div>
              <div className="canvas-picker-list scroller">
                {filteredNotes.length === 0 ? (
                  <div className="canvas-picker-empty">Keine Dateien gefunden</div>
                ) : (
                  filteredNotes.map((note) => (
                    <button
                      key={note.path}
                      type="button"
                      className="canvas-picker-item"
                      onClick={() => {
                        onAddFileNode(note.path);
                        setShowFilePicker(false);
                      }}
                    >
                      <span className="picker-item-title">{note.basename || note.name}</span>
                      <span className="picker-item-path">{note.path}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Group */}
        <button
          type="button"
          className="canvas-tb-btn"
          onClick={onAddGroupNode}
          title="Gruppe / Bereich hinzufügen"
        >
          <FolderPlus size={15} />
          <span>Gruppe</span>
        </button>

        {/* Workflow Shapes Dropdown */}
        <div className="canvas-tb-popover-container" ref={workflowMenuRef}>
          <button
            type="button"
            className={`canvas-tb-btn ${showWorkflowMenu ? 'active' : ''}`}
            onClick={() => setShowWorkflowMenu((v) => !v)}
            title="Workflow-Formen (Prozess, Entscheidung, Start/Ende)"
          >
            <GitBranch size={15} />
            <span>Workflow</span>
            <ChevronDown size={12} />
          </button>

          {showWorkflowMenu && (
            <div className="canvas-palette-dropdown">
              <div className="canvas-palette-title">Workflow-Formen</div>
              <button
                type="button"
                className="canvas-palette-item"
                onClick={() => {
                  onAddTextNode('rectangle');
                  setShowWorkflowMenu(false);
                }}
              >
                <Square size={16} /> <span>Prozesschritt (Rechteck)</span>
              </button>
              <button
                type="button"
                className="canvas-palette-item"
                onClick={() => {
                  onAddTextNode('rounded');
                  setShowWorkflowMenu(false);
                }}
              >
                <div className="palette-icon-rounded" /> <span>Start / Ende (Abgerundet)</span>
              </button>
              <button
                type="button"
                className="canvas-palette-item"
                onClick={() => {
                  onAddTextNode('circle');
                  setShowWorkflowMenu(false);
                }}
              >
                <Circle size={16} /> <span>Knotenpunkt / Status (Kreis)</span>
              </button>
              <button
                type="button"
                className="canvas-palette-item"
                onClick={() => {
                  onAddTextNode('diamond');
                  setShowWorkflowMenu(false);
                }}
              >
                <Diamond size={16} /> <span>Entscheidung / Verzweigung (Raute)</span>
              </button>
              <button
                type="button"
                className="canvas-palette-item"
                onClick={() => {
                  onAddTextNode('parallelogram');
                  setShowWorkflowMenu(false);
                }}
              >
                <div className="palette-icon-parallel" /> <span>Ein- / Ausgabe (Parallelogramm)</span>
              </button>
              <button
                type="button"
                className="canvas-palette-item"
                onClick={() => {
                  onAddTextNode('hexagon');
                  setShowWorkflowMenu(false);
                }}
              >
                <div className="palette-icon-hexagon" /> <span>Bedingung / Filter (Hexagon)</span>
              </button>
              <button
                type="button"
                className="canvas-palette-item"
                onClick={() => {
                  onAddTextNode('cylinder');
                  setShowWorkflowMenu(false);
                }}
              >
                <Database size={16} /> <span>Datenbank / Speicher (Zylinder)</span>
              </button>
            </div>
          )}
        </div>

        {/* Network Elements Dropdown */}
        <div className="canvas-tb-popover-container" ref={networkMenuRef}>
          <button
            type="button"
            className={`canvas-tb-btn ${showNetworkMenu ? 'active' : ''}`}
            onClick={() => setShowNetworkMenu((v) => !v)}
            title="Netzwerk-Elemente (Server, Router, Cloud, Workstation)"
          >
            <Network size={15} />
            <span>Netzwerk</span>
            <ChevronDown size={12} />
          </button>

          {showNetworkMenu && (
            <div className="canvas-palette-dropdown">
              <div className="canvas-palette-title">Netzwerk-Elemente</div>
              <button
                type="button"
                className="canvas-palette-item"
                onClick={() => {
                  onAddTextNode('server');
                  setShowNetworkMenu(false);
                }}
              >
                <Server size={16} /> <span>Server / Host</span>
              </button>
              <button
                type="button"
                className="canvas-palette-item"
                onClick={() => {
                  onAddTextNode('router');
                  setShowNetworkMenu(false);
                }}
              >
                <Network size={16} /> <span>Router / Gateway / Switch</span>
              </button>
              <button
                type="button"
                className="canvas-palette-item"
                onClick={() => {
                  onAddTextNode('cloud');
                  setShowNetworkMenu(false);
                }}
              >
                <Cloud size={16} /> <span>Cloud / Internet</span>
              </button>
              <button
                type="button"
                className="canvas-palette-item"
                onClick={() => {
                  onAddTextNode('workstation');
                  setShowNetworkMenu(false);
                }}
              >
                <Monitor size={16} /> <span>Workstation / Client</span>
              </button>
              <button
                type="button"
                className="canvas-palette-item"
                onClick={() => {
                  onAddTextNode('cylinder');
                  setShowNetworkMenu(false);
                }}
              >
                <Database size={16} /> <span>Datenbank / Storage</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="canvas-toolbar-spacer" />

      {/* Right items: History & View Controls */}
      <div className="canvas-toolbar-group">
        <button
          type="button"
          className="canvas-tb-btn icon-only"
          onClick={onUndo}
          disabled={!canUndo}
          title="Rückgängig (Strg+Z)"
          aria-label="Rückgängig"
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          className="canvas-tb-btn icon-only"
          onClick={onRedo}
          disabled={!canRedo}
          title="Wiederholen (Strg+Y)"
          aria-label="Wiederholen"
        >
          <Redo2 size={16} />
        </button>
        <button
          type="button"
          className="canvas-tb-btn icon-only"
          onClick={onFitView}
          title="Ansicht einpassen (Fit View)"
          aria-label="Ansicht einpassen"
        >
          <Maximize2 size={16} />
        </button>
        <button
          type="button"
          className={`canvas-tb-btn icon-only ${gridMode !== 'off' ? 'active' : ''}`}
          onClick={onToggleGrid}
          title={`Gitter: ${gridMode}`}
          aria-label="Gitter umschalten"
        >
          <Grid size={16} />
        </button>
      </div>
    </div>
  );
};
