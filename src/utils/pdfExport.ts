import html2canvas from 'html2canvas';

const SVG_NS = 'http://www.w3.org/2000/svg';

function waitAnimationFrame(): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  return new Promise((resolve) => setTimeout(resolve, 16));
}

function areCanvasEmbedsReady(container: HTMLElement): boolean {
  const canvasEmbeds = Array.from(
    container.querySelectorAll<HTMLElement>('.embedded-canvas-container')
  );
  return canvasEmbeds.every((el) => {
    if (el.querySelector('.canvas-embed-loading')) return false;
    const hasCore = Boolean(
      el.querySelector('.react-flow__node, .canvas-embed-error, .react-flow__renderer')
    );
    if (!hasCore) return false;
    const edgeGroups = el.querySelectorAll('.react-flow__edges .react-flow__edge');
    if (edgeGroups.length > 0) {
      const edgePaths = el.querySelectorAll('.react-flow__edges path.react-flow__edge-path');
      if (edgePaths.length === 0) return false;
    }
    return true;
  });
}

function areBaseEmbedsReady(container: HTMLElement): boolean {
  const baseEmbeds = Array.from(
    container.querySelectorAll<HTMLElement>('.embedded-base-container')
  );
  return baseEmbeds.every((el) => {
    if (el.querySelector('.base-embed-loading')) return false;
    return Boolean(el.querySelector('.base-embed-content, .base-error-box'));
  });
}

/**
 * Waits until all embedded Canvas and Base widgets inside `container` finish
 * their async loading and React Flow / layout painting completes.
 */
