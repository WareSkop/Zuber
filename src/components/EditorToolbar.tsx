import React, { useState, useRef, useEffect } from 'react';
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
  Plus,
  Image,
  Camera,
  ChevronDown,
  Columns,
  Rows,
  Minus,
} from 'lucide-react';
import type { LivePreviewEditorRef } from './LivePreviewEditor';

interface EditorToolbarProps {
  editorRef: React.RefObject<LivePreviewEditorRef | null>;
  onUploadImage: (file: File) => Promise<string | void>;
  visible?: boolean;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  editorRef,
  onUploadImage,
  visible = true,
}) => {
  const [headingMenuOpen, setHeadingMenuOpen] = useState(false);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [imageMenuOpen, setImageMenuOpen] = useState(false);
  const [calloutMenuOpen, setCalloutMenuOpen] = useState(false);

  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  if (!visible) return null;

  const handleFormat = (type: 'bold' | 'italic' | 'strikethrough' | 'highlight' | 'code') => {
    editorRef.current?.applyFormat(type);
  };

  const handleHeading = (level: number) => {
    editorRef.current?.insertHeading(level);
    setHeadingMenuOpen(false);
  };

  const handleInsertTable = (r = tableRows, c = tableCols) => {
    editorRef.current?.insertTable(r, c);
    setTableMenuOpen(false);
  };

  const handleAddTableRow = () => {
    editorRef.current?.insertTableRow();
    setTableMenuOpen(false);
  };

  const handleAddTableCol = () => {
    editorRef.current?.insertTableColumn();
    setTableMenuOpen(false);
  };

  const handleInsertCallout = (type: string) => {
    editorRef.current?.insertCallout(type);
    setCalloutMenuOpen(false);
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
    setImageMenuOpen(false);
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
        {/* Headings */}
        <div className="toolbar-item-relative">
          <button
            type="button"
            className={`toolbar-btn ${headingMenuOpen ? 'active' : ''}`}
            onClick={() => {
              setHeadingMenuOpen(!headingMenuOpen);
              setTableMenuOpen(false);
              setImageMenuOpen(false);
              setCalloutMenuOpen(false);
            }}
            title="Überschriften (H1 - H6)"
          >
            <Heading size={16} />
            <ChevronDown size={11} className="toolbar-chevron" />
          </button>
          {headingMenuOpen && (
            <div className="toolbar-popover-menu">
              <button type="button" onClick={() => handleHeading(1)} className="popover-item">
                <Heading1 size={15} /> <span>Titel 1 (H1)</span>
              </button>
              <button type="button" onClick={() => handleHeading(2)} className="popover-item">
                <Heading2 size={15} /> <span>Titel 2 (H2)</span>
              </button>
              <button type="button" onClick={() => handleHeading(3)} className="popover-item">
                <Heading3 size={15} /> <span>Titel 3 (H3)</span>
              </button>
              <button type="button" onClick={() => handleHeading(4)} className="popover-item">
                <span>H4 Überschrift 4</span>
              </button>
              <button type="button" onClick={() => handleHeading(5)} className="popover-item">
                <span>H5 Überschrift 5</span>
              </button>
              <button type="button" onClick={() => handleHeading(6)} className="popover-item">
                <span>H6 Überschrift 6</span>
              </button>
            </div>
          )}
        </div>

        <div className="toolbar-separator" />

        {/* Text Styles */}
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => handleFormat('bold')}
          title="Fett (Strg+B)"
        >
          <Bold size={16} />
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => handleFormat('italic')}
          title="Kursiv (Strg+I)"
        >
          <Italic size={16} />
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => handleFormat('strikethrough')}
          title="Durchgestrichen (~~Text~~)"
        >
          <Strikethrough size={16} />
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => handleFormat('highlight')}
          title="Textmarker / Highlight (==Text==)"
        >
          <Highlighter size={16} />
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => handleFormat('code')}
          title="Inline-Code (`Code`)"
        >
          <Code size={16} />
        </button>

        <div className="toolbar-separator" />

        {/* Lists & Indents */}
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => editorRef.current?.insertList('bullet')}
          title="Aufzählungsliste (- Liste)"
        >
          <List size={16} />
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => editorRef.current?.insertList('number')}
          title="Nummerierte Liste (1. Liste)"
        >
          <ListOrdered size={16} />
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => editorRef.current?.insertTask()}
          title="Aufgabenliste (- [ ] Aufgabe)"
        >
          <CheckSquare size={16} />
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => editorRef.current?.indent()}
          title="Einrücken (+2 Leerzeichen)"
        >
          <Indent size={16} />
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => editorRef.current?.outdent()}
          title="Ausrücken (-2 Leerzeichen)"
        >
          <Outdent size={16} />
        </button>

        <div className="toolbar-separator" />

        {/* Links & Autocomplete triggers */}
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => editorRef.current?.insertWikiLink(true)}
          title="Wiki-Link ([[Notiz]])"
        >
          <Link2 size={16} />
          <span className="toolbar-btn-text">[[ ]]</span>
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => editorRef.current?.insertTag(true)}
          title="Tag einfügen (#tag)"
        >
          <Hash size={16} />
        </button>

        <div className="toolbar-separator" />

        {/* Blocks: Table, Quote, Callout, Codeblock */}
        <div className="toolbar-item-relative">
          <button
            type="button"
            className={`toolbar-btn ${tableMenuOpen ? 'active' : ''}`}
            onClick={() => {
              setTableMenuOpen(!tableMenuOpen);
              setHeadingMenuOpen(false);
              setImageMenuOpen(false);
              setCalloutMenuOpen(false);
            }}
            title="Markdown-Tabelle"
          >
            <Table size={16} />
            <ChevronDown size={11} className="toolbar-chevron" />
          </button>
          {tableMenuOpen && (
            <div className="toolbar-popover-menu table-popover">
              <div className="table-popover-title">Tabelle einfügen</div>
              <div className="table-quick-presets">
                <button type="button" onClick={() => handleInsertTable(2, 2)} className="table-preset-btn">
                  2×2
                </button>
                <button type="button" onClick={() => handleInsertTable(3, 3)} className="table-preset-btn">
                  3×3
                </button>
                <button type="button" onClick={() => handleInsertTable(4, 4)} className="table-preset-btn">
                  4×4
                </button>
              </div>
              <div className="table-custom-row">
                <label>
                  <span>Spalten:</span>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={tableCols}
                    onChange={(e) => setTableCols(Number(e.target.value))}
                  />
                </label>
                <label>
                  <span>Zeilen:</span>
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
                onClick={() => handleInsertTable()}
              >
                + Tabelle erstellen
              </button>

              {inTable && (
                <div className="table-inside-actions">
                  <div className="table-popover-subtitle">Aktive Tabelle</div>
                  <button type="button" onClick={handleAddTableRow} className="popover-item">
                    <Rows size={14} /> <span>+ Zeile darunter</span>
                  </button>
                  <button type="button" onClick={handleAddTableCol} className="popover-item">
                    <Columns size={14} /> <span>+ Spalte rechts</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className="toolbar-btn"
          onClick={() => editorRef.current?.insertQuote()}
          title="Zitatblock (> Zitat)"
        >
          <Quote size={16} />
        </button>

        {/* Callouts */}
        <div className="toolbar-item-relative">
          <button
            type="button"
            className={`toolbar-btn ${calloutMenuOpen ? 'active' : ''}`}
            onClick={() => {
              setCalloutMenuOpen(!calloutMenuOpen);
              setHeadingMenuOpen(false);
              setTableMenuOpen(false);
              setImageMenuOpen(false);
            }}
            title="Obsidian Callout (> [!NOTE])"
          >
            <AlertCircle size={16} />
            <ChevronDown size={11} className="toolbar-chevron" />
          </button>
          {calloutMenuOpen && (
            <div className="toolbar-popover-menu">
              <button type="button" onClick={() => handleInsertCallout('note')} className="popover-item">
                <span className="callout-pill note">NOTE</span> <span>Hinweis</span>
              </button>
              <button type="button" onClick={() => handleInsertCallout('tip')} className="popover-item">
                <span className="callout-pill tip">TIP</span> <span>Tipp</span>
              </button>
              <button type="button" onClick={() => handleInsertCallout('important')} className="popover-item">
                <span className="callout-pill important">IMPORTANT</span> <span>Wichtig</span>
              </button>
              <button type="button" onClick={() => handleInsertCallout('warning')} className="popover-item">
                <span className="callout-pill warning">WARNING</span> <span>Warnung</span>
              </button>
              <button type="button" onClick={() => handleInsertCallout('caution')} className="popover-item">
                <span className="callout-pill caution">CAUTION</span> <span>Achtung</span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          className="toolbar-btn"
          onClick={() => editorRef.current?.insertCodeBlock()}
          title="Codeblock (```lang)"
        >
          <Terminal size={16} />
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => editorRef.current?.insertHorizontalRule()}
          title="Trennlinie (---)"
        >
          <Minus size={16} />
        </button>

        <div className="toolbar-separator" />

        {/* Image & Camera Upload */}
        <div className="toolbar-item-relative">
          <button
            type="button"
            className={`toolbar-btn ${imageMenuOpen ? 'active' : ''}`}
            onClick={() => {
              setImageMenuOpen(!imageMenuOpen);
              setHeadingMenuOpen(false);
              setTableMenuOpen(false);
              setCalloutMenuOpen(false);
            }}
            title="Bild einfügen oder Foto aufnehmen"
          >
            <Image size={16} />
            <ChevronDown size={11} className="toolbar-chevron" />
          </button>
          {imageMenuOpen && (
            <div className="toolbar-popover-menu image-popover">
              <button
                type="button"
                className="popover-item"
                onClick={() => fileInputRef.current?.click()}
              >
                <Image size={15} /> <span>Foto/Datei aus Galerie</span>
              </button>
              <button
                type="button"
                className="popover-item"
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera size={15} /> <span>Foto mit Kamera aufnehmen</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
