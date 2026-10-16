import React, { useEffect, useRef, useMemo } from 'react';
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
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { marked } from 'marked';
import { api } from '../api';

export type EditorMode = 'live' | 'reading' | 'source';

interface LivePreviewEditorProps {
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
}

const IMAGE_EXT_REGEX = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const TABLE_SEPARATOR_REGEX = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

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

  return escaped
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
    table.className = 'obsidian-table';

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
    readonly pos: number
  ) {
    super();
  }

  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.pos === this.pos;
  }

  toDOM(view: EditorView) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'checkbox-custom cm-task-checkbox';
    input.checked = this.checked;
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
    readonly onNavigate: (target: string) => void
  ) {
    super();
  }

  eq(other: EmbedWidget) {
    return (
      other.target === this.target &&
      other.alt === this.alt &&
      other.notePath === this.notePath
    );
  }

  toDOM() {
    const wrapper = document.createElement('span');
    wrapper.className = 'cm-embed-widget';
    const cleanTarget = this.target.split('#')[0].trim();
    const isImage = IMAGE_EXT_REGEX.test(cleanTarget);

    if (isImage) {
      const img = document.createElement('img');
      img.src = /^(https?:|data:)/i.test(cleanTarget)
        ? cleanTarget
        : api.getAttachmentUrl(cleanTarget, this.notePath);
      img.alt = this.alt || cleanTarget;
      img.className = 'cm-embedded-image';
      img.loading = 'lazy';
      img.decoding = 'async';
      // Support optional Obsidian width syntax like ![[image.png|400]]
      if (/^\d+$/.test(this.alt.trim())) {
        img.style.maxWidth = `${this.alt.trim()}px`;
      }
      wrapper.appendChild(img);
    } else {
      const card = document.createElement('span');
      card.className = 'cm-embedded-note-pill';
      card.textContent = `📄 ${this.alt || cleanTarget}`;
      card.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onNavigate(this.target);
      });
      wrapper.appendChild(card);
    }
    return wrapper;
  }
}

function buildLivePreviewDecorations(
  view: EditorView,
  notePath: string,
  onNavigate: (target: string) => void,
  onSelectTag: (tag: string) => void
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
    const taskMatch = text.match(/^(\s*[-*+]\s+)(\[[ xX]\])(\s+)/);
    if (taskMatch) {
      const bracketOffset = taskMatch[1].length;
      const bracketPos = line.from + bracketOffset;
      const isChecked = taskMatch[2].toLowerCase() === '[x]';
      inlineDecos.push({
        from: line.from,
        to: bracketPos + 3,
        deco: Decoration.replace({
          widget: new CheckboxWidget(isChecked, bracketPos),
        }),
      });
    }

    // 2. Obsidian Embeds ![[Target|Alt]] and WikiLinks [[Target|Alias]]
    const wikiRegex = /(!?)\[\[([^\]|#\n]+)(?:#([^\]|\n]+))?(?:\|([^\]\n]+))?\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = wikiRegex.exec(text)) !== null) {
      const fullStart = line.from + match.index;
      const fullEnd = fullStart + match[0].length;
      const isEmbed = match[1] === '!';
      const target = match[2].trim();
      const alias = match[4]?.trim() || target;

      if (isEmbed) {
        inlineDecos.push({
          from: fullStart,
          to: fullEnd,
          deco: Decoration.replace({
            widget: new EmbedWidget(target, match[4]?.trim() || '', notePath, onNavigate),
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
            widget: new EmbedWidget(href, label, notePath, onNavigate),
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

export const LivePreviewEditor: React.FC<LivePreviewEditorProps> = ({
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
}) => {
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const livePluginCompartment = useRef(new Compartment());

  const callbacksRef = useRef({
    onChangeBody,
    onChangeRaw,
    onNavigateWikiLink,
    onSelectTag,
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
    mode,
    notePath,
    allNotes,
    allTags,
  };

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
      return ViewPlugin.fromClass(
        class {
          decorations: DecorationSet;
          constructor(view: EditorView) {
            this.decorations = buildLivePreviewDecorations(
              view,
              callbacksRef.current.notePath,
              (t) => callbacksRef.current.onNavigateWikiLink(t),
              (tag) => callbacksRef.current.onSelectTag(tag)
            );
          }
          update(update: ViewUpdate) {
            if (update.docChanged || update.selectionSet || update.viewportChanged) {
              this.decorations = buildLivePreviewDecorations(
                update.view,
                callbacksRef.current.notePath,
                (t) => callbacksRef.current.onNavigateWikiLink(t),
                (tag) => callbacksRef.current.onSelectTag(tag)
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
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of Array.from(items)) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              api.uploadAttachment(file).then((res) => {
                const pos = view.state.selection.main.head;
                view.dispatch({
                  changes: { from: pos, insert: `${res.wikiEmbed}\n` },
                });
              });
              return true;
            }
          }
        }
        return false;
      },
      drop(event, view) {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const file = files[0];
        if (file && file.type.startsWith('image/')) {
          event.preventDefault();
          api.uploadAttachment(file).then((res) => {
            const pos = view.state.selection.main.head;
            view.dispatch({
              changes: { from: pos, insert: `${res.wikiEmbed}\n` },
            });
          });
          return true;
        }
        return false;
      },
    });

    const state = EditorState.create({
      doc: activeDocText,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown(),
        EditorView.lineWrapping,
        placeholder('Beginne mit deiner Notiz... (Tippe [[ für Wiki-Links oder # für Tags)'),
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

    // 1. Transform Obsidian Callouts: > [!type] Title \n > content
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

    // 2. Transform Obsidian ![[Embeds]]
    processed = processed.replace(
      /!\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]/g,
      (_match, targetRaw, altRaw) => {
        const target = String(targetRaw).trim();
        const alt = altRaw ? String(altRaw).trim() : target;
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
        const url = /^(https?:|data:)/i.test(target)
          ? target
          : api.getAttachmentUrl(target, notePath);
        return `<span class="reading-image-embed"><img src="${url}" alt="${alt}" loading="lazy" decoding="async" /></span>`;
      }
    );

    // 4. Transform Standard Markdown Links [label](url)
    processed = processed.replace(
      /(?<!!)\[([^\]\n]+)\]\(([^)\n]+)\)/g,
      (_match, labelRaw, hrefRaw) => {
        const href = String(hrefRaw).trim();
        const label = String(labelRaw).trim();
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

    return marked.parse(processed, { async: false, gfm: true }) as string;
  }, [body, mode, notePath]);

  const handleReadingClick = (e: React.MouseEvent<HTMLDivElement>) => {
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
};