export async function waitForEmbedsToRender(
  container: HTMLElement,
  timeoutMs = 3000
): Promise<void> {
  const hasEmbeds = Boolean(
    container.querySelector('.embedded-canvas-container, .embedded-base-container')
  );
  if (!hasEmbeds) return;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (areCanvasEmbedsReady(container) && areBaseEmbedsReady(container)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // Allow React Flow fitView layout and SVG edge paths to finish painting
  await waitAnimationFrame();
  await waitAnimationFrame();
  await new Promise((resolve) => setTimeout(resolve, 200));
}

function isUnresolvedStroke(val?: string | null): boolean {
  if (!val) return true;
  const v = val.trim().toLowerCase();
  return (
    v === '' ||
    v === 'none' ||
    v === 'transparent' ||
    v === 'rgba(0, 0, 0, 0)' ||
    v.includes('var(')
  );
}

function resolveSvgStroke(el: Element): string {
  try {
    const cs = typeof window !== 'undefined' ? window.getComputedStyle(el) : null;
    const computedStroke = cs?.stroke?.trim();
    if (!isUnresolvedStroke(computedStroke)) {
      return computedStroke!;
    }
  } catch {
    // Ignore getComputedStyle errors in non-standard DOMs
  }
  const attrStroke = el.getAttribute('stroke')?.trim();
  if (!isUnresolvedStroke(attrStroke)) {
    return attrStroke!;
  }
  return '#64748b';
}

function resolveSvgStrokeWidth(el: Element): string {
  const attrSw = el.getAttribute('stroke-width')?.trim();
  if (attrSw && attrSw !== '0' && attrSw !== '0px') {
    return attrSw;
  }
  try {
    const cs = typeof window !== 'undefined' ? window.getComputedStyle(el) : null;
    const sw = cs?.strokeWidth?.trim();
    if (sw && sw !== '0px' && sw !== 'none' && sw !== '1px') return sw;
  } catch {
    // Ignore
  }
  return '2';
}

function buildArrowheadPoints(
  tipX: number,
  tipY: number,
  angle: number,
  arrowLen = 10,
  arrowHalfW = 4.5
): string {
  const baseX = tipX - arrowLen * Math.cos(angle);
  const baseY = tipY - arrowLen * Math.sin(angle);
  const leftX = baseX + arrowHalfW * Math.sin(angle);
  const leftY = baseY - arrowHalfW * Math.cos(angle);
  const rightX = baseX - arrowHalfW * Math.sin(angle);
  const rightY = baseY + arrowHalfW * Math.cos(angle);
  return `${tipX.toFixed(2)},${tipY.toFixed(2)} ${leftX.toFixed(2)},${leftY.toFixed(2)} ${rightX.toFixed(2)},${rightY.toFixed(2)}`;
}

function buildArrowheadPolygon(
  tipX: number,
  tipY: number,
  angle: number,
  color: string
): SVGPolygonElement {
  const doc = typeof document !== 'undefined' ? document : null;
  const polygon = doc!.createElementNS(SVG_NS, 'polygon') as SVGPolygonElement;
  polygon.setAttribute('class', 'pdf-baked-arrowhead');
  polygon.setAttribute('points', buildArrowheadPoints(tipX, tipY, angle, 10, 4));
  polygon.setAttribute('fill', color);
  polygon.setAttribute('stroke', color);
  polygon.setAttribute('stroke-width', '1');
  polygon.style.fill = color;
  polygon.style.stroke = color;
  return polygon;
}

export interface SnapshotEdgePath {
  d: string;
  stroke: string;
  strokeWidth: string;
  strokeDasharray?: string;
  arrowheads: string[];
}

export interface SnapshotEdgeLabel {
  transform: string;
  rectAttrs?: {
    x: string;
    y: string;
    width: string;
    height: string;
    rx: string;
    ry: string;
  };
  text: string;
  textY: string;
  textDy: string;
}

export interface ReactFlowEdgeSnapshot {
  idx: number;
  width: number;
  height: number;
  matrixTransform: string;
  edges: SnapshotEdgePath[];
  labels: SnapshotEdgeLabel[];
}

function cssMatrixToSvgMatrix(rawTransform: string, viewportEl: HTMLElement | null): string {
  const t = (rawTransform || '').trim();
  const m2d = t.match(/^matrix\(\s*([^)]+)\s*\)$/i);
  if (m2d) {
    const parts = m2d[1].split(/[\s,]+/).filter(Boolean);
    if (parts.length === 6) {
      return `matrix(${parts.join(' ')})`;
    }
  }
  const m3d = t.match(/^matrix3d\(\s*([^)]+)\s*\)$/i);
  if (m3d) {
    const p = m3d[1].split(/[\s,]+/).filter(Boolean);
    if (p.length === 16) {
      return `matrix(${p[0]} ${p[1]} ${p[4]} ${p[5]} ${p[12]} ${p[13]})`;
    }
  }
  // Fallback for JSDOM or inline translate(...) scale(...) when getComputedStyle returns 'none'
  const inline = (viewportEl?.style?.transform || '').trim();
  if (inline) {
    const tr = inline.match(/translate(?:3d)?\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px/i);
    const sc = inline.match(/scale\(\s*([-\d.]+)/i);
    const tx = tr ? tr[1] : '0';
    const ty = tr ? tr[2] : '0';
    const s = sc ? sc[1] : '1';
    return `matrix(${s} 0 0 ${s} ${tx} ${ty})`;
  }
  return 'matrix(1 0 0 1 0 0)';
}

/**
 * Snapshots live React Flow container dimensions, viewport transform matrix,
 * SVG edge paths, computed strokes, arrowhead polygons, and SVG edge labels
 * before html2canvas clones the DOM.
 */
