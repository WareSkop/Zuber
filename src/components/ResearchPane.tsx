import React, { useState, useEffect, useRef, useMemo, Suspense, lazy } from 'react';
import {
  Columns,
  Rows,
  ArrowLeft,
  X,
  GitFork,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  FileText,
  Image as ImageIcon,
  Database,
  Globe,
  RotateCw,
  Copy,
  Check,
  ExternalLink,
  ShieldAlert,
  FilePlus,
  Quote,
} from 'lucide-react';
import { createRoot, type Root } from 'react-dom/client';
import DOMPurify from 'dompurify';
import { useTranslation } from '../i18n';
import { api } from '../api';
import { syncEngine } from '../sync/syncEngine';
import type { GraphData, WebExtractResponse } from '../../shared/types';
import { WorkflowCanvasIcon } from './canvas/WorkflowCanvasIcon';
import { renderReadingHtml, renderWebArticleHtml, loadAndInitMermaid, escapeHtml } from '../utils/readingMode';
import { ResearchPdfViewer } from './ResearchPdfViewer';
import { ZUBER_QUOTE_MIME, type ZuberQuotePayload } from '../utils/quoteUtils';
import { BaseView } from './BaseView';
import { BaseEmbedWidget } from './base/BaseEmbedWidget';
import { CanvasEmbedWidget } from './canvas/CanvasEmbedWidget';
import { normalizeWebUrl, routeExternalLinkClick } from '../utils/researchLinkUtils';
import { resolveDecryptedAttachmentUrl } from '../crypto/encryptedAttachmentUrl';
import { stripZencExt } from '../crypto/folderCrypto';

const GraphView = lazy(() =>
  import('./GraphView').then((m) => ({ default: m.GraphView }))
);
const CanvasEditor = lazy(() =>
  import('./canvas/CanvasEditor').then((m) => ({ default: m.CanvasEditor }))
);

export type ResearchContentType = 'note' | 'canvas' | 'image' | 'pdf' | 'graph' | 'base' | 'web';

export function detectFileType(path: string): ResearchContentType {
  const lower = stripZencExt(path).toLowerCase();
  if (lower.endsWith('.canvas')) return 'canvas';
  if (lower.endsWith('.base')) return 'base';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(lower)) return 'image';
  return 'note';
}

export interface ResearchTarget {
  path: string;
  type: ResearchContentType;
}

export interface ResearchPaneProps {
  target: ResearchTarget | null;
  orientation: 'horizontal' | 'vertical';
  onToggleOrientation: () => void;
  onOpenInMain: (path: string) => void;
  onClose: () => void;
  onNavigate: (target: string, event?: { altKey?: boolean; preventDefault?: () => void }) => void;
  onShowGraph: () => void;
  onOpenWebUrl?: (url: string) => void;
  onSaveWebNote?: (article: {
    title: string;
    url: string;
    byline?: string | null;
    siteName?: string | null;
    markdown: string;
  }) => void | Promise<void>;
  onInsertQuote?: (payload: ZuberQuotePayload) => void;
  graphData: GraphData;
  allNotes: { path: string; name: string; basename: string }[];
  activeNotePath: string | null;
  onSelectTag?: (tag: string) => void;
}

