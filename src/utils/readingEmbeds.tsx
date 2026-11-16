import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BaseEmbedWidget } from '../components/base/BaseEmbedWidget';
import { CanvasEmbedWidget } from '../components/canvas/CanvasEmbedWidget';

export interface MountReadingEmbedsOptions {
  allNotes: ({ path: string; name: string; basename: string } & Record<string, any>)[];
  notePath: string;
  onOpenNote?: (target: string) => void;
}

/**
 * Mounts interactive BaseEmbedWidget and CanvasEmbedWidget React roots inside
 * a rendered Reading Mode HTML container and returns a cleanup callback.
 */
export function mountReadingCanvasAndBaseEmbeds(
  container: HTMLElement,
  { allNotes, notePath, onOpenNote }: MountReadingEmbedsOptions
): () => void {
  const roots: Root[] = [];
  const noopOpen = onOpenNote ?? (() => {});

  const baseEmbedBlocks = container.querySelectorAll<HTMLElement>(
    '.embedded-base-container, .reading-base-embed'
  );
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
    roots.push(root);
    root.render(
      <BaseEmbedWidget
        basePath={basePath}
        initialView={initialView}
        height={height}
        allNotes={allNotes}
        onOpenNote={noopOpen}
      />
    );
  });

  const canvasEmbedBlocks = container.querySelectorAll<HTMLElement>('.embedded-canvas-container');
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
    roots.push(root);
    root.render(
      <CanvasEmbedWidget
        canvasPath={canvasPath}
        height={height}
        allNotes={allNotes}
        currentNotePath={notePath}
        onOpenNote={noopOpen}
      />
    );
  });

  return () => {
    roots.forEach((r) => {
      try {
        r.unmount();
      } catch {
        // Ignore already-unmounted roots
      }
    });
  };
}