export function snapshotReactFlowEdges(rootEl: HTMLElement): ReactFlowEdgeSnapshot[] {
  const rfElements: HTMLElement[] = rootEl.classList.contains('react-flow')
    ? [rootEl]
    : Array.from(rootEl.querySelectorAll<HTMLElement>('.react-flow'));

  return rfElements.map((rfEl, idx) => {
    rfEl.setAttribute('data-pdf-rf-idx', String(idx));

    const rfRect = rfEl.getBoundingClientRect?.() ?? { width: 0, height: 0 };
    const width = Math.ceil(rfRect.width) || rfEl.clientWidth || 720;
    const height = Math.ceil(rfRect.height) || rfEl.clientHeight || 380;

    const viewportEl = rfEl.querySelector<HTMLElement>('.react-flow__viewport');
    let rawTransform = 'none';
    try {
      rawTransform =
        viewportEl && typeof window !== 'undefined'
          ? window.getComputedStyle(viewportEl).transform || 'none'
          : 'none';
    } catch {
      rawTransform = 'none';
    }
    const matrixTransform = cssMatrixToSvgMatrix(rawTransform, viewportEl);

    const edges: SnapshotEdgePath[] = [];
    const pathEls = Array.from(
      rfEl.querySelectorAll<SVGPathElement>('path.react-flow__edge-path')
    );

    pathEls.forEach((pathEl) => {
      if (pathEl.classList.contains('react-flow__edge-interaction')) return;
      const d = pathEl.getAttribute('d')?.trim();
      if (!d) return;

      const stroke = resolveSvgStroke(pathEl);
      const strokeWidth = resolveSvgStrokeWidth(pathEl);
      let strokeDasharray: string | undefined;
      try {
        const cs = typeof window !== 'undefined' ? window.getComputedStyle(pathEl) : null;
        const dash = cs?.strokeDasharray?.trim() || pathEl.getAttribute('stroke-dasharray')?.trim();
        if (dash && dash !== 'none') {
          strokeDasharray = dash;
        }
      } catch {
        const attrDash = pathEl.getAttribute('stroke-dasharray')?.trim();
        if (attrDash && attrDash !== 'none') strokeDasharray = attrDash;
      }

      const arrowheads: string[] = [];
      const hasMarkerEnd = Boolean(pathEl.getAttribute('marker-end'));
      const hasMarkerStart = Boolean(pathEl.getAttribute('marker-start'));

      if (
        (hasMarkerEnd || hasMarkerStart) &&
        typeof pathEl.getTotalLength === 'function' &&
        typeof pathEl.getPointAtLength === 'function'
      ) {
        try {
          const totalLen = pathEl.getTotalLength();
          if (totalLen > 1) {
            if (hasMarkerEnd) {
              const tip = pathEl.getPointAtLength(totalLen);
              const prev = pathEl.getPointAtLength(Math.max(0, totalLen - 8));
              const angle = Math.atan2(tip.y - prev.y, tip.x - prev.x);
              arrowheads.push(buildArrowheadPoints(tip.x, tip.y, angle, 10, 4.5));
            }
            if (hasMarkerStart) {
              const tip = pathEl.getPointAtLength(0);
              const next = pathEl.getPointAtLength(Math.min(totalLen, 8));
              const angle = Math.atan2(tip.y - next.y, tip.x - next.x);
              arrowheads.push(buildArrowheadPoints(tip.x, tip.y, angle, 10, 4.5));
            }
          }
        } catch {
          // Ignore geometry errors on disconnected SVG paths
        }
      }

      edges.push({ d, stroke, strokeWidth, strokeDasharray, arrowheads });
    });

    const labels: SnapshotEdgeLabel[] = [];
    const labelWrappers = Array.from(
      rfEl.querySelectorAll<SVGGElement>('.react-flow__edges .react-flow__edge-textwrapper')
    );
    labelWrappers.forEach((wrapper) => {
      const textEl = wrapper.querySelector<SVGTextElement>('.react-flow__edge-text');
      const text = textEl?.textContent?.trim() || '';
      if (!text) return;

      const rectEl = wrapper.querySelector<SVGRectElement>('.react-flow__edge-textbg');
      labels.push({
        transform: wrapper.getAttribute('transform') || '',
        rectAttrs: rectEl
          ? {
              x: rectEl.getAttribute('x') || '-4',
              y: rectEl.getAttribute('y') || '-2',
              width: rectEl.getAttribute('width') || String(text.length * 7 + 8),
              height: rectEl.getAttribute('height') || '18',
              rx: rectEl.getAttribute('rx') || '2',
              ry: rectEl.getAttribute('ry') || '2',
            }
          : undefined,
        text,
        textY: textEl?.getAttribute('y') || '0',
        textDy: textEl?.getAttribute('dy') || '0.3em',
      });
    });

    return { idx, width, height, matrixTransform, edges, labels };
  });
}

/**
 * Composites top-level container-sized <svg class="pdf-canvas-edges-overlay">
 * elements inside cloned .react-flow containers during html2canvas onclone,
 * hides the 0x0 .react-flow__edges SVG, and enforces deterministic z-index layers.
 */
