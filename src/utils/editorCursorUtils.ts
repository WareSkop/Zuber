/**
 * Computes the smart cursor position (and optional trailing newline insertion)
 * below an H1 heading (`^#\s+.*`) when entering Edit Mode on mobile or
 * opening a newly created note.
 */
export function computeBodyCursorAfterHeading(docText: string): {
  pos: number;
  insertText?: string;
  insertFrom?: number;
} {
  if (!/^#\s+[^\r\n]*/.test(docText)) {
    return { pos: 0 };
  }

  const firstNewlineIdx = docText.indexOf('\n');
  if (firstNewlineIdx === -1) {
    // Only "# Heading" line exists — append "\n\n" so cursor lands in body
    return {
      pos: docText.length + 2,
      insertFrom: docText.length,
      insertText: '\n\n',
    };
  }

  const afterFirstLine = docText.slice(firstNewlineIdx + 1);
  if (afterFirstLine.trim().length === 0) {
    // Empty body after "# Heading\n..."
    if (afterFirstLine.length === 0) {
      return {
        pos: docText.length + 1,
        insertFrom: docText.length,
        insertText: '\n',
      };
    }
    return { pos: firstNewlineIdx + 2 };
  }

  // Starts with "# Heading" and already has body content; place cursor at start of first content line
  const leadingBlanks = afterFirstLine.match(/^(?:\r?\n)*/);
  const offset = leadingBlanks ? leadingBlanks[0].length : 0;
  return { pos: firstNewlineIdx + 1 + offset };
}
