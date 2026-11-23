import YAML from 'yaml';
import type { AttachmentKind, ExternalLinkRef, FrontmatterProperty, NoteHeading, PropertyType } from './types';

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function inferPropertyType(key: string, value: unknown): PropertyType {
  const lowerKey = key.toLowerCase();
  if (lowerKey === 'sendtarget' || lowerKey === 'send-target' || lowerKey === 'send_target') {
    return 'checkbox';
  }
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
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
    return 'object';
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
    if (typeof value === 'string') {
      return value.trim().toLowerCase() === 'true';
    }
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
  if (type === 'object') {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value;
    }
    return {};
  }
  return value === null || value === undefined ? '' : String(value);
}

export function isNoteSendTarget(
  frontmatter?: Record<string, unknown> | null,
  properties?: FrontmatterProperty[] | null
): boolean {
  if (frontmatter) {
    const val = frontmatter.sendtarget ?? frontmatter.sendTarget;
    if (val === true || String(val).trim().toLowerCase() === 'true') {
      return true;
    }
  }
  if (properties && Array.isArray(properties)) {
    const prop = properties.find((p) => p.key.toLowerCase() === 'sendtarget');
    if (prop) {
      if (prop.value === true || String(prop.value).trim().toLowerCase() === 'true') {
        return true;
      }
    }
  }
  return false;
}

export function isNoteTemplate(
  arg1?: FrontmatterProperty[] | Record<string, unknown> | null,
  arg2?: FrontmatterProperty[] | Record<string, unknown> | null
): boolean {
  const checkFrontmatter = (fm: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(fm)) {
      if (k.toLowerCase() === 'istemplate') {
        if (v === true || String(v).trim().toLowerCase() === 'true') {
          return true;
        }
      }
    }
    return false;
  };

  const checkProps = (props: FrontmatterProperty[]) => {
    const prop = props.find((p) => p && typeof p.key === 'string' && p.key.toLowerCase() === 'istemplate');
    if (prop) {
      if (prop.value === true || String(prop.value).trim().toLowerCase() === 'true') {
        return true;
      }
    }
    return false;
  };

  if (Array.isArray(arg1)) {
    if (checkProps(arg1)) return true;
  } else if (arg1 && typeof arg1 === 'object') {
    if (checkFrontmatter(arg1 as Record<string, unknown>)) return true;
  }

  if (Array.isArray(arg2)) {
    if (checkProps(arg2)) return true;
  } else if (arg2 && typeof arg2 === 'object') {
    if (checkFrontmatter(arg2 as Record<string, unknown>)) return true;
  }

  return false;
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
  const body = rawContent.slice(match[0].length).replace(/^\r?\n/, '');
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

