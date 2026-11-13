import { describe, expect, test } from 'bun:test';
import { ApiError } from '../../apps/web/src/api-error';
import { errorMessage, refused, retryPolicy } from '../../apps/web/src/query-policy';

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
});
