import { describe, it, expect } from 'vitest';
import {
  extractMatchSnippet,
  parseSearchQuery,
  scoreSearchMatch,
} from './searchEngine';
import {
  findInNoteMatches,
  searchNotesFullTextOffline,
  searchVaultFiles,
  wrapMatchIndex,
} from '../src/utils/mobileSearchUtils';

describe('Unified Search Engine (shared/searchEngine.ts)', () => {
  it('enforces whole-word default with Unicode boundaries', () => {
    const parsed = parseSearchQuery('zuber');
    expect(parsed.required).toHaveLength(1);

    // Matches standalone Zuber / zuber
    expect(
      scoreSearchMatch({ path: 'A.md', body: 'Hallo Zuber!' }, parsed)
    ).not.toBeNull();
    expect(
      scoreSearchMatch({ path: 'B.md', body: 'Das liegt im Zuber.' }, parsed)
    ).not.toBeNull();

    // Does NOT match Zubereitung or Holzzuber without wildcards
    expect(
      scoreSearchMatch({ path: 'C.md', body: 'Zubereitung von Tee' }, parsed)
    ).toBeNull();
    expect(
      scoreSearchMatch({ path: 'D.md', body: 'Alter Holzzuber' }, parsed)
    ).toBeNull();
  });

  it('supports prefix, suffix, and infix wildcards (*)', () => {
    const prefix = parseSearchQuery('zuber*');
    expect(scoreSearchMatch({ path: 'A.md', body: 'Zuber' }, prefix)).not.toBeNull();
    expect(scoreSearchMatch({ path: 'B.md', body: 'Zubereitung' }, prefix)).not.toBeNull();
    expect(scoreSearchMatch({ path: 'C.md', body: 'Holzzuber' }, prefix)).toBeNull();

    const suffix = parseSearchQuery('*zuber');
    expect(scoreSearchMatch({ path: 'D.md', body: 'Holzzuber' }, suffix)).not.toBeNull();
    expect(scoreSearchMatch({ path: 'E.md', body: 'Zubereitung' }, suffix)).toBeNull();

    const infix = parseSearchQuery('*zuber*');
    expect(scoreSearchMatch({ path: 'F.md', body: 'Holzzubereitung' }, infix)).not.toBeNull();
  });

  it('supports boolean operators (+required, -excluded, implicit AND) and quoted phrases without crashing on bare +/-', () => {
    const bare = parseSearchQuery('+ -');
    expect(bare.hasTerms).toBe(false);

    const both = parseSearchQuery('+zuber +Entwicklung');
    expect(scoreSearchMatch({ path: 'A.md', body: 'Zuber Entwicklung' }, both)).not.toBeNull();
    expect(scoreSearchMatch({ path: 'B.md', body: 'Nur Zuber hier' }, both)).toBeNull();

    const excluded = parseSearchQuery('+zuber -archiv');
    expect(scoreSearchMatch({ path: 'A.md', body: 'Aktive Zuber Notiz' }, excluded)).not.toBeNull();
    expect(scoreSearchMatch({ path: 'B.md', body: 'Zuber im Archiv' }, excluded)).toBeNull();

    const phrase = parseSearchQuery('"zuber entwicklung"');
    expect(scoreSearchMatch({ path: 'A.md', body: 'Die Zuber   Entwicklung läuft' }, phrase)).not.toBeNull();
    expect(scoreSearchMatch({ path: 'B.md', body: 'Entwicklung für Zuber' }, phrase)).toBeNull();
  });

  it('ranks results deterministically: exact title > whole-word title > tag/alias > body > wildcard > recency', () => {
    const now = Date.now();
    const q = parseSearchQuery('zuber');

    const exactTitle = scoreSearchMatch({ path: 'Zuber.md', body: 'Intro', mtime: now - 100 * 86400_000 }, q, now)!;
    const wordInTitle = scoreSearchMatch({ path: 'Mein Zuber Plan.md', body: 'Intro', mtime: now - 100 * 86400_000 }, q, now)!;
    const tagMatch = scoreSearchMatch({ path: 'Other.md', tags: ['zuber'], body: 'Intro', mtime: now - 100 * 86400_000 }, q, now)!;
    const bodyMatch = scoreSearchMatch({ path: 'Notes.md', body: 'Ein Zuber im Keller', mtime: now - 100 * 86400_000 }, q, now)!;

    expect(exactTitle).toBeGreaterThan(wordInTitle);
    expect(wordInTitle).toBeGreaterThan(tagMatch);
    expect(tagMatch).toBeGreaterThan(bodyMatch);

    // Wildcard body match scores lower than whole-word body match
    const wildScore = scoreSearchMatch({ path: 'Notes.md', body: 'Zubereitung', mtime: now - 100 * 86400_000 }, parseSearchQuery('zuber*'), now)!;
    expect(bodyMatch).toBeGreaterThan(wildScore);

    // Recency tie-breaker boosts recent notes
    const recentBody = scoreSearchMatch({ path: 'Recent.md', body: 'Ein Zuber', mtime: now - 3600_000 }, q, now)!;
    const oldBody = scoreSearchMatch({ path: 'Old.md', body: 'Ein Zuber', mtime: now - 120 * 86400_000 }, q, now)!;
    expect(recentBody).toBeGreaterThan(oldBody);
  });

  it('extracts best snippet and ranges and supports in-note wrap-around indexing', () => {
    const body = 'First line\nSecond line mentions Zuber and Entwicklung\nThird line';
    const parsed = parseSearchQuery('+zuber +Entwicklung');
    const snip = extractMatchSnippet(body, parsed, 120);
    expect(snip.line).toBe(2);
    expect(snip.ranges.length).toBe(2);

    const inNote = findInNoteMatches('Zuber one\nZubereitung\nZuber two', 'zuber');
    expect(inNote).toHaveLength(2);
    expect(wrapMatchIndex(0, -1, 2)).toBe(1);
    expect(wrapMatchIndex(1, 1, 2)).toBe(0);

    const files = searchVaultFiles([{ path: 'Other.md' }, { path: 'Zuber.md' }], 'zuber');
    expect(files.map((f) => f.path)).toEqual(['Zuber.md']);

    const offline = searchNotesFullTextOffline(
      [
        { path: 'Old.md', body: 'Zuber', mtime: 1000 },
        { path: 'New.md', body: 'Zuber', mtime: 9000000000000 },
      ],
      'zuber',
      20,
      'newest'
    );
    expect(offline[0].path).toBe('New.md');
  });
});
