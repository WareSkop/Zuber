import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Bold,
  Italic,
  Strikethrough,
  Highlighter,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading,
  List,
  ListOrdered,
  CheckSquare,
  Indent,
  Outdent,
  Link2,
  Hash,
  Quote,
  AlertCircle,
  Terminal,
  Table,
  Image,
  Camera,
  ChevronDown,
  Columns,
  Rows,
  Minus,
  Type,
  Info,
  HelpCircle,
  AlertTriangle,
  Flame,
} from 'lucide-react';
import type { LivePreviewEditorRef } from './LivePreviewEditor';
import { useTranslation } from '../i18n';

interface EditorToolbarProps {
  editorRef: React.RefObject<LivePreviewEditorRef | null>;
  onUploadImage: (file: File) => Promise<string | void>;
  visible?: boolean;
}

type OpenMenuType = 'heading' | 'table' | 'callout' | 'image' | null;

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  editorRef,
  onUploadImage,
  visible = true,
}) => {
  const { t } = useTranslation();
  const [openMenu, setOpenMenu] = useState<OpenMenuType>(null);
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const activeTriggerRef = useRef<HTMLElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close popover when clicking outside or pressing Escape
  useEffect(() => {
    if (!openMenu) return;

    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (activeTriggerRef.current?.contains(target)) return;
      setOpenMenu(null);
      activeTriggerRef.current = null;
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenu(null);
        activeTriggerRef.current = null;
      }
    };

    const handleScroll = (e: Event) => {
      // If scroll happens outside the popover itself, close the popover
      if (popoverRef.current?.contains(e.target as Node)) return;
      setOpenMenu(null);
      activeTriggerRef.current = null;
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [openMenu]);

  if (!visible) return null;

  const toggleMenu = (menu: OpenMenuType, triggerEl: HTMLElement) => {
    if (openMenu === menu) {
      setOpenMenu(null);
      activeTriggerRef.current = null;
    } else {
      const rect = triggerEl.getBoundingClientRect();
      const popoverWidth = menu === 'table' ? 240 : 210;
      const maxLeft = Math.max(8, window.innerWidth - popoverWidth - 10);
      setMenuCoords({
        top: rect.bottom + 4,
        left: Math.min(Math.max(8, rect.left), maxLeft),
      });
      activeTriggerRef.current = triggerEl;
      setOpenMenu(menu);
    }
  };

  const handleFormat = (type: 'bold' | 'italic' | 'strikethrough' | 'highlight' | 'code') => {
    editorRef.current?.applyFormat(type);
  };

  const handleHeading = (level: number) => {
    editorRef.current?.insertHeading(level);
    setOpenMenu(null);
    activeTriggerRef.current = null;
  };

  const handleInsertTable = (r = tableRows, c = tableCols) => {
    editorRef.current?.insertTable(r, c);
    setOpenMenu(null);
    activeTriggerRef.current = null;
  };

  const handleAddTableRow = () => {
    editorRef.current?.insertTableRow();
    setOpenMenu(null);
    activeTriggerRef.current = null;
  };

  const handleAddTableCol = () => {
    editorRef.current?.insertTableColumn();
    setOpenMenu(null);
    activeTriggerRef.current = null;
  };

  const handleInsertCallout = (type: string) => {
    editorRef.current?.insertCallout(type);
    setOpenMenu(null);
    activeTriggerRef.current = null;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const embed = await onUploadImage(file);
        if (embed) {
          editorRef.current?.insertImageEmbed(embed);
        }
      } catch (err) {
        console.error('Upload-Fehler in EditorToolbar:', err);
      }
    }
    e.target.value = '';
    setOpenMenu(null);
    activeTriggerRef.current = null;
  };

  const inTable = editorRef.current?.isCursorInTable() ?? false;

  return (
    <div className="mobile-editor-toolbar" role="toolbar" aria-label="Markdown-Formatierungsleiste">
      {/* Hidden file inputs for Gallery & Camera */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <div className="toolbar-scroll-group">
        {/* Headings Dropdown */}
        <div className="toolbar-item-relative">
          <button
            type="button"
            className={`toolbar-btn ${openMenu === 'heading' ? 'active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => toggleMenu('heading', e.currentTarget)}
            title="Überschriften (H1 - H6 & Normaler Text)"
            aria-haspopup="true"
            aria-expanded={openMenu === 'heading'}
          >
            <Heading size={16} />
            <ChevronDown size={11} className="toolbar-chevron" />
          </button>
        </div>

        <div className="toolbar-separator" />

        {/* Text Styles */}
        <button
          type="button"
          className="toolbar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat('bold')}
          title={t('toolbar.bold')}
        >
          <Bold size={16} />
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat('italic')}
          title={t('toolbar.italic')}
        >
          <Italic size={16} />
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat('strikethrough')}
          title={t('toolbar.strikethrough')}
        >
          <Strikethrough size={16} />
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat('highlight')}
          title={t('toolbar.highlight')}
        >
          <Highlighter size={16} />
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat('code')}
          title={t('toolbar.code')}
        >
          <Code size={16} />
        </button>

        <div className="toolbar-separator" />

        {/* Lists & Indents */}
        <button
          type="button"
          className="toolbar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editorRef.current?.insertList('bullet')}
          title={t('toolbar.bulletList')}
        >
          <List size={16} />
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editorRef.current?.insertList('number')}
          title={t('toolbar.numberList')}
        >
          <ListOrdered size={16} />
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editorRef.current?.insertTask()}
          title={t('toolbar.taskList')}
        >
          <CheckSquare size={16} />
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editorRef.current?.indent()}
          title={t('toolbar.indent')}
        >
          <Indent size={16} />
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editorRef.current?.outdent()}
          title={t('toolbar.outdent')}
        >
          <Outdent size={16} />
        </button>

        <div className="toolbar-separator" />

        {/* Links & Autocomplete triggers */}
        <button
          type="button"
          className="toolbar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editorRef.current?.insertWikiLink(true)}
          title={t('toolbar.wikilink')}
        >
          <Link2 size={16} />
          <span className="toolbar-btn-text">[[ ]]</span>
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editorRef.current?.insertTag(true)}
          title={t('toolbar.tag')}
        >
          <Hash size={16} />
        </button>

        <div className="toolbar-separator" />

        {/* Blocks: Table Dropdown, Quote, Callout Dropdown, Codeblock */}
        <div className="toolbar-item-relative">
          <button
            type="button"
            className={`toolbar-btn ${openMenu === 'table' ? 'active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => toggleMenu('table', e.currentTarget)}
            title={t('toolbar.table')}
            aria-haspopup="true"
            aria-expanded={openMenu === 'table'}
          >
            <Table size={16} />
            <ChevronDown size={11} className="toolbar-chevron" />
          </button>
        </div>

        <button
          type="button"
          className="toolbar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editorRef.current?.insertQuote()}
          title={t('toolbar.quote')}
        >
          <Quote size={16} />
        </button>

        {/* Callouts Dropdown */}
        <div className="toolbar-item-relative">
          <button
            type="button"
            className={`toolbar-btn ${openMenu === 'callout' ? 'active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => toggleMenu('callout', e.currentTarget)}
            title={t('toolbar.callout')}
            aria-haspopup="true"
            aria-expanded={openMenu === 'callout'}
          >
            <AlertCircle size={16} />
            <ChevronDown size={11} className="toolbar-chevron" />
          </button>
        </div>

        <button
          type="button"
          className="toolbar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editorRef.current?.insertCodeBlock()}
          title={t('toolbar.codeblock')}
        >
          <Terminal size={16} />
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editorRef.current?.insertHorizontalRule()}
          title={t('toolbar.horizontalRule')}
        >
          <Minus size={16} />
        </button>

        <div className="toolbar-separator" />

        {/* Image & Camera Upload Dropdown */}
        <div className="toolbar-item-relative">
          <button
            type="button"
            className={`toolbar-btn ${openMenu === 'image' ? 'active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => toggleMenu('image', e.currentTarget)}
            title={t('toolbar.image')}
            aria-haspopup="true"
            aria-expanded={openMenu === 'image'}
          >
            <Image size={16} />
            <ChevronDown size={11} className="toolbar-chevron" />
          </button>
        </div>
      </div>

      {/* Render Popover via React Portal to prevent CSS overflow clipping */}
      {openMenu &&
        createPortal(
          <div
            ref={popoverRef}
            className="toolbar-popover-menu toolbar-popover-portal"
            style={{
              position: 'fixed',
              top: `${menuCoords.top}px`,
              left: `${menuCoords.left}px`,
              zIndex: 1000,
            }}
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).tagName !== 'INPUT') {
                e.preventDefault();
              }
            }}
          >
            {openMenu === 'heading' && (
              <>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleHeading(0)}
                  className="popover-item"
                >
                  <Type size={15} /> <span>{t('toolbar.paragraph')}</span>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleHeading(1)}
                  className="popover-item"
                >
                  <Heading1 size={15} /> <span>{t('toolbar.h1')}</span>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleHeading(2)}
                  className="popover-item"
                >
                  <Heading2 size={15} /> <span>{t('toolbar.h2')}</span>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleHeading(3)}
                  className="popover-item"
                >
                  <Heading3 size={15} /> <span>{t('toolbar.h3')}</span>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleHeading(4)}
                  className="popover-item"
                >
                  <span className="popover-heading-badge">H4</span> <span>H4</span>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleHeading(5)}
                  className="popover-item"
                >
                  <span className="popover-heading-badge">H5</span> <span>H5</span>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleHeading(6)}
                  className="popover-item"
                >
                  <span className="popover-heading-badge">H6</span> <span>H6</span>
                </button>
              </>
            )}

            {openMenu === 'table' && (
              <div className="table-popover-content">
                <div className="table-popover-title">{t('toolbar.table')}</div>
                <div className="table-quick-presets">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleInsertTable(2, 2)}
                    className="table-preset-btn"
                  >
                    2×2
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleInsertTable(3, 3)}
                    className="table-preset-btn"
                  >
                    3×3
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleInsertTable(4, 4)}
                    className="table-preset-btn"
                  >
                    4×4
                  </button>
                </div>
                <div className="table-custom-row">
                  <label>
                    <span>{t('toolbar.tableCols')}:</span>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={tableCols}
                      onChange={(e) => setTableCols(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    <span>{t('toolbar.tableRows')}:</span>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={tableRows}
                      onChange={(e) => setTableRows(Number(e.target.value))}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="btn-popover-primary"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleInsertTable()}
                >
                  {t('toolbar.insertTableBtn')}
                </button>

                {inTable && (
                  <div className="table-inside-actions">
                    <div className="table-popover-subtitle">{t('toolbar.activeTable')}</div>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleAddTableRow}
                      className="popover-item"
                    >
                      <Rows size={14} /> <span>{t('toolbar.addRowBelow')}</span>
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleAddTableCol}
                      className="popover-item"
                    >
                      <Columns size={14} /> <span>{t('toolbar.addColRight')}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {openMenu === 'callout' && (
              <>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleInsertCallout('note')}
                  className="popover-item"
                >
                  <span className="callout-pill note">NOTE</span> <span>{t('toolbar.noteCallout')}</span>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleInsertCallout('info')}
                  className="popover-item"
                >
                  <span className="callout-pill info">INFO</span> <span>{t('toolbar.infoCallout')}</span>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleInsertCallout('tip')}
                  className="popover-item"
                >
                  <span className="callout-pill tip">TIP</span> <span>{t('toolbar.tipCallout')}</span>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleInsertCallout('warning')}
                  className="popover-item"
                >
                  <span className="callout-pill warning">WARNING</span> <span>{t('toolbar.warningCallout')}</span>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleInsertCallout('danger')}
                  className="popover-item"
                >
                  <span className="callout-pill danger">DANGER</span> <span>{t('toolbar.dangerCallout')}</span>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleInsertCallout('question')}
                  className="popover-item"
                >
                  <span className="callout-pill question">QUESTION</span> <span>{t('toolbar.questionCallout')}</span>
                </button>
              </>
            )}

            {openMenu === 'image' && (
              <div className="image-popover">
                <button
                  type="button"
                  className="popover-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    fileInputRef.current?.click();
                    setOpenMenu(null);
                  }}
                >
                  <Image size={15} /> <span>{t('toolbar.uploadImage')}</span>
                </button>
                <button
                  type="button"
                  className="popover-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    cameraInputRef.current?.click();
                    setOpenMenu(null);
                  }}
                >
                  <Camera size={15} /> <span>{t('toolbar.takePhoto')}</span>
                </button>
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
};
