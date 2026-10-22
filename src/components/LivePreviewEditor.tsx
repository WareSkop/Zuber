import React, { useState, useEffect, useRef, useMemo, useImperativeHandle, forwardRef } from 'react';
import {
  EditorState,
  RangeSetBuilder,
  Compartment,
  StateEffect,
  StateField,
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
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting } from '@codemirror/language';
import { tagHighlighter, tags } from '@lezer/highlight';
import hljs from 'highlight.js';
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
import { useTranslation } from '../i18n';
import { Target } from 'lucide-react';
import { CanvasEmbedWidget } from './canvas/CanvasEmbedWidget';
import { BaseView } from './BaseView';

let mermaidModulePromise: Promise<typeof import('mermaid').default> | null = null;
async function loadAndInitMermaid(isDark: boolean) {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').then((m) => m.default);
  }
  const mermaid = await mermaidModulePromise;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: isDark ? 'dark' : 'default',
    fontFamily: 'inherit',
    suppressErrorRendering: true,
  });
  return mermaid;
}

if (typeof window !== 'undefined' && typeof DOMPurify?.addHook === 'function') {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'IFRAME') {
      const isPdfFrame = node.classList?.contains('cm-lp-pdf-frame');
      if (isPdfFrame) {
        node.removeAttribute('srcdoc');
        const src = node.getAttribute('src') || '';
        if (/^\s*(javascript|vbscript|data):/i.test(src)) {
          node.removeAttribute('src');
        }
      } else {
        // Enforce strict isolated sandbox without allow-same-origin for HTML previews
        node.setAttribute('sandbox', 'allow-scripts');
        node.removeAttribute('src');
      }
    }
  });
}

export const setBlockModeEffect = StateEffect.define<{ pos: number; mode: 'preview' | 'code' }>();

export const blockModesField = StateField.define<Map<number, 'preview' | 'code'>>({
  create() {
    return new Map();
  },
  update(modes, tr) {
    let updated = modes;
    if (tr.docChanged) {
      updated = new Map();
      for (const [pos, mode] of modes) {
        const newPos = tr.changes.mapPos(pos);
        updated.set(newPos, mode);
      }
    }
    for (const effect of tr.effects) {
      if (effect.is(setBlockModeEffect)) {
        if (updated === modes) updated = new Map(modes);
        updated.set(effect.value.pos, effect.value.mode);
      }
    }
    return updated;
  },
});

const TEXT_EXT_REGEX = /\.(txt|md|markdown|csv|json|log|yaml|yml|xml|toml|ini|env|sh|bash|zsh|bat|cmd|ps1|js|jsx|ts|tsx|py|rb|php|java|c|cpp|h|hpp|cs|go|rs|swift|kt|html|htm|css|scss|sass|less|sql)$/i;

function isTextFile(file: File): boolean {
  if (file.type && file.type.startsWith('text/')) return true;
  if (
    file.type === 'application/json' ||
    file.type === 'application/xml' ||
    file.type === 'application/javascript' ||
    file.type === 'application/x-yaml' ||
    file.type === 'application/x-sh'
  ) {
    return true;
  }
  return TEXT_EXT_REGEX.test(file.name);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const codeHighlighter = tagHighlighter([
  { tag: tags.keyword, class: 'cm-keyword' },
  { tag: tags.string, class: 'cm-string' },
  { tag: tags.special(tags.string), class: 'cm-string cm-string-special' },
  { tag: tags.number, class: 'cm-number' },
  { tag: tags.bool, class: 'cm-bool' },
  { tag: tags.atom, class: 'cm-atom' },
  { tag: tags.comment, class: 'cm-comment' },
  { tag: tags.variableName, class: 'cm-variableName' },
  { tag: tags.function(tags.variableName), class: 'cm-function' },
  { tag: tags.typeName, class: 'cm-typeName' },
  { tag: tags.className, class: 'cm-className' },
  { tag: tags.operator, class: 'cm-operator' },
  { tag: tags.punctuation, class: 'cm-punctuation' },
  { tag: tags.propertyName, class: 'cm-propertyName' },
  { tag: tags.definition(tags.variableName), class: 'cm-def' },
  { tag: tags.attributeName, class: 'cm-attribute' },
]);

marked.use({
  gfm: true,
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = (lang || '').trim();
      const langLower = language.toLowerCase();

      // Mermaid Code Block (Reading Mode)
      if (langLower === 'mermaid') {
        const encodedCode = encodeURIComponent(text);
        return `<div class="codeblock-container reading-mermaid-container" data-code="${encodedCode}"><div class="codeblock-header"><span class="codeblock-lang">MERMAID</span><div class="codeblock-view-toggle"><button type="button" class="codeblock-toggle-btn active" data-action="diagram">Diagram</button><button type="button" class="codeblock-toggle-btn" data-action="code">Code</button></div><button type="button" class="codeblock-copy-btn" title="Code kopieren"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span class="copy-text">Kopieren</span></button></div><div class="reading-mermaid-preview"><div class="reading-mermaid-svg"></div></div><pre class="reading-mermaid-code" style="display:none;"><code class="hljs language-mermaid">${escapeHtml(text)}</code></pre></div>`;
      }

      // Base Code Block (Reading Mode)
      if (langLower === 'base') {
        let highlightedCode = '';
        try {
          highlightedCode = hljs.highlight(text, { language: 'yaml' }).value;
        } catch {
          highlightedCode = escapeHtml(text);
        }
        const encodedCode = encodeURIComponent(text);
        return `<div class="codeblock-container reading-base-container" data-code="${encodedCode}"><div class="codeblock-header"><span class="codeblock-lang">BASE</span><div class="codeblock-view-toggle"><button type="button" class="codeblock-toggle-btn active" data-action="preview">View</button><button type="button" class="codeblock-toggle-btn" data-action="code">Code</button></div><button type="button" class="codeblock-copy-btn" title="Code kopieren"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span class="copy-text">Kopieren</span></button></div><div class="reading-base-preview"><div class="reading-base-mount"></div></div><pre class="reading-base-code" style="display:none;"><code class="hljs language-yaml">${highlightedCode}</code></pre></div>`;
      }

      // HTML Code Block (Reading Mode)
      if (langLower === 'html' || langLower === 'htm') {
        let highlightedCode = '';
        try {
          highlightedCode = hljs.highlight(text, { language: 'html' }).value;
        } catch {
          highlightedCode = escapeHtml(text);
        }
        const encodedCode = encodeURIComponent(text);
        const escapedSrcdoc = escapeHtml(text);
        return `<div class="codeblock-container reading-html-container" data-code="${encodedCode}"><div class="codeblock-header"><span class="codeblock-lang">HTML</span><div class="codeblock-view-toggle"><button type="button" class="codeblock-toggle-btn active" data-action="preview">Preview</button><button type="button" class="codeblock-toggle-btn" data-action="code">Code</button></div><button type="button" class="codeblock-copy-btn" title="Code kopieren"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span class="copy-text">Kopieren</span></button></div><div class="reading-html-preview"><iframe srcdoc="${escapedSrcdoc}" sandbox="allow-scripts" class="reading-html-frame" style="width: 100%; height: 320px; border: none; border-radius: 6px; background: #fff;"></iframe></div><pre class="reading-html-code" style="display:none;"><code class="hljs language-html">${highlightedCode}</code></pre></div>`;
      }

      let highlightedCode = '';
      if (language && hljs.getLanguage(language)) {
        try {
          highlightedCode = hljs.highlight(text, { language }).value;
        } catch {
          highlightedCode = escapeHtml(text);
        }
      } else {
        try {
          highlightedCode = hljs.highlightAuto(text).value;
        } catch {
          highlightedCode = escapeHtml(text);
        }
      }

      const langDisplay = (language || 'code').toUpperCase();
      return `<div class="codeblock-container"><div class="codeblock-header"><span class="codeblock-lang">${langDisplay}</span><button type="button" class="codeblock-copy-btn" title="Code kopieren"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span class="copy-text">Kopieren</span></button></div><pre><code class="hljs${language ? ` language-${language}` : ''}">${highlightedCode}</code></pre></div>`;
    },
  },
});

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
  hasSelection: () => boolean;
  replaceSelection: (newText: string) => void;
  focus: () => void;
}

