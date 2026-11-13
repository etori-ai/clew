import { describe, expect, test } from 'bun:test';
import { ApiError } from '../../apps/web/src/api-error';
import { errorMessage, noCalendar, refused, retryPolicy } from '../../apps/web/src/query-policy';
import { executionStatus } from '../../apps/web/src/execution-status';

describe('the browser cache policy (D33)', () => {
  test('a 5xx is retried once, a 4xx never', () => {
    expect(retryPolicy(0, new ApiError(503, 'Tjänsten går inte att nå just nu.'))).toBe(true);
    expect(retryPolicy(1, new ApiError(503, 'Tjänsten går inte att nå just nu.'))).toBe(false);
    expect(retryPolicy(0, new ApiError(400, 'Fel indata.'))).toBe(false);
    expect(retryPolicy(0, new ApiError(401, 'Din inloggning har gått ut. Logga in igen.'))).toBe(false);
    expect(retryPolicy(0, new ApiError(403, 'Du saknar behörighet för åtgärden.'))).toBe(false);
  });
  test('the session ending is never retried', () => {
    expect(retryPolicy(0, new DOMException('Aborted', 'AbortError'))).toBe(false);
    expect(retryPolicy(0, new Error('Session unavailable'))).toBe(false);
    expect(retryPolicy(0, undefined)).toBe(false);
  });
  test("a capability read that is not the person's is refused: a hidden or unknown one is a 404 (D23), the scope a 400 with its sentence", () => {
    expect(refused(new ApiError(404, 'Okänd förmåga.'))).toBe(true);
    expect(refused(new ApiError(403, 'Du saknar behörighet för åtgärden.'))).toBe(true);
    expect(refused(new ApiError(400, 'Du saknar behörighet för åtgärden.'))).toBe(true);
    expect(refused(new ApiError(400, 'Inget system för utvecklingssamtal är anslutet just nu.'))).toBe(true);
    // Any other 400 is a failure the person is told about: a source that did not answer, and "Okänd förmåga." as a
    // 400, which the capability route never gives.
    expect(refused(new ApiError(400, 'Kalendern svarar inte just nu.'))).toBe(false);
    expect(refused(new ApiError(400, 'Okänd förmåga.'))).toBe(false);
    expect(refused(new ApiError(503, 'Tjänsten går inte att nå just nu.'))).toBe(false);
    expect(refused(new Error('boom'))).toBe(false);
  });
  test('the person reads the server message when there is one, the fallback otherwise', () => {
    expect(errorMessage(new ApiError(400, 'Veckan är redan planerad.'), 'Något gick fel.')).toBe(
      'Veckan är redan planerad.',
    );
    expect(errorMessage(new Error('boom'), 'Något gick fel.')).toBe('Något gick fel.');
    expect(errorMessage('boom', 'Sidan kunde inte läsas.')).toBe('Sidan kunde inte läsas.');
  });
  test('a person with no calendar is told so; a calendar that does not answer is not mistaken for none (D116, amended 2026-11-12)', () => {
    expect(noCalendar(new ApiError(404, 'Okänd förmåga.'))).toBe('hidden');
    expect(noCalendar(new ApiError(400, 'Ditt konto har ingen kalender kopplad.'))).toBe('unbound');
    expect(noCalendar(new ApiError(400, 'Kalenderkontot är inte tillgängligt.'))).toBeNull();
    expect(noCalendar(new ApiError(503, 'Något gick fel. Försök igen.'))).toBeNull();
    expect(noCalendar(new Error('Session unavailable'))).toBeNull();
  });
});

describe('a decision on its way while its system does not answer (D45, D47; D116, amended 2026-11-12)', () => {
  const execution = (state: 'pending' | 'running' | 'succeeded', extra = {}) => ({
    id: 'e1',
    decisionId: 'd1',
    operation: 'hr.bookTalk',
    state,
    reason: null,
    compensates: null,
    ...extra,
  });
  test('says that it is queued and read back', () => {
    const queued = 'Ditt beslut är sparat. Det du skickar köas och läses tillbaka när systemet svarar.';
    expect(executionStatus(execution('pending'), true)).toBe(queued);
    expect(executionStatus(execution('running'), true)).toBe(queued);
    expect(executionStatus(execution('pending'))).toBe('Ditt beslut är sparat och väntar på källan.');
  });
  test('keeps its own words for an undo, a reason and an answered decision', () => {
    expect(executionStatus(execution('pending', { compensates: 'e0' }), true)).toBe(
      'Din begäran att ångra är sparad och väntar på källan.',
    );
    expect(executionStatus(execution('pending', { reason: 'needs-session' }), true)).toBe(
      'Källan kräver en aktiv inloggning. Åtgärden väntar.',
    );
    expect(executionStatus(execution('succeeded'), true)).toBeNull();
  });
});
