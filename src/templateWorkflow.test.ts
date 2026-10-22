import { describe, it, expect } from 'vitest';
import {
  isNoteTemplate,
  parseMarkdownWithFrontmatter,
  serializeMarkdownWithFrontmatter,
} from '../shared/markdownUtils';
import type { FrontmatterProperty } from '../shared/types';

describe('Template Workflow (isTemplate: true)', () => {
  describe('isNoteTemplate detection', () => {
    it('detects isTemplate: true in properties array', () => {
      const props: FrontmatterProperty[] = [
        { key: 'author', value: 'Alice', type: 'text' },
        { key: 'isTemplate', value: true, type: 'checkbox' },
      ];
      expect(isNoteTemplate(props)).toBe(true);
    });

    it('detects isTemplate: "true" string in properties array (case-insensitive)', () => {
      const props: FrontmatterProperty[] = [
        { key: 'istemplate', value: 'true', type: 'text' },
      ];
      expect(isNoteTemplate(props)).toBe(true);
    });

    it('detects isTemplate in frontmatter object', () => {
      expect(isNoteTemplate(undefined, { isTemplate: true })).toBe(true);
      expect(isNoteTemplate(undefined, { istemplate: 'true' })).toBe(true);
      expect(isNoteTemplate(undefined, { isTemplate: false })).toBe(false);
      expect(isNoteTemplate(undefined, { isTemplate: 'false' })).toBe(false);
      expect(isNoteTemplate(undefined, {})).toBe(false);
    });

    it('returns false when isTemplate is not present or false', () => {
      const props: FrontmatterProperty[] = [
        { key: 'author', value: 'Alice', type: 'text' },
        { key: 'isTemplate', value: false, type: 'checkbox' },
      ];
      expect(isNoteTemplate(props)).toBe(false);
      expect(isNoteTemplate([])).toBe(false);
      expect(isNoteTemplate()).toBe(false);
    });
  });

  describe('Instantiating notes from template', () => {
    it('strips isTemplate property and substitutes {{date}}, {{time}}, and {{title}}', () => {
      const templateMarkdown = `---
author: Alice
isTemplate: true
project: "{{title}}"
created: "{{date}}"
---
# Projekt: {{title}}

Erstellt am {{date}} um {{time}}.

## Aufgaben
- [ ] Kickoff-Meeting vorbereiten
`;

      const parsed = parseMarkdownWithFrontmatter(templateMarkdown);
      expect(isNoteTemplate(parsed.properties, parsed.frontmatter)).toBe(true);

      const targetTitle = 'Kundenportal 2026';
      const fakeDate = '2026-10-22';
      const fakeTime = '14:30';

      const replaceVars = (str: string) =>
        str
          .replace(/\{\{date\}\}/gi, fakeDate)
          .replace(/\{\{time\}\}/gi, fakeTime)
          .replace(/\{\{title\}\}/gi, targetTitle);

      // 1. Substitute in body
      const newBody = replaceVars(parsed.body);

      // 2. CRITICAL: Filter out isTemplate property so the new note is never a template!
      const newProperties = parsed.properties
        .filter((p) => p.key.toLowerCase() !== 'istemplate')
        .map((p) => {
          if (typeof p.value === 'string') {
            return { ...p, value: replaceVars(p.value) };
          }
          return p;
        });

      // Verify that isTemplate is removed
      expect(isNoteTemplate(newProperties)).toBe(false);

      // Verify variable replacement in body
      expect(newBody).toContain('# Projekt: Kundenportal 2026');
      expect(newBody).toContain('Erstellt am 2026-10-22 um 14:30.');

      // Serialize back and verify YAML frontmatter
      const serialized = serializeMarkdownWithFrontmatter(newProperties, newBody);
      const reParsed = parseMarkdownWithFrontmatter(serialized);

      expect(reParsed.frontmatter.isTemplate).toBeUndefined();
      expect(reParsed.frontmatter.project).toBe('Kundenportal 2026');
      expect(reParsed.frontmatter.created).toBe('2026-10-22');
      expect(reParsed.frontmatter.author).toBe('Alice');
      expect(isNoteTemplate(reParsed.properties, reParsed.frontmatter)).toBe(false);
    });
  });
});
