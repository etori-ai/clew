import { describe, expect, test } from 'bun:test';

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
(globalThis as unknown as { sessionStorage: FakeStorage }).sessionStorage = storage;
const { forgetShown, readShown, rememberShown } = await import('../src/conversation-shown');

/**
 * What a conversation showed is kept in the tab for its menu, a view's input with it, which can name a person or hold
 * what they searched for (L4 of the web review of 2026-11-23): the session's end takes all of it and nothing else.
 */
describe('the end of the session takes what every conversation showed', () => {
  test('every conversation’s things go, and what else the tab keeps stays', () => {
    storage.items.clear();
    rememberShown('c1', '?card=ledighet');
    rememberShown('c2', '?open=phonebook.directory&open-title=Telefonbok&open-input=%7B%22query%22%3A%22Anna%22%7D');
    storage.setItem('clew:review-draft:x', 'kept by its own rule');
    expect(readShown('c1').items).toEqual(['ledighet']);
    expect(readShown('c2').views).toHaveLength(1);
    forgetShown();
    expect(readShown('c1')).toEqual({ items: [], views: [] });
    expect(readShown('c2')).toEqual({ items: [], views: [] });
    expect([...storage.items.keys()]).toEqual(['clew:review-draft:x']);
  });
  test('a browser that refuses storage kept nothing, and nothing fails', () => {
    storage.refuse = true;
    expect(() => forgetShown()).not.toThrow();
    storage.refuse = false;
  });
});
