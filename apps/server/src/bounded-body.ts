/**
 * A body another party sends, read no further than its limit: a request's, as far as a route allows, or an answer's,
 * as far as its reader allows. Every body the server reads is read here, so none holds more of what another party sends
 * than its limit: a declared length above the limit is refused before anything is read, and a body sent in pieces,
 * which declares none, is read a piece at a time and given up as soon as it passes the limit. Reading it whole and
 * measuring it afterwards let one request fill the server's memory (ID-8, CB-6). `tests/unit/bounded-body.test.ts`
 * fails on a body read anywhere else in `apps/server/src`.
 */
/** What has a body: a `Request` or a `Response`. */
type Bodied = Pick<Request, 'headers' | 'body'>;

/** A character of a body is at most three bytes in UTF-8 (one outside the first plane is two characters of four). */
export const BYTES_PER_CHARACTER = 3;

/** The body's text, or `undefined` when it is longer than `bound` bytes. A request without a body is the empty text. */
export async function boundedText(request: Bodied, bound: number): Promise<string | undefined> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d{1,15}$/.test(declared) || Number(declared) > bound)) return undefined;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const pieces: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > bound) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    pieces.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const piece of pieces) {
    bytes.set(piece, at);
    at += piece.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * The body's text when it is at most `max` characters, else `undefined`. Read no further than `max` characters can take
 * in UTF-8, so a limit a route states in characters keeps meaning what it did.
 */
export async function textOfAtMost(request: Bodied, max: number): Promise<string | undefined> {
  const text = await boundedText(request, max * BYTES_PER_CHARACTER);
  return text === undefined || text.length > max ? undefined : text;
}
