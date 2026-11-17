/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConflictModal } from './ConflictModal';
import { I18nProvider } from '../i18n';
import type { ConflictItem } from '../sync/syncEngine';

describe('ConflictModal hook stability', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('transitions from empty conflicts to non-empty and back without React hook order error (#310)', () => {
    const sampleConflict: ConflictItem = {
      id: 'save-diagram.canvas-1',
      path: 'diagram.canvas',
      localBody: '{"nodes":[{"id":"1","x":100,"y":200}],"edges":[]}',
      localProperties: [],
      localTimestamp: Date.now(),
      serverNote: {
        path: 'diagram.canvas',
        name: 'diagram',
        frontmatter: {},
        properties: [],
        body: '{"nodes":[{"id":"1","x":10,"y":20}],"edges":[]}',
        rawContent: '{"nodes":[{"id":"1","x":10,"y":20}],"edges":[]}',
        tags: [],
        links: [],
        embeds: [],
        headings: [],
        updatedAt: Date.now() - 1000,
      },
    };

    // 1. Initial render with empty conflicts
    act(() => {
      root.render(
        <I18nProvider>
          <ConflictModal conflicts={[]} onClose={() => {}} />
        </I18nProvider>
      );
    });
    expect(container.querySelector('.conflict-modal')).toBeNull();

    // 2. Transition to non-empty conflicts (previously threw React Error #310)
    act(() => {
      root.render(
        <I18nProvider>
          <ConflictModal conflicts={[sampleConflict]} onClose={() => {}} />
        </I18nProvider>
      );
    });
    expect(container.querySelector('.conflict-modal')).not.toBeNull();
    expect(container.textContent).toContain('diagram.canvas');

    // 3. Transition back to empty conflicts
    act(() => {
      root.render(
        <I18nProvider>
          <ConflictModal conflicts={[]} onClose={() => {}} />
        </I18nProvider>
      );
    });
    expect(container.querySelector('.conflict-modal')).toBeNull();
  });
});
