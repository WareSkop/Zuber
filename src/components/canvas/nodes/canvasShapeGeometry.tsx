import React from 'react';
import type { CanvasShape } from '../../../../shared/canvasTypes';
import { stripZencExt } from '../../../crypto/folderCrypto';

export const CANVAS_IMAGE_EXT_REGEX = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

/**
 * Checks whether a vault path (including `.zenc`-encrypted paths) points to an image file.
 */
export function isImageFilePath(filePath?: string | null): boolean {
  if (!filePath) return false;
  return CANVAS_IMAGE_EXT_REGEX.test(stripZencExt(filePath.trim()));
}

/**
 * Renders the outer silhouette geometry in `0..100` SVG coordinate space.
 * Used for both shape node fills and `objectBoundingBox` image `<clipPath>` masks.
 */
export function renderShapeClipGeometry(shape: CanvasShape): React.ReactNode {
  switch (shape) {
    case 'rounded':
      return <rect x="2" y="2" width="96" height="96" rx="24" />;
    case 'circle':
      return <ellipse cx="50" cy="50" rx="48" ry="48" />;
    case 'diamond':
      return <polygon points="50,2 98,50 50,98 2,50" />;
    case 'parallelogram':
      return <polygon points="18,2 98,2 82,98 2,98" />;
    case 'hexagon':
      return <polygon points="18,2 82,2 98,50 82,98 18,98 2,50" />;
    case 'cylinder':
      return <path d="M 4,16 A 46,13 0 0,1 96,16 L 96,84 A 46,14 0 0,1 4,84 Z" />;
    case 'cloud':
      return (
        <path d="M 22,65 C 10,65 5,52 14,42 C 12,28 26,18 38,24 C 45,12 65,12 72,24 C 84,18 96,28 94,42 C 102,52 96,65 86,65 C 90,78 78,88 66,86 C 58,94 42,94 34,86 C 22,88 12,78 22,65 Z" />
      );
    case 'server':
      return <rect x="3" y="3" width="94" height="94" rx="8" />;
    case 'router':
      return <rect x="5" y="16" width="90" height="68" rx="12" />;
    case 'workstation':
      return <rect x="5" y="6" width="90" height="64" rx="6" />;
    case 'rectangle':
    default:
      return <rect x="2" y="2" width="96" height="96" rx="6" />;
  }
}

/**
 * Renders the full filled + stroked SVG layers for text/shape nodes (`CanvasShapeNode`).
 */
