import { describe, expect, test } from 'bun:test';
import { ApiError } from '../../apps/web/src/api-error';
import { errorMessage, retryPolicy } from '../../apps/web/src/query-policy';

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
  test('the person reads the server message when there is one, the fallback otherwise', () => {
    expect(errorMessage(new ApiError(400, 'Veckan är redan planerad.'), 'Något gick fel.')).toBe(
      'Veckan är redan planerad.',
    );
    expect(errorMessage(new Error('boom'), 'Något gick fel.')).toBe('Något gick fel.');
    expect(errorMessage('boom', 'Sidan kunde inte läsas.')).toBe('Sidan kunde inte läsas.');
  });
});
