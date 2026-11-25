// A billing record drawn as one page, for the review one at a time (D70): what Draken shows when an attester opens a
// record (cost type, customer, the manager who ordered, the errand, the rows with their coding and the sum), as an SVG
// with no script and no external reference. Drawn from the record as read; nothing of it is kept.

const escapeXml = s =>
  String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

/**
 * shown: a record as connector.mjs shows it. money: how an amount is written. Returns the SVG's text and the sentence
 * that names it for a screen reader.
 */
export function recordSvg(shown, { sourceLabel, money, transferDate }) {
  const text = (x, y, s, attrs = '') => `<text x="${x}" y="${y}" ${attrs}>${escapeXml(s)}</text>`;
  const right = 'text-anchor="end"';
  const muted = 'fill="#52525b"';
  const small = 'font-size="12"';
  const lines = shown.lines.length ? shown.lines : [{ text: 'Inga rader', quantity: 0, costPerUnit: 0, amount: 0 }];
  const top = 300;
  const rowHeight = 46;
  const rows = lines
    .map((line, i) => {
      const y = top + i * rowHeight;
      return (
        `<line x1="40" y1="${y}" x2="600" y2="${y}" stroke="#e4e4e7"/>` +
        text(40, y + 20, clip(line.text, 44)) +
        text(400, y + 20, line.quantity ? String(line.quantity).replace('.', ',') : '', right) +
        text(490, y + 20, line.costPerUnit ? money(line.costPerUnit) : '', right) +
        text(600, y + 20, money(line.amount), right) +
        text(40, y + 37, line.account ? clip(line.account, 70) : 'Ingen kontering', `${small} ${muted}`)
      );
    })
    .join('');
  const sumY = top + lines.length * rowHeight;
  const height = sumY + 110;
  const label = `Faktureringsunderlag: ${shown.description}, ${money(shown.amount)}${
    shown.customer ? ', kund ' + shown.customer : ''
  }${shown.chef ? ', chef ' + shown.chef : ''}`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${height}" viewBox="0 0 640 ${height}" role="img" aria-label="${escapeXml(label)}">` +
    `<rect width="640" height="${height}" fill="#ffffff"/>` +
    `<g font-family="Inter, system-ui, sans-serif" font-size="14" fill="#18181b">` +
    text(40, 56, clip(shown.description, 46), 'font-size="20" font-weight="700"') +
    text(40, 80, `Faktureringsunderlag · ${sourceLabel}`, muted) +
    text(
      600,
      56,
      shown.errand ? `Ärende ${shown.errand}` : 'Inget ärende',
      `${right} font-size="16" font-weight="600"`,
    ) +
    text(
      600,
      80,
      `${shown.type || 'Okänd typ'} · ${shown.status === 'NEW' ? 'väntar på attest' : shown.status}`,
      `${right} ${muted}`,
    ) +
    text(40, 130, 'Kund', `${small} ${muted}`) +
    text(40, 150, clip(shown.customer || 'Okänd kund', 38), 'font-weight="600"') +
    text(40, 170, shown.customerId ? `Kundnummer ${shown.customerId}` : '', muted) +
    text(330, 130, 'Chef', `${small} ${muted}`) +
    text(330, 150, clip(shown.chef || 'Ingen chef angiven', 36), 'font-weight="600"') +
    text(330, 170, shown.customerReference ? `Referens ${shown.customerReference}` : '', muted) +
    text(40, 215, 'Registrerad', `${small} ${muted}`) +
    text(40, 235, shown.created || '–') +
    text(190, 215, 'Uppdaterad', `${small} ${muted}`) +
    text(190, 235, shown.updated || '–') +
    text(330, 215, 'Förs över', `${small} ${muted}`) +
    text(330, 235, transferDate || '–') +
    text(470, 215, 'Vår referens', `${small} ${muted}`) +
    text(470, 235, clip(shown.ourReference || '–', 18)) +
    text(40, 290, 'Rad', `${small} font-weight="600" ${muted}`) +
    text(400, 290, 'Antal', `${right} ${small} font-weight="600" ${muted}`) +
    text(490, 290, 'Á-pris', `${right} ${small} font-weight="600" ${muted}`) +
    text(600, 290, 'Belopp', `${right} ${small} font-weight="600" ${muted}`) +
    rows +
    `<line x1="40" y1="${sumY}" x2="600" y2="${sumY}" stroke="#18181b" stroke-width="2"/>` +
    text(40, sumY + 30, 'Att debitera', 'font-size="16" font-weight="700"') +
    text(600, sumY + 30, money(shown.amount), `${right} font-size="16" font-weight="700"`) +
    text(40, sumY + 70, 'Attesteras i Clew och förs sedan över till ekonomisystemet.', `${small} ${muted}`) +
    `</g></svg>`;
  return { svg, label };
}
