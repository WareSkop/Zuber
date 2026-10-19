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
  BoxSelect,
} from 'lucide-react';
import type { CanvasShape } from '../../../shared/canvasTypes';

export interface CanvasGridConfig {
  snapToGrid: boolean;
  gridSize: number;
  showGrid: boolean;
  gridVariant: 'dots' | 'lines' | 'off';
}

interface CanvasToolbarProps {
  onAddTextNode: (shape?: CanvasShape) => void;
  onAddFileNode: (filePath: string) => void;
  onAddGroupNode: () => void;
  onFitView: () => void;
  gridConfig?: CanvasGridConfig;
  onChangeGridConfig?: (config: CanvasGridConfig) => void;
  // Legacy props compatibility
  gridMode?: 'dots' | 'lines' | 'off';
  onToggleGrid?: () => void;
  isSelectionToolActive?: boolean;
  onToggleSelectionTool?: () => void;
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
  gridConfig,
  onChangeGridConfig,
  gridMode,
  onToggleGrid,
  isSelectionToolActive = false,
  onToggleSelectionTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  allNotes,
}) => {
  const activeGridConfig: CanvasGridConfig = gridConfig || {
    snapToGrid: true,
    gridSize: 15,
    showGrid: gridMode !== 'off',
    gridVariant: gridMode || 'dots',
  };

  const handleGridConfigChange = (newConfig: CanvasGridConfig) => {
    if (onChangeGridConfig) {
      onChangeGridConfig(newConfig);
    } else if (onToggleGrid) {
      onToggleGrid();
    }
  };
  const [openDropdown, setOpenDropdown] = useState<'workflow' | 'network' | 'file' | 'grid' | null>(null);
  const [fileSearch, setFileSearch] = useState('');
  const toolbarRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!openDropdown || !dropdownRef.current) return;
    const el = dropdownRef.current;
    el.style.left = '0px';

    const clamp = () => {
      if (!dropdownRef.current) return;
      const target = dropdownRef.current;
      const rect = target.getBoundingClientRect();
      const container = target.closest('.canvas-editor-wrapper') || document.body;
      const containerRect = container.getBoundingClientRect();

      const minLeft = Math.max(containerRect.left + 12, 8);
      const maxRight = Math.min(containerRect.right - 12, window.innerWidth - 8);

      if (rect.right > maxRight) {
        const overflow = rect.right - maxRight;
        const targetLeft = -overflow;
        if (rect.left - overflow < minLeft) {
          const underflow = minLeft - (rect.left - overflow);
          target.style.left = `${targetLeft + underflow}px`;
        } else {
          target.style.left = `${targetLeft}px`;
        }
      } else if (rect.left < minLeft) {
        const underflow = minLeft - rect.left;
        target.style.left = `${underflow}px`;
      }
    };

    clamp();
    requestAnimationFrame(clamp);
  }, [openDropdown]);

  const filteredNotes = allNotes
    .filter(
      (n) =>
        !fileSearch ||
        n.name.toLowerCase().includes(fileSearch.toLowerCase()) ||
        n.path.toLowerCase().includes(fileSearch.toLowerCase())
    )
    .slice(0, 15);

  return (
    <div className="canvas-toolbar" ref={toolbarRef}>
      {/* Node creation group */}
      <div className="canvas-toolbar-group">
        <button
          type="button"
          className="canvas-toolbar-btn"
          onClick={() => {
            onAddTextNode('rectangle');
            setOpenDropdown(null);
          }}
          title="Text-Karte hinzufügen (+)"
        >
          <Plus size={15} />
          <span>Text</span>
        </button>

        {/* Embed note/file picker */}
        <div className="canvas-toolbar-dropdown">
          <button
            type="button"
            className={`canvas-toolbar-btn ${openDropdown === 'file' ? 'active' : ''}`}
            onClick={() => setOpenDropdown((prev) => (prev === 'file' ? null : 'file'))}
            title="Notiz / Datei einbetten"
          >
            <FileText size={15} />
            <span>Notiz einbetten</span>
            <ChevronDown size={12} />
          </button>

          {openDropdown === 'file' && (
            <div ref={dropdownRef} className="canvas-dropdown-menu canvas-file-picker-menu">
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
                      className="canvas-dropdown-item"
                      onClick={() => {
                        onAddFileNode(note.path);
                        setOpenDropdown(null);
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
          className="canvas-toolbar-btn"
          onClick={() => {
            onAddGroupNode();
            setOpenDropdown(null);
          }}
          title="Gruppe / Bereich hinzufügen"
        >
          <FolderPlus size={15} />
          <span>Gruppe</span>
        </button>

        {/* Workflow Shapes Dropdown */}
        <div className="canvas-toolbar-dropdown">
          <button
            type="button"
            className={`canvas-toolbar-btn ${openDropdown === 'workflow' ? 'active' : ''}`}
            onClick={() => setOpenDropdown((prev) => (prev === 'workflow' ? null : 'workflow'))}
            title="Workflow-Formen (Prozess, Entscheidung, Start/Ende)"
          >
            <GitBranch size={15} />
            <span>Workflow</span>
            <ChevronDown size={12} />
          </button>

          {openDropdown === 'workflow' && (
            <div ref={dropdownRef} className="canvas-dropdown-menu">
              <div className="canvas-dropdown-title">Workflow-Formen</div>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('rectangle');
                  setOpenDropdown(null);
                }}
              >
                <Square size={15} /> <span>Prozessschritt (Rechteck)</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('rounded');
                  setOpenDropdown(null);
                }}
              >
                <div className="palette-icon-rounded" /> <span>Start / Ende (Abgerundet)</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('circle');
                  setOpenDropdown(null);
                }}
              >
                <Circle size={15} /> <span>Knotenpunkt / Status (Kreis)</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('diamond');
                  setOpenDropdown(null);
                }}
              >
                <Diamond size={15} /> <span>Entscheidung (Raute)</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('parallelogram');
                  setOpenDropdown(null);
                }}
              >
                <div className="palette-icon-parallel" /> <span>Ein- / Ausgabe (Parallelogramm)</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('hexagon');
                  setOpenDropdown(null);
                }}
              >
                <div className="palette-icon-hexagon" /> <span>Bedingung / Filter (Hexagon)</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('cylinder');
                  setOpenDropdown(null);
                }}
              >
                <Database size={15} /> <span>Datenbank / Speicher (Zylinder)</span>
              </button>
            </div>
          )}
        </div>

        {/* Network Elements Dropdown */}
        <div className="canvas-toolbar-dropdown">
          <button
            type="button"
            className={`canvas-toolbar-btn ${openDropdown === 'network' ? 'active' : ''}`}
            onClick={() => setOpenDropdown((prev) => (prev === 'network' ? null : 'network'))}
            title="Netzwerk-Elemente (Server, Router, Cloud, Workstation)"
          >
            <Network size={15} />
            <span>Netzwerk</span>
            <ChevronDown size={12} />
          </button>

          {openDropdown === 'network' && (
            <div ref={dropdownRef} className="canvas-dropdown-menu">
              <div className="canvas-dropdown-title">Netzwerk-Elemente</div>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('server');
                  setOpenDropdown(null);
                }}
              >
                <Server size={15} /> <span>Server / Host</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('router');
                  setOpenDropdown(null);
                }}
              >
                <Network size={15} /> <span>Router / Gateway / Switch</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('cloud');
                  setOpenDropdown(null);
                }}
              >
                <Cloud size={15} /> <span>Cloud / Internet</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('workstation');
                  setOpenDropdown(null);
                }}
              >
                <Monitor size={15} /> <span>Workstation / Client</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('cylinder');
                  setOpenDropdown(null);
                }}
              >
                <Database size={15} /> <span>Datenbank / Storage</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="canvas-toolbar-divider" />

      {/* History & View Controls */}
      <div className="canvas-toolbar-group">
        <button
          type="button"
          className="canvas-toolbar-btn icon-only"
          onClick={onUndo}
          disabled={!canUndo}
          title="Rückgängig (Strg+Z)"
          aria-label="Rückgängig"
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          className="canvas-toolbar-btn icon-only"
          onClick={onRedo}
          disabled={!canRedo}
          title="Wiederholen (Strg+Y)"
          aria-label="Wiederholen"
        >
          <Redo2 size={16} />
        </button>
        <button
          type="button"
          className="canvas-toolbar-btn icon-only"
          onClick={onFitView}
          title="Ansicht einpassen (Fit View)"
          aria-label="Ansicht einpassen"
        >
          <Maximize2 size={16} />
        </button>
        <button
          type="button"
          className={`canvas-toolbar-btn icon-only ${isSelectionToolActive ? 'active' : ''}`}
          onClick={onToggleSelectionTool}
          title={
            isSelectionToolActive
              ? 'Auswahl-Rechteck aktiv (Klicken zum Deaktivieren)'
              : 'Auswahl-Rechteck / Marquee aktivieren (oder Shift gedrückt halten)'
          }
          aria-label="Auswahl-Rechteck aktivieren"
        >
          <BoxSelect size={16} />
        </button>

        {/* Grid & Snap popover dropdown */}
        <div className="canvas-toolbar-dropdown">
          <button
            type="button"
            className={`canvas-toolbar-btn icon-only ${
              activeGridConfig.snapToGrid || activeGridConfig.gridVariant !== 'off' ? 'active' : ''
            }`}
            onClick={() => setOpenDropdown((prev) => (prev === 'grid' ? null : 'grid'))}
            title={`Gitter & Einrasten (${activeGridConfig.snapToGrid ? 'Einrasten an' : 'Einrasten aus'}, ${activeGridConfig.gridSize}px)`}
            aria-label="Gitter-Einstellungen"
          >
            <Grid size={16} />
          </button>

          {openDropdown === 'grid' && (
            <div ref={dropdownRef} className="canvas-dropdown-menu canvas-grid-menu">
              <div className="canvas-dropdown-title">Gitter & Einrasten</div>

              {/* Snap to grid toggle */}
              <button
                type="button"
                className={`canvas-dropdown-item ${activeGridConfig.snapToGrid ? 'active' : ''}`}
                onClick={() =>
                  handleGridConfigChange({
                    ...activeGridConfig,
                    snapToGrid: !activeGridConfig.snapToGrid,
                  })
                }
              >
                <span>{activeGridConfig.snapToGrid ? '✓ Einrasten aktiv (Snap)' : 'Einrasten deaktiviert'}</span>
              </button>

              <div className="canvas-dropdown-divider" />
              <div className="canvas-dropdown-subtitle">Gittergröße</div>
              <div className="canvas-grid-pills">
                {[10, 15, 20, 25].map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={`canvas-grid-pill-btn ${activeGridConfig.gridSize === size ? 'active' : ''}`}
                    onClick={() =>
                      handleGridConfigChange({
                        ...activeGridConfig,
                        gridSize: size,
                      })
                    }
                  >
                    {size}px
                  </button>
                ))}
              </div>

              <div className="canvas-dropdown-divider" />
              <div className="canvas-dropdown-subtitle">Hintergrund</div>
              <div className="canvas-grid-pills">
                {(['dots', 'lines', 'off'] as const).map((variant) => (
                  <button
                    key={variant}
                    type="button"
                    className={`canvas-grid-pill-btn ${activeGridConfig.gridVariant === variant ? 'active' : ''}`}
                    onClick={() =>
                      handleGridConfigChange({
                        ...activeGridConfig,
                        gridVariant: variant,
                        showGrid: variant !== 'off',
                      })
                    }
                  >
                    {variant === 'dots' ? 'Punkte' : variant === 'lines' ? 'Linien' : 'Aus'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
