import { CalendarError } from './model';

/** A response body as text, refused past `max` bytes so a calendar source cannot fill the server's memory. */
export async function readLimited(response: Response, max: number) {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let raw = '',
    count = 0;
  if (reader)
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      count += part.value.byteLength;
      if (count > max) {
        await reader.cancel();
        throw new CalendarError('För många kalenderuppgifter. Välj en kortare period.');
      }
      raw += decoder.decode(part.value, { stream: true });
    }
  return raw + decoder.decode();
}
