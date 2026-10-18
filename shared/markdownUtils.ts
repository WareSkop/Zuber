import YAML from 'yaml';
import type { AttachmentKind, FrontmatterProperty, NoteHeading, PropertyType } from './types';

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function inferPropertyType(key: string, value: unknown): PropertyType {
  const lowerKey = key.toLowerCase();
  if (lowerKey === 'tags' || lowerKey === 'tag' || lowerKey === 'aliases' || lowerKey === 'alias' || lowerKey === 'cssclasses') {
    return 'list';
  }
  if (Array.isArray(value)) {
    return 'list';
  }
  if (typeof value === 'boolean') {
    return 'checkbox';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return 'date';
    }
  }
  if (lowerKey.includes('date') || lowerKey === 'created' || lowerKey === 'updated' || lowerKey === 'fällig' || lowerKey === 'datum') {
    return 'date';
  }
  return 'text';
}

export function normalizePropertyValue(key: string, value: unknown, type: PropertyType): unknown {
  if (type === 'list') {
    if (Array.isArray(value)) {
      return value.map((v) => String(v).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  }
  if (type === 'checkbox') {
    return Boolean(value);
  }
  if (type === 'number') {
    const n = Number(value);
    return Number.isNaN(n) ? 0 : n;
  }
  if (type === 'date') {
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
    return value ? String(value) : '';
  }
  return value === null || value === undefined ? '' : String(value);
}

export function parseMarkdownWithFrontmatter(rawContent: string): {
  frontmatter: Record<string, unknown>;
  properties: FrontmatterProperty[];
  body: string;
  hasFrontmatter: boolean;
} {
  const match = rawContent.match(FRONTMATTER_REGEX);
  if (!match) {
    return {
      frontmatter: {},
      properties: [],
      body: rawContent,
      hasFrontmatter: false,
    };
  }

  const yamlText = match[1];
  const body = rawContent.slice(match[0].length);
  let parsed: Record<string, unknown> = {};

  try {
    const doc = YAML.parse(yamlText);
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
      parsed = doc as Record<string, unknown>;
    }
  } catch {
    parsed = {};
  }

  const properties: FrontmatterProperty[] = Object.entries(parsed).map(([key, val]) => {
    const type = inferPropertyType(key, val);
    return {
      key,
      type,
      value: normalizePropertyValue(key, val, type),
    };
  });

  return {
    frontmatter: parsed,
    properties,
    body,
    hasFrontmatter: true,
  };
}

export function serializeMarkdownWithFrontmatter(
  properties: FrontmatterProperty[],
  body: string
): string {
  const validProps = properties.filter((p) => p.key.trim().length > 0);
  if (validProps.length === 0) {
    return body;
  }

  const obj: Record<string, unknown> = {};
  for (const prop of validProps) {
    const key = prop.key.trim();
    obj[key] = normalizePropertyValue(key, prop.value, prop.type);
  }

  const yamlStr = YAML.stringify(obj, { lineWidth: 0 }).trimEnd();
  const cleanBody = body.replace(/^\r?\n/, '');
  return `---\n${yamlStr}\n---\n${cleanBody ? '\n' + cleanBody : ''}`.replace(/\n\n\n+/, '\n\n');
}

/**
 * Extracts [[Wiki-Links]], ![[Embeds]], and internal Markdown [links](path) / ![images](path) from markdown body.
 */
export function extractLinksAndEmbeds(body: string): {
  links: string[];
  embeds: string[];
} {
  // Remove fenced code blocks before extracting links
  const withoutCode = body.replace(/```[\s\S]*?```/g, '');
  const linksSet = new Set<string>();
  const embedsSet = new Set<string>();

  const safeDecode = (s: string) => {
    try {
      return decodeURIComponent(s.trim());
    } catch {
      return s.trim();
    }
  };

  // 1. Obsidian [[Wiki-Links]] and ![[Embeds]]
  const wikiRegex = /(!?)\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|[^\]\n]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = wikiRegex.exec(withoutCode)) !== null) {
    const isEmbed = match[1] === '!';
    const target = safeDecode(match[2]);
    if (!target) continue;
    if (isEmbed) {
      embedsSet.add(target);
      if (!/\.(png|jpg|jpeg|gif|webp|svg|pdf|mp3|mp4|xlsx|docx|zip)$/i.test(target)) {
        linksSet.add(target);
      }
    } else {
      linksSet.add(target);
    }
  }

  // 2. Standard Markdown ![alt](path) and [label](path)
  const mdLinkRegex = /(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g;
  while ((match = mdLinkRegex.exec(withoutCode)) !== null) {
    const isEmbed = match[1] === '!';
    const rawHref = match[3].trim().replace(/\s+"[^"]*"$/, '');
    if (
      !rawHref ||
      /^(https?:|mailto:|tel:|data:|#)/i.test(rawHref)
    ) {
      continue;
    }
    const target = safeDecode(rawHref.split('#')[0]);
    if (!target) continue;
    if (isEmbed) {
      embedsSet.add(target);
    } else if (!/\.(png|jpg|jpeg|gif|webp|svg|pdf|mp3|mp4|xlsx|docx|zip)$/i.test(target)) {
      linksSet.add(target);
    }
  }

  return {
    links: Array.from(linksSet),
    embeds: Array.from(embedsSet),
  };
}

/**
 * Extracts #tags from both Frontmatter properties and inline Markdown text.
 */
export function extractTags(
  properties: FrontmatterProperty[],
  body: string
): string[] {
  const tagsSet = new Set<string>();

  // 1. Frontmatter tags
  for (const prop of properties) {
    if (prop.key.toLowerCase() === 'tags' || prop.key.toLowerCase() === 'tag') {
      const list = Array.isArray(prop.value)
        ? prop.value
        : typeof prop.value === 'string'
          ? prop.value.split(',')
          : [];
      for (const item of list) {
        const cleaned = String(item).trim().replace(/^#+/, '');
        if (cleaned) tagsSet.add(cleaned);
      }
    }
  }

  // 2. Inline #tags (excluding code blocks, headings, and URLs)
  const withoutCode = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]+`/g, '');
  const tagRegex = /(?:^|[\s(])#([a-zA-ZäöüÄÖÜß0-9/_-]+)(?=$|[\s.,;:!?)\]])/gm;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(withoutCode)) !== null) {
    const tag = match[1].trim();
    // Avoid pure numbers like #123
    if (tag && !/^\d+$/.test(tag)) {
      tagsSet.add(tag);
    }
  }

  return Array.from(tagsSet);
}

/**
 * Extracts Markdown headings (# H1 .. ###### H6) with line numbers (1-indexed in body)
 */
export function extractHeadings(body: string): NoteHeading[] {
  const lines = body.split(/\r?\n/);
  const headings: NoteHeading[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim().replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, a) => a || t),
        line: i + 1,
      });
    }
  }

  return headings;
}

/**
 * Returns attachment classification for a file path or extension.
 */
export function getAttachmentKind(filePath: string): AttachmentKind {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  if (ext === 'md') return 'markdown';
  if (ext === 'canvas') return 'canvas';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) return 'audio';
  if (['mp4', 'webm', 'ogv', 'mov', 'mkv'].includes(ext)) return 'video';
  return 'other';
}

/**
 * Parses JSON Canvas (.canvas) content and extracts all outbound file links,
 * internal [[Wiki-Links]], and #tags from text, file, and group nodes.
 */
export function extractCanvasLinksAndTags(rawJson: string): {
  links: string[];
  tags: string[];
} {
  const linksSet = new Set<string>();
  const tagsSet = new Set<string>();

  try {
    const doc = JSON.parse(rawJson);
    if (doc && Array.isArray(doc.nodes)) {
      for (const node of doc.nodes) {
        if (!node || typeof node !== 'object') continue;

        // 1. type === 'file': node.file
        if (node.type === 'file' && typeof node.file === 'string' && node.file.trim()) {
          const cleanFile = node.file.trim();
          linksSet.add(cleanFile);
        }

        // 2. node.text
        if (typeof node.text === 'string' && node.text.trim()) {
          const { links } = extractLinksAndEmbeds(node.text);
          for (const l of links) linksSet.add(l);
          const tags = extractTags([], node.text);
          for (const t of tags) tagsSet.add(t);
        }

        // 3. node.label
        if (typeof node.label === 'string' && node.label.trim()) {
          const { links } = extractLinksAndEmbeds(node.label);
          for (const l of links) linksSet.add(l);
          const tags = extractTags([], node.label);
          for (const t of tags) tagsSet.add(t);
        }
      }
    }

    if (doc && Array.isArray(doc.edges)) {
      for (const edge of doc.edges) {
        if (!edge || typeof edge !== 'object') continue;
        if (typeof edge.label === 'string' && edge.label.trim()) {
          const { links } = extractLinksAndEmbeds(edge.label);
          for (const l of links) linksSet.add(l);
          const tags = extractTags([], edge.label);
          for (const t of tags) tagsSet.add(t);
        }
      }
    }
  } catch {
    // Ignore JSON parsing errors for corrupted or empty canvas files
  }

  return {
    links: Array.from(linksSet),
    tags: Array.from(tagsSet),
  };
}
