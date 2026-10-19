import React, { useEffect, useRef, useMemo, useImperativeHandle, forwardRef } from 'react';
import {
  EditorState,
  RangeSetBuilder,
  Compartment,
} from '@codemirror/state';
import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  keymap,
  placeholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import {
  autocompletion,
  startCompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { createRoot, type Root } from 'react-dom/client';
import { api } from '../api';
import { CanvasEmbedWidget } from './canvas/CanvasEmbedWidget';

export type EditorMode = 'live' | 'reading' | 'source';

export interface LivePreviewEditorRef {
  applyFormat: (formatType: 'bold' | 'italic' | 'strikethrough' | 'highlight' | 'code') => void;
  insertTable: (rows?: number, cols?: number) => void;
  insertCodeBlock: (lang?: string) => void;
  insertTask: () => void;
  insertWikiLink: (openAutocomplete?: boolean) => void;
  insertTag: (openAutocomplete?: boolean) => void;
  insertHeading: (level: number) => void;
  insertList: (type: 'bullet' | 'number') => void;
  indent: () => void;
  outdent: () => void;
  insertQuote: () => void;
  insertCallout: (type?: string) => void;
  insertHorizontalRule: () => void;
  isCursorInTable: () => boolean;
  insertTableRow: () => void;
  insertTableColumn: () => void;
  insertImageEmbed: (embedTag: string) => void;
  insertExternalLink: (linkText?: string, linkUrl?: string) => void;
  getSelectedText: () => string;
  focus: () => void;
}

export interface LivePreviewEditorProps {
  notePath: string;
  body: string;
  rawContent: string;
  mode: EditorMode;
  allNotes: { path: string; name: string; basename: string }[];
  allTags: string[];
  scrollToLine?: number | null;
  onChangeBody: (newBody: string) => void;
  onChangeRaw: (newRaw: string) => void;
  onNavigateWikiLink: (target: string) => void;
  onSelectTag: (tag: string) => void;
  onUploadAttachment?: (file: File) => Promise<string>;
}

const IMAGE_EXT_REGEX = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const TABLE_SEPARATOR_REGEX = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;
const isTableRow = (text: string) => text.includes('|') && text.trim().length > 0;

function splitTableCells(rowText: string): string[] {
  let trimmed = rowText.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((c) => c.trim());
}

function parseAlignments(sepText: string): ('left' | 'center' | 'right')[] {
  return splitTableCells(sepText).map((cell) => {
    const c = cell.trim();
    if (c.startsWith(':') && c.endsWith(':')) return 'center';
    if (c.endsWith(':')) return 'right';
    return 'left';
  });
}

function formatCellInlineHtml(cell: string, notePath: string): string {
  const escaped = cell
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const html = escaped
    // ![[image]]
    .replace(/!\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_m, t, alt) => {
      const target = String(t).trim();
      const url = api.getAttachmentUrl(target, notePath);
      return `<img src="${url}" alt="${alt || target}" class="cm-table-inline-img" loading="lazy" decoding="async" />`;
    })
    // ![alt](url)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, href) => {
      const target = String(href).trim();
      const url = /^(https?:|data:)/i.test(target)
        ? target
        : api.getAttachmentUrl(target, notePath);
      return `<img src="${url}" alt="${alt || target}" class="cm-table-inline-img" loading="lazy" decoding="async" />`;
    })
    // [[WikiLink|Alias]]
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_m, t, alias) => {
      const target = String(t).trim();
      const label = alias ? String(alias).trim() : target;
      return `<span class="cm-wikilink-widget" data-wikilink="${target}">${label}</span>`;
    })
    // [label](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
      return `<span class="cm-wikilink-widget" data-wikilink="${String(href).trim()}">${label}</span>`;
    })
    // **bold**
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // *italic*
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // ==highlight==
    .replace(/==([^=]+)==/g, '<mark class="cm-lp-highlight">$1</mark>')
    // `code`
    .replace(/`([^`]+)`/g, '<code class="cm-lp-inline-code">$1</code>');

  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-wiki-target', 'data-wikilink', 'data-tag', 'target', 'loading', 'decoding', 'align'],
  });
}

class TableWidget extends WidgetType {
  constructor(
    readonly rawLines: string[],
    readonly linePositions: number[],
    readonly notePath: string,
    readonly onNavigate: (target: string) => void
  ) {
    super();
  }

  eq(other: TableWidget) {
    return (
      other.notePath === this.notePath &&
      other.rawLines.length === this.rawLines.length &&
      other.rawLines.every((l, idx) => l === this.rawLines[idx]) &&
      other.linePositions[0] === this.linePositions[0]
    );
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-lp-table-widget';

    const table = document.createElement('table');
    table.className = 'knowmesh-table obsidian-table';

    const headerCells = splitTableCells(this.rawLines[0] || '');
    const alignments = parseAlignments(this.rawLines[1] || '');
    const colCount = Math.max(headerCells.length, alignments.length);

    const thead = document.createElement('thead');
    const headTr = document.createElement('tr');
    for (let c = 0; c < colCount; c++) {
      const th = document.createElement('th');
      th.style.textAlign = alignments[c] || 'left';
      th.innerHTML = formatCellInlineHtml(headerCells[c] ?? '', this.notePath);
      headTr.appendChild(th);
    }
    headTr.addEventListener('mousedown', (e) => {
      const linkEl = (e.target as HTMLElement).closest('[data-wikilink]');
      if (linkEl) {
        e.preventDefault();
        e.stopPropagation();
        this.onNavigate(linkEl.getAttribute('data-wikilink') || '');
        return;
      }
      e.preventDefault();
      view.dispatch({
        selection: { anchor: this.linePositions[0] },
        scrollIntoView: false,
      });
      view.focus();
    });
    thead.appendChild(headTr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let r = 2; r < this.rawLines.length; r++) {
      const rowCells = splitTableCells(this.rawLines[r]);
      const tr = document.createElement('tr');
      for (let c = 0; c < colCount; c++) {
        const td = document.createElement('td');
        td.style.textAlign = alignments[c] || 'left';
        td.innerHTML = formatCellInlineHtml(rowCells[c] ?? '', this.notePath);
        tr.appendChild(td);
      }
      const targetPos = this.linePositions[r] ?? this.linePositions[0];
      tr.addEventListener('mousedown', (e) => {
        const linkEl = (e.target as HTMLElement).closest('[data-wikilink]');
        if (linkEl) {
          e.preventDefault();
          e.stopPropagation();
          this.onNavigate(linkEl.getAttribute('data-wikilink') || '');
          return;
        }
        e.preventDefault();
        view.dispatch({
          selection: { anchor: targetPos },
          scrollIntoView: false,
        });
        view.focus();
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);
    return wrapper;
  }
}

class WikiLinkWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly display: string,
    readonly onNavigate: (target: string) => void
  ) {
    super();
  }

  eq(other: WikiLinkWidget) {
    return other.target === this.target && other.display === this.display;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-wikilink-widget';
    span.textContent = this.display;
    span.title = `Öffnen: ${this.target}`;
    span.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onNavigate(this.target);
    });
    return span;
  }
}

class ExternalLinkWidget extends WidgetType {
  constructor(
    readonly href: string,
    readonly display: string
  ) {
    super();
  }

  eq(other: ExternalLinkWidget) {
    return other.href === this.href && other.display === this.display;
  }

  toDOM() {
    const a = document.createElement('a');
    a.className = 'cm-external-link-widget external-link';
    a.href = this.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = this.display || this.href;
    a.title = `${this.display ? `${this.display} — ` : ''}${this.href} ↗`;
    a.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    return a;
  }
}

class TagPillWidget extends WidgetType {
  constructor(
    readonly tag: string,
    readonly onSelectTag: (tag: string) => void
  ) {
    super();
  }

  eq(other: TagPillWidget) {
    return other.tag === this.tag;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-tag-widget';
    span.textContent = `#${this.tag}`;
    span.title = `Nach #${this.tag} filtern`;
    span.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onSelectTag(this.tag);
    });
    return span;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
    readonly indentSpaces: number = 0
  ) {
    super();
  }

  eq(other: CheckboxWidget) {
    return (
      other.checked === this.checked &&
      other.pos === this.pos &&
      other.indentSpaces === this.indentSpaces
    );
  }

  toDOM(view: EditorView) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'checkbox-custom cm-task-checkbox';
    input.checked = this.checked;
    if (this.indentSpaces > 0) {
      input.style.marginLeft = `calc(4px + ${this.indentSpaces * 0.65}rem)`;
    }
    input.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const replaceText = this.checked ? '[ ]' : '[x]';
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 3, insert: replaceText },
      });
    });
    return input;
  }
}

class EmbedWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly alt: string,
    readonly notePath: string,
    readonly onNavigate: (target: string) => void,
    readonly width?: number,
    readonly align?: 'left' | 'center' | 'right',
    readonly range?: { from: number; to: number },
    readonly onUpdateTag?: (newTag: string, from: number, to: number) => void
  ) {
    super();
  }

  eq(other: EmbedWidget) {
    return (
      other.target === this.target &&
      other.alt === this.alt &&
      other.notePath === this.notePath &&
      other.width === this.width &&
      other.align === this.align &&
      other.range?.from === this.range?.from &&
      other.range?.to === this.range?.to
    );
  }

  toDOM() {
    const cleanTarget = this.target.split('#')[0].trim();
    const isCanvas = cleanTarget.toLowerCase().endsWith('.canvas');

    if (isCanvas) {
      const container = document.createElement('div');
      container.className = 'cm-embed-widget cm-canvas-embed-wrapper';
      const root = createRoot(container);
      (container as any)._reactRoot = root;
      root.render(
        <CanvasEmbedWidget
          canvasPath={cleanTarget}
          onOpenNote={this.onNavigate}
        />
      );
      return container;
    }

    const isImage = IMAGE_EXT_REGEX.test(cleanTarget);

    if (!isImage) {
      const wrapper = document.createElement('span');
      wrapper.className = 'cm-embed-widget';
      const card = document.createElement('span');
      card.className = 'cm-embedded-note-pill';
      card.textContent = `📄 ${this.alt || cleanTarget}`;
      card.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onNavigate(this.target);
      });
      wrapper.appendChild(card);
      return wrapper;
    }

    // --- Interactive Image Embed Wrapper ---
    const wrapper = document.createElement('span');
    wrapper.className = 'cm-embed-widget cm-image-embed-wrapper';
    if (this.align) {
      wrapper.setAttribute('data-align', this.align);
    }

    let currentWidth = this.width;
    let currentAlign = this.align;

    const img = document.createElement('img');
    img.src = /^(https?:|data:)/i.test(cleanTarget)
      ? cleanTarget
      : api.getAttachmentUrl(cleanTarget, this.notePath);
    img.alt = this.alt || cleanTarget;
    img.className = 'cm-embedded-image';
    img.loading = 'lazy';
    img.decoding = 'async';
    if (currentWidth) {
      img.style.width = `${currentWidth}px`;
      img.setAttribute('width', String(currentWidth));
    }
    if (currentAlign) {
      img.setAttribute('align', currentAlign);
    }

    const applyChange = (newWidth?: number, newAlign?: 'left' | 'center' | 'right') => {
      if (!this.range || !this.onUpdateTag) return;
      currentWidth = newWidth;
      currentAlign = newAlign;

      const parts = [`<img src="${cleanTarget}"`];
      if (this.alt && this.alt !== cleanTarget && !/^\d+$/.test(this.alt)) {
        parts.push(`alt="${this.alt.replace(/"/g, '&quot;')}"`);
      }
      if (currentWidth) {
        parts.push(`width="${currentWidth}"`);
      }
      if (currentAlign) {
        parts.push(`align="${currentAlign}"`);
      }
      parts.push('/>');
      const newTag = parts.join(' ');
      this.onUpdateTag(newTag, this.range.from, this.range.to);
    };

    // Toolbar
    const toolbar = document.createElement('span');
    toolbar.className = 'cm-image-toolbar';

    const createBtn = (alignVal: 'left' | 'center' | 'right' | undefined, title: string, svg: string) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cm-image-btn ${currentAlign === alignVal ? 'active' : ''}`;
      btn.title = title;
      btn.innerHTML = svg;
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyChange(currentWidth, alignVal);
      });
      return btn;
    };

    // Left, Center, Right, Inline buttons
    toolbar.appendChild(
      createBtn(
        'left',
        'Linksbündig (float: left)',
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="15" y1="12" x2="3" y2="12"></line><line x1="17" y1="18" x2="3" y2="18"></line></svg>'
      )
    );
    toolbar.appendChild(
      createBtn(
        'center',
        'Zentriert (margin: auto)',
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="19" y1="12" x2="5" y2="12"></line><line x1="21" y1="18" x2="3" y2="18"></line></svg>'
      )
    );
    toolbar.appendChild(
      createBtn(
        'right',
        'Rechtsbündig (float: right)',
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="12" x2="9" y2="12"></line><line x1="21" y1="18" x2="7" y2="18"></line></svg>'
      )
    );
    toolbar.appendChild(
      createBtn(
        undefined,
        'Inline (Keine Ausrichtung)',
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="12" x2="3" y2="12"></line><line x1="21" y1="18" x2="3" y2="18"></line></svg>'
      )
    );

    const sizeBadge = document.createElement('span');
    sizeBadge.className = 'cm-image-size-badge';
    sizeBadge.textContent = currentWidth ? `${currentWidth} px` : 'Auto';
    toolbar.appendChild(sizeBadge);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'cm-image-btn cm-image-btn-reset';
    resetBtn.title = 'Originalbreite wiederherstellen';
    resetBtn.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>';
    resetBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyChange(undefined, currentAlign);
    });
    toolbar.appendChild(resetBtn);

    // Resize Handles
    const handleSE = document.createElement('span');
    handleSE.className = 'cm-image-resize-handle cm-image-resize-handle-se';
    handleSE.title = 'Bildgröße mit der Maus anpassen (Ziehen)';

    const handleSW = document.createElement('span');
    handleSW.className = 'cm-image-resize-handle cm-image-resize-handle-sw';
    handleSW.title = 'Bildgröße mit der Maus anpassen (Ziehen)';

    const setupDrag = (handle: HTMLElement, isLeft: boolean) => {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = img.offsetWidth || 300;
        wrapper.classList.add('is-resizing');
        document.body.style.cursor = isLeft ? 'nesw-resize' : 'nwse-resize';

        let targetWidth = startW;

        const onMouseMove = (ev: MouseEvent) => {
          ev.preventDefault();
          const dx = isLeft ? startX - ev.clientX : ev.clientX - startX;
          targetWidth = Math.max(60, Math.min(1400, Math.round(startW + dx)));
          img.style.width = `${targetWidth}px`;
          sizeBadge.textContent = `${targetWidth} px`;
        };

        const onMouseUp = () => {
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
          document.body.style.cursor = '';
          wrapper.classList.remove('is-resizing');
          applyChange(targetWidth, currentAlign);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });
    };

    setupDrag(handleSE, false);
    setupDrag(handleSW, true);

    wrapper.appendChild(toolbar);
    wrapper.appendChild(img);
    wrapper.appendChild(handleSE);
    wrapper.appendChild(handleSW);

    // Toggle selection
    wrapper.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.cm-image-toolbar, .cm-image-resize-handle')) {
        return;
      }
      e.preventDefault();
      document.querySelectorAll('.cm-image-embed-wrapper.is-selected').forEach((el) => {
        if (el !== wrapper) el.classList.remove('is-selected');
      });
      wrapper.classList.toggle('is-selected');
    });

    const onDocClick = (e: MouseEvent) => {
      if (!wrapper.contains(e.target as Node)) {
        wrapper.classList.remove('is-selected');
      }
    };
    document.addEventListener('pointerdown', onDocClick);

    return wrapper;
  }

  override destroy(dom: HTMLElement) {
    const root = (dom as any)._reactRoot as Root | undefined;
    if (root) {
      setTimeout(() => {
        try {
          root.unmount();
        } catch {}
      }, 0);
    }
  }
}

function buildLivePreviewDecorations(
  view: EditorView,
  notePath: string,
  onNavigate: (target: string) => void,
  onSelectTag: (tag: string) => void,
  onUpdateTag: (newTag: string, from: number, to: number) => void
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const selection = view.state.selection.main;

  // Determine which lines currently have the cursor/selection
  const activeLines = new Set<number>();
  const selStartLine = doc.lineAt(selection.from).number;
  const selEndLine = doc.lineAt(selection.to).number;
  for (let l = selStartLine; l <= selEndLine; l++) {
    activeLines.add(l);
  }

  // Determine visible line window (expanded by 60 lines so tables/code blocks near viewport edges are complete)
  let minLine = 1;
  let maxLine = doc.lines;
  if (view.visibleRanges.length > 0) {
    const firstVis = doc.lineAt(view.visibleRanges[0].from).number;
    const lastVis = doc.lineAt(
      view.visibleRanges[view.visibleRanges.length - 1].to
    ).number;
    minLine = Math.max(1, firstVis - 60);
    maxLine = Math.min(doc.lines, lastVis + 60);
  }

  // Track code fence state up to minLine
  let inCodeFence = false;
  for (let l = 1; l < minLine; l++) {
    if (doc.line(l).text.trim().startsWith('```')) {
      inCodeFence = !inCodeFence;
    }
  }

  for (let lineNum = minLine; lineNum <= maxLine; lineNum++) {
    const line = doc.line(lineNum);
    const text = line.text;
    const isCursorOnLine = activeLines.has(lineNum);

    if (text.trim().startsWith('```')) {
      inCodeFence = !inCodeFence;
      builder.add(line.from, line.from, Decoration.line({ class: 'cm-lp-codeblock-line' }));
      continue;
    }

    if (inCodeFence) {
      builder.add(line.from, line.from, Decoration.line({ class: 'cm-lp-codeblock-line' }));
      continue;
    }

    // Markdown Table block detection:
    // Header line with '|' followed by a separator line |---|---|
    if (
      text.includes('|') &&
      lineNum + 1 <= doc.lines &&
      TABLE_SEPARATOR_REGEX.test(doc.line(lineNum + 1).text)
    ) {
      let tableEndLine = lineNum + 1;
      while (
        tableEndLine + 1 <= doc.lines &&
        doc.line(tableEndLine + 1).text.includes('|') &&
        doc.line(tableEndLine + 1).text.trim().length > 0
      ) {
        tableEndLine++;
      }

      let cursorInTable = false;
      for (let tl = lineNum; tl <= tableEndLine; tl++) {
        if (activeLines.has(tl)) {
          cursorInTable = true;
          break;
        }
      }

      if (!cursorInTable) {
        const rawLines: string[] = [];
        const linePositions: number[] = [];
        for (let tl = lineNum; tl <= tableEndLine; tl++) {
          const tLine = doc.line(tl);
          rawLines.push(tLine.text);
          linePositions.push(tLine.from);
        }

        // First line hosts the rendered HTML table widget
        builder.add(
          line.from,
          line.from,
          Decoration.line({ class: 'cm-lp-table-host-line' })
        );
        builder.add(
          line.from,
          line.to,
          Decoration.replace({
            widget: new TableWidget(rawLines, linePositions, notePath, onNavigate),
          })
        );

        // Subsequent lines of the table are visually collapsed while cursor is outside
        for (let tl = lineNum + 1; tl <= tableEndLine; tl++) {
          const subLine = doc.line(tl);
          builder.add(
            subLine.from,
            subLine.from,
            Decoration.line({ class: 'cm-lp-table-collapsed-line' })
          );
          if (subLine.to > subLine.from) {
            builder.add(subLine.from, subLine.to, Decoration.replace({}));
          }
        }

        lineNum = tableEndLine;
        continue;
      } else {
        // Cursor is inside the table: style all table lines in monospace so pipes align
        for (let tl = lineNum; tl <= tableEndLine; tl++) {
          const subLine = doc.line(tl);
          builder.add(
            subLine.from,
            subLine.from,
            Decoration.line({ class: 'cm-lp-table-source-line' })
          );
        }
        lineNum = tableEndLine;
        continue;
      }
    }

    // Callout detection: > [!tip] Title or > content
    const calloutMatch = text.match(/^>\s*\[!([a-zA-Z]+)\]\s*(.*)$/);
    if (calloutMatch) {
      const calloutType = calloutMatch[1].toLowerCase();
      builder.add(
        line.from,
        line.from,
        Decoration.line({ class: `cm-lp-callout cm-lp-callout-header cm-callout-${calloutType}` })
      );
      if (!isCursorOnLine) {
        const prefixEnd = line.from + text.indexOf(']') + 1;
        builder.add(line.from, prefixEnd, Decoration.replace({}));
      }
      continue;
    } else if (text.startsWith('>')) {
      builder.add(line.from, line.from, Decoration.line({ class: 'cm-lp-blockquote' }));
    }

    // Heading detection: # H1 .. ###### H6
    const headingMatch = text.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      builder.add(
        line.from,
        line.from,
        Decoration.line({ class: `cm-lp-heading cm-lp-h${level}` })
      );
      if (!isCursorOnLine) {
        builder.add(
          line.from,
          line.from + headingMatch[1].length + 1,
          Decoration.replace({})
        );
      }
    }

    // Skip inline replacement if cursor is on this line so the user can edit raw markdown smoothly
    if (isCursorOnLine) {
      continue;
    }

    // Collect inline decorations for this line and sort by position
    const inlineDecos: { from: number; to: number; deco: Decoration }[] = [];

    // 1. Task list checkbox: - [ ] or - [x]
    const taskMatch = text.match(/^(\s*)([-*+]\s+)(\[[ xX]\])(\s*)/);
    if (taskMatch) {
      const leadingWhitespace = taskMatch[1];
      const listMarker = taskMatch[2];
      const checkMarker = taskMatch[3];
      let indentSpaces = 0;
      for (const ch of leadingWhitespace) {
        if (ch === '\t') indentSpaces += 4;
        else if (ch === ' ') indentSpaces += 1;
      }
      const bracketPos = line.from + leadingWhitespace.length + listMarker.length;
      const isChecked = checkMarker.toLowerCase() === '[x]';
      inlineDecos.push({
        from: line.from,
        to: bracketPos + 3,
        deco: Decoration.replace({
          widget: new CheckboxWidget(isChecked, bracketPos, indentSpaces),
        }),
      });
    }

    // 2. Embeds ![[Target|Alt]] and WikiLinks [[Target|Alias]]
    const wikiRegex = /(!?)\[\[([^\]|#\n]+)(?:#([^\]|\n]+))?(?:\|([^\]\n]+))?\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = wikiRegex.exec(text)) !== null) {
      const fullStart = line.from + match.index;
      const fullEnd = fullStart + match[0].length;
      const isEmbed = match[1] === '!';
      const target = match[2].trim();
      const alias = match[4]?.trim() || target;

      if (isEmbed) {
        let imgWidth: number | undefined;
        let imgAlign: 'left' | 'center' | 'right' | undefined;
        const rawAlt = match[4]?.trim() || '';
        if (rawAlt) {
          const parts = rawAlt.split('|').map((s) => s.trim().toLowerCase());
          for (const p of parts) {
            if (/^\d+$/.test(p)) imgWidth = parseInt(p, 10);
            else if (p === 'left' || p === 'center' || p === 'right') imgAlign = p;
          }
        }
        inlineDecos.push({
          from: fullStart,
          to: fullEnd,
          deco: Decoration.replace({
            widget: new EmbedWidget(
              target,
              rawAlt,
              notePath,
              onNavigate,
              imgWidth,
              imgAlign,
              { from: fullStart, to: fullEnd },
              onUpdateTag
            ),
          }),
        });
      } else {
        inlineDecos.push({
          from: fullStart,
          to: fullEnd,
          deco: Decoration.replace({
            widget: new WikiLinkWidget(target, alias, onNavigate),
          }),
        });
      }
    }

    // 3. Standard Markdown Images ![alt](url) and Links [label](url)
    const mdLinkRegex = /(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g;
    while ((match = mdLinkRegex.exec(text)) !== null) {
      const fullStart = line.from + match.index;
      const fullEnd = fullStart + match[0].length;
      const isEmbed = match[1] === '!';
      const label = match[2].trim();
      const href = match[3].trim();

      if (isEmbed) {
        inlineDecos.push({
          from: fullStart,
          to: fullEnd,
          deco: Decoration.replace({
            widget: new EmbedWidget(
              href,
              label,
              notePath,
              onNavigate,
              undefined,
              undefined,
              { from: fullStart, to: fullEnd },
              onUpdateTag
            ),
          }),
        });
      } else {
        const isExternal = /^(https?:|mailto:)/i.test(href);
        if (isExternal) {
          inlineDecos.push({
            from: fullStart,
            to: fullEnd,
            deco: Decoration.replace({
              widget: new ExternalLinkWidget(href, label || href),
            }),
          });
        } else {
          inlineDecos.push({
            from: fullStart,
            to: fullEnd,
            deco: Decoration.replace({
              widget: new WikiLinkWidget(href, label || href, onNavigate),
            }),
          });
        }
      }
    }

    // 3.5. HTML <img> tags: <img src="..." width="..." align="..." />
    const htmlImgRegex = /<img\b([^>]*?)\/?>/gi;
    while ((match = htmlImgRegex.exec(text)) !== null) {
      const fullStart = line.from + match.index;
      const fullEnd = fullStart + match[0].length;
      const tagContent = match[0];
      const srcMatch = /src=["']([^"']+)["']/i.exec(tagContent);
      if (srcMatch) {
        const src = srcMatch[1];
        const altMatch = /alt=["']([^"']*)["']/i.exec(tagContent);
        const widthMatch = /width=["']?(\d+)["']?/i.exec(tagContent);
        const alignMatch = /align=["']?(left|center|right)["']?/i.exec(tagContent);
        const width = widthMatch ? parseInt(widthMatch[1], 10) : undefined;
        const align = alignMatch
          ? (alignMatch[1].toLowerCase() as 'left' | 'center' | 'right')
          : undefined;
        inlineDecos.push({
          from: fullStart,
          to: fullEnd,
          deco: Decoration.replace({
            widget: new EmbedWidget(
              src,
              altMatch ? altMatch[1] : '',
              notePath,
              onNavigate,
              width,
              align,
              { from: fullStart, to: fullEnd },
              onUpdateTag
            ),
          }),
        });
      }
    }

    // 4. Bold **text**
    const boldRegex = /\*\*([^*]+)\*\*/g;
    while ((match = boldRegex.exec(text)) !== null) {
      const from = line.from + match.index;
      const to = from + match[0].length;
      inlineDecos.push({ from, to: from + 2, deco: Decoration.replace({}) });
      inlineDecos.push({
        from: from + 2,
        to: to - 2,
        deco: Decoration.mark({ class: 'cm-lp-bold' }),
      });
      inlineDecos.push({ from: to - 2, to, deco: Decoration.replace({}) });
    }

    // 5. Highlight ==text==
    const highlightRegex = /==([^=]+)==/g;
    while ((match = highlightRegex.exec(text)) !== null) {
      const from = line.from + match.index;
      const to = from + match[0].length;
      inlineDecos.push({ from, to: from + 2, deco: Decoration.replace({}) });
      inlineDecos.push({
        from: from + 2,
        to: to - 2,
        deco: Decoration.mark({ class: 'cm-lp-highlight' }),
      });
      inlineDecos.push({ from: to - 2, to, deco: Decoration.replace({}) });
    }

    // 6. Inline code `code`
    const codeRegex = /`([^`\n]+)`/g;
    while ((match = codeRegex.exec(text)) !== null) {
      const from = line.from + match.index;
      const to = from + match[0].length;
      inlineDecos.push({ from, to: from + 1, deco: Decoration.replace({}) });
      inlineDecos.push({
        from: from + 1,
        to: to - 1,
        deco: Decoration.mark({ class: 'cm-lp-inline-code' }),
      });
      inlineDecos.push({ from: to - 1, to, deco: Decoration.replace({}) });
    }

    // 7. Inline #tags
    const tagRegex = /(?:^|\s)(#[a-zA-ZäöüÄÖÜß0-9/_-]+)(?=$|[\s.,;:!?)])/g;
    while ((match = tagRegex.exec(text)) !== null) {
      const hashIndex = match.index + match[0].indexOf('#');
      const from = line.from + hashIndex;
      const to = from + match[1].length;
      const tagName = match[1].slice(1);
      if (!/^\d+$/.test(tagName)) {
        inlineDecos.push({
          from,
          to,
          deco: Decoration.replace({
            widget: new TagPillWidget(tagName, onSelectTag),
          }),
        });
      }
    }

    // Sort and add non-overlapping inline decorations
    inlineDecos.sort((a, b) => a.from - b.from || a.to - b.to);
    let lastEnd = line.from;
    for (const item of inlineDecos) {
      if (item.from >= lastEnd) {
        builder.add(item.from, item.to, item.deco);
        lastEnd = item.to;
      }
    }
  }

  return builder.finish();
}

export const LivePreviewEditor = forwardRef<LivePreviewEditorRef, LivePreviewEditorProps>((props, ref) => {
  const {
    notePath,
    body,
    rawContent,
    mode,
    allNotes,
    allTags,
    scrollToLine,
    onChangeBody,
    onChangeRaw,
    onNavigateWikiLink,
    onSelectTag,
  } = props;

  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const livePluginCompartment = useRef(new Compartment());

  const callbacksRef = useRef({
    onChangeBody,
    onChangeRaw,
    onNavigateWikiLink,
    onSelectTag,
    onUploadAttachment: props.onUploadAttachment,
    mode,
    notePath,
    allNotes,
    allTags,
  });
  callbacksRef.current = {
    onChangeBody,
    onChangeRaw,
    onNavigateWikiLink,
    onSelectTag,
    onUploadAttachment: props.onUploadAttachment,
    mode,
    notePath,
    allNotes,
    allTags,
  };

  const applyFormat = (
    formatType: 'bold' | 'italic' | 'strikethrough' | 'highlight' | 'code'
  ) => {
    const view = viewRef.current;
    if (!view) return;
    const formatDelimiters: Record<string, { delim: string; placeholder: string }> = {
      bold: { delim: '**', placeholder: 'Fetter Text' },
      italic: { delim: '*', placeholder: 'Kursiver Text' },
      strikethrough: { delim: '~~', placeholder: 'Durchgestrichen' },
      highlight: { delim: '==', placeholder: 'Markierter Text' },
      code: { delim: '`', placeholder: 'Code' },
    };
    const { delim, placeholder: ph } =
      formatDelimiters[formatType] || { delim: '**', placeholder: 'Text' };
    const dLen = delim.length;
    const selection = view.state.selection.main;
    const selText = view.state.sliceDoc(selection.from, selection.to);

    if (selText) {
      if (selText.startsWith(delim) && selText.endsWith(delim) && selText.length >= dLen * 2) {
        const inner = selText.slice(dLen, -dLen);
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: inner },
          selection: { anchor: selection.from, head: selection.from + inner.length },
        });
      } else {
        const wrapped = `${delim}${selText}${delim}`;
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: wrapped },
          selection: { anchor: selection.from + dLen, head: selection.to + dLen },
        });
      }
    } else {
      const doc = view.state.doc;
      const before = doc.sliceString(Math.max(0, selection.from - dLen), selection.from);
      const after = doc.sliceString(selection.from, Math.min(doc.length, selection.from + dLen));
      if (before === delim && after === delim) {
        view.dispatch({
          changes: [
            { from: selection.from - dLen, to: selection.from, insert: '' },
            { from: selection.from, to: selection.from + dLen, insert: '' },
          ],
          selection: { anchor: selection.from - dLen },
        });
      } else {
        const wrapped = `${delim}${ph}${delim}`;
        view.dispatch({
          changes: { from: selection.from, to: selection.from, insert: wrapped },
          selection: {
            anchor: selection.from + dLen,
            head: selection.from + dLen + ph.length,
          },
        });
      }
    }
    view.focus();
  };

  const insertCodeBlock = (lang = 'typescript') => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const selText = view.state.sliceDoc(sel.from, sel.to);
    const snippet = `\`\`\`${lang}\n${selText || '// Code hier'}\n\`\`\`\n`;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: snippet },
      selection: { anchor: sel.from + snippet.length },
    });
    view.focus();
  };

  const insertTable = (rows = 3, cols = 3) => {
    const view = viewRef.current;
    if (!view) return;
    const safeCols = Math.max(1, Math.min(10, cols));
    const safeRows = Math.max(1, Math.min(20, rows));

    let header = '| ' + Array.from({ length: safeCols }, (_, i) => `Spalte ${i + 1}`).join(' | ') + ' |\n';
    let sep = '| ' + Array.from({ length: safeCols }, () => ':---').join(' | ') + ' |\n';
    let bodyRows = '';
    for (let r = 0; r < safeRows; r++) {
      bodyRows += '| ' + Array.from({ length: safeCols }, (_, c) => `Wert ${r + 1}-${c + 1}`).join(' | ') + ' |\n';
    }
    const table = `\n${header}${sep}${bodyRows}\n`;
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: sel.head, insert: table },
      selection: { anchor: sel.head + table.length },
    });
    view.focus();
  };

  const isCursorInTable = (): boolean => {
    const view = viewRef.current;
    if (!view) return false;
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.head);
    return isTableRow(line.text) || TABLE_SEPARATOR_REGEX.test(line.text);
  };

  const insertTableRow = () => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.head);
    if (!isTableRow(line.text) && !TABLE_SEPARATOR_REGEX.test(line.text)) return;
    const cells = splitTableCells(line.text);
    const count = Math.max(1, cells.length);
    const newRow = '\n| ' + Array(count).fill('   ').join(' | ') + ' |';
    view.dispatch({
      changes: { from: line.to, insert: newRow },
      selection: { anchor: line.to + newRow.length },
    });
    view.focus();
  };

  const insertTableColumn = () => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const curLine = view.state.doc.lineAt(sel.head);
    if (!isTableRow(curLine.text) && !TABLE_SEPARATOR_REGEX.test(curLine.text)) return;

    let startLineNum = curLine.number;
    while (startLineNum > 1) {
      const prev = view.state.doc.line(startLineNum - 1);
      if (isTableRow(prev.text) || TABLE_SEPARATOR_REGEX.test(prev.text)) {
        startLineNum--;
      } else {
        break;
      }
    }
    let endLineNum = curLine.number;
    while (endLineNum < view.state.doc.lines) {
      const next = view.state.doc.line(endLineNum + 1);
      if (isTableRow(next.text) || TABLE_SEPARATOR_REGEX.test(next.text)) {
        endLineNum++;
      } else {
        break;
      }
    }

    const changes = [];
    for (let l = startLineNum; l <= endLineNum; l++) {
      const line = view.state.doc.line(l);
      const isSep = TABLE_SEPARATOR_REGEX.test(line.text);
      const addition = isSep ? ' :--- |' : ' Neu |';
      const trimmed = line.text.trimEnd();
      if (trimmed.endsWith('|')) {
        changes.push({ from: line.from + trimmed.length - 1, insert: addition });
      } else {
        changes.push({ from: line.to, insert: isSep ? ' | :--- |' : ' | Neu |' });
      }
    }
    view.dispatch({ changes });
    view.focus();
  };

  const insertTask = () => {
    const view = viewRef.current;
    if (!view) return;
    const state = view.state;
    const sel = state.selection.main;
    const line = state.doc.lineAt(sel.head);
    const taskMatch = line.text.match(/^-\s+\[([ xX])\]\s+/);

    if (taskMatch) {
      // Toggle off
      const oldPrefixLen = taskMatch[0].length;
      const offsetInContent = Math.max(0, sel.head - (line.from + oldPrefixLen));
      const newCursorPos = line.from + offsetInContent;
      view.dispatch({
        changes: { from: line.from, to: line.from + oldPrefixLen, insert: '' },
        selection: { anchor: newCursorPos, head: newCursorPos },
        scrollIntoView: true,
      });
    } else {
      // Check if bullet or number exists to replace
      const existingMatch = line.text.match(/^(-\s+|\d+\.\s+)/);
      const oldPrefixLen = existingMatch ? existingMatch[0].length : 0;
      const newPrefix = '- [ ] ';
      const offsetInContent = Math.max(0, sel.head - (line.from + oldPrefixLen));
      const newCursorPos = line.from + newPrefix.length + offsetInContent;
      view.dispatch({
        changes: { from: line.from, to: line.from + oldPrefixLen, insert: newPrefix },
        selection: { anchor: newCursorPos, head: newCursorPos },
        scrollIntoView: true,
      });
    }
    view.focus();
  };

  const insertList = (type: 'bullet' | 'number') => {
    const view = viewRef.current;
    if (!view) return;
    const state = view.state;
    const sel = state.selection.main;
    const line = state.doc.lineAt(sel.head);

    if (type === 'bullet') {
      const match = line.text.match(/^-\s+/);
      if (match) {
        // Toggle off
        const oldPrefixLen = match[0].length;
        const offsetInContent = Math.max(0, sel.head - (line.from + oldPrefixLen));
        const newCursorPos = line.from + offsetInContent;
        view.dispatch({
          changes: { from: line.from, to: line.from + oldPrefixLen, insert: '' },
          selection: { anchor: newCursorPos, head: newCursorPos },
          scrollIntoView: true,
        });
      } else {
        // Check if there is an ordered list or task prefix to replace
        const existingMatch = line.text.match(/^(\d+\.\s+|-\s*\[[ xX]\]\s+)/);
        const oldPrefixLen = existingMatch ? existingMatch[0].length : 0;
        const newPrefix = '- ';
        const offsetInContent = Math.max(0, sel.head - (line.from + oldPrefixLen));
        const newCursorPos = line.from + newPrefix.length + offsetInContent;
        view.dispatch({
          changes: { from: line.from, to: line.from + oldPrefixLen, insert: newPrefix },
          selection: { anchor: newCursorPos, head: newCursorPos },
          scrollIntoView: true,
        });
      }
    } else {
      const match = line.text.match(/^\d+\.\s+/);
      if (match) {
        // Toggle off
        const oldPrefixLen = match[0].length;
        const offsetInContent = Math.max(0, sel.head - (line.from + oldPrefixLen));
        const newCursorPos = line.from + offsetInContent;
        view.dispatch({
          changes: { from: line.from, to: line.from + oldPrefixLen, insert: '' },
          selection: { anchor: newCursorPos, head: newCursorPos },
          scrollIntoView: true,
        });
      } else {
        // Check if bullet or task exists to replace
        const existingMatch = line.text.match(/^(-\s*\[[ xX]\]\s+|-\s+)/);
        const oldPrefixLen = existingMatch ? existingMatch[0].length : 0;
        const newPrefix = '1. ';
        const offsetInContent = Math.max(0, sel.head - (line.from + oldPrefixLen));
        const newCursorPos = line.from + newPrefix.length + offsetInContent;
        view.dispatch({
          changes: { from: line.from, to: line.from + oldPrefixLen, insert: newPrefix },
          selection: { anchor: newCursorPos, head: newCursorPos },
          scrollIntoView: true,
        });
      }
    }
    view.focus();
  };

  const indent = () => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const startLine = view.state.doc.lineAt(sel.from);
    const endLine = view.state.doc.lineAt(sel.to);
    const changes = [];
    for (let l = startLine.number; l <= endLine.number; l++) {
      const line = view.state.doc.line(l);
      changes.push({ from: line.from, insert: '  ' });
    }
    view.dispatch({ changes });
    view.focus();
  };

  const outdent = () => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const startLine = view.state.doc.lineAt(sel.from);
    const endLine = view.state.doc.lineAt(sel.to);
    const changes = [];
    for (let l = startLine.number; l <= endLine.number; l++) {
      const line = view.state.doc.line(l);
      const spaces = line.text.match(/^ {1,2}/);
      if (spaces) {
        changes.push({ from: line.from, to: line.from + spaces[0].length, insert: '' });
      }
    }
    if (changes.length > 0) view.dispatch({ changes });
    view.focus();
  };

  const insertWikiLink = (openAutocomplete = true) => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const selText = view.state.sliceDoc(sel.from, sel.to);
    if (selText) {
      const insert = `[[${selText}]]`;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert },
        selection: { anchor: sel.from + insert.length },
      });
    } else {
      view.dispatch({
        changes: { from: sel.head, insert: '[[]]' },
        selection: { anchor: sel.head + 2 },
      });
      if (openAutocomplete) {
        setTimeout(() => {
          if (viewRef.current) startCompletion(viewRef.current);
        }, 30);
      }
    }
    view.focus();
  };

  const insertTag = (openAutocomplete = true) => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: sel.head, insert: '#' },
      selection: { anchor: sel.head + 1 },
    });
    view.focus();
    if (openAutocomplete) {
      setTimeout(() => {
        if (viewRef.current) startCompletion(viewRef.current);
      }, 30);
    }
  };

  const insertHeading = (level: number) => {
    const view = viewRef.current;
    if (!view) return;
    const state = view.state;
    const sel = state.selection.main;
    const line = state.doc.lineAt(sel.head);
    const existingMatch = line.text.match(/^(#{1,6})\s+/);
    const oldPrefixLen = existingMatch ? existingMatch[0].length : 0;
    const newPrefix = level > 0 ? `${'#'.repeat(level)} ` : '';

    const offsetInContent = Math.max(0, sel.head - (line.from + oldPrefixLen));
    const newCursorPos = line.from + newPrefix.length + offsetInContent;

    view.dispatch({
      changes: {
        from: line.from,
        to: line.from + oldPrefixLen,
        insert: newPrefix,
      },
      selection: {
        anchor: newCursorPos,
        head: newCursorPos,
      },
      scrollIntoView: true,
    });
    view.focus();
  };

  const insertQuote = () => {
    const view = viewRef.current;
    if (!view) return;
    const state = view.state;
    const sel = state.selection.main;
    const line = state.doc.lineAt(sel.head);
    const quoteMatch = line.text.match(/^>\s*/);

    if (quoteMatch) {
      const oldPrefixLen = quoteMatch[0].length;
      const offsetInContent = Math.max(0, sel.head - (line.from + oldPrefixLen));
      const newCursorPos = line.from + offsetInContent;
      view.dispatch({
        changes: { from: line.from, to: line.from + oldPrefixLen, insert: '' },
        selection: { anchor: newCursorPos, head: newCursorPos },
        scrollIntoView: true,
      });
    } else {
      const newPrefix = '> ';
      const offsetInContent = Math.max(0, sel.head - line.from);
      const newCursorPos = line.from + newPrefix.length + offsetInContent;
      view.dispatch({
        changes: { from: line.from, insert: newPrefix },
        selection: { anchor: newCursorPos, head: newCursorPos },
        scrollIntoView: true,
      });
    }
    view.focus();
  };

  const insertCallout = (type = 'NOTE') => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const upper = type.toUpperCase();
    const titleMap: Record<string, string> = {
      NOTE: 'Hinweis',
      INFO: 'Information',
      TIP: 'Tipp',
      WARNING: 'Warnung',
      DANGER: 'Gefahr',
      QUESTION: 'Frage',
    };
    const title = titleMap[upper] || upper;
    const snippet = `> [!${upper}] ${title}\n> Text hier einfügen...\n\n`;
    view.dispatch({
      changes: { from: sel.head, insert: snippet },
      selection: { anchor: sel.head + snippet.length },
    });
    view.focus();
  };

  const insertHorizontalRule = () => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const hr = '\n\n---\n\n';
    view.dispatch({
      changes: { from: sel.head, insert: hr },
      selection: { anchor: sel.head + hr.length },
    });
    view.focus();
  };

  const insertImageEmbed = (embedTag: string) => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const snippet = `${embedTag}\n`;
    view.dispatch({
      changes: { from: sel.head, insert: snippet },
      selection: { anchor: sel.head + snippet.length },
    });
    view.focus();
  };

  const getSelectedText = (): string => {
    const view = viewRef.current;
    if (!view) return '';
    const sel = view.state.selection.main;
    return view.state.sliceDoc(sel.from, sel.to);
  };

  const insertExternalLink = (linkText?: string, linkUrl?: string) => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    const currentSelected = view.state.sliceDoc(sel.from, sel.to);
    const finalLabel = linkText !== undefined && linkText.length > 0 ? linkText : currentSelected;
    const finalUrl = (linkUrl || '').trim();

    if (finalUrl) {
      const markdown = `[${finalLabel || finalUrl}](${finalUrl})`;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: markdown },
        selection: { anchor: sel.from + markdown.length },
      });
    } else {
      const markdown = `[${finalLabel}]()`;
      const cursorAnchor = sel.from + finalLabel.length + 3;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: markdown },
        selection: { anchor: cursorAnchor },
      });
    }
    view.focus();
  };

  useImperativeHandle(ref, () => ({
    applyFormat,
    insertTable,
    insertCodeBlock,
    insertTask,
    insertWikiLink,
    insertTag,
    insertHeading,
    insertList,
    indent,
    outdent,
    insertQuote,
    insertCallout,
    insertHorizontalRule,
    isCursorInTable,
    insertTableRow,
    insertTableColumn,
    insertImageEmbed,
    insertExternalLink,
    getSelectedText,
    focus: () => viewRef.current?.focus(),
  }));

  const activeDocText = mode === 'source' ? rawContent : body;

  // Create CodeMirror 6 instance when in 'live' or 'source' mode
  useEffect(() => {
    if (mode === 'reading') {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
      return;
    }

    const container = editorContainerRef.current;
    if (!container) return;

    const wikiCompletion = (context: CompletionContext): CompletionResult | null => {
      // 1. [[WikiLink]] completion
      const wikiBefore = context.matchBefore(/\[\[[^\]|\n]*$/);
      if (wikiBefore) {
        const query = wikiBefore.text.slice(2).toLowerCase();
        const options = callbacksRef.current.allNotes
          .filter((n) => n.basename.toLowerCase().includes(query))
          .slice(0, 60)
          .map((n) => ({
            label: n.basename,
            detail: n.path,
            apply: `${n.basename}]]`,
          }));
        return {
          from: wikiBefore.from + 2,
          options,
        };
      }

      // 2. #tag completion
      const tagBefore = context.matchBefore(/#[a-zA-ZäöüÄÖÜß0-9/_-]*$/);
      if (tagBefore) {
        const query = tagBefore.text.slice(1).toLowerCase();
        const options = callbacksRef.current.allTags
          .filter((t) => t.toLowerCase().includes(query))
          .slice(0, 60)
          .map((t) => ({
            label: `#${t}`,
            apply: `#${t}`,
          }));
        return {
          from: tagBefore.from,
          options,
        };
      }

      return null;
    };

    const createLivePreviewPlugin = (enabled: boolean) => {
      if (!enabled) return [];
      const onUpdateTag = (newTag: string, from: number, to: number) => {
        const v = viewRef.current;
        if (!v) return;
        const docLen = v.state.doc.length;
        const safeFrom = Math.max(0, Math.min(from, docLen));
        const safeTo = Math.max(safeFrom, Math.min(to, docLen));
        v.dispatch({
          changes: { from: safeFrom, to: safeTo, insert: newTag },
        });
      };
      return ViewPlugin.fromClass(
        class {
          decorations: DecorationSet;
          constructor(view: EditorView) {
            this.decorations = buildLivePreviewDecorations(
              view,
              callbacksRef.current.notePath,
              (t) => callbacksRef.current.onNavigateWikiLink(t),
              (tag) => callbacksRef.current.onSelectTag(tag),
              onUpdateTag
            );
          }
          update(update: ViewUpdate) {
            if (update.docChanged || update.selectionSet || update.viewportChanged) {
              this.decorations = buildLivePreviewDecorations(
                update.view,
                callbacksRef.current.notePath,
                (t) => callbacksRef.current.onNavigateWikiLink(t),
                (tag) => callbacksRef.current.onSelectTag(tag),
                onUpdateTag
              );
            }
          }
        },
        {
          decorations: (v) => v.decorations,
        }
      );
    };

    const uploadHandler = EditorView.domEventHandlers({
      paste(event, view) {
        const clipboard = event.clipboardData;
        if (!clipboard) return false;

        const files: File[] = [];
        if (clipboard.files && clipboard.files.length > 0) {
          for (let i = 0; i < clipboard.files.length; i++) {
            files.push(clipboard.files[i]);
          }
        } else if (clipboard.items) {
          for (const item of Array.from(clipboard.items)) {
            if (item.kind === 'file') {
              const f = item.getAsFile();
              if (f) files.push(f);
            }
          }
        }

        const imageFiles = files.filter(
          (f) => f.type.startsWith('image/') || IMAGE_EXT_REGEX.test(f.name)
        );

        if (imageFiles.length > 0) {
          event.preventDefault();
          for (const file of imageFiles) {
            const uploadPromise = callbacksRef.current.onUploadAttachment
              ? callbacksRef.current.onUploadAttachment(file)
              : api.uploadAttachment(file).then((res) => res.wikiEmbed || (res.path ? `![[${res.path}]]` : `![[${res.name}]]`));

            uploadPromise
              .then((embedTag) => {
                const pos = view.state.selection.main.head;
                view.dispatch({
                  changes: { from: pos, insert: `${embedTag}\n` },
                  selection: { anchor: pos + embedTag.length + 1 },
                });
              })
              .catch((err) => {
                console.error('Fehler beim Einfügen aus der Zwischenablage:', err);
              });
          }
          return true;
        }

        const pastedText = clipboard.getData('text/plain')?.trim();
        if (pastedText && /^(https?:\/\/[^\s<>()]+)$/i.test(pastedText)) {
          const state = view.state;
          const sel = state.selection.main;
          const doc = state.doc;
          const line = doc.lineAt(sel.head);
          const lineText = line.text;
          const posInLine = sel.head - line.from;

          // Guard 1: Fenced code blocks
          let inCodeFence = false;
          for (let l = 1; l <= line.number; l++) {
            if (doc.line(l).text.trim().startsWith('```')) {
              if (l === line.number) {
                inCodeFence = true;
                break;
              }
              inCodeFence = !inCodeFence;
            }
          }

          if (!inCodeFence) {
            // Guard 2: Inline code `...`
            const textBeforeCursor = lineText.slice(0, posInLine);
            const backticksBefore = (textBeforeCursor.match(/`/g) || []).length;
            const inInlineCode = backticksBefore % 2 !== 0;

            // Guard 3: Inside ](...) URL part
            const lastOpenParen = textBeforeCursor.lastIndexOf('](');
            let inMarkdownLinkUrl = false;
            if (lastOpenParen !== -1) {
              const closingParen = lineText.indexOf(')', lastOpenParen);
              if (closingParen === -1 || closingParen >= posInLine) {
                inMarkdownLinkUrl = true;
              }
            }

            if (!inInlineCode && !inMarkdownLinkUrl) {
              event.preventDefault();
              const selectedText = state.sliceDoc(sel.from, sel.to).trim();
              if (selectedText.length > 0) {
                const formatted = `[${selectedText}](${pastedText})`;
                view.dispatch({
                  changes: { from: sel.from, to: sel.to, insert: formatted },
                  selection: { anchor: sel.from + formatted.length },
                });
              } else {
                const formatted = `[${pastedText}](${pastedText})`;
                view.dispatch({
                  changes: { from: sel.from, to: sel.to, insert: formatted },
                  selection: { anchor: sel.from + formatted.length },
                });
              }
              return true;
            }
          }
        }

        return false;
      },
      drop(event, view) {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const imageFiles = Array.from(files).filter(
          (f) => f.type.startsWith('image/') || IMAGE_EXT_REGEX.test(f.name)
        );
        if (imageFiles.length > 0) {
          event.preventDefault();
          for (const file of imageFiles) {
            const uploadPromise = callbacksRef.current.onUploadAttachment
              ? callbacksRef.current.onUploadAttachment(file)
              : api.uploadAttachment(file).then((res) => res.wikiEmbed || (res.path ? `![[${res.path}]]` : `![[${res.name}]]`));

            uploadPromise
              .then((embedTag) => {
                const pos = view.state.selection.main.head;
                view.dispatch({
                  changes: { from: pos, insert: `${embedTag}\n` },
                  selection: { anchor: pos + embedTag.length + 1 },
                });
              })
              .catch((err) => {
                console.error('Fehler beim Drop des Bildes:', err);
              });
          }
          return true;
        }
        return false;
      },
    });

    const state = EditorState.create({
      doc: activeDocText,
      extensions: [
        history(),
        keymap.of([
          { key: 'Mod-b', run: () => { applyFormat('bold'); return true; } },
          { key: 'Mod-i', run: () => { applyFormat('italic'); return true; } },
          { key: 'Mod-e', run: () => { applyFormat('code'); return true; } },
          { key: 'Mod-Shift-x', run: () => { applyFormat('strikethrough'); return true; } },
          { key: 'Alt-h', run: () => { applyFormat('highlight'); return true; } },
          { key: 'Mod-Shift-c', run: () => { insertCodeBlock(); return true; } },
          { key: 'Mod-Shift-l', run: () => { insertTask(); return true; } },
          { key: 'Alt-Shift-t', run: () => { insertTable(); return true; } },
          { key: 'Mod-k', run: () => { insertWikiLink(); return true; } },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        markdown(),
        EditorView.lineWrapping,
        placeholder(
          (typeof localStorage !== 'undefined' && localStorage.getItem('knowmesh_language') === 'de')
            ? 'Beginne mit deiner Notiz... (Tippe [[ für Wiki-Links oder # für Tags)'
            : 'Start writing your note... (Type [[ for wiki links or # for tags)'
        ),
        autocompletion({ override: [wikiCompletion] }),
        livePluginCompartment.current.of(createLivePreviewPlugin(mode === 'live')),
        uploadHandler,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const text = update.state.doc.toString();
            if (callbacksRef.current.mode === 'source') {
              callbacksRef.current.onChangeRaw(text);
            } else {
              callbacksRef.current.onChangeBody(text);
            }
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: container,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Re-initialize editor when notePath or mode switches
  }, [notePath, mode]);

  // Keep CodeMirror document in sync when external changes arrive (e.g. via WebSocket or checkbox click)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentText = view.state.doc.toString();
    if (currentText !== activeDocText) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentText.length,
          insert: activeDocText,
        },
      });
    }
  }, [activeDocText]);

  // Scroll to heading line when requested from Outline
  useEffect(() => {
    if (!scrollToLine || !viewRef.current) return;
    const view = viewRef.current;
    const lineNum = Math.min(scrollToLine, view.state.doc.lines);
    const line = view.state.doc.line(lineNum);
    view.dispatch({
      selection: { anchor: line.from },
      scrollIntoView: true,
    });
    view.focus();
  }, [scrollToLine]);

  // Render HTML for Reading Mode ('reading')
  const renderedHtml = useMemo(() => {
    if (mode !== 'reading') return '';

    let processed = body;

    // 1. Transform Callouts: > [!type] Title \n > content
    processed = processed.replace(
      /(?:^>\s*\[!([a-zA-Z]+)\]\s*(.*)\n)((?:^>.*\n?)*)/gm,
      (_match, typeStr, titleStr, contentBlock) => {
        const type = String(typeStr).toLowerCase();
        const title = titleStr?.trim() || type.toUpperCase();
        const innerLines = String(contentBlock)
          .split('\n')
          .map((l) => l.replace(/^>\s?/, ''))
          .join('\n');
        const innerHtml = marked.parse(innerLines, { async: false, gfm: true }) as string;
        return `<div class="reading-callout callout-${type}"><div class="reading-callout-title">${title}</div><div class="reading-callout-body">${innerHtml}</div></div>\n`;
      }
    );

    // 2. Transform Wiki-Embeds ![[Embeds]]
    processed = processed.replace(
      /!\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]/g,
      (_match, targetRaw, altRaw) => {
        const target = String(targetRaw).trim();
        const alt = altRaw ? String(altRaw).trim() : target;
        if (target.toLowerCase().endsWith('.canvas')) {
          return `<div class="reading-canvas-embed" data-canvas-path="${target}" data-wikilink="${target}"><div class="reading-canvas-embed-header"><span class="canvas-icon">📊</span> <strong>${alt}</strong> <span class="canvas-open-hint">Im Editor öffnen ↗</span></div></div>`;
        }
        if (IMAGE_EXT_REGEX.test(target)) {
          const url = api.getAttachmentUrl(target, notePath);
          const styleAttr = /^\d+$/.test(alt) ? ` style="max-width:${alt}px"` : '';
          return `<span class="reading-image-embed"><img src="${url}" alt="${alt}" loading="lazy" decoding="async"${styleAttr} /></span>`;
        }
        return `<div class="reading-note-embed" data-wikilink="${target}">📄 Eingebettete Notiz: <strong>${alt}</strong></div>`;
      }
    );

    // 3. Transform Standard Markdown Images ![alt](url) to use vault attachment resolver
    processed = processed.replace(
      /!\[([^\]\n]*)\]\(([^)\n]+)\)/g,
      (_match, altRaw, hrefRaw) => {
        const target = String(hrefRaw).trim();
        const alt = String(altRaw || target).trim();
        if (target.toLowerCase().endsWith('.canvas')) {
          return `<div class="reading-canvas-embed" data-canvas-path="${target}" data-wikilink="${target}"><div class="reading-canvas-embed-header"><span class="canvas-icon">📊</span> <strong>${alt}</strong> <span class="canvas-open-hint">Im Editor öffnen ↗</span></div></div>`;
        }
        const url = /^(https?:|data:)/i.test(target)
          ? target
          : api.getAttachmentUrl(target, notePath);
        return `<span class="reading-image-embed"><img src="${url}" alt="${alt}" loading="lazy" decoding="async" /></span>`;
      }
    );

    // 3.5. Transform HTML <img> tags to resolve relative vault paths
    processed = processed.replace(
      /<img\b([^>]*?src=["']([^"']+)["'][^>]*?)\/?>/gi,
      (fullTag, _attrs, src) => {
        const cleanSrc = String(src).trim();
        if (/^(https?:|data:)/i.test(cleanSrc)) return fullTag;
        const resolvedUrl = api.getAttachmentUrl(cleanSrc, notePath);
        return fullTag.replace(src, resolvedUrl);
      }
    );

    // 4. Transform Standard Markdown Links [label](url)
    processed = processed.replace(
      /(?<!!)\[([^\]\n]+)\]\(([^)\n]+)\)/g,
      (_match, labelRaw, hrefRaw) => {
        const href = String(hrefRaw).trim();
        const label = String(labelRaw).trim();
        if (/^(https?:|mailto:)/i.test(href)) {
          return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="external-link">${label}</a>`;
        }
        return `<a href="#" class="reading-wikilink" data-wikilink="${href}">${label}</a>`;
      }
    );

    // 5. Transform [[Wiki-Links]]
    processed = processed.replace(
      /\[\[([^\]|#\n]+)(?:#([^\]|\n]+))?(?:\|([^\]\n]+))?\]\]/g,
      (_match, targetRaw, _heading, aliasRaw) => {
        const target = String(targetRaw).trim();
        const display = aliasRaw ? String(aliasRaw).trim() : target;
        return `<a href="#" class="reading-wikilink" data-wikilink="${target}">${display}</a>`;
      }
    );

    // 6. Transform ==highlights==
    processed = processed.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');

    // 7. Transform inline #tags
    processed = processed.replace(
      /(^|\s)#([a-zA-ZäöüÄÖÜß0-9/_-]+)(?=$|[\s.,;:!?)])/gm,
      '$1<span class="reading-tag" data-tag="$2">#$2</span>'
    );

    let rawHtml = marked.parse(processed, { async: false, gfm: true }) as string;
    // Add task-list-item class to <li> containing input checkbox for reliable styling
    rawHtml = rawHtml.replace(/<li(\s*[^>]*)>(?:\s*<p>)?\s*(<input\s+[^>]*type=["']checkbox["'][^>]*>)/gi, '<li$1 class="task-list-item">$2');
    return DOMPurify.sanitize(rawHtml, {
      ADD_ATTR: ['href', 'target', 'rel', 'data-wiki-target', 'data-wikilink', 'data-canvas-path', 'data-tag', 'loading', 'decoding', 'align'],
    });
  }, [body, mode, notePath]);

  const handleReadingClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const extLink = (e.target as HTMLElement).closest('a[target="_blank"]');
    if (extLink) {
      return;
    }
    const targetEl = (e.target as HTMLElement).closest('[data-wikilink], [data-tag]');
    if (!targetEl) return;

    const wiki = targetEl.getAttribute('data-wikilink');
    if (wiki) {
      e.preventDefault();
      onNavigateWikiLink(wiki);
      return;
    }

    const tag = targetEl.getAttribute('data-tag');
    if (tag) {
      e.preventDefault();
      onSelectTag(tag);
    }
  };

  if (mode === 'reading') {
    return (
      <div
        className="reading-view-container markdown-rendered"
        onClick={handleReadingClick}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
    );
  }

  return <div ref={editorContainerRef} className="codemirror-editor-wrapper" />;
});

LivePreviewEditor.displayName = 'LivePreviewEditor';
