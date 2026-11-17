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
  Presentation,
  Image as ImageIcon,
  Upload,
} from 'lucide-react';
import type { CanvasShape } from '../../../shared/canvasTypes';
import { isImageFilePath } from './nodes/canvasShapeGeometry';
import { stripZencExt } from '../../crypto/folderCrypto';
import { useTranslation } from '../../i18n';

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
  allFiles?: { path: string; name: string; basename?: string }[];
  onUploadImageFiles?: (files: File[]) => void | Promise<void>;
  isPresentationPanelOpen?: boolean;
  onTogglePresentationPanel?: () => void;
  presentationSlideCount?: number;
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
  allFiles = [],
  onUploadImageFiles,
  isPresentationPanelOpen = false,
  onTogglePresentationPanel,
  presentationSlideCount = 0,
}) => {
  const { t } = useTranslation();
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
  const [openDropdown, setOpenDropdown] = useState<'workflow' | 'network' | 'file' | 'image' | 'grid' | null>(null);
  const [fileSearch, setFileSearch] = useState('');
  const [imageSearch, setImageSearch] = useState('');
  const toolbarRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

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

  const filteredImages = allFiles
    .filter((f) => isImageFilePath(f.path))
    .filter(
      (f) =>
        !imageSearch ||
        f.name.toLowerCase().includes(imageSearch.toLowerCase()) ||
        f.path.toLowerCase().includes(imageSearch.toLowerCase())
    )
    .slice(0, 20);

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
          title={t('canvas.addTextTooltip')}
        >
          <Plus size={15} />
          <span>{t('canvas.addText')}</span>
        </button>

        {/* Embed note/file picker */}
        <div className="canvas-toolbar-dropdown">
          <button
            type="button"
            className={`canvas-toolbar-btn ${openDropdown === 'file' ? 'active' : ''}`}
            onClick={() => setOpenDropdown((prev) => (prev === 'file' ? null : 'file'))}
            title={t('canvas.addFileTooltip')}
          >
            <FileText size={15} />
            <span>{t('canvas.addFile')}</span>
            <ChevronDown size={12} />
          </button>

          {openDropdown === 'file' && (
            <div ref={dropdownRef} className="canvas-dropdown-menu canvas-file-picker-menu">
              <div className="canvas-picker-search-row">
                <Search size={14} />
                <input
                  type="text"
                  autoFocus
                  placeholder={t('canvas.searchFilesPlaceholder')}
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                />
              </div>
              <div className="canvas-picker-list scroller">
                {filteredNotes.length === 0 ? (
                  <div className="canvas-picker-empty">{t('canvas.noFilesFound')}</div>
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

        {/* Embed / Upload Image picker */}
        <div className="canvas-toolbar-dropdown">
          <button
            type="button"
            className={`canvas-toolbar-btn ${openDropdown === 'image' ? 'active' : ''}`}
            onClick={() => setOpenDropdown((prev) => (prev === 'image' ? null : 'image'))}
            title={t('canvas.addImageTooltip')}
          >
            <ImageIcon size={15} />
            <span>{t('canvas.addImage')}</span>
            <ChevronDown size={12} />
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*,.svg"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              if (files.length > 0 && onUploadImageFiles) {
                void onUploadImageFiles(files);
              }
              e.target.value = '';
              setOpenDropdown(null);
            }}
          />

          {openDropdown === 'image' && (
            <div ref={dropdownRef} className="canvas-dropdown-menu canvas-file-picker-menu">
              {onUploadImageFiles && (
                <button
                  type="button"
                  className="canvas-dropdown-item canvas-upload-image-item"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <Upload size={14} />
                  <span>{t('canvas.uploadImage')}</span>
                </button>
              )}
              <div className="canvas-picker-search-row">
                <Search size={14} />
                <input
                  type="text"
                  autoFocus
                  placeholder={t('canvas.searchImagesPlaceholder')}
                  value={imageSearch}
                  onChange={(e) => setImageSearch(e.target.value)}
                />
              </div>
              <div className="canvas-picker-list scroller">
                {filteredImages.length === 0 ? (
                  <div className="canvas-picker-empty">{t('canvas.noImagesFound')}</div>
                ) : (
                  filteredImages.map((img) => {
                    const logical = stripZencExt(img.path);
                    const title = stripZencExt(img.basename || img.name);
                    return (
                      <button
                        key={img.path}
                        type="button"
                        className="canvas-dropdown-item"
                        onClick={() => {
                          onAddFileNode(img.path);
                          setOpenDropdown(null);
                        }}
                      >
                        <span className="picker-item-title">{title}</span>
                        <span className="picker-item-path">{logical}</span>
                      </button>
                    );
                  })
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
          title={t('canvas.addGroupTooltip')}
        >
          <FolderPlus size={15} />
          <span>{t('canvas.addGroup')}</span>
        </button>

        {/* Workflow Shapes Dropdown */}
        <div className="canvas-toolbar-dropdown">
          <button
            type="button"
            className={`canvas-toolbar-btn ${openDropdown === 'workflow' ? 'active' : ''}`}
            onClick={() => setOpenDropdown((prev) => (prev === 'workflow' ? null : 'workflow'))}
            title={t('canvas.workflowTooltip')}
          >
            <GitBranch size={15} />
            <span>{t('canvas.workflow')}</span>
            <ChevronDown size={12} />
          </button>

          {openDropdown === 'workflow' && (
            <div ref={dropdownRef} className="canvas-dropdown-menu">
              <div className="canvas-dropdown-title">{t('canvas.workflowShapes')}</div>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('rectangle');
                  setOpenDropdown(null);
                }}
              >
                <Square size={15} /> <span>{t('canvas.shapeProcess')}</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('rounded');
                  setOpenDropdown(null);
                }}
              >
                <div className="palette-icon-rounded" /> <span>{t('canvas.shapeStartEnd')}</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('circle');
                  setOpenDropdown(null);
                }}
              >
                <Circle size={15} /> <span>{t('canvas.shapeTerminal')}</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('diamond');
                  setOpenDropdown(null);
                }}
              >
                <Diamond size={15} /> <span>{t('canvas.shapeDecision')}</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('parallelogram');
                  setOpenDropdown(null);
                }}
              >
                <div className="palette-icon-parallel" /> <span>{t('canvas.shapeIo')}</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('hexagon');
                  setOpenDropdown(null);
                }}
              >
                <div className="palette-icon-hexagon" /> <span>{t('canvas.shapeConditionFilter')}</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('cylinder');
                  setOpenDropdown(null);
                }}
              >
                <Database size={15} /> <span>{t('canvas.shapeDatabase')}</span>
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
            title={t('canvas.networkTooltip')}
          >
            <Network size={15} />
            <span>{t('canvas.network')}</span>
            <ChevronDown size={12} />
          </button>

          {openDropdown === 'network' && (
            <div ref={dropdownRef} className="canvas-dropdown-menu">
              <div className="canvas-dropdown-title">{t('canvas.networkShapes')}</div>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('server');
                  setOpenDropdown(null);
                }}
              >
                <Server size={15} /> <span>{t('canvas.shapeServerHost')}</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('router');
                  setOpenDropdown(null);
                }}
              >
                <Network size={15} /> <span>{t('canvas.shapeRouter')}</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('cloud');
                  setOpenDropdown(null);
                }}
              >
                <Cloud size={15} /> <span>{t('canvas.shapeCloud')}</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('workstation');
                  setOpenDropdown(null);
                }}
              >
                <Monitor size={15} /> <span>{t('canvas.shapeWorkstation')}</span>
              </button>
              <button
                type="button"
                className="canvas-dropdown-item"
                onClick={() => {
                  onAddTextNode('cylinder');
                  setOpenDropdown(null);
                }}
              >
                <Database size={15} /> <span>{t('canvas.shapeDatabase')}</span>
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
          title={t('canvas.undoShortcut')}
          aria-label={t('canvas.undo')}
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          className="canvas-toolbar-btn icon-only"
          onClick={onRedo}
          disabled={!canRedo}
          title={`${t('canvas.redo')} (Ctrl+Y)`}
          aria-label={t('canvas.redo')}
        >
          <Redo2 size={16} />
        </button>
        <button
          type="button"
          className="canvas-toolbar-btn icon-only"
          onClick={onFitView}
          title={t('canvas.fitView')}
          aria-label={t('canvas.fitViewAria')}
        >
          <Maximize2 size={16} />
        </button>
        <button
          type="button"
          className={`canvas-toolbar-btn icon-only ${isSelectionToolActive ? 'active' : ''}`}
          onClick={onToggleSelectionTool}
          title={
            isSelectionToolActive
              ? t('canvas.marqueeActive')
              : t('canvas.marqueeToggle')
          }
          aria-label={t('canvas.marqueeAria')}
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
            title={t('canvas.gridTooltip', {
              snap: activeGridConfig.snapToGrid ? t('canvas.snapOn') : t('canvas.snapOff'),
              size: activeGridConfig.gridSize,
            })}
            aria-label={t('canvas.gridSettings')}
          >
            <Grid size={16} />
          </button>

          {openDropdown === 'grid' && (
            <div ref={dropdownRef} className="canvas-dropdown-menu canvas-grid-menu">
              <div className="canvas-dropdown-title">{t('canvas.gridAndSnap')}</div>

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
                <span>{activeGridConfig.snapToGrid ? t('canvas.snapActiveLabel') : t('canvas.snapInactiveLabel')}</span>
              </button>

              <div className="canvas-dropdown-divider" />
              <div className="canvas-dropdown-subtitle">{t('canvas.gridSize')}</div>
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
              <div className="canvas-dropdown-subtitle">{t('canvas.backgroundLabel')}</div>
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
                    {variant === 'dots' ? t('canvas.gridDots') : variant === 'lines' ? t('canvas.gridLines') : t('canvas.gridOff')}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {onTogglePresentationPanel && (
          <>
            <div className="canvas-toolbar-divider" />
            <button
              type="button"
              className={`canvas-toolbar-btn canvas-presentation-toggle-btn ${isPresentationPanelOpen ? 'active' : ''}`}
              onClick={() => {
                onTogglePresentationPanel();
                setOpenDropdown(null);
              }}
              title={t('canvas.presentation.toolbarTitle')}
              aria-label={t('canvas.presentation.toolbarTitle')}
            >
              <Presentation size={15} />
              <span>{t('canvas.presentation.toolbarButton')}</span>
              {presentationSlideCount > 0 && (
                <span className="canvas-presentation-count-badge">{presentationSlideCount}</span>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
