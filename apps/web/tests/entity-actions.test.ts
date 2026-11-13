import { describe, expect, test } from 'bun:test';
import type { AskValues } from '@clew/contracts';
import { askDraftKey, withPreset } from '../src/entity-actions';

/**
 * What a propose's dialog opens on when it is started about an entity (D112 item 10), with answers to start from or
 * without (a plan's row tied to the action, D124): the draft `useEntityAction` keeps per start while the page stays.
 */
describe('the answers a propose’s dialog opens on', () => {
  const book = { capability: 'clew.bookTalk' };
  const anna = { key: 'anna', name: 'Anna Lindqvist' };
  /** The propose branch as the hook runs it: the draft's key for this start, its preset filled in where nothing was typed. */
  const open = (drafts: Readonly<Record<string, AskValues>>, preset?: AskValues) => {
    const key = askDraftKey(book, anna, preset);
    const next = withPreset(drafts, key, preset);
    return { key, drafts: next, values: next[key] ?? {} };
  };

  test('two rows tying the same action with different answers each open on their own, after one was closed', () => {
    const a = open({}, { kind: 'a' });
    expect(a.values).toEqual({ kind: 'a' });
    // Esc keeps the draft; the other row's dialog opens on its own answers, not the first row's.
    const b = open(a.drafts, { kind: 'b' });
    expect(b.values).toEqual({ kind: 'b' });
    expect(b.key).not.toBe(a.key);
    // Back on the first row, it opens on its own answers again.
    expect(open(b.drafts, { kind: 'a' }).values).toEqual({ kind: 'a' });
  });

  test('what the person typed from a start is kept for that start and no other', () => {
    const a = open({}, { kind: 'a' });
    const typed = { ...a.drafts, [a.key]: { kind: 'a', note: 'Före lunch' } };
    expect(open(typed, { kind: 'a' }).values).toEqual({ kind: 'a', note: 'Före lunch' });
    expect(open(typed, { kind: 'b' }).values).toEqual({ kind: 'b' });
    expect(open(typed).values).toEqual({});
  });

  test('a start without answers is keyed as it always was, and the order of the answers does not matter', () => {
    expect(askDraftKey(book, anna)).toBe('person:anna:clew.bookTalk');
    expect(askDraftKey(book, anna, {})).toBe('person:anna:clew.bookTalk');
    expect(askDraftKey(book, { kind: 'unit', key: 'u1', name: 'Skolan' })).toBe('unit:u1:clew.bookTalk');
    expect(askDraftKey(book, anna, { a: '1', b: '2' })).toBe(askDraftKey(book, anna, { b: '2', a: '1' }));
    // Without answers, what was typed is kept across closing and opening, as on a person's page.
    const typed = { 'person:anna:clew.bookTalk': { note: 'x' } };
    expect(open(typed).values).toEqual({ note: 'x' });
    expect(withPreset(typed, 'person:anna:clew.bookTalk', undefined)).toBe(typed);
  });
});