function trimTrailingUrlPunctuation(rawUrl: string): string {
  let url = rawUrl;
  while (url.length > 0) {
    const last = url[url.length - 1];
    if (last === ')' && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) {
      break;
    }
    if ('.,;:!?)]}\'"'.includes(last)) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return url;
}

function normalizeHttpUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim().replace(/^<|>$/g, '');
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Extracts deduplicated external http(s) URLs from Markdown links `[title](https://...)`
 * and bare URLs while ignoring fenced/inline code blocks.
 */
export function extractExternalLinksFromMarkdown(body: string): ExternalLinkRef[] {
  if (!body) return [];
  const withoutCode = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\r\n]+`/g, ' ');

  const linkMap = new Map<string, ExternalLinkRef>();
  const recordUrl = (rawUrl: string, rawTitle?: string) => {
    const normalized = normalizeHttpUrl(rawUrl) || (/^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : null);
    if (!normalized) return;
    const cleanTitle = rawTitle?.trim();
    const usableTitle =
      cleanTitle && cleanTitle !== normalized && cleanTitle !== rawUrl.trim()
        ? cleanTitle
        : undefined;
    const existing = linkMap.get(normalized);
    if (!existing) {
      linkMap.set(normalized, { url: normalized, ...(usableTitle ? { title: usableTitle } : {}) });
    } else if (!existing.title && usableTitle) {
      existing.title = usableTitle;
    }
  };

  // 1. Standard Markdown links [label](https://...) (skip image embeds ![alt](...))
  const mdLinkRegex = /(!?)\[([^\]\r\n]*)\]\((\s*<[^>]+>|[^)\r\n]+)\)/g;
  const textForBareScan = withoutCode.replace(mdLinkRegex, (_full, bang, label, rawHref) => {
    if (bang !== '!') {
      const cleanedHref = String(rawHref)
        .trim()
        .replace(/^<|>$/g, '')
        .replace(/\s+["'][^"']*["']$/, '')
        .trim();
      if (/^https?:\/\//i.test(cleanedHref)) {
        recordUrl(cleanedHref, String(label || ''));
      }
    }
    return ' ';
  });

  // 2. Bare http(s):// URLs outside Markdown link syntax
  const bareUrlRegex = /\bhttps?:\/\/[^\s<>"'`]+/gi;
  let bareMatch: RegExpExecArray | null;
  while ((bareMatch = bareUrlRegex.exec(textForBareScan)) !== null) {
    const cleaned = trimTrailingUrlPunctuation(bareMatch[0]);
    if (cleaned) {
      recordUrl(cleaned);
    }
  }

  return Array.from(linkMap.values());
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
  if (ext === 'base') return 'base';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) return 'audio';
  if (['mp4', 'webm', 'ogv', 'mov', 'mkv'].includes(ext)) return 'video';
  return 'other';
}

/**
 * Resolves the classified AttachmentKind for a given file path or wiki target.
 */
export function resolveWikiTargetKind(filePath: string): AttachmentKind {
  return getAttachmentKind(filePath);
}

export interface RenameMapping {
  oldPath: string;
  newPath: string;
  isDirectory?: boolean;
}

/**
 * Protect code blocks (``` fenced and ` inline code) during link refactoring.
 */
