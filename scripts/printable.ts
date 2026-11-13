/**
 * A value as one field of one line of a script's output: a control character (a tab, a line break, the escape that
 * starts a terminal's sequences, any C0 or C1 code, DEL), a backslash, and a character that reorders or hides text (the
 * bidirectional controls and isolates, zero-width characters, the line and paragraph separators, the byte order mark)
 * written as an escape, so it is seen and does nothing: no value can start a line of its own, hide one or move the
 * terminal's cursor.
 */
export function printable(value: unknown): string {
  return String(value ?? '').replace(
    /[\u0000-\u001f\u007f-\u009f\\\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g,
    c =>
      c === '\\'
        ? '\\\\'
        : c === '\t'
          ? '\\t'
          : c === '\n'
            ? '\\n'
            : c === '\r'
              ? '\\r'
              : '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}
