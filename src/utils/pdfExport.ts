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

function buildArrowheadPolygon(
  tipX: number,
  tipY: number,
  angle: number,
  color: string
): SVGPolygonElement {
  const arrowLen = 10;
  const arrowHalfW = 4;
  const baseX = tipX - arrowLen * Math.cos(angle);
  const baseY = tipY - arrowLen * Math.sin(angle);
  const leftX = baseX + arrowHalfW * Math.sin(angle);
  const leftY = baseY - arrowHalfW * Math.cos(angle);
  const rightX = baseX - arrowHalfW * Math.sin(angle);
  const rightY = baseY + arrowHalfW * Math.cos(angle);

  const doc = typeof document !== 'undefined' ? document : null;
  const polygon = doc!.createElementNS(SVG_NS, 'polygon') as SVGPolygonElement;
  polygon.setAttribute('class', 'pdf-baked-arrowhead');
  polygon.setAttribute(
    'points',
    `${tipX.toFixed(2)},${tipY.toFixed(2)} ${leftX.toFixed(2)},${leftY.toFixed(2)} ${rightX.toFixed(2)},${rightY.toFixed(2)}`
  );
  polygon.setAttribute('fill', color);
  polygon.setAttribute('stroke', color);
  polygon.setAttribute('stroke-width', '1');
  polygon.style.fill = color;
  polygon.style.stroke = color;
  return polygon;
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

  if (isCanvas) {
    element.style.height = '380px';
    element.style.background = '#ffffff';
    prepareSvgsForHtml2Canvas(element);
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
          prepareSvgsForHtml2Canvas(clonedEl);
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
    }
  }
}