export function renderShapeSvgElements(
  shape: CanvasShape,
  baseFill: string,
  fillColor: string,
  strokeColor: string,
  strokeWidth: string
): React.ReactNode {
  switch (shape) {
    case 'rounded':
      return (
        <g>
          <rect x="2" y="2" width="96" height="96" rx="24" fill={baseFill} stroke={strokeColor} strokeWidth={strokeWidth} />
          <rect x="2" y="2" width="96" height="96" rx="24" fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
        </g>
      );
    case 'circle':
      return (
        <g>
          <ellipse cx="50" cy="50" rx="48" ry="48" fill={baseFill} stroke={strokeColor} strokeWidth={strokeWidth} />
          <ellipse cx="50" cy="50" rx="48" ry="48" fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
        </g>
      );
    case 'diamond':
      return (
        <g>
          <polygon points="50,2 98,50 50,98 2,50" fill={baseFill} stroke={strokeColor} strokeWidth={strokeWidth} />
          <polygon points="50,2 98,50 50,98 2,50" fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
        </g>
      );
    case 'parallelogram':
      return (
        <g>
          <polygon points="18,2 98,2 82,98 2,98" fill={baseFill} stroke={strokeColor} strokeWidth={strokeWidth} />
          <polygon points="18,2 98,2 82,98 2,98" fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
        </g>
      );
    case 'hexagon':
      return (
        <g>
          <polygon points="18,2 82,2 98,50 82,98 18,98 2,50" fill={baseFill} stroke={strokeColor} strokeWidth={strokeWidth} />
          <polygon points="18,2 82,2 98,50 82,98 18,98 2,50" fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
        </g>
      );
    case 'cylinder':
      return (
        <g>
          <path d="M 4,16 L 4,84 A 46,14 0 0,0 96,84 L 96,16" fill={baseFill} stroke={strokeColor} strokeWidth={strokeWidth} />
          <ellipse cx="50" cy="16" rx="46" ry="13" fill={baseFill} stroke={strokeColor} strokeWidth={strokeWidth} />
          <path d="M 4,16 L 4,84 A 46,14 0 0,0 96,84 L 96,16" fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
          <path
            d="M 4,46 A 46,13 0 0,0 96,46"
            fill="none"
            stroke={strokeColor}
            strokeWidth="1.2"
            strokeDasharray="4 3"
            opacity="0.65"
          />
          <ellipse cx="50" cy="16" rx="46" ry="13" fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
        </g>
      );
    case 'cloud':
      return (
        <g>
          <path
            d="M 22,65 C 10,65 5,52 14,42 C 12,28 26,18 38,24 C 45,12 65,12 72,24 C 84,18 96,28 94,42 C 102,52 96,65 86,65 C 90,78 78,88 66,86 C 58,94 42,94 34,86 C 22,88 12,78 22,65 Z"
            fill={baseFill}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
          <path
            d="M 22,65 C 10,65 5,52 14,42 C 12,28 26,18 38,24 C 45,12 65,12 72,24 C 84,18 96,28 94,42 C 102,52 96,65 86,65 C 90,78 78,88 66,86 C 58,94 42,94 34,86 C 22,88 12,78 22,65 Z"
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
        </g>
      );
    case 'server':
      return (
        <g>
          <rect x="3" y="3" width="94" height="94" rx="8" fill={baseFill} stroke={strokeColor} strokeWidth={strokeWidth} />
          <rect x="3" y="3" width="94" height="94" rx="8" fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
          <line x1="4" y1="34" x2="96" y2="34" stroke={strokeColor} strokeWidth="1.2" opacity="0.6" />
          <line x1="4" y1="66" x2="96" y2="66" stroke={strokeColor} strokeWidth="1.2" opacity="0.6" />
          <circle cx="14" cy="18" r="3" fill="#3fb950" />
          <circle cx="24" cy="18" r="3" fill="var(--accent-color, #7852ee)" />
          <circle cx="14" cy="50" r="3" fill="#3fb950" />
          <circle cx="24" cy="50" r="3" fill="var(--accent-color, #7852ee)" />
          <circle cx="14" cy="82" r="3" fill="#3fb950" />
          <circle cx="24" cy="82" r="3" fill="var(--accent-color, #7852ee)" />
        </g>
      );
    case 'router':
      return (
        <g>
          <rect x="5" y="16" width="90" height="68" rx="12" fill={baseFill} stroke={strokeColor} strokeWidth={strokeWidth} />
          <rect x="5" y="16" width="90" height="68" rx="12" fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
          <path
            d="M 28,50 L 72,50 M 62,42 L 72,50 L 62,58 M 38,42 L 28,50 L 38,58 M 50,28 L 50,72 M 42,38 L 50,28 L 58,38 M 42,62 L 50,72 L 58,62"
            fill="none"
            stroke={strokeColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    case 'workstation':
      return (
        <g>
          <rect x="5" y="6" width="90" height="64" rx="6" fill={baseFill} stroke={strokeColor} strokeWidth={strokeWidth} />
          <rect x="5" y="6" width="90" height="64" rx="6" fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
          <line x1="50" y1="70" x2="50" y2="86" stroke={strokeColor} strokeWidth="3" />
          <line x1="32" y1="88" x2="68" y2="88" stroke={strokeColor} strokeWidth="3" strokeLinecap="round" />
        </g>
      );
    case 'rectangle':
    default:
      return (
        <g>
          <rect x="2" y="2" width="96" height="96" rx="6" fill={baseFill} stroke={strokeColor} strokeWidth={strokeWidth} />
          <rect x="2" y="2" width="96" height="96" rx="6" fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
        </g>
      );
  }
}

/**
 * Renders an unfilled SVG perimeter border overlay for shaped image nodes (`CanvasFileNode`).
 */
export function renderShapeBorderSvg(
  shape: CanvasShape,
  strokeColor: string,
  strokeWidth: string
): React.ReactNode {
  switch (shape) {
    case 'rounded':
      return <rect x="2" y="2" width="96" height="96" rx="24" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />;
    case 'circle':
      return <ellipse cx="50" cy="50" rx="48" ry="48" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />;
    case 'diamond':
      return <polygon points="50,2 98,50 50,98 2,50" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />;
    case 'parallelogram':
      return <polygon points="18,2 98,2 82,98 2,98" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />;
    case 'hexagon':
      return <polygon points="18,2 82,2 98,50 82,98 18,98 2,50" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />;
    case 'cylinder':
      return (
        <g>
          <path d="M 4,16 A 46,13 0 0,1 96,16 L 96,84 A 46,14 0 0,1 4,84 Z" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
          <path d="M 4,16 A 46,13 0 0,0 96,16" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} opacity="0.65" vectorEffect="non-scaling-stroke" />
        </g>
      );
    case 'cloud':
      return (
        <path
          d="M 22,65 C 10,65 5,52 14,42 C 12,28 26,18 38,24 C 45,12 65,12 72,24 C 84,18 96,28 94,42 C 102,52 96,65 86,65 C 90,78 78,88 66,86 C 58,94 42,94 34,86 C 22,88 12,78 22,65 Z"
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      );
    case 'server':
      return <rect x="3" y="3" width="94" height="94" rx="8" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />;
    case 'router':
      return <rect x="5" y="16" width="90" height="68" rx="12" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />;
    case 'workstation':
      return (
        <g>
          <rect x="5" y="6" width="90" height="64" rx="6" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
          <line x1="50" y1="70" x2="50" y2="86" stroke={strokeColor} strokeWidth="3" vectorEffect="non-scaling-stroke" />
          <line x1="32" y1="88" x2="68" y2="88" stroke={strokeColor} strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </g>
      );
    case 'rectangle':
    default:
      return <rect x="2" y="2" width="96" height="96" rx="6" fill="none" stroke={strokeColor} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />;
  }
}