export function applyReactFlowEdgeOverlaysInClone(
  clonedRoot: HTMLElement,
  snapshots: ReactFlowEdgeSnapshot[]
): void {
  if (!snapshots.length) return;
  const doc = clonedRoot.ownerDocument;

  const clonedRfs: HTMLElement[] = clonedRoot.matches('.react-flow[data-pdf-rf-idx]')
    ? [clonedRoot]
    : Array.from(clonedRoot.querySelectorAll<HTMLElement>('.react-flow[data-pdf-rf-idx]'));

  clonedRfs.forEach((rfEl) => {
    const idx = Number(rfEl.getAttribute('data-pdf-rf-idx'));
    const snap = snapshots.find((s) => s.idx === idx);
    if (!snap) return;

    rfEl.querySelectorAll<HTMLElement | SVGElement>('.react-flow__edges').forEach((edgesEl) => {
      edgesEl.style.setProperty('display', 'none', 'important');
    });

    rfEl.querySelectorAll('svg.pdf-canvas-edges-overlay').forEach((old) => old.remove());

    const overlaySvg = doc.createElementNS(SVG_NS, 'svg');
    overlaySvg.setAttribute('class', 'pdf-canvas-edges-overlay');
    overlaySvg.setAttribute('width', String(snap.width));
    overlaySvg.setAttribute('height', String(snap.height));
    overlaySvg.setAttribute('viewBox', `0 0 ${snap.width} ${snap.height}`);
    overlaySvg.style.position = 'absolute';
    overlaySvg.style.top = '0';
    overlaySvg.style.left = '0';
    overlaySvg.style.width = `${snap.width}px`;
    overlaySvg.style.height = `${snap.height}px`;
    overlaySvg.style.overflow = 'visible';
    overlaySvg.style.pointerEvents = 'none';
    overlaySvg.style.zIndex = '2';

    const group = doc.createElementNS(SVG_NS, 'g');
    group.setAttribute('transform', snap.matrixTransform);

    snap.edges.forEach((edge) => {
      const path = doc.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', edge.d);
      path.setAttribute('stroke', edge.stroke);
      path.setAttribute('stroke-width', edge.strokeWidth);
      if (edge.strokeDasharray) {
        path.setAttribute('stroke-dasharray', edge.strokeDasharray);
      }
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      group.appendChild(path);

      edge.arrowheads.forEach((points) => {
        const polygon = doc.createElementNS(SVG_NS, 'polygon');
        polygon.setAttribute('class', 'pdf-baked-arrowhead');
        polygon.setAttribute('points', points);
        polygon.setAttribute('fill', edge.stroke);
        group.appendChild(polygon);
      });
    });

    snap.labels.forEach((lbl) => {
      const labelGroup = doc.createElementNS(SVG_NS, 'g');
      labelGroup.setAttribute('class', 'react-flow__edge-textwrapper');
      if (lbl.transform) labelGroup.setAttribute('transform', lbl.transform);
      labelGroup.style.setProperty('z-index', '5', 'important');

      if (lbl.rectAttrs) {
        const rect = doc.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('class', 'react-flow__edge-textbg');
        rect.setAttribute('x', lbl.rectAttrs.x);
        rect.setAttribute('y', lbl.rectAttrs.y);
        rect.setAttribute('width', lbl.rectAttrs.width);
        rect.setAttribute('height', lbl.rectAttrs.height);
        rect.setAttribute('rx', lbl.rectAttrs.rx);
        rect.setAttribute('ry', lbl.rectAttrs.ry);
        rect.setAttribute('fill', '#ffffff');
        rect.setAttribute('stroke', '#cbd5e1');
        rect.setAttribute('stroke-width', '1');
        rect.style.fill = '#ffffff';
        labelGroup.appendChild(rect);
      }

      const textEl = doc.createElementNS(SVG_NS, 'text');
      textEl.setAttribute('class', 'react-flow__edge-text');
      textEl.setAttribute('y', lbl.textY);
      textEl.setAttribute('dy', lbl.textDy);
      textEl.setAttribute('fill', '#111827');
      textEl.setAttribute('font-size', '11px');
      textEl.setAttribute('font-family', 'sans-serif');
      textEl.style.fill = '#111827';
      textEl.textContent = lbl.text;
      labelGroup.appendChild(textEl);

      group.appendChild(labelGroup);
    });

    overlaySvg.appendChild(group);
    rfEl.appendChild(overlaySvg);

    // Enforce deterministic layer stacking
    rfEl
      .querySelectorAll<HTMLElement>('.react-flow__node-group, .react-flow__node-canvasGroup')
      .forEach((n) => {
        n.style.setProperty('z-index', '1', 'important');
      });

    rfEl
      .querySelectorAll<HTMLElement>(
        '.react-flow__node-shape, .react-flow__node-file, .react-flow__node-text, .react-flow__node-canvasShape, .react-flow__node-canvasFile, .react-flow__node-canvasLink'
      )
      .forEach((n) => {
        n.style.setProperty('z-index', '4', 'important');
      });

    rfEl
      .querySelectorAll<HTMLElement>('.react-flow__edgelabel-renderer, .react-flow__edge-textwrapper')
      .forEach((lbl) => {
        lbl.style.setProperty('z-index', '5', 'important');
        if (lbl.classList.contains('react-flow__edgelabel-renderer')) {
          Array.from(lbl.children).forEach((child) => {
            const c = child as HTMLElement;
            c.style.background = '#ffffff';
            c.style.color = '#111827';
          });
        }
      });
  });
}

