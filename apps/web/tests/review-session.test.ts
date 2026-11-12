import { beforeEach, describe, expect, test } from 'bun:test';
import type { ReviewEvidence, Thread } from '@clew/contracts';

/** The tab's session storage as a browser keeps it, or one that refuses every access. */
class FakeStorage {
  items = new Map<string, string>();
  refuse = false;
  private check() {
    if (this.refuse) throw new Error('SecurityError');
  }
  get length() {
    this.check();
    return this.items.size;
  }
  key(i: number) {
    this.check();
    return [...this.items.keys()][i] ?? null;
  }
  getItem(k: string) {
    this.check();
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.check();
    this.items.set(k, v);
  }
  removeItem(k: string) {
    this.check();
    this.items.delete(k);
  }
}
const storage = new FakeStorage();
(globalThis as unknown as { window: { sessionStorage: FakeStorage } }).window = { sessionStorage: storage };

const {
  EMPTY_DRAFT,
  approvedOf,
  begun,
  clearDraft,
  clearDrafts,
  draftText,
  leftOf,
  nextStep,
  parseDraft,
  reviewRows,
  reviewVersion,
  sameVersions,
  saveDraft,
  seenOf,
  selectionAfterReview,
  withDecision,
  withoutDecision,
} = await import('../src/review-session');

type Item = Thread['items'][number];
const row = (ref: string, extra: Partial<Item> = {}): Item => ({
  ref,
  label: `Faktura ${ref}`,
  detail: '1 000 kr',
  selectable: true,
  selected: false,
  ...extra,
});
const items = [row('a', { revision: 'r1' }), row('b'), row('c'), { ...row('note'), selectable: false }];
const evidence = (ref: string, revision = 'r1', doc = 'd1'): ReviewEvidence => ({
  ref,
  revision,
  documents: [{ id: 'invoice', revision: doc }],
  expiresAt: '2026-11-12T10:00:00.000Z',
  proof: 'a'.repeat(64),
});

