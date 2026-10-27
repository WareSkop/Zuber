import YAML from 'yaml';
import { extractLinksAndEmbeds } from '../../shared/markdownUtils';
import type {
  BaseDefinition,
  BaseFilterCondition,
  BaseGroupBy,
  BaseSortRule,
  BaseViewConfig,
  NoteData,
  NoteSummary,
} from '../../shared/types';

export interface BaseRecordFile {
  name: string;
  path: string;
  folder: string;
  ext: string;
  mtime: number;
  inFolder: (folder: string) => boolean;
  hasTag: (tag: string) => boolean;
  hasLink: (link: string) => boolean;
}

export interface BaseRecord {
  file: BaseRecordFile;
  tags: string[];
  links: string[];
  properties: Record<string, any>;
  formulas: Record<string, any>;
  [key: string]: any;
}

export interface BaseGroup {
  key: string;
  label: string;
  records: BaseRecord[];
}

export interface BaseQueryResult {
  definition: BaseDefinition;
  view: BaseViewConfig;
  columns: string[];
  columnDisplayNames: Record<string, string>;
  records: BaseRecord[];
  groups: BaseGroup[];
  totalCount: number;
}

/**
 * Parses raw YAML text into a typed BaseDefinition.
 */
export function parseBaseYaml(rawYaml: string): BaseDefinition {
  if (!rawYaml || !rawYaml.trim()) {
    return { views: [{ type: 'table', name: 'Table' }] };
  }

  try {
    const parsed = YAML.parse(rawYaml);
    if (!parsed || typeof parsed !== 'object') {
      return { views: [{ type: 'table', name: 'Table' }] };
    }

    const definition: BaseDefinition = {
      filters: parsed.filters,
      formulas: parsed.formulas,
      properties: parsed.properties,
      summaries: parsed.summaries,
      views: Array.isArray(parsed.views) && parsed.views.length > 0
        ? parsed.views
        : [{ type: 'table', name: 'Table' }],
    };
    return definition;
  } catch (err) {
    throw new Error(`YAML Parsing Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Checks whether a list of links (or note content) points to the requested target note.
 * Supports:
 * - Direct note names: [[Target]] -> matches "Target" or "Target.md"
 * - Subpaths: [[Folder/Target]] -> matches "Target" or "Folder/Target"
 * - Anchors: [[Target#Heading]] -> matches "Target"
 * - Aliases: [[Target|Alias]] -> matches "Target"
 * - Standard Markdown links: [Text](Target.md) or [Text](Folder/Target.md)
 */
export function noteMatchesLinkTarget(rawLinkTarget: string, allLinks: string[], noteContent?: string): boolean {
  const query = (rawLinkTarget || '').trim();
  if (!query) return false;

  // Clean the query target: remove wiki brackets if present, anchors, aliases, .md
  let cleanTarget = query.replace(/^\[\[/, '').replace(/\]\]$/, '').trim();
  cleanTarget = cleanTarget.split('#')[0].split('|')[0].trim();
  const targetNoExt = cleanTarget.replace(/\.md$/i, '').trim().toLowerCase();
  const targetBasename = (targetNoExt.split(/[/\\]/).pop() || targetNoExt).toLowerCase();

  const isMatch = (linkItem: string): boolean => {
    if (!linkItem) return false;
    let cleanItem = String(linkItem).trim().replace(/^\[\[/, '').replace(/\]\]$/, '').trim();
    cleanItem = cleanItem.split('#')[0].split('|')[0].trim();
    const itemNoExt = cleanItem.replace(/\.md$/i, '').trim().toLowerCase();
    const itemBasename = (itemNoExt.split(/[/\\]/).pop() || itemNoExt).toLowerCase();

    // 1. Exact match on clean target (e.g. "zielnotiz" === "zielnotiz" or "ordner/zielnotiz" === "ordner/zielnotiz")
    if (itemNoExt === targetNoExt) return true;
    // 2. Basename match (e.g. "ordner/zielnotiz" matches target "zielnotiz" or link "zielnotiz" matches target "ordner/zielnotiz")
    if (targetBasename && (itemBasename === targetBasename || itemNoExt === targetBasename || targetNoExt === itemBasename)) return true;
    // 3. Path suffix match (e.g. "sub/ordner/zielnotiz" ends with "/ordner/zielnotiz")
    if (itemNoExt.endsWith(`/${targetNoExt}`) || targetNoExt.endsWith(`/${itemNoExt}`)) return true;

    return false;
  };

  if (allLinks.some(isMatch)) {
    return true;
  }

  // If not found in allLinks, also check note body or raw content
  if (noteContent && typeof noteContent === 'string') {
    const extracted = extractLinksAndEmbeds(noteContent);
    if (extracted.links.some(isMatch)) {
      return true;
    }

    // Direct regex matching for [[Zielnotiz...]] or [text](...Zielnotiz...)
    const escapedBasename = targetBasename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wikiRegex = new RegExp(`\\[\\[(?:[^\\]|#\\n]*[\\/\\\\])?${escapedBasename}(?:#[^\\]|\\n]+)?(?:\\|[^\\]\\n]+)?\\]\\]`, 'i');
    if (wikiRegex.test(noteContent)) return true;

    const mdRegex = new RegExp(`\\]\\((?:[^)\\n]*[\\/\\\\])?${escapedBasename}(?:\\.md)?(?:#[^)\\n]+)?\\)`, 'i');
    if (mdRegex.test(noteContent)) return true;
  }

  return false;
}

/**
 * Converts a note into a unified BaseRecord suitable for querying and rendering.
 */
export function createRecordFromNote(note: NoteData | NoteSummary | any): BaseRecord {
  const filePath = (note.path || '').replace(/^[/\\]+/, '').replace(/\\/g, '/');
  const name = note.name || filePath.split('/').pop() || '';
  const folder = note.folder !== undefined
    ? note.folder
    : filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
  const ext = note.extension || (filePath.includes('.') ? filePath.split('.').pop() || 'md' : 'md');
  const mtime = note.mtime ?? note.updatedAt ?? (note as any).mtimeMs ?? 0;

  // Extract tags: note.tags or note.properties.find(tags)
  const tagsSet = new Set<string>();
  if (Array.isArray(note.tags)) {
    for (const t of note.tags) {
      if (typeof t === 'string' && t.trim()) {
        const clean = t.trim().replace(/^#/, '');
        tagsSet.add(clean.toLowerCase());
      }
    }
  }

  // Properties dictionary
  const properties: Record<string, any> = {};
  if (note.frontmatter && typeof note.frontmatter === 'object') {
    for (const [k, v] of Object.entries(note.frontmatter)) {
      properties[k] = v;
      if (k.toLowerCase() === 'tags') {
        const list = Array.isArray(v) ? v : [v];
        for (const item of list) {
          if (typeof item === 'string' && item.trim()) {
            tagsSet.add(item.trim().replace(/^#/, '').toLowerCase());
          }
        }
      }
    }
  }

  if (note.properties && typeof note.properties === 'object') {
    if (Array.isArray(note.properties)) {
      for (const prop of note.properties) {
        if (prop && prop.key) {
          properties[prop.key] = prop.value;
          if (prop.key.toLowerCase() === 'tags') {
            const list = Array.isArray(prop.value) ? prop.value : [prop.value];
            for (const item of list) {
              if (typeof item === 'string' && item.trim()) {
                tagsSet.add(item.trim().replace(/^#/, '').toLowerCase());
              }
            }
          }
        }
      }
    } else {
      for (const [k, v] of Object.entries(note.properties)) {
        properties[k] = v;
        if (k.toLowerCase() === 'tags') {
          const list = Array.isArray(v) ? v : [v];
          for (const item of list) {
            if (typeof item === 'string' && item.trim()) {
              tagsSet.add(item.trim().replace(/^#/, '').toLowerCase());
            }
          }
        }
      }
    }
  }

  const allTags: string[] = Array.from(tagsSet);
  const allLinks: string[] = Array.isArray(note.links) ? note.links.map(String) : [];

  const fileObj: BaseRecordFile = {
    name,
    path: filePath,
    folder,
    ext,
    mtime,
    inFolder: (targetFolder: string) => {
      const cleanTarget = (targetFolder || '').trim().replace(/^[/\\]+/, '').replace(/[/\\]+$/, '').toLowerCase();
      if (!cleanTarget) return true; // root or any
      const folderLower = folder.toLowerCase();
      return folderLower === cleanTarget || folderLower.startsWith(`${cleanTarget}/`);
    },
    hasTag: (tag: string) => {
      const clean = (tag || '').trim().replace(/^#/, '').toLowerCase();
      return allTags.includes(clean);
    },
    hasLink: (link: string) => {
      const content = (note as any).body || (note as any).rawContent;
      return noteMatchesLinkTarget(link, allLinks, typeof content === 'string' ? content : undefined);
    },
  };

  const record: BaseRecord = {
    file: fileObj,
    tags: allTags,
    links: allLinks,
    properties,
    formulas: {},
  };

  // Expose properties directly on the record for easy formula/expression evaluation
  for (const [k, v] of Object.entries(properties)) {
    if (!(k in record)) {
      record[k] = v;
    }
  }

  return record;
}

/**
 * Normalizes duration string literals in formulas (e.g. "1 day" -> 86400000).
 */
function normalizeDurationLiterals(expr: string): string {
  return expr.replace(/["'](\d+)\s*(day|days|d|hour|hours|h|minute|minutes|min|m|second|seconds|s)["']/gi, (_, num, unit) => {
    const n = Number(num);
    const u = unit.toLowerCase();
    let ms = 1000;
    if (u.startsWith('d')) ms = 24 * 60 * 60 * 1000;
    else if (u.startsWith('h')) ms = 60 * 60 * 1000;
    else if (u.startsWith('m')) ms = 60 * 1000;
    else if (u.startsWith('s')) ms = 1000;
    return String(n * ms);
  });
}

/**
 * Safe, deterministic recursive-descent expression evaluator for Base formulas and filters.
 * Never uses `eval` or `new Function`, preventing arbitrary code execution (XSS) and global scope access.
 */
type Token =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: string }
  | { type: 'punct'; value: string };

const FORBIDDEN_PROPS = new Set(['constructor', '__proto__', 'prototype', 'window', 'document', 'globalThis', 'Function', 'eval']);

function tokenizeExpression(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // String literal
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let str = '';
      while (i < len && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < len) {
          i++;
          str += input[i];
        } else {
          str += input[i];
        }
        i++;
      }
      if (i < len && input[i] === quote) i++;
      tokens.push({ type: 'string', value: str });
      continue;
    }

    // Number literal
    if (/\d/.test(ch) || (ch === '.' && i + 1 < len && /\d/.test(input[i + 1]))) {
      let numStr = '';
      while (i < len && /[\d.]/.test(input[i])) {
        numStr += input[i++];
      }
      tokens.push({ type: 'number', value: Number(numStr) });
      continue;
    }

    // Multi-char operators
    const three = input.slice(i, i + 3);
    if (three === '===' || three === '!==') {
      tokens.push({ type: 'op', value: three });
      i += 3;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '&&' || two === '||') {
      tokens.push({ type: 'op', value: two });
      i += 2;
      continue;
    }

    // Single-char operators
    if ('+-*/%<>!='.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }

    // Punctuation
    if ('().,?:[]'.includes(ch)) {
      tokens.push({ type: 'punct', value: ch });
      i++;
      continue;
    }

    // Identifiers
    if (/[a-zA-Z_$äöüÄÖÜß]/.test(ch)) {
      let ident = '';
      while (i < len && /[a-zA-Z0-9_$äöüÄÖÜß-]/.test(input[i])) {
        ident += input[i++];
      }
      const lower = ident.toLowerCase();
      if (lower === 'and') {
        tokens.push({ type: 'op', value: '&&' });
      } else if (lower === 'or') {
        tokens.push({ type: 'op', value: '||' });
      } else if (lower === 'not') {
        tokens.push({ type: 'op', value: '!' });
      } else {
        tokens.push({ type: 'ident', value: ident });
      }
      continue;
    }

    throw new Error(`Unexpected character: ${ch}`);
  }

  return tokens;
}

function evaluateSafeExpression(expr: string, context: Record<string, any>): any {
  const tokens = tokenizeExpression(expr);
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const consume = (): Token => tokens[pos++];

  const parseTernary = (): any => {
    const cond = parseOr();
    if (peek()?.type === 'punct' && peek()?.value === '?') {
      consume();
      const thenVal = parseTernary();
      if (peek()?.type === 'punct' && peek()?.value === ':') {
        consume();
      }
      const elseVal = parseTernary();
      return cond ? thenVal : elseVal;
    }
    return cond;
  };

  const parseOr = (): any => {
    let left = parseAnd();
    while (peek()?.type === 'op' && peek()?.value === '||') {
      consume();
      const right = parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  };

  const parseAnd = (): any => {
    let left = parseEquality();
    while (peek()?.type === 'op' && peek()?.value === '&&') {
      consume();
      const right = parseEquality();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  };

  const parseEquality = (): any => {
    let left = parseRelational();
    while (peek()?.type === 'op' && ['==', '===', '!=', '!==', '='].includes(String(peek()!.value))) {
      const op = String(consume().value);
      const right = parseRelational();
      if (op === '==' || op === '=' ) {
        left = left == right;
      } else if (op === '===') {
        left = left === right;
      } else if (op === '!=') {
        left = left != right;
      } else {
        left = left !== right;
      }
    }
    return left;
  };

  const parseRelational = (): any => {
    let left = parseAdditive();
    while (peek()?.type === 'op' && ['<', '<=', '>', '>='].includes(String(peek()!.value))) {
      const op = String(consume().value);
      const right = parseAdditive();
      if (op === '<') left = left < right;
      else if (op === '<=') left = left <= right;
      else if (op === '>') left = left > right;
      else if (op === '>=') left = left >= right;
    }
    return left;
  };

  const parseAdditive = (): any => {
    let left = parseMultiplicative();
    while (peek()?.type === 'op' && (peek()!.value === '+' || peek()!.value === '-')) {
      const op = String(consume().value);
      const right = parseMultiplicative();
      if (op === '+') left = left + right;
      else left = Number(left) - Number(right);
    }
    return left;
  };

  const parseMultiplicative = (): any => {
    let left = parseUnary();
    while (peek()?.type === 'op' && ['*', '/', '%'].includes(String(peek()!.value))) {
      const op = String(consume().value);
      const right = parseUnary();
      if (op === '*') left = Number(left) * Number(right);
      else if (op === '/') left = Number(left) / Number(right);
      else left = Number(left) % Number(right);
    }
    return left;
  };

  const parseUnary = (): any => {
    if (peek()?.type === 'op' && ['!', '-', '+'].includes(String(peek()!.value))) {
      const op = String(consume().value);
      const val = parseUnary();
      if (op === '!') return !val;
      if (op === '-') return -Number(val);
      return +Number(val);
    }
    return parseMemberAndCall();
  };

  const parseMemberAndCall = (): any => {
    let obj = parsePrimary();

    while (peek()) {
      if (peek()?.type === 'punct' && peek()?.value === '.') {
        consume();
        const propToken = consume();
        if (!propToken || propToken.type !== 'ident') {
          throw new Error('Expected property identifier after dot');
        }
        const propName = propToken.value;
        if (FORBIDDEN_PROPS.has(propName)) {
          throw new Error(`Forbidden property access: ${propName}`);
        }
        if (obj == null) {
          obj = undefined;
        } else if (peek()?.type === 'punct' && peek()?.value === '(') {
          // Method call on obj
          consume(); // '('
          const args: any[] = [];
          if (!(peek()?.type === 'punct' && peek()?.value === ')')) {
            args.push(parseTernary());
            while (peek()?.type === 'punct' && peek()?.value === ',') {
              consume();
              args.push(parseTernary());
            }
          }
          if (peek()?.type === 'punct' && peek()?.value === ')') consume();
          let fn = obj[propName];
          if (!fn && propName === 'contains' && typeof obj?.includes === 'function') {
            fn = obj.includes;
          }
          if (typeof fn === 'function') {
            obj = fn.apply(obj, args);
          } else {
            obj = undefined;
          }
        } else {
          obj = Object.prototype.hasOwnProperty.call(obj, propName) || propName === 'length'
            ? obj[propName]
            : undefined;
        }
      } else if (peek()?.type === 'punct' && peek()?.value === '(') {
        consume(); // '('
        const args: any[] = [];
        if (!(peek()?.type === 'punct' && peek()?.value === ')')) {
          args.push(parseTernary());
          while (peek()?.type === 'punct' && peek()?.value === ',') {
            consume();
            args.push(parseTernary());
          }
        }
        if (peek()?.type === 'punct' && peek()?.value === ')') consume();
        if (typeof obj === 'function') {
          obj = obj(...args);
        } else {
          throw new Error('Attempted to call non-function');
        }
      } else {
        break;
      }
    }

    return obj;
  };

  const parsePrimary = (): any => {
    const tok = consume();
    if (!tok) throw new Error('Unexpected end of expression');

    if (tok.type === 'number' || tok.type === 'string') {
      return tok.value;
    }

    if (tok.type === 'punct' && tok.value === '(') {
      const val = parseTernary();
      if (peek()?.type === 'punct' && peek()?.value === ')') {
        consume();
      }
      return val;
    }

    if (tok.type === 'ident') {
      if (tok.value === 'true') return true;
      if (tok.value === 'false') return false;
      if (tok.value === 'null') return null;
      if (tok.value === 'undefined') return undefined;
      if (FORBIDDEN_PROPS.has(tok.value)) {
        throw new Error(`Forbidden identifier: ${tok.value}`);
      }
      return Object.prototype.hasOwnProperty.call(context, tok.value) ? context[tok.value] : undefined;
    }

    throw new Error(`Unexpected token: ${tok.value}`);
  };

  const result = parseTernary();
  if (pos < tokens.length) {
    throw new Error('Unexpected trailing tokens');
  }
  return result;
}

/**
 * Evaluates a single formula expression against a record.
 */
export function evaluateFormula(formula: string, record: BaseRecord, formulasSoFar: Record<string, any> = {}): any {
  if (!formula || !formula.trim()) return '';

  const cleanFormula = normalizeDurationLiterals(formula.trim()).replace(/\bif\s*\(/g, '__if(');

  // Sandbox helper functions
  const dateFn = (val: any) => {
    if (!val) return 0;
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'number') return val;
    const parsed = new Date(val).getTime();
    return isNaN(parsed) ? 0 : parsed;
  };

  const todayFn = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  const nowFn = () => Date.now();

  const roundFn = (val: any, decimals = 0) => {
    const num = Number(val);
    if (isNaN(num)) return 0;
    if (decimals <= 0) return Math.round(num);
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
  };

  const context: Record<string, any> = {
    file: record.file,
    date: dateFn,
    today: todayFn,
    now: nowFn,
    __if: (cond: any, thenVal: any, elseVal: any) => (cond ? thenVal : elseVal),
    if: (cond: any, thenVal: any, elseVal: any) => (cond ? thenVal : elseVal),
    round: roundFn,
    floor: Math.floor,
    ceil: Math.ceil,
    abs: Math.abs,
    min: Math.min,
    max: Math.max,
    Math: {
      round: Math.round,
      floor: Math.floor,
      ceil: Math.ceil,
      abs: Math.abs,
      min: Math.min,
      max: Math.max,
    },
    formula: formulasSoFar,
    ...formulasSoFar,
  };

  const noteObj: Record<string, any> = {};
  for (const [k, v] of Object.entries(record.properties)) {
    const rawKey = k.replace(/^note\./, '');
    if (!FORBIDDEN_PROPS.has(rawKey)) {
      noteObj[rawKey] = v;
      context[rawKey] = v;
    }
  }
  context.note = noteObj;

  try {
    const result = evaluateSafeExpression(cleanFormula, context);
    return result !== undefined && result !== null ? result : '';
  } catch {
    return '';
  }
}

/**
 * Evaluates an individual filter string expression against a record.
 */
function evaluateStringExpression(expr: string, record: BaseRecord): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return true;

  // 1. file.inFolder("...") & !file.inFolder("...")
  const notInFolderMatch = trimmed.match(/^!\s*file\.inFolder\(\s*["']([^"']+)["']\s*\)$/i);
  if (notInFolderMatch) {
    return !record.file.inFolder(notInFolderMatch[1]);
  }
  const inFolderMatch = trimmed.match(/^file\.inFolder\(\s*["']([^"']+)["']\s*\)$/i);
  if (inFolderMatch) {
    return record.file.inFolder(inFolderMatch[1]);
  }

  // 2. file.hasTag("...") & !file.hasTag("...")
  const notHasTagMatch = trimmed.match(/^!\s*file\.hasTag\(\s*["']([^"']+)["']\s*\)$/i);
  if (notHasTagMatch) {
    return !record.file.hasTag(notHasTagMatch[1]);
  }
  const hasTagMatch = trimmed.match(/^file\.hasTag\(\s*["']([^"']+)["']\s*\)$/i);
  if (hasTagMatch) {
    return record.file.hasTag(hasTagMatch[1]);
  }

  // 3. file.hasLink("...") & !file.hasLink("...")
  const notHasLinkMatch = trimmed.match(/^!\s*file\.hasLink\(\s*["']([^"']+)["']\s*\)$/i);
  if (notHasLinkMatch) {
    return !record.file.hasLink(notHasLinkMatch[1]);
  }
  const hasLinkMatch = trimmed.match(/^file\.hasLink\(\s*["']([^"']+)["']\s*\)$/i);
  if (hasLinkMatch) {
    return record.file.hasLink(hasLinkMatch[1]);
  }

  // 4. Safe sandboxed comparison / boolean expression
  const noteObj: Record<string, any> = {};
  const validProps: Record<string, any> = {};

  for (const [k, v] of Object.entries(record.properties)) {
    const rawKey = k.replace(/^note\./, '');
    if (!FORBIDDEN_PROPS.has(rawKey)) {
      noteObj[rawKey] = v;
      validProps[rawKey] = v;
    }
  }

  const context: Record<string, any> = {
    file: record.file,
    note: noteObj,
    ...validProps,
    ...record.formulas,
  };

  try {
    return Boolean(evaluateSafeExpression(trimmed, context));
  } catch {
    return false;
  }
}

/**
 * Recursively evaluates a BaseFilterCondition against a record.
 */
export function evaluateCondition(cond: BaseFilterCondition | undefined | null, record: BaseRecord): boolean {
  if (cond === undefined || cond === null) return true;

  // A. Array of conditions (implicit AND)
  if (Array.isArray(cond)) {
    return cond.every((c) => evaluateCondition(c, record));
  }

  // B. String expression
  if (typeof cond === 'string') {
    return evaluateStringExpression(cond, record);
  }

  // C. Object with logical operators
  if (typeof cond === 'object') {
    const obj = cond as Record<string, any>;

    // and
    if ('and' in obj && Array.isArray(obj.and)) {
      return obj.and.every((sub) => evaluateCondition(sub, record));
    }

    // or
    if ('or' in obj && Array.isArray(obj.or)) {
      if (obj.or.length === 0) return true;
      return obj.or.some((sub) => evaluateCondition(sub, record));
    }

    // not
    if ('not' in obj) {
      if (Array.isArray(obj.not)) {
        return !obj.not.every((sub) => evaluateCondition(sub, record));
      }
      return !evaluateCondition(obj.not, record);
    }

    // Key-value exact match: { status: "done", priority: 1 }
    for (const [key, val] of Object.entries(obj)) {
      let actual: any;
      if (key.startsWith('file.')) {
        actual = (record.file as any)[key.replace('file.', '')];
      } else {
        actual = getPropertyValue(record, key);
      }
      if (String(actual).toLowerCase() !== String(val).toLowerCase()) {
        return false;
      }
    }
    return true;
  }

  return true;
}

/**
 * Executes a full Base query against a set of vault notes and returns rendered results.
 */
export function executeBaseQuery(
  definition: BaseDefinition,
  allNotes: (NoteData | NoteSummary | any)[],
  viewIndex = 0,
  currentBasePath?: string
): BaseQueryResult {
  const views = definition.views && definition.views.length > 0
    ? definition.views
    : [{ type: 'table', name: 'Table' }];

  const activeView = views[viewIndex] || views[0];

  // Self-Exclusion and Default Filtering:
  // Check if query filters explicitly mention file.ext
  const filtersString = JSON.stringify(definition.filters || '') + JSON.stringify(activeView.filters || '');
  const explicitlyChecksExt = filtersString.includes('file.ext');

  // Candidate filtering:
  // 1. Strictly exclude .base files and currentBasePath
  // 2. By default, restrict to .md files unless query explicitly checks file.ext
  const candidateNotes = (allNotes || []).filter((n) => {
    const p = n?.path || '';
    if (!p) return false;
    if (p.endsWith('.base')) return false;
    if (currentBasePath && p === currentBasePath) return false;
    if (!explicitlyChecksExt) {
      const ext = n.extension || (p.includes('.') ? p.split('.').pop() : 'md');
      if (ext !== 'md' && !p.endsWith('.md')) return false;
    }
    return true;
  });

  // Strict Path Deduplication
  const seenCandidatePaths = new Set<string>();
  const uniqueCandidateNotes = candidateNotes.filter((n) => {
    const p = n?.path || '';
    if (seenCandidatePaths.has(p)) return false;
    seenCandidatePaths.add(p);
    return true;
  });

  // 1. Convert notes to BaseRecords
  const allRecords = uniqueCandidateNotes.map((n) => createRecordFromNote(n));

  // 2. Evaluate Formulas for each record
  const formulas = definition.formulas || {};
  for (const record of allRecords) {
    const computed: Record<string, any> = {};
    for (const [fName, fExpr] of Object.entries(formulas)) {
      computed[fName] = evaluateFormula(fExpr, record, computed);
    }
    record.formulas = computed;
    // Also expose formula.fName
    for (const [k, v] of Object.entries(computed)) {
      record[`formula.${k}`] = v;
    }
  }

  // 3. Filter Records
  const seenResultPaths = new Set<string>();
  const matchingRecords = allRecords.filter((rec) => {
    // Check global filters
    if (definition.filters && !evaluateCondition(definition.filters, rec)) {
      return false;
    }
    // Check view-specific filters
    if (activeView.filters && !evaluateCondition(activeView.filters, rec)) {
      return false;
    }
    if (seenResultPaths.has(rec.file.path)) return false;
    seenResultPaths.add(rec.file.path);
    return true;
  });

  // 4. Sort Records
  const sortRules = activeView.sort || [];
  if (sortRules.length > 0) {
    matchingRecords.sort((a, b) => {
      for (const rule of sortRules) {
        const prop = rule.property;
        const dir = (rule.direction || 'ASC').toUpperCase() === 'DESC' ? -1 : 1;

        const valA = getPropertyValue(a, prop);
        const valB = getPropertyValue(b, prop);

        if (valA === valB) continue;
        if (valA === undefined || valA === null) return 1 * dir;
        if (valB === undefined || valB === null) return -1 * dir;

        if (typeof valA === 'number' && typeof valB === 'number') {
          return (valA - valB) * dir;
        }

        const cmp = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return cmp * dir;
      }
      return 0;
    });
  }

  // 5. Limit
  const limit = activeView.limit;
  const limitedRecords = limit && limit > 0 ? matchingRecords.slice(0, limit) : matchingRecords;

  // 6. Columns Determination
  let columns: string[] = [];
  if (Array.isArray(activeView.order) && activeView.order.length > 0) {
    columns = [...activeView.order];
  } else {
    // Inferred columns: always start with file.name, then all properties found in records
    const propKeys = new Set<string>();
    for (const rec of limitedRecords) {
      for (const k of Object.keys(rec.properties)) {
        propKeys.add(k);
      }
      for (const f of Object.keys(rec.formulas)) {
        propKeys.add(`formula.${f}`);
      }
    }
    columns = ['file.name', ...Array.from(propKeys)];
  }

  // 7. Column Display Names
  const columnDisplayNames: Record<string, string> = {};
  for (const col of columns) {
    if (definition.properties && definition.properties[col]?.displayName) {
      columnDisplayNames[col] = definition.properties[col].displayName!;
    } else if (col === 'file.name') {
      columnDisplayNames[col] = 'Name';
    } else if (col === 'file.folder') {
      columnDisplayNames[col] = 'Folder';
    } else if (col.startsWith('formula.')) {
      columnDisplayNames[col] = col.replace('formula.', '');
    } else {
      columnDisplayNames[col] = col;
    }
  }

  // 8. Grouping
  const groups: BaseGroup[] = [];
  if (activeView.groupBy && activeView.groupBy.property) {
    const groupProp = activeView.groupBy.property;
    const groupDir = (activeView.groupBy.direction || 'ASC').toUpperCase() === 'DESC' ? -1 : 1;

    const groupMap = new Map<string, BaseRecord[]>();
    for (const rec of limitedRecords) {
      const gVal = String(getPropertyValue(rec, groupProp) ?? 'Ungrouped');
      if (!groupMap.has(gVal)) {
        groupMap.set(gVal, []);
      }
      groupMap.get(gVal)!.push(rec);
    }

    const sortedGroupKeys = Array.from(groupMap.keys()).sort((a, b) => {
      return a.localeCompare(b, undefined, { numeric: true }) * groupDir;
    });

    for (const k of sortedGroupKeys) {
      groups.push({
        key: k,
        label: k,
        records: groupMap.get(k) || [],
      });
    }
  } else {
    // Single default group
    groups.push({
      key: 'all',
      label: 'All Notes',
      records: limitedRecords,
    });
  }

  return {
    definition,
    view: activeView,
    columns,
    columnDisplayNames,
    records: limitedRecords,
    groups,
    totalCount: matchingRecords.length,
  };
}

/**
 * Resolves a property value from a BaseRecord (supports file.name, formula.x, or regular properties).
 */
export function getPropertyValue(record: BaseRecord, propertyKey: string): any {
  if (propertyKey === 'file.name') return record.file.name;
  if (propertyKey === 'file.folder') return record.file.folder;
  if (propertyKey === 'file.path') return record.file.path;
  if (propertyKey === 'file.ext') return record.file.ext;
  if (propertyKey === 'file.mtime') return record.file.mtime;

  if (propertyKey.startsWith('formula.')) {
    const fKey = propertyKey.replace('formula.', '');
    return record.formulas[fKey] ?? record[propertyKey];
  }

  if (propertyKey.startsWith('note.')) {
    const nKey = propertyKey.replace('note.', '');
    return record.properties[nKey] ?? record.properties[propertyKey] ?? record[nKey] ?? record[propertyKey];
  }

  if (propertyKey in record.properties) {
    return record.properties[propertyKey];
  }

  // Flexible property access fallback (e.g. resolve both IP and note.IP)
  if (`note.${propertyKey}` in record.properties) {
    return record.properties[`note.${propertyKey}`];
  }

  return record[propertyKey];
}
