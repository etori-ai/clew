// Small deterministic original documents for the independent finance fixture. No renderer or application dependency.
import { createHash } from 'node:crypto';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const xml = value =>
  String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const word = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const excel = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// Stored ZIP entries keep fixture generation deterministic and independently runnable.
function zip(files) {
  const entries = [],
    central = [];
  let offset = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = Buffer.from(path),
      data = Buffer.from(text),
      crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    entries.push(header, name, data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...entries, directory, end]);
}
function openXml(mainType, path, contents, extras = {}, relations = '') {
  return zip({
    '[Content_Types].xml': `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${path}" ContentType="${mainType}"/>${Object.keys(
      extras,
    )
      .filter(k => k.startsWith('xl/worksheets'))
      .map(
        k =>
          `<Override PartName="/${k}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${path}"/></Relationships>`,
    [path]: contents,
    ...extras,
    ...(relations ? { 'xl/_rels/workbook.xml.rels': relations } : {}),
  });
}
function pdf(inv) {
  const text = s =>
    String(s)
      .replace(/[\\()]/g, '\\$&')
      .replace(/[^\x20-\xff]/g, '-');
  const page = lines =>
    lines.map((s, i) => `BT /F1 ${i ? 12 : 22} Tf 48 ${760 - i * 30} Td (${text(s)}) Tj ET`).join('\n');
  const pages = [
    page([
      `Faktura ${inv.ref.split(':').at(-1)}`,
      inv.supplier,
      `Belopp: ${inv.amount} SEK`,
      `Forfaller: ${inv.due}`,
      `Bestallning: ${inv.order || '-'}`,
      ...inv.lines.map(l => `${l.text}: ${l.amount} SEK`),
      'Exempelunderlag - Ekonomisystemet',
    ]),
    page([
      'Betalningsunderlag',
      `Kostnadsstalle: ${inv.costCentre}`,
      `Konto: ${inv.account}`,
      'Detta ar ett syntetiskt dokument for Clews utvecklingsmiljo.',
    ]),
  ];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    ...pages.map(
      (_, i) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents ${6 + i} 0 R >>`,
    ),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    ...pages.map(p => `<< /Length ${Buffer.byteLength(p, 'latin1')} >>\nstream\n${p}\nendstream`),
  ];
  let out = '%PDF-1.4\n',
    offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const start = Buffer.byteLength(out, 'latin1');
  out +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map(n => `${String(n).padStart(10, '0')} 00000 n \n`)
      .join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
export function invoiceDocuments(inv) {
  const paragraphs = [
    'Inköpsavtal',
    `Leverantör: ${inv.supplier}`,
    `Beställning: ${inv.order || 'Saknas'}`,
    'Leveransen ska motsvara beställningen. Kontrollera belopp och leverans före attest.',
    'Detta är ett syntetiskt exempelavtal.',
  ];
  const docx = openXml(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map(t => `<w:p><w:r><w:t>${xml(t)}</w:t></w:r></w:p>`).join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`,
  );
  const sheet = rows =>
    `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}"${typeof v === 'number' ? '' : ' t="inlineStr"'}>${typeof v === 'number' ? `<v>${v}</v>` : `<is><t>${xml(v)}</t></is>`}</c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const xlsx = openXml(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    'xl/workbook.xml',
    '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Specifikation" sheetId="1" r:id="rId1"/><sheet name="Referenser" sheetId="2" r:id="rId2"/></sheets></workbook>',
    {
      'xl/worksheets/sheet1.xml': sheet([
        ['Beskrivning', 'Belopp SEK'],
        ...inv.lines.map(l => [l.text, l.amount]),
        ['Att betala inklusive moms', inv.amount],
      ]),
      'xl/worksheets/sheet2.xml': sheet([
        ['Faktura', inv.ref],
        ['Beställning', inv.order],
        ['Kostnadsställe', inv.costCentre],
      ]),
    },
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
  );
  const originals = [
    {
      id: 'invoice',
      title: 'Faktura',
      filename: 'Faktura.pdf',
      mediaType: 'application/pdf',
      bytes: pdf(inv),
      required: true,
    },
    { id: 'agreement', title: 'Inköpsavtal', filename: 'Avtal.docx', mediaType: word, bytes: docx, required: false },
    {
      id: 'specification',
      title: 'Specifikation',
      filename: 'Specifikation.xlsx',
      mediaType: excel,
      bytes: xlsx,
      required: false,
    },
  ];
  return {
    originals,
    bundle: {
      ref: inv.ref,
      revision: digest(Buffer.from(JSON.stringify(inv))),
      title: `Faktura från ${inv.supplier}`,
      documents: originals.map(({ bytes, ...d }) => ({
        ...d,
        size: bytes.length,
        sha256: digest(bytes),
        revision: digest(bytes),
      })),
    },
  };
}