function protectCodeBlocks(content: string): { text: string; restore: (s: string) => string } {
  const blocks: string[] = [];
  const text = content.replace(/(```[\s\S]*?```|`[^`\r\n]+`)/g, (m) => {
    const idx = blocks.length;
    blocks.push(m);
    return `\x00CODE_BLOCK_${idx}\x00`;
  });
  return {
    text,
    restore: (s: string) => s.replace(/\x00CODE_BLOCK_(\d+)\x00/g, (_, idx) => blocks[Number(idx)] ?? ''),
  };
}

/**
 * Refactors all matching wiki-links, embeds, markdown links/images, and HTML img tags
 * across a markdown document.
 */
export function refactorMarkdownContent(content: string, mappings: RenameMapping[]): string {
  if (!mappings || mappings.length === 0) return content;

  // Protect code fences
  const { text: protectedContent, restore } = protectCodeBlocks(content);

  let updated = protectedContent;

  for (const mapping of mappings) {
    const oldPath = mapping.oldPath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    const newPath = mapping.newPath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    if (!oldPath || !newPath || oldPath === newPath) continue;

    const isDir = Boolean(mapping.isDirectory);
    const oldPrefix = oldPath.endsWith('/') ? oldPath : `${oldPath}/`;
    const newPrefix = newPath.endsWith('/') ? newPath : `${newPath}/`;

    const oldName = oldPath.split('/').pop() || '';
    const newName = newPath.split('/').pop() || '';
    const oldExt = oldName.includes('.') ? oldName.split('.').pop()?.toLowerCase() || '' : '';

    const oldBaseNoExt = oldName.replace(/\.(md|canvas)$/i, '');
    const newBaseNoExt = newName.replace(/\.(md|canvas)$/i, '');

    const oldPathNoExt = oldPath.replace(/\.(md|canvas)$/i, '');
    const newPathNoExt = newPath.replace(/\.(md|canvas)$/i, '');

    // 1. Refactor Wiki-links and Wiki-embeds:
    // Pattern: (!?)[[(target)(#subpath)?(|alias)?]]
    const wikiRegex = /(!?)\[\[([^\]|#\r\n]+)(#[^\]|\r\n]*)?(\|[^\]\r\n]*)?\]\]/g;
    updated = updated.replace(wikiRegex, (match, isEmbed, rawTarget, subpath = '', alias = '') => {
      let cleanTarget = rawTarget.trim();
      let wasUrlEncoded = false;
      try {
        const decoded = decodeURIComponent(cleanTarget);
        if (decoded !== cleanTarget) {
          wasUrlEncoded = true;
          cleanTarget = decoded;
        }
      } catch {}

      const normTarget = cleanTarget.replace(/^\.?\//, '').replace(/\\/g, '/');
      let targetReplaced: string | null = null;

      if (isDir) {
        if (normTarget === oldPath) {
          targetReplaced = newPath;
        } else if (normTarget.startsWith(oldPrefix)) {
          targetReplaced = newPrefix + normTarget.slice(oldPrefix.length);
        }
      } else {
        // Exact full path match
        if (normTarget === oldPath) {
          targetReplaced = newPath;
        } else if ((oldExt === 'md' || oldExt === 'canvas') && normTarget === oldPathNoExt) {
          targetReplaced = newPathNoExt;
        } else if (normTarget.includes('/')) {
          // Path with folders: check if it's a suffix match
          if (oldPath.endsWith('/' + normTarget)) {
            targetReplaced = newPath;
          } else if ((oldExt === 'md' || oldExt === 'canvas') && oldPathNoExt.endsWith('/' + normTarget)) {
            targetReplaced = newPathNoExt;
          }
        } else {
          // Short name match (no slashes in target)
          if (normTarget === oldName) {
            targetReplaced = newName;
          } else if ((oldExt === 'md' || oldExt === 'canvas') && normTarget === oldBaseNoExt) {
            targetReplaced = newBaseNoExt;
          }
        }
      }

      if (!targetReplaced) return match;

      if (wasUrlEncoded) {
        targetReplaced = encodeURI(targetReplaced);
      }

      return `${isEmbed}[[${targetReplaced}${subpath}${alias}]]`;
    });

    // 2. Refactor Standard Markdown Links and Images:
    // Pattern: (!?)[label](href)
    const mdLinkRegex = /(!?)\[([^\]\r\n]*)\]\((\s*<[^>]+>|[^)\r\n]+)\)/g;
    updated = updated.replace(mdLinkRegex, (match, isEmbed, label, rawHref) => {
      let innerHref = rawHref.trim();
      let hasAngleBrackets = false;
      if (innerHref.startsWith('<') && innerHref.endsWith('>')) {
        hasAngleBrackets = true;
        innerHref = innerHref.slice(1, -1).trim();
      }

      // Check external URLs
      if (/^(https?:|mailto:|tel:|data:|#)/i.test(innerHref)) {
        return match;
      }

      // Split into url, hash/subpath, and optional title
      const parts = innerHref.match(/^([^\s#?]+)(#[^\s]*)?(\s+["'].*["'])?$/);
      if (!parts) return match;

      const rawUrl = parts[1];
      const hash = parts[2] || '';
      const title = parts[3] || '';

      let cleanUrl = rawUrl;
      let wasUrlEncoded = false;
      try {
        const decoded = decodeURIComponent(cleanUrl);
        if (decoded !== cleanUrl) {
          wasUrlEncoded = true;
          cleanUrl = decoded;
        }
      } catch {}

      const normUrl = cleanUrl.replace(/^\.?\//, '').replace(/\\/g, '/');
      let urlReplaced: string | null = null;

      if (isDir) {
        if (normUrl === oldPath) {
          urlReplaced = newPath;
        } else if (normUrl.startsWith(oldPrefix)) {
          urlReplaced = newPrefix + normUrl.slice(oldPrefix.length);
        }
      } else {
        if (normUrl === oldPath) {
          urlReplaced = newPath;
        } else if ((oldExt === 'md' || oldExt === 'canvas') && normUrl === oldPathNoExt) {
          urlReplaced = newPathNoExt;
        } else if (normUrl === oldName) {
          urlReplaced = newName;
        } else if ((oldExt === 'md' || oldExt === 'canvas') && normUrl === oldBaseNoExt) {
          urlReplaced = newBaseNoExt;
        }
      }

      if (!urlReplaced) return match;

      if (wasUrlEncoded) {
        urlReplaced = encodeURI(urlReplaced);
      }

      const finalHref = hasAngleBrackets
        ? `<${urlReplaced}${hash}${title}>`
        : `${urlReplaced}${hash}${title}`;

      return `${isEmbed}[${label}](${finalHref})`;
    });

    // 3. Refactor HTML <img src="..."> tags
    const htmlImgRegex = /(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi;
    updated = updated.replace(htmlImgRegex, (match, prefix, srcValue, suffix) => {
      if (/^(https?:|data:|blob:)/i.test(srcValue)) return match;

      let cleanSrc = srcValue.trim();
      let wasUrlEncoded = false;
      try {
        const decoded = decodeURIComponent(cleanSrc);
        if (decoded !== cleanSrc) {
          wasUrlEncoded = true;
          cleanSrc = decoded;
        }
      } catch {}

      const normSrc = cleanSrc.replace(/^\.?\//, '').replace(/\\/g, '/');
      let srcReplaced: string | null = null;

      if (isDir) {
        if (normSrc === oldPath) {
          srcReplaced = newPath;
        } else if (normSrc.startsWith(oldPrefix)) {
          srcReplaced = newPrefix + normSrc.slice(oldPrefix.length);
        }
      } else {
        if (normSrc === oldPath) {
          srcReplaced = newPath;
        } else if (normSrc === oldName) {
          srcReplaced = newName;
        }
      }

      if (!srcReplaced) return match;

      if (wasUrlEncoded) {
        srcReplaced = encodeURI(srcReplaced);
      }

      return `${prefix}${srcReplaced}${suffix}`;
    });
  }

  return restore(updated);
}

/**
 * Refactors all file references, wiki-links, and embeds inside a JSON Canvas (.canvas) document.
 */
export function refactorCanvasContent(rawJson: string, mappings: RenameMapping[]): string {
  if (!mappings || mappings.length === 0) return rawJson;

  try {
    const doc = JSON.parse(rawJson);
    if (!doc || typeof doc !== 'object') return rawJson;
    let modified = false;

    for (const mapping of mappings) {
      const oldPath = mapping.oldPath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
      const newPath = mapping.newPath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
      if (!oldPath || !newPath || oldPath === newPath) continue;

      const isDir = Boolean(mapping.isDirectory);
      const oldPrefix = oldPath.endsWith('/') ? oldPath : `${oldPath}/`;
      const newPrefix = newPath.endsWith('/') ? newPath : `${newPath}/`;

      if (isDir && typeof doc.assetsFolder === 'string' && doc.assetsFolder.trim()) {
        const cleanAssets = doc.assetsFolder.replace(/^[/\\]+|[/\\]+$/g, '').replace(/\\/g, '/');
        if (cleanAssets === oldPath) {
          doc.assetsFolder = newPath;
          modified = true;
        } else if (cleanAssets.startsWith(oldPrefix)) {
          doc.assetsFolder = newPrefix + cleanAssets.slice(oldPrefix.length);
          modified = true;
        }
      }

      // 1. Process Nodes
      if (Array.isArray(doc.nodes)) {
        for (const node of doc.nodes) {
          if (!node || typeof node !== 'object') continue;

          // type === 'file': node.file
          if (node.type === 'file' && typeof node.file === 'string') {
            const cleanFile = node.file.replace(/^[/\\]+/, '').replace(/\\/g, '/');
            if (isDir) {
              if (cleanFile === oldPath) {
                node.file = newPath;
                modified = true;
              } else if (cleanFile.startsWith(oldPrefix)) {
                node.file = newPrefix + cleanFile.slice(oldPrefix.length);
                modified = true;
              }
            } else {
              if (cleanFile === oldPath) {
                node.file = newPath;
                modified = true;
              }
            }
          }

          // Optional clickable internal link on file/image nodes: node.link
          if (
            typeof node.link === 'string' &&
            node.link.trim() &&
            !/^(https?:|mailto:|tel:)/i.test(node.link.trim())
          ) {
            const cleanLink = node.link.trim().replace(/^[/\\]+/, '').replace(/\\/g, '/');
            if (isDir) {
              if (cleanLink === oldPath) {
                node.link = newPath;
                modified = true;
              } else if (cleanLink.startsWith(oldPrefix)) {
                node.link = newPrefix + cleanLink.slice(oldPrefix.length);
                modified = true;
              }
            } else if (cleanLink === oldPath) {
              node.link = newPath;
              modified = true;
            }
          }

          // node.text
          if (typeof node.text === 'string' && node.text) {
            const nextText = refactorMarkdownContent(node.text, [mapping]);
            if (nextText !== node.text) {
              node.text = nextText;
              modified = true;
            }
          }

          // node.label
          if (typeof node.label === 'string' && node.label) {
            const nextLabel = refactorMarkdownContent(node.label, [mapping]);
            if (nextLabel !== node.label) {
              node.label = nextLabel;
              modified = true;
            }
          }
        }
      }

      // 2. Process Edges
      if (Array.isArray(doc.edges)) {
        for (const edge of doc.edges) {
          if (!edge || typeof edge !== 'object') continue;
          if (typeof edge.label === 'string' && edge.label) {
            const nextLabel = refactorMarkdownContent(edge.label, [mapping]);
            if (nextLabel !== edge.label) {
              edge.label = nextLabel;
              modified = true;
            }
          }
        }
      }
    }

    if (modified) {
      return JSON.stringify(doc, null, 2);
    }
  } catch {
    // Return unmodified on parse errors
  }

  return rawJson;
}

/**
 * Parses JSON Canvas (.canvas) content and extracts all outbound file links,
 * internal [[Wiki-Links]], external http(s) URLs, #tags, and optional assetsFolder.
 */
export function extractCanvasLinksAndTags(rawJson: string): {
  links: string[];
  tags: string[];
  externalLinks: ExternalLinkRef[];
  assetsFolder?: string;
} {
  const linksSet = new Set<string>();
  const tagsSet = new Set<string>();
  const externalMap = new Map<string, ExternalLinkRef>();
  let assetsFolder: string | undefined;

  const recordExternal = (rawUrl: string, rawTitle?: string) => {
    const normalized = normalizeHttpUrl(rawUrl) || (/^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : null);
    if (!normalized) return;
    const cleanTitle = rawTitle?.trim();
    const usableTitle =
      cleanTitle && cleanTitle !== normalized && cleanTitle !== rawUrl.trim()
        ? cleanTitle
        : undefined;
    const existing = externalMap.get(normalized);
    if (!existing) {
      externalMap.set(normalized, { url: normalized, ...(usableTitle ? { title: usableTitle } : {}) });
    } else if (!existing.title && usableTitle) {
      existing.title = usableTitle;
    }
  };

  const collectTextMetadata = (text: string) => {
    const { links } = extractLinksAndEmbeds(text);
    for (const l of links) linksSet.add(l);
    const tags = extractTags([], text);
    for (const t of tags) tagsSet.add(t);
    for (const ext of extractExternalLinksFromMarkdown(text)) {
      recordExternal(ext.url, ext.title);
    }
  };

  try {
    const doc = JSON.parse(rawJson);
    if (doc && typeof doc.assetsFolder === 'string' && doc.assetsFolder.trim()) {
      assetsFolder = doc.assetsFolder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    }

    if (doc && Array.isArray(doc.nodes)) {
      for (const node of doc.nodes) {
        if (!node || typeof node !== 'object') continue;

        // 1. type === 'file': node.file
        if (node.type === 'file' && typeof node.file === 'string' && node.file.trim()) {
          const cleanFile = node.file.trim();
          linksSet.add(cleanFile);
        }

        // 2. type === 'link': node.url
        if (node.type === 'link' && typeof node.url === 'string' && node.url.trim()) {
          const titleCandidate =
            typeof node.label === 'string' && node.label.trim()
              ? node.label.trim()
              : typeof node.text === 'string' && node.text.trim()
                ? node.text.trim()
                : undefined;
          recordExternal(node.url.trim(), titleCandidate);
        }

        // 3. Optional clickable link on file/image nodes: node.link
        if (typeof node.link === 'string' && node.link.trim()) {
          const trimmedLink = node.link.trim();
          if (/^https?:\/\//i.test(trimmedLink)) {
            recordExternal(trimmedLink);
          } else if (!/^(mailto:|tel:)/i.test(trimmedLink)) {
            linksSet.add(trimmedLink);
          }
        }

        // 4. node.text
        if (typeof node.text === 'string' && node.text.trim()) {
          collectTextMetadata(node.text);
        }

        // 5. node.label
        if (typeof node.label === 'string' && node.label.trim()) {
          collectTextMetadata(node.label);
        }
      }
    }

    if (doc && Array.isArray(doc.edges)) {
      for (const edge of doc.edges) {
        if (!edge || typeof edge !== 'object') continue;
        if (typeof edge.label === 'string' && edge.label.trim()) {
          collectTextMetadata(edge.label);
        }
      }
    }
  } catch {
    // Ignore JSON parsing errors for corrupted or empty canvas files
  }

  return {
    links: Array.from(linksSet),
    tags: Array.from(tagsSet),
    externalLinks: Array.from(externalMap.values()),
    ...(assetsFolder ? { assetsFolder } : {}),
  };
}

/**
 * Refactors folder and note references inside an Obsidian Base (.base) YAML configuration.
 * Handles file.inFolder("..."), file == "...", and string paths.
 */
export function refactorBaseContent(
  rawYaml: string,
  mappingsOrOldPath: RenameMapping[] | string,
  maybeNewPath?: string
): string {
  if (!rawYaml || !mappingsOrOldPath) return rawYaml;
  let mappings: RenameMapping[] = [];
  if (typeof mappingsOrOldPath === 'string') {
    mappings = [{ oldPath: mappingsOrOldPath, newPath: maybeNewPath || '' }];
  } else if (Array.isArray(mappingsOrOldPath)) {
    mappings = mappingsOrOldPath;
  }
  if (mappings.length === 0) return rawYaml;
  let updated = rawYaml;

  for (const mapping of mappings) {
    const oldPath = mapping.oldPath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    const newPath = mapping.newPath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    if (!oldPath || !newPath || oldPath === newPath) continue;

    const oldFolderEscaped = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 1. file.inFolder("oldFolder") / file.inFolder('oldFolder')
    const inFolderRegex = new RegExp(`(file\\.inFolder\\(\\s*["'])${oldFolderEscaped}(["']\\s*\\))`, 'g');
    updated = updated.replace(inFolderRegex, `$1${newPath}$2`);

    // 2. Exact file path quotes in filters or views: "oldPath" or "oldPath.md"
    const oldPathNoExt = oldPath.replace(/\.(md|canvas|base)$/i, '');
    const newPathNoExt = newPath.replace(/\.(md|canvas|base)$/i, '');
    const oldPathNoExtEscaped = oldPathNoExt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Replace string references inside quotes
    const strQuoteRegex = new RegExp(`(["'])${oldFolderEscaped}(["'])`, 'g');
    updated = updated.replace(strQuoteRegex, `$1${newPath}$2`);

    const strNoExtRegex = new RegExp(`(["'])${oldPathNoExtEscaped}(["'])`, 'g');
    updated = updated.replace(strNoExtRegex, `$1${newPathNoExt}$2`);
  }

  return updated;
}