/**
 * Normalizes React Flow and Mermaid SVGs before html2canvas rasterization:
 * sets explicit pixel dimensions, inlines computed stroke/fill attributes,
 * bakes <polygon> arrowheads directly for marker-end/marker-start paths,
 * and enforces layer stacking so edges and arrowheads never disappear.
 */
export function prepareSvgsForHtml2Canvas(rootEl: HTMLElement): void {
  const rfRoot = rootEl.querySelector<HTMLElement>('.react-flow') || rootEl;
  const rfRect = rfRoot.getBoundingClientRect?.() ?? { width: 0, height: 0 };
  const fallbackWidth = Math.ceil(rfRect.width || rootEl.clientWidth || 750);
  const fallbackHeight = Math.ceil(rfRect.height || rootEl.clientHeight || 340);

  const viewport = rootEl.querySelector<HTMLElement>('.react-flow__viewport');
  if (viewport) {
    viewport.style.width = '100%';
    viewport.style.height = '100%';
    viewport.style.overflow = 'visible';
  }

  const edgesLayer = rootEl.querySelector<HTMLElement>('.react-flow__edges');
  if (edgesLayer) {
    edgesLayer.style.zIndex = '4';
    edgesLayer.style.position = 'absolute';
    edgesLayer.style.overflow = 'visible';
  }

  const nodesLayer = rootEl.querySelector<HTMLElement>('.react-flow__nodes');
  if (nodesLayer) {
    nodesLayer.style.zIndex = '2';
  }

  const svgs = Array.from(
    rootEl.querySelectorAll<SVGElement>(
      '.react-flow svg, .reading-mermaid-svg svg, svg.react-flow__edges, svg.react-flow__marker'
    )
  );
  // Deduplicate in case rootEl itself or nested selectors match
  const seenSvgs = new Set<SVGElement>(svgs);
  seenSvgs.forEach((svg) => {
    const rect = svg.getBoundingClientRect?.() ?? { width: 0, height: 0 };
    const w = Math.ceil(rect.width > 0 ? rect.width : fallbackWidth);
    const h = Math.ceil(rect.height > 0 ? rect.height : fallbackHeight);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.style.overflow = 'visible';
  });

  const edgeShapes = Array.from(
    rootEl.querySelectorAll<SVGElement>(
      '.react-flow__edges path.react-flow__edge-path, .react-flow__edges path, .react-flow__edges line, .react-flow__edges polyline'
    )
  );
  const processedShapes = new Set<SVGElement>(edgeShapes);

  processedShapes.forEach((pathEl) => {
    if (pathEl.classList.contains('react-flow__edge-interaction')) return;
    const resolvedStroke = resolveSvgStroke(pathEl);
    const resolvedWidth = resolveSvgStrokeWidth(pathEl);

    pathEl.setAttribute('stroke', resolvedStroke);
    pathEl.setAttribute('stroke-width', resolvedWidth);
    pathEl.setAttribute('fill', 'none');

    try {
      const cs = typeof window !== 'undefined' ? window.getComputedStyle(pathEl) : null;
      if (cs?.strokeDasharray && cs.strokeDasharray !== 'none') {
        pathEl.setAttribute('stroke-dasharray', cs.strokeDasharray);
      }
    } catch {
      // Ignore
    }

    pathEl.style.stroke = resolvedStroke;
    pathEl.style.strokeWidth = resolvedWidth.endsWith('px')
      ? resolvedWidth
      : `${resolvedWidth}px`;
    pathEl.style.fill = 'none';
    pathEl.style.opacity = '1';

    const hasMarkerEnd = Boolean(pathEl.getAttribute('marker-end'));
    const hasMarkerStart = Boolean(pathEl.getAttribute('marker-start'));
    if (
      (hasMarkerEnd || hasMarkerStart) &&
      pathEl.parentElement &&
      !pathEl.parentElement.querySelector('.pdf-baked-arrowhead')
    ) {
      const geomPath = pathEl as unknown as SVGPathElement;
      if (typeof geomPath.getTotalLength === 'function' && typeof geomPath.getPointAtLength === 'function') {
        try {
          const totalLen = geomPath.getTotalLength();
          if (totalLen > 1) {
            if (hasMarkerEnd) {
              const p2 = geomPath.getPointAtLength(totalLen);
              const p1 = geomPath.getPointAtLength(Math.max(0, totalLen - 4));
              const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
              pathEl.parentElement.appendChild(
                buildArrowheadPolygon(p2.x, p2.y, angle, resolvedStroke)
              );
            }
            if (hasMarkerStart) {
              const p2 = geomPath.getPointAtLength(0);
              const p1 = geomPath.getPointAtLength(Math.min(totalLen, 4));
              const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
              pathEl.parentElement.appendChild(
                buildArrowheadPolygon(p2.x, p2.y, angle, resolvedStroke)
              );
            }
          }
        } catch {
          // Ignore geometry errors on disconnected SVG paths
        }
      }
    }
  });
}

