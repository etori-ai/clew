/** Reject unsupported/encrypted ZIPs and large expansion before handing Office files to a renderer. */
export function checkOfficeArchive(bytes: ArrayBuffer, maxBytes = 8 * 1024 * 1024) {
  if (bytes.byteLength > maxBytes) throw new Error('Dokumentet är för stort för förhandsvisning. Hämta originalet.');
  const view = new DataView(bytes);
  let end = bytes.byteLength - 22;
  for (; end >= Math.max(0, bytes.byteLength - 65557); end--) if (view.getUint32(end, true) === 0x06054b50) break;
  if (end < Math.max(0, bytes.byteLength - 65557) || view.getUint32(end, true) !== 0x06054b50)
    throw new Error('Dokumentet är inte en giltig Office-fil.');
  const entries = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true),
    expanded = 0;
  if (entries > 1000 || entries === 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true))
    throw new Error('Dokumentets arkiv stöds inte.');
  for (let i = 0; i < entries; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) throw new Error('Dokumentets arkiv är skadat.');
    const flags = view.getUint16(at + 8, true),
      method = view.getUint16(at + 10, true);
    const packed = view.getUint32(at + 20, true),
      size = view.getUint32(at + 24, true);
    expanded += size;
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      size > 16 * 1024 * 1024 ||
      expanded > 40 * 1024 * 1024 ||
      size > Math.max(1, packed) * 200
    )
      throw new Error('Dokumentet är krypterat eller för stort för förhandsvisning. Hämta originalet.');
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  if (at > end) throw new Error('Dokumentets arkiv är skadat.');
}

export const columnName = (index: number): string =>
  index < 26
    ? String.fromCharCode(65 + index)
    : columnName(Math.floor(index / 26) - 1) + String.fromCharCode(65 + (index % 26));

/** Bound actual expansion too: directory sizes alone are untrusted. Reject sparse-sheet allocation bombs before parsing. */
export async function checkOfficeContent(bytes: ArrayBuffer) {
  checkOfficeArchive(bytes);
  const v = new DataView(bytes);
  let end = bytes.byteLength - 22;
  while (v.getUint32(end, true) !== 0x06054b50) end--;
  let at = v.getUint32(end + 16, true),
    totalCells = 0;
  const names = new Set<string>();
  for (let i = 0; i < v.getUint16(end + 10, true); i++) {
    const nameLength = v.getUint16(at + 28, true),
      name = new TextDecoder().decode(bytes.slice(at + 46, at + 46 + nameLength));
    const size = v.getUint32(at + 24, true),
      packed = v.getUint32(at + 20, true),
      method = v.getUint16(at + 10, true),
      local = v.getUint32(at + 42, true);
    if (names.has(name) || local + 30 > at || v.getUint32(local, true) !== 0x04034b50)
      throw new Error('Dokumentets arkiv är skadat.');
    names.add(name);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    if (start + packed > at) throw new Error('Dokumentets arkiv är skadat.');
    const sheet = /^xl\/worksheets\/[^/]+\.xml$/i.test(name);
    let stream = new Blob([bytes.slice(start, start + packed)]).stream();
    if (method === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader(),
      chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > size) throw new Error('Dokumentets arkiv är för stort.');
        if (sheet) chunks.push(value);
      }
      if (length !== size) throw new Error('Dokumentets arkiv är skadat.');
    } finally {
      await reader.cancel();
    }
    if (sheet) {
      const content = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        content.set(chunk, offset);
        offset += chunk.length;
      }
      const xml = new TextDecoder().decode(content);
      let rows = 0,
        columns = 0;
      if (/<!DOCTYPE/i.test(xml) || [...xml.matchAll(/<(?:\w+:)?row\b/g)].length > 10_000)
        throw new Error('Kalkylbladet är för stort eller har ett format som inte stöds.');
      for (const match of xml.matchAll(/\br\s*=\s*["']([^"']*)["']/g))
        if (!/^(?:[A-Z]+)?[1-9][0-9]*$/.test(match[1]!)) throw new Error('Kalkylbladets celladresser stöds inte.');
      for (const match of xml.matchAll(/\br\s*=\s*["']([A-Z]+)([0-9]+)["']/g)) {
        const row = Number(match[2]);
        let col = 0;
        for (const c of match[1]!) col = col * 26 + c.charCodeAt(0) - 64;
        rows = Math.max(rows, row);
        columns = Math.max(columns, col);
      }
      // Include explicitly empty rows, which the parser may allocate before trimming.
      for (const match of xml.matchAll(/<(?:\w+:)?row\b[^>]*\br\s*=\s*["']([0-9]+)["']/g))
        rows = Math.max(rows, Number(match[1]));
      totalCells += rows * columns;
      if (rows > 10_000 || columns > 1000 || totalCells > 250_000)
        throw new Error('Kalkylbladet är för stort för förhandsvisning.');
    }
    at += 46 + nameLength + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
  }
}