export interface LivePreviewEditorProps {
  notePath: string;
  body: string;
  rawContent: string;
  mode: EditorMode;
  allNotes: { path: string; name: string; basename: string; isSendTarget?: boolean }[];
  allTags: string[];
  scrollToLine?: number | null;
  onChangeBody: (newBody: string) => void;
  onChangeRaw: (newRaw: string) => void;
  onNavigateWikiLink: (target: string) => void;
  onSelectTag: (tag: string) => void;
  onUploadAttachment?: (file: File) => Promise<string>;
  onSendToTargetNote?: () => void;
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
    readonly onUpdateTag?: (newTag: string, from: number, to: number) => void,
    readonly allNotes?: { path: string; name: string; basename: string }[],
    readonly t?: (key: string) => string
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
    let isCanvas = cleanTarget.toLowerCase().endsWith('.canvas');
    let effectiveCanvasPath = cleanTarget;

    if (!isCanvas && this.allNotes) {
      const lower = cleanTarget.toLowerCase();
      const canvasMatch = this.allNotes.find(
        (n) =>
          (n.basename.toLowerCase() === lower || n.name.toLowerCase() === lower || n.path.toLowerCase() === lower) &&
          n.path.toLowerCase().endsWith('.canvas')
      );
      const mdMatch = this.allNotes.find(
        (n) =>
          (n.basename.toLowerCase() === lower || n.name.toLowerCase() === lower || n.path.toLowerCase() === lower) &&
          n.path.toLowerCase().endsWith('.md')
      );
      if (canvasMatch && !mdMatch) {
        isCanvas = true;
        effectiveCanvasPath = canvasMatch.path;
      }
    }

    if (isCanvas) {
      const container = document.createElement('div');
      container.className = 'cm-embed-widget cm-canvas-embed-wrapper cm-lp-canvas-embed';
      const root = createRoot(container);
      (container as any)._reactRoot = root;
      root.render(
        <CanvasEmbedWidget
          canvasPath={effectiveCanvasPath}
          onOpenNote={this.onNavigate}
          allNotes={this.allNotes}
        />
      );
      return container;
    }

    const isImage = IMAGE_EXT_REGEX.test(cleanTarget);
    const isPdf = cleanTarget.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      const container = document.createElement('div');
      container.className = 'cm-lp-pdf-embed';
      const fileUrl = /^(https?:|data:)/i.test(cleanTarget)
        ? cleanTarget
        : api.getAttachmentUrl(cleanTarget, this.notePath);
      const iframeSrc = `${fileUrl}#toolbar=1&view=FitH`;
      const fileName = cleanTarget.split('/').pop() || cleanTarget;
      const height = this.width ? `${this.width}px` : '550px';

      container.innerHTML = `
        <div class="cm-lp-pdf-header">
          <span class="cm-lp-pdf-title">📄 ${escapeHtml(fileName)}</span>
          <a href="${fileUrl}" target="_blank" rel="noopener noreferrer" class="cm-lp-pdf-open-btn" title="${this.t ? this.t('editor.openPdfInNewTab') : 'In neuem Tab öffnen'}">↗</a>
        </div>
        <iframe src="${iframeSrc}" class="cm-lp-pdf-frame" style="height: ${height};" loading="lazy"></iframe>
      `;
      return container;
    }

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

    // Delete Button (Papierkorb)
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'cm-image-btn cm-image-btn-delete';
    deleteBtn.title = this.t ? this.t('editor.removeImage') : 'Bild entfernen';
    deleteBtn.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
    deleteBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.range && this.onUpdateTag) {
        this.onUpdateTag('', this.range.from, this.range.to);
      }
    });
    toolbar.appendChild(deleteBtn);

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

class InteractiveCodeBlockWidget extends WidgetType {
  constructor(
    readonly language: string,
    readonly codeText: string,
    readonly pos: number,
    readonly mode: 'preview' | 'code',
    readonly onToggleMode: (pos: number, mode: 'preview' | 'code') => void,
    readonly t?: (key: string) => string,
    readonly onNavigate?: (target: string) => void,
    readonly allNotes?: any[],
    readonly currentBasePath?: string
  ) {
    super();
  }