/**
 * Strips 4-byte UTF-16 surrogate-pair emojis and normalizes non-WinAnsi symbols
 * so jsPDF's built-in fonts never emit Latin-1 mojibake (e.g. Ø=ÜÄ), while
 * preserving German umlauts (ä, ö, ü, ß, Ä, Ö, Ü) and standard Latin-1 text.
 */
export function sanitizePdfText(text: string): string {
  return text
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .replace(/[\uFE0E\uFE0F\u200D]/g, '')
    .replace(/↗/g, '->')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/[✓✔]/g, '[x]')
    .replace(/⚠/g, '[!]')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export interface CapturedElementImage {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Captures a rendered embed container (e.g. CanvasEmbedWidget or BaseEmbedWidget)
 * as a crisp PNG data URL using html2canvas, normalizing SVG edge paths and
 * arrowheads and hiding interactive buttons during capture.
 */
export async function captureElementToPng(
  element: HTMLElement
): Promise<CapturedElementImage | null> {
  const isCanvas = element.classList.contains('embedded-canvas-container');
  const prevHeight = element.style.height;
  const prevBg = element.style.background;

  let rfSnapshots: ReactFlowEdgeSnapshot[] = [];
  if (isCanvas) {
    element.style.height = '380px';
    element.style.background = '#ffffff';
    rfSnapshots = snapshotReactFlowEdges(element);
  }

  try {
    const renderedCanvas = await html2canvas(element, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
      onclone: (_clonedDoc, clonedEl) => {
        clonedEl
          .querySelectorAll<HTMLElement>(
            '.canvas-embed-open-btn, .base-embed-open-btn, .react-flow__controls, .react-flow__attribution'
          )
          .forEach((btn) => {
            btn.style.display = 'none';
          });

        if (isCanvas) {
          clonedEl.style.height = '380px';
          clonedEl.style.background = '#ffffff';
          if (rfSnapshots.length > 0) {
            applyReactFlowEdgeOverlaysInClone(clonedEl, rfSnapshots);
          } else {
            prepareSvgsForHtml2Canvas(clonedEl);
          }
        }
      },
    });

    if (!renderedCanvas.width || !renderedCanvas.height) return null;
    return {
      dataUrl: renderedCanvas.toDataURL('image/png'),
      width: renderedCanvas.width,
      height: renderedCanvas.height,
    };
  } catch {
    return null;
  } finally {
    if (isCanvas) {
      element.style.height = prevHeight;
      element.style.background = prevBg;
      element.querySelectorAll('[data-pdf-rf-idx]').forEach((el) => {
        el.removeAttribute('data-pdf-rf-idx');
      });
    }
  }
}