export const ResearchPane: React.FC<ResearchPaneProps> = ({
  target,
  orientation,
  onToggleOrientation,
  onOpenInMain,
  onClose,
  onNavigate,
  onShowGraph,
  onOpenWebUrl,
  onSaveWebNote,
  onInsertQuote,
  graphData,
  allNotes,
  activeNotePath,
  onSelectTag,
}) => {
  const { t, language } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [noteContent, setNoteContent] = useState<string>('');
  const [canvasRawContent, setCanvasRawContent] = useState<string>('{}');
  const [imageZoom, setImageZoom] = useState<number>(1);
  const [webInputValue, setWebInputValue] = useState<string>('');
  const [webViewMode, setWebViewMode] = useState<'markdown' | 'html'>('markdown');
  const [extractedWeb, setExtractedWeb] = useState<WebExtractResponse | null>(null);
  const [webExtractLoading, setWebExtractLoading] = useState<boolean>(false);
  const [webExtractError, setWebExtractError] = useState<string | null>(null);
  const [webReloadTick, setWebReloadTick] = useState<number>(0);
  const [savingWebNote, setSavingWebNote] = useState<boolean>(false);
  const [savedWebNoteUrl, setSavedWebNoteUrl] = useState<string | null>(null);
  const [iframeReloadKey, setIframeReloadKey] = useState<number>(0);
  const [embedBlocked, setEmbedBlocked] = useState<boolean>(false);
  const [urlCopied, setUrlCopied] = useState<boolean>(false);
  const [decryptedMediaUrl, setDecryptedMediaUrl] = useState<string | null>(null);
  const [quotePopover, setQuotePopover] = useState<{
    x: number;
    y: number;
    payload: ZuberQuotePayload;
  } | null>(null);

  const readingContainerRef = useRef<HTMLDivElement>(null);
  const contentContainerRef = useRef<HTMLDivElement>(null);
  const quotePopoverRef = useRef<HTMLButtonElement | null>(null);
  const webExtractCacheRef = useRef<Map<string, WebExtractResponse>>(new Map());

  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;
    setDecryptedMediaUrl(null);
    if (!target || (target.type !== 'image' && target.type !== 'pdf')) return;
    resolveDecryptedAttachmentUrl(target.path)
      .then((res) => {
        if (!res) return;
        if (cancelled) {
          if (res.isObjectUrl) URL.revokeObjectURL(res.url);
          return;
        }
        if (res.isObjectUrl) revokedUrl = res.url;
        setDecryptedMediaUrl(res.url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [target?.path, target?.type]);
  const webInputRef = useRef<HTMLInputElement>(null);

  // Sync address bar, reset web reader state on URL change, and fetch Reader Markdown or HTML embed check
  useEffect(() => {
    setQuotePopover(null);
    if (target?.type !== 'web') {
      setEmbedBlocked(false);
      setExtractedWeb(null);
      setWebExtractError(null);
      setWebExtractLoading(false);
      return;
    }
    setWebInputValue(target.path || '');
    setEmbedBlocked(false);
    setUrlCopied(false);
    setWebViewMode('markdown');
    setExtractedWeb(null);
    setWebExtractError(null);

    if (!target.path) {
      setWebExtractLoading(false);
      const timer = window.setTimeout(() => webInputRef.current?.focus(), 30);
      return () => window.clearTimeout(timer);
    }
  }, [target?.type, target?.path]);

  useEffect(() => {
    if (target?.type !== 'web' || !target.path) return;
    let cancelled = false;

    if (webViewMode === 'markdown') {
      const cached = webExtractCacheRef.current.get(target.path);
      if (cached) {
        setExtractedWeb(cached);
        setWebExtractError(null);
        setWebExtractLoading(false);
        return;
      }

      setWebExtractLoading(true);
      setWebExtractError(null);
      api
        .extractWebUrl(target.path)
        .then((res) => {
          if (cancelled) return;
          webExtractCacheRef.current.set(target.path, res);
          setExtractedWeb(res);
          setWebExtractLoading(false);
        })
        .catch((err: any) => {
          if (cancelled) return;
          setExtractedWeb(null);
          setWebExtractError(err?.message || t('research.extractErrorTitle'));
          setWebExtractLoading(false);
        });
    } else {
      api
        .checkLinkEmbed(target.path)
        .then((res) => {
          if (!cancelled && res && res.embeddable === false) {
            setEmbedBlocked(true);
          }
        })
        .catch(() => {
          // Ignore network/offline pre-check errors; let iframe try loading
        });
    }

    return () => {
      cancelled = true;
    };
  }, [target?.type, target?.path, webViewMode, webReloadTick, t]);

  // Load content when target changes
  useEffect(() => {
    if (!target || target.type === 'graph') {
      setLoading(false);
      return;
    }

    let isMounted = true;
    setImageZoom(1);

    if (target.type === 'note') {
      setLoading(true);
      syncEngine
        .getNote(target.path)
        .then((note) => {
          if (!isMounted) return;
          setNoteContent(note.body || '');
          setLoading(false);
        })
        .catch(() => {
          if (!isMounted) return;
          api
            .getNote(target.path)
            .then((res) => {
              if (!isMounted) return;
              setNoteContent(res.body || '');
              setLoading(false);
            })
            .catch(() => {
              if (!isMounted) return;
              setNoteContent(t('research.noteLoadError'));
              setLoading(false);
            });
        });
    } else if (target.type === 'canvas') {
      setLoading(true);
      syncEngine
        .getNote(target.path)
        .then((note) => {
          if (!isMounted) return;
          setCanvasRawContent(note.rawContent || note.body || '{}');
          setLoading(false);
        })
        .catch(() => {
          if (!isMounted) return;
          api
            .getNote(target.path)
            .then((res) => {
              if (!isMounted) return;
              setCanvasRawContent(res.rawContent || res.body || '{}');
              setLoading(false);
            })
            .catch(() => {
              if (!isMounted) return;
              setCanvasRawContent('{}');
              setLoading(false);
            });
        });
    } else {
      setLoading(false);
    }

    return () => {
      isMounted = false;
    };
  }, [target?.path, target?.type]);

  // Render HTML for markdown notes
  const renderedHtml = useMemo(() => {
    if (target?.type !== 'note') return '';
    return renderReadingHtml(noteContent, target.path, allNotes, {
      attachmentLabel: t('sidebar.pdfAttachmentLabel'),
      pageBreakLabel: t('editor.pageBreakLabel'),
      openInNewTabLabel: t('editor.openInNewTab'),
      embeddedNoteLabel: t('editor.embeddedNote'),
    });
  }, [target?.type, target?.path, noteContent, allNotes, t]);

  const readingHtmlObj = useMemo(() => ({ __html: renderedHtml }), [renderedHtml]);

  const renderedWebHtml = useMemo(() => {
    if (target?.type !== 'web' || webViewMode !== 'markdown' || extractedWeb?.type !== 'article') {
      return '';
    }
    return renderWebArticleHtml(extractedWeb.markdown);
  }, [target?.type, webViewMode, extractedWeb]);

  const webHtmlObj = useMemo(() => ({ __html: renderedWebHtml }), [renderedWebHtml]);

  // Dismiss quick-quote popover on Escape or outside mousedown
  useEffect(() => {
    if (!quotePopover) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setQuotePopover(null);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (quotePopoverRef.current?.contains(e.target as Node)) return;
      // Selection change / click inside content will re-evaluate on mouseup
      if (!contentContainerRef.current?.contains(e.target as Node)) {
        setQuotePopover(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [quotePopover]);

  // Setup Mermaid diagrams, Base blocks, and event listeners in reading view
  useEffect(() => {
    if (target?.type !== 'note' || !readingContainerRef.current) return;
    const container = readingContainerRef.current;

    const isDark =
      document.documentElement.getAttribute('data-theme') !== 'light' &&
      (document.documentElement.getAttribute('data-theme') === 'dark' ||
        (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) ||
        document.documentElement.classList.contains('dark'));

    // Mermaid rendering
    const mermaidBlocks = container.querySelectorAll<HTMLElement>('.reading-mermaid-container');
    mermaidBlocks.forEach((block) => {
      const rawCode = decodeURIComponent(block.dataset.code || '');
      const svgContainer = block.querySelector<HTMLElement>('.reading-mermaid-svg');
      if (!svgContainer || svgContainer.hasAttribute('data-rendered')) return;

      svgContainer.setAttribute('data-rendered', 'true');
      const renderId = 'research-mermaid-' + Math.random().toString(36).slice(2, 9);
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

    // Base block rendering
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
          currentBasePath={target.path || undefined}
          onOpenNote={(noteP: string) => onNavigate(noteP)}
        />
      );
    });

    // Base Embeds (![[Name.base]]) rendering
    const baseEmbedBlocks = container.querySelectorAll<HTMLElement>('.embedded-base-container, .reading-base-embed');
    baseEmbedBlocks.forEach((block) => {
      const basePath = block.dataset.basePath || block.dataset.wikilink || '';
      const initialView = block.dataset.view || undefined;
      const height = block.dataset.height || undefined;
      let mountContainer = block.querySelector<HTMLElement>('.reading-base-mount');
      if (!mountContainer) {
        mountContainer = document.createElement('div');
        mountContainer.className = 'reading-base-mount';
        block.appendChild(mountContainer);
      }
      if (mountContainer.hasAttribute('data-rendered')) return;

      mountContainer.setAttribute('data-rendered', 'true');
      const root = createRoot(mountContainer);
      baseRoots.push(root);
      root.render(
        <BaseEmbedWidget
          basePath={basePath}
          initialView={initialView}
          height={height}
          allNotes={allNotes}
          onOpenNote={(noteP: string) => onNavigate(noteP)}
        />
      );
    });

    // Canvas Embeds (![[Name.canvas]]) rendering
    const canvasEmbedBlocks = container.querySelectorAll<HTMLElement>('.embedded-canvas-container');
    const canvasRoots: Root[] = [];
    canvasEmbedBlocks.forEach((block) => {
      const canvasPath = block.dataset.canvasPath || block.dataset.wikilink || '';
      const height = block.dataset.height || undefined;
      let mountContainer = block.querySelector<HTMLElement>('.reading-canvas-mount');
      if (!mountContainer) {
        mountContainer = document.createElement('div');
        mountContainer.className = 'reading-canvas-mount';
        block.appendChild(mountContainer);
      }
      if (mountContainer.hasAttribute('data-rendered')) return;

      mountContainer.setAttribute('data-rendered', 'true');
      const root = createRoot(mountContainer);
      canvasRoots.push(root);
      root.render(
        <CanvasEmbedWidget
          canvasPath={canvasPath}
          height={height}
          allNotes={allNotes}
          currentNotePath={target?.path}
          onOpenNote={(noteP: string) => onNavigate(noteP)}
        />
      );
    });

    return () => {
      baseRoots.forEach((r) => {
        try {
          r.unmount();
        } catch {}
      });
      canvasRoots.forEach((r) => {
        try {
          r.unmount();
        } catch {}
      });
      container.querySelectorAll('.reading-base-mount, .reading-canvas-mount, .reading-mermaid-svg').forEach((el) => {
        el.removeAttribute('data-rendered');
      });
    };
  }, [target?.type, target?.path, renderedHtml, allNotes, onNavigate]);

  useEffect(() => {
    if (target?.type !== 'note' || !readingContainerRef.current) return;
    const container = readingContainerRef.current;
    let cancelled = false;
    const revokedUrls: string[] = [];

    const mediaEls = container.querySelectorAll<HTMLImageElement | HTMLIFrameElement>(
      'img[src*="/api/vault/attachment"], iframe[src*="/api/vault/attachment"]'
    );
    mediaEls.forEach((el) => {
      try {
        const parsed = new URL(el.src, window.location.origin);
        const targetParam = parsed.searchParams.get('target');
        if (!targetParam) return;
        resolveDecryptedAttachmentUrl(targetParam, target.path)
          .then((res) => {
            if (!res) return;
            if (cancelled) {
              if (res.isObjectUrl) URL.revokeObjectURL(res.url);
              return;
            }
            if (res.isObjectUrl) revokedUrls.push(res.url);
            if (el.tagName === 'IFRAME') {
              el.src = `${res.url}#toolbar=1&view=FitH`;
              const openBtn = el.closest('.cm-lp-pdf-embed')?.querySelector('a.cm-lp-pdf-open-btn') as HTMLAnchorElement | null;
              if (openBtn) openBtn.href = res.url;
            } else {
              el.src = res.url;
            }
          })
          .catch(() => {});
      } catch {}
    });

    return () => {
      cancelled = true;
      for (const u of revokedUrls) {
        URL.revokeObjectURL(u);
      }
    };
  }, [target?.type, target?.path, renderedHtml]);

  useEffect(() => {
    if (target?.type !== 'note' || !readingContainerRef.current) return;
    const links = readingContainerRef.current.querySelectorAll<HTMLAnchorElement>('a[href^="http://"], a[href^="https://"]');
    const splitTooltip = t('research.linkTooltipSplit');
    links.forEach((a) => {
      a.title = splitTooltip;
    });
  }, [target?.type, renderedHtml, t]);

  // Click handler inside Reading Mode
  const handleReadingClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const extLink = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (extLink && /^https?:/i.test(extLink.href)) {
      routeExternalLinkClick({
        url: extLink.href,
        isResearchOpen: true,
        event: e,
        onOpenInResearch: onOpenWebUrl,
        openExternal: (u) => window.open(u, '_blank', 'noopener,noreferrer'),
      });
      return;
    }
    if (extLink && extLink.getAttribute('target') === '_blank') return;

    // Codeblock view toggle (Diagram | Code / Preview | Code)
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

    // Copy code button
    const copyBtn = (e.target as HTMLElement).closest(
      '.codeblock-copy-btn, .cm-lp-codeblock-copy-btn'
    ) as HTMLButtonElement | null;
    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const container = copyBtn.closest('.codeblock-container');
      const code = container?.querySelector('code')?.textContent || '';
      navigator.clipboard.writeText(code).finally(() => {
        copyBtn.classList.add('copied');
        const textSpan = copyBtn.querySelector('.copy-text');
        if (textSpan) textSpan.textContent = language === 'de' ? 'Kopiert!' : 'Copied!';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          if (textSpan) textSpan.textContent = language === 'de' ? 'Kopieren' : 'Copy';
        }, 2000);
      });
      return;
    }

    // WikiLink or Tag click
    const targetEl = (e.target as HTMLElement).closest('[data-wikilink], [data-tag]');
    if (!targetEl) return;

    const wiki = targetEl.getAttribute('data-wikilink');
    if (wiki) {
      if (e.altKey) e.preventDefault();
      e.preventDefault();
      onNavigate(wiki, e);
      return;
    }

    const tag = targetEl.getAttribute('data-tag');
    if (tag && onSelectTag) {
      e.preventDefault();
      onSelectTag(tag);
    }
  };

  const isGraph = !target || target.type === 'graph';
  const isWeb = target?.type === 'web';
  const fileName = isWeb
    ? extractedWeb?.title || target?.path || t('research.openWebUrl')
    : target?.path
    ? target.path.split('/').pop() || target.path
    : '';
  const typeBadge = isGraph
    ? 'GRAPH'
    : isWeb
    ? 'WEB'
    : target?.type === 'note'
    ? 'MD'
    : target?.type === 'canvas'
    ? 'CANVAS'
    : target?.type === 'base'
    ? 'BASE'
    : target?.type === 'image'
    ? 'IMG'
    : target?.type === 'pdf'
    ? 'PDF'
    : 'REF';

  const buildSelectionQuotePayload = (fallbackTarget?: EventTarget | null): ZuberQuotePayload | null => {
    if (!target || isGraph || target.type === 'image' || target.type === 'canvas' || target.type === 'base') {
      return null;
    }
    const sel = window.getSelection?.();
    const selectedText = sel?.toString().trim() || '';
    if (!selectedText) return null;

    const resolveElement = (node: Node | null | undefined): HTMLElement | null => {
      if (!node) return null;
      return node.nodeType === 3 ? node.parentElement : (node as HTMLElement);
    };

    const anchorEl = resolveElement(sel?.anchorNode);
    const focusEl = resolveElement(sel?.focusNode);
    const fallbackEl =
      fallbackTarget && typeof (fallbackTarget as Node).nodeType === 'number'
        ? resolveElement(fallbackTarget as Node)
        : null;

    if (
      contentContainerRef.current &&
      anchorEl &&
      !contentContainerRef.current.contains(anchorEl) &&
      (!focusEl || !contentContainerRef.current.contains(focusEl))
    ) {
      return null;
    }

    const pageEl =
      anchorEl?.closest('[data-pdf-page]') ||
      focusEl?.closest('[data-pdf-page]') ||
      fallbackEl?.closest('[data-pdf-page]');
    const rawPage = pageEl?.getAttribute('data-pdf-page');
    const parsedPage = rawPage ? Number(rawPage) : undefined;
    const validPage =
      typeof parsedPage === 'number' && Number.isFinite(parsedPage) && parsedPage > 0
        ? parsedPage
        : undefined;

    if (target.type === 'pdf') {
      return {
        text: selectedText,
        url: target.path,
        title: target.path.split('/').pop() || target.path,
        page: validPage,
        isInternal: true,
      };
    }

    if (target.type === 'web') {
      const isExternalPdf = extractedWeb?.type === 'pdf';
      return {
        text: selectedText,
        url: extractedWeb?.url || target.path,
        title: extractedWeb?.title || target.path,
        ...(isExternalPdf && validPage ? { page: validPage } : {}),
        isInternal: false,
      };
    }

    if (target.type === 'note') {
      return {
        text: selectedText,
        url: target.path,
        title: (target.path.split('/').pop() || target.path).replace(/\.md$/i, ''),
        isInternal: true,
      };
    }

    return null;
  };

  const handleContentDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    const payload = buildSelectionQuotePayload(e.target);
    if (!payload) return;
    setQuotePopover(null);
    e.dataTransfer.setData(ZUBER_QUOTE_MIME, JSON.stringify(payload));
    e.dataTransfer.setData('text/plain', payload.text);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleContentSelectionEnd = (e: React.SyntheticEvent<HTMLDivElement>) => {
    if (!onInsertQuote) {
      if (quotePopover) setQuotePopover(null);
      return;
    }
    // Keep current selection check
    const payload = buildSelectionQuotePayload(e.target);
    if (!payload) {
      setQuotePopover(null);
      return;
    }
    const sel = window.getSelection?.();
    let rect: DOMRect | null = null;
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (typeof range.getBoundingClientRect === 'function') {
        rect = range.getBoundingClientRect();
      }
    }
    if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0)) {
      rect = contentContainerRef.current?.getBoundingClientRect?.() || null;
    }
    if (!rect) {
      setQuotePopover(null);
      return;
    }
    const rawX = rect.left + Math.max(rect.width / 2, 0);
    const rawY = Math.max(12, rect.top - 8);
    const clampedX = Math.max(84, Math.min(rawX || 140, (window.innerWidth || 1024) - 84));
    const clampedY = Math.max(12, Math.min(rawY, (window.innerHeight || 768) - 48));
    setQuotePopover({ x: clampedX, y: clampedY, payload });
  };

  const handleWebReaderClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute('href') || anchor.href;
    if (!href || !/^https?:\/\//i.test(href)) return;
    routeExternalLinkClick({
      url: href,
      isResearchOpen: true,
      event: e,
      onOpenInResearch: onOpenWebUrl,
      openExternal: (u) => window.open(u, '_blank', 'noopener,noreferrer'),
    });
  };

  const handleSaveArticleClick = async () => {
    if (!onSaveWebNote || extractedWeb?.type !== 'article' || savingWebNote) return;
    setSavingWebNote(true);
    try {
      await onSaveWebNote({
        title: extractedWeb.title,
        url: extractedWeb.url,
        byline: extractedWeb.byline,
        siteName: extractedWeb.siteName,
        markdown: extractedWeb.markdown,
      });
      setSavedWebNoteUrl(extractedWeb.url);
      window.setTimeout(() => setSavedWebNoteUrl(null), 2200);
    } finally {
      setSavingWebNote(false);
    }
  };

  return (
    <aside className="research-pane-container" aria-label={t('research.title', 'Rechercheansicht')}>
      {/* Header Bar */}
      <header className="research-pane-header">
        <div className="research-header-left">
          <span className="research-type-badge">{typeBadge}</span>
          <span className="research-title-text" title={isGraph ? t('graph.title', 'Graph-Ansicht') : target?.path}>
            {isGraph ? (
              <>
                <GitFork size={14} className="research-icon" />
                <span>{t('graph.title', 'Graph-Ansicht')}</span>
              </>
            ) : isWeb ? (
              <>
                <Globe size={14} className="research-icon" />
                <span>{fileName}</span>
              </>
            ) : target?.type === 'canvas' ? (
              <>
                <WorkflowCanvasIcon size={14} className="research-icon" />
                <span>{fileName}</span>
              </>
            ) : target?.type === 'base' ? (
              <>
                <Database size={14} className="research-icon" />
                <span>{fileName}</span>
              </>
            ) : target?.type === 'image' ? (
              <>
                <ImageIcon size={14} className="research-icon" />
                <span>{fileName}</span>
              </>
            ) : (
              <>
                <FileText size={14} className="research-icon" />
                <span>{fileName}</span>
              </>
            )}
          </span>
        </div>

        <div className="research-header-controls">
          {/* Open Web URL */}
          {onOpenWebUrl && (
            <button
              type="button"
              className={`research-header-btn open-web-btn ${isWeb ? 'active' : ''}`}
              data-testid="research-open-web-btn"
              onClick={() => onOpenWebUrl(isWeb ? target?.path || '' : '')}
              title={t('research.openWebUrl')}
              aria-label={t('research.openWebUrl')}
            >
              <Globe size={15} />
            </button>
          )}

          {/* Quick Graph Switch */}
          <button
            type="button"
            className={`research-header-btn show-graph-btn ${isGraph ? 'active' : ''}`}
            onClick={onShowGraph}
            title={t('research.showGraph', 'Graph in Rechercheansicht zeigen')}
            aria-label={t('research.showGraph', 'Graph in Rechercheansicht zeigen')}
          >
            <GitFork size={15} />
            <span className="btn-label-desktop">{language === 'de' ? 'Graph' : 'Graph'}</span>
          </button>

          {/* Orientation Toggle */}
          <button
            type="button"
            className="research-header-btn orientation-btn"
            onClick={onToggleOrientation}
            title={t('research.toggleOrientation', 'Split-Ausrichtung wechseln (Links/Rechts ⇄ Oben/Unten)')}
            aria-label={t('research.toggleOrientation', 'Split-Ausrichtung wechseln')}
          >
            {orientation === 'horizontal' ? <Rows size={15} /> : <Columns size={15} />}
          </button>

          {/* Open in Main Editor */}
          <button
            type="button"
            className="research-header-btn open-in-main-btn"
            disabled={isGraph || isWeb || !target?.path}
            onClick={() => {
              if (target?.path) {
                onOpenInMain(target.path);
              }
            }}
            title={t('research.openInMain', 'Im Haupteditor öffnen (Alt+Klick)')}
            aria-label={t('research.openInMain', 'Im Haupteditor öffnen')}
          >
            <ArrowLeft size={15} />
            <span className="btn-label-desktop">{language === 'de' ? 'Im Editor' : 'In Editor'}</span>
          </button>

          {/* Close Research Pane */}
          <button
            type="button"
            className="research-header-btn close-btn"
            onClick={onClose}
            title={t('research.close', 'Rechercheansicht schließen')}
            aria-label={t('research.close', 'Rechercheansicht schließen')}
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Interactive Web Browser Address Bar, Mode Toggle & Save as Note */}
      {isWeb && (
        <form
          className="research-web-bar"
          data-testid="research-web-bar"
          onSubmit={(e) => {
            e.preventDefault();
            const normalized = normalizeWebUrl(webInputValue);
            if (normalized && onOpenWebUrl) {
              setEmbedBlocked(false);
              setWebExtractError(null);
              onOpenWebUrl(normalized);
            }
          }}
        >
          <input
            ref={webInputRef}
            type="text"
            inputMode="url"
            data-testid="research-web-url-input"
            className="research-web-url-input"
            placeholder={t('research.urlPlaceholder')}
            value={webInputValue}
            onChange={(e) => setWebInputValue(e.target.value)}
          />
          <div
            className="research-web-mode-toggle"
            role="group"
            aria-label={t('research.viewModeGroup')}
            data-testid="research-web-mode-toggle"
          >
            <button
              type="button"
              className={`research-web-mode-btn ${webViewMode === 'markdown' ? 'active' : ''}`}
              data-testid="research-web-mode-markdown"
              onClick={() => setWebViewMode('markdown')}
            >
              {t('research.modeMarkdown')}
            </button>
            <button
              type="button"
              className={`research-web-mode-btn ${webViewMode === 'html' ? 'active' : ''}`}
              data-testid="research-web-mode-html"
              onClick={() => setWebViewMode('html')}
            >
              {t('research.modeHtml')}
            </button>
          </div>
          {onSaveWebNote && (
            <button
              type="button"
              className={`research-web-save-btn ${savedWebNoteUrl && extractedWeb?.type === 'article' && savedWebNoteUrl === extractedWeb.url ? 'saved' : ''}`}
              data-testid="research-web-save-note-btn"
              disabled={savingWebNote || extractedWeb?.type !== 'article'}
              title={t('research.saveAsNote')}
              aria-label={t('research.saveAsNote')}
              onClick={handleSaveArticleClick}
            >
              {savedWebNoteUrl && extractedWeb?.type === 'article' && savedWebNoteUrl === extractedWeb.url ? (
                <>
                  <Check size={14} />
                  <span className="btn-label-desktop">{t('research.savedAsNote')}</span>
                </>
              ) : (
                <>
                  <FilePlus size={14} />
                  <span className="btn-label-desktop">{t('research.saveAsNote')}</span>
                </>
              )}
            </button>
          )}
          <button
            type="button"
            className="research-web-bar-btn"
            data-testid="research-web-reload-btn"
            disabled={!target?.path}
            title={t('research.reloadWeb')}
            aria-label={t('research.reloadWeb')}
            onClick={() => {
              if (target?.path) {
                webExtractCacheRef.current.delete(target.path);
              }
              setEmbedBlocked(false);
              setWebExtractError(null);
              if (webViewMode === 'markdown') {
                setWebReloadTick((k) => k + 1);
              } else {
                setIframeReloadKey((k) => k + 1);
              }
            }}
          >
            <RotateCw size={15} />
          </button>
          <button
            type="button"
            className="research-web-bar-btn"
            data-testid="research-web-copy-btn"
            disabled={!target?.path}
            title={urlCopied ? t('research.copiedUrl') : t('research.copyUrl')}
            aria-label={t('research.copyUrl')}
            onClick={() => {
              if (!target?.path) return;
              navigator.clipboard?.writeText(target.path).then(() => {
                setUrlCopied(true);
                window.setTimeout(() => setUrlCopied(false), 1800);
              }).catch(() => {});
            }}
          >
            {urlCopied ? <Check size={15} /> : <Copy size={15} />}
          </button>
          <button
            type="button"
            className="research-web-bar-btn"
            data-testid="research-web-external-btn"
            disabled={!target?.path}
            title={t('research.openExternalBrowser')}
            aria-label={t('research.openExternalBrowser')}
            onClick={() => {
              if (target?.path) {
                window.open(target.path, '_blank', 'noopener,noreferrer');
              }
            }}
          >
            <ExternalLink size={15} />
          </button>
        </form>
      )}

      {/* Pane Content Area */}
      <div
        className="research-pane-content"
        ref={contentContainerRef}
        onDragStart={handleContentDragStart}
        onMouseUp={handleContentSelectionEnd}
        onKeyUp={handleContentSelectionEnd}
        onScrollCapture={() => {
          if (quotePopover) setQuotePopover(null);
        }}
      >
        {loading ? (
          <div className="empty-state">
            <span className="sync-spinner" />
            <p>{language === 'de' ? 'Lade Referenzinhalt…' : 'Loading reference content…'}</p>
          </div>
        ) : isGraph ? (
          <div className="research-graph-wrapper">
            <Suspense fallback={<div className="empty-state">Lade Graph…</div>}>
              <GraphView
                graphData={graphData}
                activeNotePath={activeNotePath}
                isLocalGraph={false}
                onSelectNote={(pathOrTitle, isUnresolved, event) => {
                  if (event?.altKey) {
                    event.preventDefault?.();
                    onOpenInMain(pathOrTitle);
                  } else {
                    onNavigate(pathOrTitle, event);
                  }
                }}
                onSelectTag={onSelectTag}
              />
            </Suspense>
          </div>
        ) : isWeb ? (
          !target?.path ? (
            <div className="empty-state">
              <Globe size={36} />
              <p>{t('research.urlPlaceholder')}</p>
            </div>
          ) : webViewMode === 'markdown' ? (
            webExtractLoading ? (
              <div className="empty-state" data-testid="research-web-extract-loading">
                <span className="sync-spinner" />
                <p>{t('research.extractingArticle')}</p>
              </div>
            ) : webExtractError ? (
              <div className="research-web-blocked-card" data-testid="research-web-extract-error">
                <ShieldAlert size={36} className="research-web-blocked-icon" />
                <h3>{t('research.extractErrorTitle')}</h3>
                <p>{webExtractError}</p>
                <code className="research-web-blocked-url">{target.path}</code>
                <div className="research-web-error-actions">
                  <button
                    type="button"
                    className="research-web-blocked-btn"
                    data-testid="research-web-switch-html-btn"
                    onClick={() => setWebViewMode('html')}
                  >
                    {t('research.switchToHtml')}
                  </button>
                  <button
                    type="button"
                    className="research-web-secondary-btn"
                    onClick={() => window.open(target.path, '_blank', 'noopener,noreferrer')}
                  >
                    {t('research.openExternalBrowser')}
                  </button>
                </div>
              </div>
            ) : extractedWeb?.type === 'pdf' ? (
              <ResearchPdfViewer
                src={api.getWebProxyPdfUrl(extractedWeb.url)}
                title={extractedWeb.title}
                externalOpenUrl={extractedWeb.url}
              />
            ) : extractedWeb?.type === 'article' ? (
              <div
                className="research-web-reader scroller"
                data-testid="research-web-reader"
                onClick={handleWebReaderClick}
              >
                <article className="reading-view-container research-reading-container">
                  <header className="research-web-article-header">
                    <h1>{extractedWeb.title}</h1>
                    <div className="research-web-article-meta">
                      {extractedWeb.siteName && <span>{extractedWeb.siteName}</span>}
                      {extractedWeb.byline && <span>{extractedWeb.byline}</span>}
                      <a
                        href={extractedWeb.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="research-web-article-source-link"
                      >
                        {extractedWeb.url}
                      </a>
                    </div>
                  </header>
                  <div
                    className="reading-view-content research-web-article-body"
                    dangerouslySetInnerHTML={webHtmlObj}
                  />
                </article>
              </div>
            ) : null
          ) : embedBlocked ? (
            <div className="research-web-blocked-card" data-testid="research-web-blocked-card">
              <ShieldAlert size={36} className="research-web-blocked-icon" />
              <h3>{t('research.embedBlockedTitle')}</h3>
              <p>{t('research.embedBlockedDesc')}</p>
              <code className="research-web-blocked-url">{target.path}</code>
              <button
                type="button"
                className="research-web-blocked-btn"
                data-testid="research-web-blocked-open-btn"
                onClick={() => window.open(target.path, '_blank', 'noopener,noreferrer')}
              >
                {t('research.openExternalBrowser')}
              </button>
            </div>
          ) : (
            <iframe
              key={`${target.path}-${iframeReloadKey}`}
              src={target.path}
              title={target.path}
              className="research-web-iframe"
              data-testid="research-web-iframe"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer-when-downgrade"
              onError={() => setEmbedBlocked(true)}
            />
          )
        ) : target?.type === 'note' ? (
          <div
            className="research-reading-scroller scroller"
            ref={readingContainerRef}
            onClick={handleReadingClick}
          >
            <div className="reading-view-container research-reading-container">
              <div
                className="reading-view-content"
                dangerouslySetInnerHTML={readingHtmlObj}
              />
            </div>
          </div>
        ) : target?.type === 'canvas' ? (
          <div className="research-canvas-wrapper" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
            <CanvasEmbedWidget
              canvasPath={target.path}
              onOpenNote={(path: string) => onNavigate(path)}
              allNotes={allNotes}
              currentNotePath={target.path}
              fullSize={true}
            />
          </div>
        ) : target?.type === 'image' ? (
          <div className="research-image-wrapper">
            <div className="research-image-toolbar">
              <button
                type="button"
                className="image-tool-btn"
                onClick={() => setImageZoom((z) => Math.min(5, z * 1.25))}
                title="Zoom In (+)"
              >
                <ZoomIn size={16} />
              </button>
              <button
                type="button"
                className="image-tool-btn"
                onClick={() => setImageZoom((z) => Math.max(0.2, z / 1.25))}
                title="Zoom Out (-)"
              >
                <ZoomOut size={16} />
              </button>
              <button
                type="button"
                className="image-tool-btn"
                onClick={() => setImageZoom(1)}
                title="Fit / 100%"
              >
                <RotateCcw size={16} />
              </button>
              <span className="image-zoom-indicator">{Math.round(imageZoom * 100)}%</span>
            </div>
            <div className="research-image-canvas">
              <img
                src={decryptedMediaUrl || api.getAttachmentUrl(target.path)}
                alt={fileName}
                className="research-image-element"
                style={{
                  transform: `scale(${imageZoom})`,
                  transformOrigin: 'center center',
                  transition: 'transform 0.12s ease-out',
                }}
              />
            </div>
          </div>
        ) : target?.type === 'pdf' ? (
          <ResearchPdfViewer
            src={decryptedMediaUrl || api.getAttachmentUrl(target.path)}
            title={fileName}
            externalOpenUrl={decryptedMediaUrl || api.getAttachmentUrl(target.path)}
          />
        ) : target?.type === 'base' ? (
          <div className="research-base-wrapper" style={{ padding: 12, height: '100%', overflow: 'auto' }}>
            <BaseEmbedWidget
              basePath={target.path}
              allNotes={allNotes}
              onOpenNote={(path: string) => onNavigate(path)}
            />
          </div>
        ) : (
          <div className="empty-state">
            <FileText size={36} />
            <p>{language === 'de' ? 'Nicht unterstütztes Format' : 'Unsupported format'}</p>
          </div>
        )}

        {quotePopover && onInsertQuote && (
          <button
            ref={quotePopoverRef}
            type="button"
            className="research-quote-popover"
            data-testid="research-quote-popover"
            style={{ left: `${quotePopover.x}px`, top: `${quotePopover.y}px` }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onInsertQuote(quotePopover.payload);
              setQuotePopover(null);
            }}
          >
            <Quote size={13} />
            <span>{t('research.insertAsQuote')}</span>
          </button>
        )}
      </div>
    </aside>
  );
};