describe('a review in progress is the person’s draft, per work item (the review a page since 2026-11-12)', () => {
  test('it decides on the selectable rows, in the item’s order', () => {
    expect(reviewRows({ items }).map(i => i.ref)).toEqual(['a', 'b', 'c']);
  });
  test('its version is the rows as the person saw them: a row added, removed or read again with another revision, label or detail is another version; anything else of the item is not', () => {
    const version = reviewVersion({ items });
    expect(version).toMatch(/^[0-9a-f]{8}$/);
    expect(reviewVersion({ items: [...items] })).toBe(version);
    expect(reviewVersion({ items: items.map(i => (i.ref === 'note' ? { ...i, label: 'x' } : i)) })).toBe(version);
    expect(reviewVersion({ items: items.map(i => ({ ...i, selected: !i.selected })) })).toBe(version);
    expect(reviewVersion({ items: items.slice(1) })).not.toBe(version);
    expect(reviewVersion({ items: [...items, row('d')] })).not.toBe(version);
    expect(reviewVersion({ items: items.map(i => (i.ref === 'a' ? { ...i, revision: 'r2' } : i)) })).not.toBe(version);
    expect(reviewVersion({ items: items.map(i => (i.ref === 'b' ? { ...i, detail: '2 000 kr' } : i)) })).not.toBe(
      version,
    );
  });
  test('a decision is taken, changed and taken back; an approval on a versioned document keeps the versions, not the proof', () => {
    let draft = withDecision(EMPTY_DRAFT, 'a', 'approve', seenOf(evidence('a')));
    draft = withDecision(draft, 'b', 'leave');
    expect(draft.decisions).toEqual({ a: 'approve', b: 'leave' });
    expect(draft.seen).toEqual({ a: { revision: 'r1', documents: [{ id: 'invoice', revision: 'd1' }] } });
    expect(JSON.stringify(draft)).not.toContain('proof');
    expect(JSON.stringify(draft)).not.toContain('expiresAt');
    expect(approvedOf(draft, reviewRows({ items }))).toEqual(['a']);
    expect(leftOf(draft, reviewRows({ items }))).toEqual(['b']);
    // Changed: an approval left behind loses its versions.
    draft = withDecision(draft, 'a', 'leave');
    expect(draft.seen).toEqual({});
    draft = withDecision(draft, 'a', 'approve');
    expect(draft.decisions.a).toBe('approve');
    draft = withoutDecision(draft, 'a');
    expect(draft.decisions).toEqual({ b: 'leave' });
    expect(begun(draft)).toBe(true);
    expect(begun(withoutDecision(draft, 'b'))).toBe(false);
  });
  test('a review that is begun goes on at the first row not yet judged, else at Skicka', () => {
    const rows = reviewRows({ items });
    expect(nextStep(EMPTY_DRAFT, rows)).toBe(0);
    expect(nextStep(withDecision(EMPTY_DRAFT, 'a', 'leave'), rows)).toBe(1);
    expect(nextStep(withDecision(EMPTY_DRAFT, 'b', 'leave'), rows)).toBe(0);
    let all = EMPTY_DRAFT;
    for (const r of rows) all = withDecision(all, r.ref, 'approve');
    expect(nextStep(all, rows)).toBe(3);
  });
  test('a kept draft is read for the rows the item has now, and only for the version it was taken on', () => {
    const version = reviewVersion({ items });
    const draft = withDecision(withDecision(EMPTY_DRAFT, 'a', 'approve', seenOf(evidence('a'))), 'gone', 'leave');
    const text = draftText(version, draft);
    expect(parseDraft(text, version, ['a', 'b', 'c'])).toEqual({
      decisions: { a: 'approve' },
      seen: { a: { revision: 'r1', documents: [{ id: 'invoice', revision: 'd1' }] } },
    });
    expect(parseDraft(text, 'another', ['a', 'b', 'c'])).toEqual(EMPTY_DRAFT);
    expect(parseDraft(null, version, ['a'])).toEqual(EMPTY_DRAFT);
    expect(parseDraft('not json', version, ['a'])).toEqual(EMPTY_DRAFT);
    expect(parseDraft(JSON.stringify({ version, decisions: { a: 'maybe' } }), version, ['a'])).toEqual(EMPTY_DRAFT);
    expect(
      parseDraft(
        JSON.stringify({ version, decisions: { a: 'leave' }, seen: { a: { revision: 'r1', documents: [] } } }),
        version,
        ['a'],
      ),
    ).toEqual({ decisions: { a: 'leave' }, seen: {} });
  });
  test('a fresh read is the approved version only when the record and every document are the same (D79)', () => {
    const seen = seenOf(evidence('a'));
    expect(sameVersions(seen, { ...evidence('a'), proof: 'b'.repeat(64), expiresAt: '2026-11-12T12:00:00.000Z' })).toBe(
      true,
    );
    expect(sameVersions(seen, evidence('a', 'r2'))).toBe(false);
    expect(sameVersions(seen, evidence('a', 'r1', 'd2'))).toBe(false);
    expect(
      sameVersions(seen, {
        ...evidence('a'),
        documents: [...evidence('a').documents, { id: 'appendix', revision: '1' }],
      }),
    ).toBe(false);
  });
  test('the item’s selection takes the review over the source’s marks, and a row not judged keeps its tick', () => {
    const marked = ['a', 'b'];
    expect(selectionAfterReview(marked, { approved: [], left: [] })).toEqual(marked);
    expect(selectionAfterReview(marked, { approved: ['c'], left: ['a'] })).toEqual(['b', 'c']);
    expect(selectionAfterReview(marked, { approved: ['b'], left: [] })).toEqual(['a', 'b']);
  });
});

describe('the draft is kept for the session, in the tab, and goes when it has done its work', () => {
  const version = reviewVersion({ items });
  beforeEach(() => {
    storage.refuse = false;
    clearDrafts();
  });
  test('kept in session storage under the item, so a reload finds it; Skicka clears it', () => {
    saveDraft('fakturor', version, withDecision(EMPTY_DRAFT, 'a', 'approve'));
    expect(parseDraft(storage.getItem('clew.review.fakturor'), version, ['a'])).toEqual({
      decisions: { a: 'approve' },
      seen: {},
    });
    clearDraft('fakturor');
    expect(storage.getItem('clew.review.fakturor')).toBeNull();
  });
  test('an empty draft is no draft', () => {
    saveDraft('fakturor', version, withDecision(EMPTY_DRAFT, 'a', 'approve'));
    saveDraft('fakturor', version, withoutDecision(withDecision(EMPTY_DRAFT, 'a', 'approve'), 'a'));
    expect(storage.getItem('clew.review.fakturor')).toBeNull();
  });
  test('the end of the session takes every draft, and nothing else in the tab', () => {
    storage.setItem('something-else', 'kept');
    saveDraft('one', version, withDecision(EMPTY_DRAFT, 'a', 'leave'));
    saveDraft('two', version, withDecision(EMPTY_DRAFT, 'b', 'leave'));
    clearDrafts();
    expect([...storage.items.keys()]).toEqual(['something-else']);
  });
  test('a browser that refuses storage keeps the draft in memory while the tab lives, and nothing throws', () => {
    storage.refuse = true;
    expect(() => saveDraft('fakturor', version, withDecision(EMPTY_DRAFT, 'c', 'leave'))).not.toThrow();
    expect(() => clearDrafts()).not.toThrow();
    expect(() => clearDraft('fakturor')).not.toThrow();
  });
});
