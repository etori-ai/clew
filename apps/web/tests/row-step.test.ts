import { describe, expect, test } from 'bun:test';
import type { Thread, ThreadAction } from '@clew/contracts';
import { rowStep } from '../src/row-step';
import { EMPTY_DRAFT } from '../src/review-session';

const item = (ref: string) => ({ ref, label: ref, selectable: true });
const thread = (over: Record<string, unknown>) =>
  ({ id: 't', state: 'open', items: [], actions: [], ...over }) as unknown as Thread;
const review = {
  id: 'attest',
  label: 'Attestera valda',
  kind: 'execute',
  role: 'primary',
  usesItems: true,
  review: 'each',
} as unknown as ThreadAction;
const approve = { id: 'approve', label: 'Godkänn', kind: 'execute', role: 'primary' } as unknown as ThreadAction;

describe('the button on a row names the next press (D142)', () => {
  test('an item reviewed one row at a time says Granska N, and Fortsätt granska at the next row once begun', () => {
    const t = thread({ actions: [review], items: [item('a'), item('b'), item('c')] });
    expect(rowStep(t, true, EMPTY_DRAFT)).toEqual({ kind: 'review', label: 'Granska 3' });
    expect(rowStep(t, true, { decisions: { a: 'approve' }, seen: {} })).toEqual({
      kind: 'review',
      label: 'Fortsätt granska',
      step: 1,
    });
  });
  test('rows the source refused are named, one or several; a decision on its way is opened', () => {
    const rows = (outcomes: string[]) => outcomes.map((outcome, i) => ({ ref: String(i), outcome }));
    const sent = { actions: [review], items: [item('a'), item('b'), item('c')] };
    expect(
      rowStep(
        thread({ ...sent, execution: { state: 'partial' }, receipt: { rows: rows(['done', 'done', 'failed']) } }),
        false,
        EMPTY_DRAFT,
      ),
    ).toEqual({ kind: 'review', label: 'Granska 1 avvisad' });
    expect(
      rowStep(
        thread({ ...sent, execution: { state: 'failed' }, receipt: { rows: rows(['failed', 'failed']) } }),
        false,
        EMPTY_DRAFT,
      ),
    ).toEqual({ kind: 'review', label: 'Granska 2 avvisade' });
    expect(rowStep(thread({ ...sent, execution: { state: 'running' } }), false, EMPTY_DRAFT)).toEqual({ kind: 'open' });
  });
  test('one press with nothing to read runs from the row; anything asked, said beforehand or chosen is opened', () => {
    expect(rowStep(thread({ actions: [approve] }), true, EMPTY_DRAFT)).toEqual({ kind: 'press', action: approve });
    expect(rowStep(thread({ actions: [approve] }), false, EMPTY_DRAFT)).toEqual({ kind: 'open' });
    const asks = { ...approve, path: { asks: [], effect: 'Ledigheten beviljas.' } };
    expect(rowStep(thread({ actions: [asks] }), true, EMPTY_DRAFT)).toEqual({ kind: 'open' });
    expect(rowStep(thread({ actions: [{ ...approve, usesItems: true }] }), true, EMPTY_DRAFT)).toEqual({
      kind: 'open',
    });
    expect(rowStep(thread({ actions: [{ ...approve, kind: 'read' }] }), true, EMPTY_DRAFT)).toEqual({ kind: 'open' });
    expect(rowStep(thread({ actions: [] }), true, EMPTY_DRAFT)).toEqual({ kind: 'open' });
  });
});
