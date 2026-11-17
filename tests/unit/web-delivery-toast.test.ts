import { describe, expect, test } from 'bun:test';
import { deliveryToast, withArrivals, type Arrival } from '../../apps/web/src/delivery-toast';

const task = (threadId: string): Arrival => ({ threadId, title: 'Attestera ' + threadId, kind: 'automatic' });
const reminder = (threadId: string): Arrival => ({ threadId, title: 'Ledighet ' + threadId, kind: 'reminder' });

describe('the one toast that says what arrived', () => {
  test('one work item: its "Visa" leads to that item', () => {
    expect(deliveryToast([task('a')])).toEqual({ body: 'Nya uppgifter finns i Att göra.', threadId: 'a' });
    expect(deliveryToast([reminder('b')])).toEqual({ body: 'Påminnelse: Ledighet b', threadId: 'b' });
  });

  test('several: one sentence, and "Visa" leads to Att göra', () => {
    expect(deliveryToast([task('a'), task('b'), task('c'), task('d'), task('e')])).toEqual({
      body: 'Nya uppgifter finns i Att göra.',
      threadId: null,
    });
    expect(deliveryToast([reminder('a'), reminder('b')])).toEqual({
      body: '2 påminnelser finns i Att göra.',
      threadId: null,
    });
    expect(deliveryToast([reminder('a'), task('b')])).toEqual({
      body: 'Påminnelser och nya uppgifter finns i Att göra.',
      threadId: null,
    });
  });

  test('a work item that arrives again while the toast is drawn is counted once, as it last arrived', () => {
    const waiting = withArrivals([task('a')], [reminder('a')]);
    expect(waiting).toEqual([reminder('a')]);
    expect(deliveryToast(waiting).threadId).toBe('a');
    expect(withArrivals(waiting, [task('b')])).toHaveLength(2);
  });
});
