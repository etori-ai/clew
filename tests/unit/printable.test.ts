import { describe, expect, test } from 'bun:test';
import { printable } from '../../scripts/printable';

/**
 * What a script prints of a stored value (`scripts/competence-read-log.ts`, D121 item 5): every field one field of one
 * line. A value that holds a tab, a line break, a terminal's escape or a character that reorders or hides text is
 * printed as an escape, so it can never forge a line, erase one or move the cursor.
 */
describe('a printed field', () => {
  test('a plain value is printed as it is', () => {
    expect(printable('competence-type-1')).toBe('competence-type-1');
    expect(printable('Bergsåkers skola')).toBe('Bergsåkers skola');
    expect(printable(3)).toBe('3');
    expect(printable(null)).toBe('');
  });
  test('a tab, a line break and a carriage return cannot start a field or a line of their own', () => {
    const forged = 'u1\n2026-11-10T08:00:00.000Z\tpoc\tperson:x\tregistrar\tsearch\ttype:y\t\t\t0';
    const out = printable(forged);
    expect(out).not.toMatch(/[\t\n\r]/);
    expect(out).toBe('u1\\n2026-11-10T08:00:00.000Z\\tpoc\\tperson:x\\tregistrar\\tsearch\\ttype:y\\t\\t\\t0');
    expect(printable('a\rb')).toBe('a\\rb');
  });
  test('a terminal’s escapes, other control codes and DEL are escaped, and so is a backslash, so nothing is ambiguous', () => {
    expect(printable('\u001b[2K\u001b[1A')).toBe('\\u001b[2K\\u001b[1A');
    expect(printable('\u0000\u0007\u007f\u009b')).toBe('\\u0000\\u0007\\u007f\\u009b');
    expect(printable('a\\nb')).toBe('a\\\\nb');
  });
  test('a character that reorders or hides text is escaped: bidirectional controls, zero width, separators', () => {
    expect(printable('a‮b⁦c​d e﻿f')).toBe('a\\u202eb\\u2066c\\u200bd\\u2028e\\ufefff');
  });
});