  eq(other: InteractiveCodeBlockWidget) {
    return (
      other.language === this.language &&
      other.codeText === this.codeText &&
      other.pos === this.pos &&
      other.mode === this.mode &&
      other.allNotes === this.allNotes &&
      other.currentBasePath === this.currentBasePath
    );
  }

  toDOM(_view: EditorView) {
    const isMermaid = this.language.toLowerCase() === 'mermaid';
    const isHtml = this.language.toLowerCase() === 'html' || this.language.toLowerCase() === 'htm';
    const isBase = this.language.toLowerCase() === 'base';

    const wrap = document.createElement('div');
    wrap.className = `cm-lp-interactive-block ${isMermaid ? 'cm-lp-mermaid-block' : isHtml ? 'cm-lp-html-block' : 'cm-lp-base-block'}`;

    const header = document.createElement('div');
    header.className = 'cm-lp-codeblock-header';

    const langDisplay = (this.language || 'code').toUpperCase();
    const langSpan = document.createElement('span');
    langSpan.className = 'cm-lp-codeblock-lang';
    langSpan.textContent = langDisplay;
    header.appendChild(langSpan);

    // Segmented toggle button [ Diagram | Code ] or [ View | Code ] or [ Preview | Code ]
    const toggleContainer = document.createElement('div');
    toggleContainer.className = 'cm-lp-codeblock-view-toggle';

    const primaryLabel = isMermaid
      ? (this.t ? this.t('editor.diagram') : 'Diagram')
      : isBase
      ? (this.t ? this.t('base.view') : 'View')
      : (this.t ? this.t('editor.preview') : 'Preview');
    const codeLabel = this.t ? this.t('editor.code') : 'Code';

    const primaryBtn = document.createElement('button');
    primaryBtn.type = 'button';
    primaryBtn.className = `cm-lp-codeblock-view-btn ${this.mode === 'preview' ? 'active' : ''}`;
    primaryBtn.textContent = primaryLabel;
    primaryBtn.onmousedown = (e) => e.preventDefault();
    primaryBtn.onclick = (e) => {
      e.stopPropagation();
      if (this.mode !== 'preview') {
        this.onToggleMode(this.pos, 'preview');
      }
    };

    const codeBtn = document.createElement('button');
    codeBtn.type = 'button';
    codeBtn.className = `cm-lp-codeblock-view-btn ${this.mode === 'code' ? 'active' : ''}`;
    codeBtn.textContent = codeLabel;
    codeBtn.onmousedown = (e) => e.preventDefault();
    codeBtn.onclick = (e) => {
      e.stopPropagation();
      if (this.mode !== 'code') {
        this.onToggleMode(this.pos, 'code');
      }
    };

    toggleContainer.appendChild(primaryBtn);
    toggleContainer.appendChild(codeBtn);
    header.appendChild(toggleContainer);

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'cm-lp-codeblock-copy-btn';
    copyBtn.title = 'Code kopieren';
    copyBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      <span class="copy-text">Kopieren</span>
    `;
    copyBtn.onmousedown = (e) => e.preventDefault();
    copyBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(this.codeText);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = this.codeText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      copyBtn.classList.add('copied');
      const textSpan = copyBtn.querySelector('.copy-text');
      if (textSpan) textSpan.textContent = 'Kopiert!';
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        if (textSpan) textSpan.textContent = 'Kopieren';
      }, 2000);
    };
    header.appendChild(copyBtn);
    wrap.appendChild(header);

    // If in 'preview' mode, render the preview content
    if (this.mode === 'preview') {
      const previewEl = document.createElement('div');
      previewEl.className = `cm-lp-block-preview ${isMermaid ? 'cm-lp-mermaid-preview' : 'cm-lp-html-preview'}`;

      if (isMermaid) {
        const isDark = document.documentElement.getAttribute('data-theme') !== 'light' &&
          (document.documentElement.getAttribute('data-theme') === 'dark' ||
           window.matchMedia('(prefers-color-scheme: dark)').matches ||
           document.documentElement.classList.contains('dark'));

        const renderId = 'mermaid-' + Math.random().toString(36).slice(2, 9);
        loadAndInitMermaid(isDark)
          .then((mermaid) => mermaid.render(renderId, this.codeText || 'graph TD\n  Start'))
          .then(({ svg }) => {
            previewEl.innerHTML = DOMPurify.sanitize(svg, {
              USE_PROFILES: { svg: true, svgFilters: true },
              ADD_TAGS: ['foreignObject', 'style'],
              ADD_ATTR: ['style', 'class', 'transform', 'viewBox', 'xmlns'],
            });
            const svgEl = previewEl.querySelector('svg');
            if (svgEl) {
              svgEl.style.maxWidth = '100%';
              svgEl.style.height = 'auto';
            }
          })
          .catch((err) => {
            document.getElementById('d' + renderId)?.remove();
            document.getElementById(renderId)?.remove();
            previewEl.innerHTML = `
              <div class="cm-lp-mermaid-error">
                <span class="cm-lp-mermaid-error-icon">⚠️</span>
                <span class="cm-lp-mermaid-error-title">Mermaid Syntax Error:</span>
                <pre class="cm-lp-mermaid-error-msg">${escapeHtml(err?.message || String(err))}</pre>
              </div>
            `;
          });
      } else if (isHtml) {
        const iframe = document.createElement('iframe');
        iframe.className = 'cm-lp-html-frame';
        iframe.sandbox.add('allow-scripts');
        iframe.srcdoc = this.codeText;
        iframe.style.width = '100%';
        iframe.style.height = '320px';
        iframe.style.border = 'none';
        iframe.style.borderRadius = '6px';
        iframe.style.background = '#ffffff';
        iframe.loading = 'lazy';
        iframe.onload = () => {
          try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (doc) {
              const h = Math.max(doc.body?.scrollHeight || 0, doc.documentElement?.scrollHeight || 0);
              if (h > 0) {
                iframe.style.height = `${Math.min(800, Math.max(120, h + 24))}px`;
              }
            }
          } catch {}
        };
        previewEl.appendChild(iframe);
      } else if (isBase) {
        const baseContainer = document.createElement('div');
        baseContainer.className = 'cm-lp-base-container';
        const root = createRoot(baseContainer);
        (baseContainer as any)._reactRoot = root;
        root.render(
          <BaseView
            definitionYaml={this.codeText}
            allNotes={this.allNotes}
            currentBasePath={this.currentBasePath}
            onOpenNote={this.onNavigate}
          />
        );
        previewEl.appendChild(baseContainer);
      }

      wrap.appendChild(previewEl);
    }

    return wrap;
  }

  destroy(dom: HTMLElement) {
    const baseContainers = dom.querySelectorAll('.cm-lp-base-container');
    baseContainers.forEach((el) => {
      const root = (el as any)._reactRoot as Root | undefined;
      if (root) {
        setTimeout(() => {
          try {
            root.unmount();
          } catch {}
        }, 0);
      }
    });
  }

  ignoreEvent(event: Event) {
    const target = event.target as HTMLElement;
    if (!target) return false;
    return target.closest('.cm-lp-codeblock-copy-btn, .cm-lp-codeblock-view-toggle, .cm-lp-block-preview, .cm-lp-base-container') != null;
  }
}

class CodeBlockHeaderWidget extends WidgetType {
  constructor(readonly language: string, readonly codeText: string) {
    super();
  }

  eq(other: CodeBlockHeaderWidget) {
    return this.language === other.language && this.codeText === other.codeText;
  }

  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-lp-codeblock-header';
    const langDisplay = (this.language || 'code').toUpperCase();
    wrap.innerHTML = `
      <span class="cm-lp-codeblock-lang">${langDisplay}</span>
      <button type="button" class="cm-lp-codeblock-copy-btn" title="Code kopieren">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <span class="copy-text">Kopieren</span>
      </button>
    `;
    const btn = wrap.querySelector('.cm-lp-codeblock-copy-btn') as HTMLButtonElement | null;
    if (btn) {
      btn.onmousedown = (e) => e.preventDefault(); // Verhindert Fokus-Verlust in CM6
      btn.onclick = async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(this.codeText);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = this.codeText;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        btn.classList.add('copied');
        const textSpan = btn.querySelector('.copy-text');
        if (textSpan) textSpan.textContent = 'Kopiert!';
        setTimeout(() => {
          btn.classList.remove('copied');
          if (textSpan) textSpan.textContent = 'Kopieren';
        }, 2000);
      };
    }
    return wrap;
  }

  ignoreEvent(event: Event) {
    return (event.target as HTMLElement)?.closest?.('.cm-lp-codeblock-copy-btn') != null;
  }
}

function buildLivePreviewDecorations(
  view: EditorView,
  notePath: string,
  onNavigate: (target: string) => void,
  onSelectTag: (tag: string) => void,
  onUpdateTag: (newTag: string, from: number, to: number) => void,
  onToggleMode: (pos: number, mode: 'preview' | 'code') => void,
  allNotes?: { path: string; name: string; basename: string }[],
  t?: (key: string) => string
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const selection = view.state.selection.main;
  const blockModes = view.state.field(blockModesField, false) || new Map<number, 'preview' | 'code'>();

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

  // Pre-scan all fenced code blocks in the document
  interface CodeBlockInfo {
    startLine: number;
    endLine: number;
    lang: string;
    codeText: string;
    hasCursor: boolean;
  }
  const codeBlocks: CodeBlockInfo[] = [];
  let pendingStart = -1;
  let pendingLang = '';

  for (let l = 1; l <= doc.lines; l++) {
    const lineText = doc.line(l).text;
    const trimmed = lineText.trim();
    if (trimmed.startsWith('```')) {
      if (pendingStart === -1) {
        pendingStart = l;
        const match = trimmed.match(/^```([a-zA-Z0-9_\-+.]*)/);
        pendingLang = match ? match[1].trim() : '';
      } else {
        const codeLines: string[] = [];
        for (let cl = pendingStart + 1; cl < l; cl++) {
          codeLines.push(doc.line(cl).text);
        }
        let hasCursor = false;
        for (let cl = pendingStart; cl <= l; cl++) {
          if (activeLines.has(cl)) {
            hasCursor = true;
            break;
          }
        }
        codeBlocks.push({
          startLine: pendingStart,
          endLine: l,
          lang: pendingLang,
          codeText: codeLines.join('\n'),
          hasCursor,
        });
        pendingStart = -1;
        pendingLang = '';
      }
    }
  }
  if (pendingStart !== -1) {
    const codeLines: string[] = [];
    for (let cl = pendingStart + 1; cl <= doc.lines; cl++) {
      codeLines.push(doc.line(cl).text);
    }
    let hasCursor = false;
    for (let cl = pendingStart; cl <= doc.lines; cl++) {
      if (activeLines.has(cl)) {
        hasCursor = true;
        break;
      }
    }
    codeBlocks.push({
      startLine: pendingStart,
      endLine: doc.lines,
      lang: pendingLang,
      codeText: codeLines.join('\n'),
      hasCursor,
    });
  }

  const codeBlockByLine = new Map<number, { block: CodeBlockInfo; isStart: boolean; isEnd: boolean }>();
  for (const cb of codeBlocks) {
    codeBlockByLine.set(cb.startLine, { block: cb, isStart: true, isEnd: cb.startLine === cb.endLine });
    for (let l = cb.startLine + 1; l < cb.endLine; l++) {
      codeBlockByLine.set(l, { block: cb, isStart: false, isEnd: false });
    }
    if (cb.endLine > cb.startLine) {
      codeBlockByLine.set(cb.endLine, { block: cb, isStart: false, isEnd: true });
    }
  }

  for (let lineNum = minLine; lineNum <= maxLine; lineNum++) {
    const line = doc.line(lineNum);
    const text = line.text;
    const isCursorOnLine = activeLines.has(lineNum);

    const cbMeta = codeBlockByLine.get(lineNum);
    if (cbMeta) {
      const { block, isStart, isEnd } = cbMeta;
      const langLower = (block.lang || '').toLowerCase();
      const isInteractive = langLower === 'mermaid' || langLower === 'html' || langLower === 'htm' || langLower === 'base';

      if (isInteractive) {
        const startLineObj = doc.line(block.startLine);
        const mode = blockModes.get(startLineObj.from) ?? 'preview';

        if (mode === 'preview') {
          if (isStart) {
            builder.add(
              line.from,
              line.from,
              Decoration.line({
                class: 'cm-lp-codeblock-header-line cm-lp-codeblock-host-line',
              })
            );
            builder.add(
              line.from,
              line.to,
              Decoration.replace({
                widget: new InteractiveCodeBlockWidget(
                  block.lang,
                  block.codeText,
                  startLineObj.from,
                  'preview',
                  onToggleMode,
                  t,
                  onNavigate,
                  allNotes,
                  notePath || undefined
                ),
              })
            );
          } else {
            builder.add(
              line.from,
              line.from,
              Decoration.line({ class: 'cm-lp-codeblock-collapsed-line' })
            );
            if (line.to > line.from) {
              builder.add(line.from, line.to, Decoration.replace({}));
            }
          }
          continue;
        } else {
          // mode === 'code'
          if (isStart) {
            builder.add(
              line.from,
              line.from,
              Decoration.line({
                class: 'cm-lp-codeblock-header-line',
              })
            );
            builder.add(
              line.from,
              line.to,
              Decoration.replace({
                widget: new InteractiveCodeBlockWidget(
                  block.lang,
                  block.codeText,
                  startLineObj.from,
                  'code',
                  onToggleMode,
                  t,
                  onNavigate,
                  allNotes,
                  notePath || undefined
                ),
              })
            );
          } else if (isEnd) {
            builder.add(
              line.from,
              line.from,
              Decoration.line({ class: 'cm-lp-codeblock-bottom-line' })
            );
            if (line.to > line.from) {
              builder.add(line.from, line.to, Decoration.replace({}));
            }
          } else {
            builder.add(
              line.from,
              line.from,
              Decoration.line({ class: 'cm-lp-codeblock-content-line' })
            );
          }
          continue;
        }
      }

      if (!block.hasCursor) {
        if (isStart) {
          builder.add(
            line.from,
            line.from,
            Decoration.line({
              class: isEnd
                ? 'cm-lp-codeblock-header-line cm-lp-codeblock-bottom-line'
                : 'cm-lp-codeblock-header-line',
            })
          );
          builder.add(
            line.from,
            line.to,
            Decoration.replace({
              widget: new CodeBlockHeaderWidget(block.lang, block.codeText),
            })
          );
        } else if (isEnd) {
          builder.add(
            line.from,
            line.from,
            Decoration.line({
              class: 'cm-lp-codeblock-bottom-line',
            })
          );
          if (line.to > line.from) {
            builder.add(line.from, line.to, Decoration.replace({}));
          }
        } else {
          builder.add(
            line.from,
            line.from,
            Decoration.line({ class: 'cm-lp-codeblock-content-line' })
          );
        }
      } else {
        if (isStart || isEnd) {
          builder.add(
            line.from,
            line.from,
            Decoration.line({ class: 'cm-lp-codeblock-line' })
          );
          const match = text.match(/^(\s*```+)/);
          if (match) {
            const btFrom = line.from + text.indexOf(match[1]);
            const btTo = btFrom + match[1].length;
            builder.add(btFrom, btTo, Decoration.mark({ class: 'cm-lp-formatting' }));
          }
        } else {
          builder.add(
            line.from,
            line.from,
            Decoration.line({ class: 'cm-lp-codeblock-content-line' })
          );
        }
      }
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
              onUpdateTag,
              allNotes,
              t
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
              onUpdateTag,
              allNotes,
              t
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
              onUpdateTag,
              allNotes,
              t
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

  const { t } = useTranslation();
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const livePluginCompartment = useRef(new Compartment());
  const [editorContextMenu, setEditorContextMenu] = useState<{ x: number; y: number } | null>(null);
  const editorContextMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!editorContextMenu) return;
    const handleDocClick = (e: MouseEvent) => {
      if (editorContextMenuRef.current?.contains(e.target as Node)) return;
      setEditorContextMenu(null);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditorContextMenu(null);
    };
    document.addEventListener('mousedown', handleDocClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [editorContextMenu]);

  const callbacksRef = useRef({
    onChangeBody,
    onChangeRaw,
    onNavigateWikiLink,
    onSelectTag,
    onUploadAttachment: props.onUploadAttachment,
    onSendToTargetNote: props.onSendToTargetNote,
    setEditorContextMenu,
    mode,
    notePath,
    allNotes,
    allTags,
    t,
  });
  callbacksRef.current = {
    onChangeBody,
    onChangeRaw,
    onNavigateWikiLink,
    onSelectTag,
    onUploadAttachment: props.onUploadAttachment,
    onSendToTargetNote: props.onSendToTargetNote,
    setEditorContextMenu,
    mode,
    notePath,
    allNotes,
    allTags,
    t,
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
    if (view) {
      const sel = view.state.selection.main;
      return view.state.sliceDoc(sel.from, sel.to);
    }
    if (typeof window !== 'undefined') {
      const sel = window.getSelection();
      return sel ? sel.toString() : '';
    }
    return '';
  };

  const hasSelection = (): boolean => {
    const view = viewRef.current;
    if (view) {
      return !view.state.selection.main.empty;
    }
    if (typeof window !== 'undefined') {
      const sel = window.getSelection();
      return !!sel && !sel.isCollapsed && !!sel.toString().trim();
    }
    return false;
  };

  const replaceSelection = (newText: string) => {
    const view = viewRef.current;
    if (view) {
      const sel = view.state.selection.main;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: newText },
        selection: { anchor: sel.from + newText.length },
      });
      view.focus();
    }
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
    hasSelection,
    replaceSelection,
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
      // 1. [[WikiLink]] and ![[Embed]] completion
      const wikiBefore = context.matchBefore(/\[\[[^\]|\n]*$/);
      if (wikiBefore) {
        const query = wikiBefore.text.slice(2).toLowerCase();
        const options = callbacksRef.current.allNotes
          .filter((n) => {
            const isCanvas = n.path.toLowerCase().endsWith('.canvas');
            const targetName = isCanvas
              ? (n.name.toLowerCase().endsWith('.canvas') ? n.name : `${n.basename}.canvas`)
              : n.basename;
            return (
              n.basename.toLowerCase().includes(query) ||
              targetName.toLowerCase().includes(query) ||
              n.path.toLowerCase().includes(query)
            );
          })
          .slice(0, 60)
          .map((n) => {
            const isCanvas = n.path.toLowerCase().endsWith('.canvas');
            const targetName = isCanvas
              ? (n.name.toLowerCase().endsWith('.canvas') ? n.name : `${n.basename}.canvas`)
              : n.basename;
            return {
              label: targetName,
              detail: n.path,
              apply: `${targetName}]]`,
            };
          });
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
        let safeTo = Math.max(safeFrom, Math.min(to, docLen));
        if (newTag === '' && safeTo < docLen && v.state.doc.sliceString(safeTo, safeTo + 1) === '\n') {
          safeTo += 1;
        }
        v.dispatch({
          changes: { from: safeFrom, to: safeTo, insert: newTag },
        });
      };

      const onToggleMode = (pos: number, mode: 'preview' | 'code') => {
        const v = viewRef.current;
        if (!v) return;
        v.dispatch({
          effects: setBlockModeEffect.of({ pos, mode }),
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
              onUpdateTag,
              onToggleMode,
              callbacksRef.current.allNotes,
              callbacksRef.current.t
            );
          }
          update(update: ViewUpdate) {
            if (
              update.docChanged ||
              update.selectionSet ||
              update.viewportChanged ||
              update.transactions.some((tr) => tr.effects.some((e) => e.is(setBlockModeEffect)))
            ) {
              this.decorations = buildLivePreviewDecorations(
                update.view,
                callbacksRef.current.notePath,
                (t) => callbacksRef.current.onNavigateWikiLink(t),
                (tag) => callbacksRef.current.onSelectTag(tag),
                onUpdateTag,
                onToggleMode,
                callbacksRef.current.allNotes,
                callbacksRef.current.t
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
      dragover(event, _view) {
        if (
          event.dataTransfer?.types.includes('Files') ||
          event.dataTransfer?.types.includes('text/plain')
        ) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          return true;
        }
        return false;
      },
      drop(event, view) {
        const dt = event.dataTransfer;
        if (!dt) return false;

        const dropPos =
          view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
          view.state.selection.main.head;

        const files = dt.files ? Array.from(dt.files) : [];

        // Fall D: Plain text drop (no files)
        if (files.length === 0) {
          const text = dt.getData('text/plain');
          if (text) {
            event.preventDefault();
            view.dispatch({
              changes: { from: dropPos, to: dropPos, insert: text },
              selection: { anchor: dropPos + text.length },
            });
            view.focus();
            return true;
          }
          return false;
        }

        event.preventDefault();

        // Categorize files
        const textFiles: File[] = [];
        const uploadFiles: File[] = [];

        for (const file of files) {
          if (isTextFile(file)) {
            textFiles.push(file);
          } else {
            // Images (Fall A) and binary files like PDF, ZIP, DOCX (Fall C)
            uploadFiles.push(file);
          }
        }

        (async () => {
          const insertChunks: string[] = [];

          // Process text files (Fall B) - read client-side directly
          if (textFiles.length > 0) {
            const contents = await Promise.all(textFiles.map((f) => f.text()));
            insertChunks.push(contents.join('\n\n'));
          }

          // Process upload files (Fall A & C)
          if (uploadFiles.length > 0) {
            for (const file of uploadFiles) {
              try {
                const embedTag = callbacksRef.current.onUploadAttachment
                  ? await callbacksRef.current.onUploadAttachment(file)
                  : await api.uploadAttachment(file).then(
                      (res) => res.wikiEmbed || (res.path ? `![[${res.path}]]` : `![[${res.name}]]`)
                    );
                insertChunks.push(embedTag);
              } catch (err) {
                console.error('Fehler beim Upload des Anhangs:', err);
              }
            }
          }

          if (insertChunks.length > 0) {
            const insertText = insertChunks.join('\n\n');
            view.dispatch({
              changes: { from: dropPos, to: dropPos, insert: insertText },
              selection: { anchor: dropPos + insertText.length },
            });
            view.focus();
          }
        })();

        return true;
      },
      contextmenu(event, view) {
        const selection = view.state.selection.main;
        if (!selection.empty) {
          event.preventDefault();
          const x = Math.min(event.clientX, window.innerWidth - 240);
          const y = Math.min(event.clientY, window.innerHeight - 100);
          callbacksRef.current.setEditorContextMenu({ x, y });
          return true;
        }
        return false;
      },
    });

    const state = EditorState.create({
      doc: activeDocText,
      extensions: [
        blockModesField,
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
        markdown({ codeLanguages: languages }),
        syntaxHighlighting(codeHighlighter),
        EditorView.lineWrapping,
        placeholder(
          (typeof localStorage !== 'undefined' && (localStorage.getItem('zuber_language') === 'de' || localStorage.getItem('knowmesh_language') === 'de'))
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
        let isCanvas = target.toLowerCase().endsWith('.canvas');
        let canvasPath = target;
        if (!isCanvas) {
          const lower = target.toLowerCase();
          const canvasMatch = allNotes.find(
            (n) =>
              (n.basename.toLowerCase() === lower || n.name.toLowerCase() === lower || n.path.toLowerCase() === lower) &&
              n.path.toLowerCase().endsWith('.canvas')
          );
          const mdMatch = allNotes.find(
            (n) =>
              (n.basename.toLowerCase() === lower || n.name.toLowerCase() === lower || n.path.toLowerCase() === lower) &&
              n.path.toLowerCase().endsWith('.md')
          );
          if (canvasMatch && !mdMatch) {
            isCanvas = true;
            canvasPath = canvasMatch.path;
          }
        }
        if (isCanvas) {
          const safeCanvasPath = escapeHtml(canvasPath);
          const safeAlt = escapeHtml(alt);
          return `<div class="reading-canvas-embed" data-canvas-path="${safeCanvasPath}" data-wikilink="${safeCanvasPath}"><div class="reading-canvas-embed-header"><span class="canvas-icon">📊</span> <strong>${safeAlt}</strong> <span class="canvas-open-hint">Im Editor öffnen ↗</span></div></div>`;
        }
        if (target.toLowerCase().endsWith('.pdf')) {
          const url = escapeHtml(api.getAttachmentUrl(target, notePath));
          const fileName = target.split('/').pop() || target;
          let height = '550px';
          if (/^\d+$/.test(alt)) {
            height = `${alt}px`;
          }
          return `<div class="cm-lp-pdf-embed reading-pdf-embed"><div class="cm-lp-pdf-header"><span class="cm-lp-pdf-title">📄 ${escapeHtml(fileName)}</span><a href="${url}" target="_blank" rel="noopener noreferrer" class="cm-lp-pdf-open-btn" title="In neuem Tab öffnen">↗</a></div><iframe src="${url}#toolbar=1&view=FitH" class="cm-lp-pdf-frame" style="height: ${height};" loading="lazy"></iframe></div>`;
        }
        if (IMAGE_EXT_REGEX.test(target)) {
          const url = escapeHtml(api.getAttachmentUrl(target, notePath));
          const styleAttr = /^\d+$/.test(alt) ? ` style="max-width:${alt}px"` : '';
          return `<span class="reading-image-embed"><img src="${url}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"${styleAttr} /></span>`;
        }
        return `<div class="reading-note-embed" data-wikilink="${escapeHtml(target)}">📄 Eingebettete Notiz: <strong>${escapeHtml(alt)}</strong></div>`;
      }
    );

    // 3. Transform Standard Markdown Images ![alt](url) to use vault attachment resolver
    processed = processed.replace(
      /!\[([^\]\n]*)\]\(([^)\n]+)\)/g,
      (_match, altRaw, hrefRaw) => {
        const target = String(hrefRaw).trim();
        const alt = String(altRaw || target).trim();
        let isCanvas = target.toLowerCase().endsWith('.canvas');
        let canvasPath = target;
        if (!isCanvas) {
          const lower = target.toLowerCase();
          const canvasMatch = allNotes.find(
            (n) =>
              (n.basename.toLowerCase() === lower || n.name.toLowerCase() === lower || n.path.toLowerCase() === lower) &&
              n.path.toLowerCase().endsWith('.canvas')
          );
          const mdMatch = allNotes.find(
            (n) =>
              (n.basename.toLowerCase() === lower || n.name.toLowerCase() === lower || n.path.toLowerCase() === lower) &&
              n.path.toLowerCase().endsWith('.md')
          );
          if (canvasMatch && !mdMatch) {
            isCanvas = true;
            canvasPath = canvasMatch.path;
          }
        }
        if (isCanvas) {
          const safeCanvasPath = escapeHtml(canvasPath);
          const safeAlt = escapeHtml(alt);
          return `<div class="reading-canvas-embed" data-canvas-path="${safeCanvasPath}" data-wikilink="${safeCanvasPath}"><div class="reading-canvas-embed-header"><span class="canvas-icon">📊</span> <strong>${safeAlt}</strong> <span class="canvas-open-hint">Im Editor öffnen ↗</span></div></div>`;
        }
        if (target.toLowerCase().endsWith('.pdf')) {
          const rawUrl = /^(https?:|data:)/i.test(target) ? target : api.getAttachmentUrl(target, notePath);
          const url = escapeHtml(rawUrl);
          const fileName = target.split('/').pop() || target;
          let height = '550px';
          if (/^\d+$/.test(alt)) {
            height = `${alt}px`;
          }
          return `<div class="cm-lp-pdf-embed reading-pdf-embed"><div class="cm-lp-pdf-header"><span class="cm-lp-pdf-title">📄 ${escapeHtml(fileName)}</span><a href="${url}" target="_blank" rel="noopener noreferrer" class="cm-lp-pdf-open-btn" title="In neuem Tab öffnen">↗</a></div><iframe src="${url}#toolbar=1&view=FitH" class="cm-lp-pdf-frame" style="height: ${height};" loading="lazy"></iframe></div>`;
        }
        const rawUrl = /^(https?:|data:)/i.test(target)
          ? target
          : api.getAttachmentUrl(target, notePath);
        return `<span class="reading-image-embed"><img src="${escapeHtml(rawUrl)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" /></span>`;
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
          return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="external-link">${escapeHtml(label)}</a>`;
        }
        return `<a href="#" class="reading-wikilink" data-wikilink="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
      }
    );

    // 5. Transform [[Wiki-Links]]
    processed = processed.replace(
      /\[\[([^\]|#\n]+)(?:#([^\]|\n]+))?(?:\|([^\]\n]+))?\]\]/g,
      (_match, targetRaw, _heading, aliasRaw) => {
        const target = String(targetRaw).trim();
        const display = aliasRaw ? String(aliasRaw).trim() : target;
        return `<a href="#" class="reading-wikilink" data-wikilink="${escapeHtml(target)}">${escapeHtml(display)}</a>`;
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
      ADD_TAGS: ['rect', 'path', 'svg', 'button', 'iframe'],
      ADD_ATTR: [
        'href',
        'target',
        'rel',
        'data-wiki-target',
        'data-wikilink',
        'data-canvas-path',
        'data-tag',
        'data-code',
        'data-action',
        'data-rendered',
        'srcdoc',
        'sandbox',
        'style',
        'loading',
        'decoding',
        'align',
        'viewBox',
        'fill',
        'stroke',
        'stroke-width',
        'width',
        'height',
        'rx',
        'ry',
        'd',
      ],
    });
  }, [body, mode, notePath]);

  // Render Mermaid diagrams in Reading Mode
  useEffect(() => {
    if (mode !== 'reading') return;
    const container = document.querySelector('.reading-view-container');
    if (!container) return;

    const isDark =
      document.documentElement.getAttribute('data-theme') !== 'light' &&
      (document.documentElement.getAttribute('data-theme') === 'dark' ||
        window.matchMedia('(prefers-color-scheme: dark)').matches ||
        document.documentElement.classList.contains('dark'));

    const mermaidBlocks = container.querySelectorAll<HTMLElement>('.reading-mermaid-container');
    if (mermaidBlocks.length === 0) return;

    mermaidBlocks.forEach((block) => {
      const rawCode = decodeURIComponent(block.dataset.code || '');
      const svgContainer = block.querySelector<HTMLElement>('.reading-mermaid-svg');
      if (!svgContainer || svgContainer.hasAttribute('data-rendered')) return;

      svgContainer.setAttribute('data-rendered', 'true');
      const renderId = 'reading-mermaid-' + Math.random().toString(36).slice(2, 9);
      loadAndInitMermaid(isDark)
        .then((mermaid) => mermaid.render(renderId, rawCode || 'graph TD\n  Start'))
        .then(({ svg }) => {
          svgContainer.innerHTML = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            ADD_TAGS: ['foreignObject', 'style'],
            ADD_ATTR: ['style', 'class', 'transform', 'viewBox', 'xmlns'],
          });
          const svgEl = svgContainer.querySelector('svg');
          if (svgEl) {
            svgEl.style.maxWidth = '100%';
            svgEl.style.height = 'auto';
          }
        })
        .catch((err) => {
          document.getElementById('d' + renderId)?.remove();
          document.getElementById(renderId)?.remove();
          svgContainer.innerHTML = `
            <div class="cm-lp-mermaid-error">
              <span class="cm-lp-mermaid-error-icon">⚠️</span>
              <span class="cm-lp-mermaid-error-title">Mermaid Syntax Error:</span>
              <pre class="cm-lp-mermaid-error-msg">${escapeHtml(err?.message || String(err))}</pre>
            </div>
          `;
        });
    });
    // Render Base blocks in Reading Mode
    const baseBlocks = container.querySelectorAll<HTMLElement>('.reading-base-container');
    const baseRoots: Root[] = [];
    baseBlocks.forEach((block) => {
      const rawCode = decodeURIComponent(block.dataset.code || '');
      const mountContainer = block.querySelector<HTMLElement>('.reading-base-mount');
      if (!mountContainer || mountContainer.hasAttribute('data-rendered')) return;

      mountContainer.setAttribute('data-rendered', 'true');
      const root = createRoot(mountContainer);
      baseRoots.push(root);
      root.render(
        <BaseView
          definitionYaml={rawCode}
          allNotes={allNotes}
          currentBasePath={notePath || undefined}
          onOpenNote={onNavigateWikiLink}
        />
      );
    });

    return () => {
      baseRoots.forEach((r) => {
        try {
          r.unmount();
        } catch {}
      });
    };
  }, [mode, onNavigateWikiLink, renderedHtml]);

  const handleReadingClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const extLink = (e.target as HTMLElement).closest('a[target="_blank"]');
    if (extLink) {
      return;
    }

    const toggleBtn = (e.target as HTMLElement).closest('.codeblock-toggle-btn') as HTMLButtonElement | null;
    if (toggleBtn) {
      e.preventDefault();
      e.stopPropagation();
      const container = toggleBtn.closest('.codeblock-container');
      if (!container) return;
      const action = toggleBtn.getAttribute('data-action');
      const buttons = container.querySelectorAll('.codeblock-toggle-btn');
      buttons.forEach((b) => b.classList.remove('active'));
      toggleBtn.classList.add('active');

      const previewEl = container.querySelector<HTMLElement>(
        '.reading-mermaid-preview, .reading-html-preview, .reading-base-preview'
      );
      const codeEl = container.querySelector<HTMLElement>(
        '.reading-mermaid-code, .reading-html-code, .reading-base-code'
      );

      if (action === 'code') {
        if (previewEl) previewEl.style.display = 'none';
        if (codeEl) codeEl.style.display = 'block';
      } else {
        if (previewEl) previewEl.style.display = 'block';
        if (codeEl) codeEl.style.display = 'none';
      }
      return;
    }

    const copyBtn = (e.target as HTMLElement).closest(
      '.codeblock-copy-btn, .cm-lp-codeblock-copy-btn'
    ) as HTMLButtonElement | null;
    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const container = copyBtn.closest('.codeblock-container');
      const code = container?.querySelector('code')?.textContent || '';
      const copyText = async () => {
        try {
          await navigator.clipboard.writeText(code);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = code;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        copyBtn.classList.add('copied');
        const textSpan = copyBtn.querySelector('.copy-text');
        if (textSpan) textSpan.textContent = 'Kopiert!';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          if (textSpan) textSpan.textContent = 'Kopieren';
        }, 2000);
      };
      copyText();
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

  const handleReadingContextMenu = (e: React.MouseEvent) => {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (sel && !sel.isCollapsed && sel.toString().trim()) {
      e.preventDefault();
      const x = Math.min(e.clientX, window.innerWidth - 240);
      const y = Math.min(e.clientY, window.innerHeight - 100);
      setEditorContextMenu({ x, y });
    }
  };

  const contextMenuElement = editorContextMenu && (
    <div
      ref={editorContextMenuRef}
      className="editor-context-menu"
      style={{
        position: 'fixed',
        top: `${editorContextMenu.y}px`,
        left: `${editorContextMenu.x}px`,
        zIndex: 9999,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="editor-context-item"
        onClick={() => {
          setEditorContextMenu(null);
          callbacksRef.current.onSendToTargetNote?.();
        }}
      >
        <Target size={15} />
        <span>{t('editor.sendToTargetNote') || 'An Ziel-Notiz senden…'}</span>
      </button>
    </div>
  );

  if (mode === 'reading') {
    return (
      <div
        className="reading-view-container markdown-rendered"
        onClick={handleReadingClick}
        onContextMenu={handleReadingContextMenu}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      >
        {contextMenuElement}
      </div>
    );
  }

  return (
    <div ref={editorContainerRef} className="codemirror-editor-wrapper">
      {contextMenuElement}
    </div>
  );
});

LivePreviewEditor.displayName = 'LivePreviewEditor';
