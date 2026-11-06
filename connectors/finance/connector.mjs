// The finance fixture's handlers and HTTP boundary. manifest.mjs owns the contract, fixture.mjs the generated records,
// state.mjs the store. Independently runnable with Node; imports nothing from the rest of the repository (D21).
import { createHash } from 'node:crypto';
import { createVerifier } from './verification.mjs';
import { manifest, CONNECTOR } from './manifest.mjs';
import { costCentreOf, dateIn, money, seed, shortDate } from './fixture.mjs';
import { memoryState } from './state.mjs';

export { manifest };

class Invalid extends Error {}
class Conflict extends Error {}
export const FAULTS = ['', 'unavailable', 'slow', 'unauthorized', 'conflict', 'crash-after-commit'];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fail = (code, message, status) => json({ error: { code, message } }, status);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const escapeXml = s =>
  String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** The invoice as one SVG page (D70): header, parties, lines, VAT and the sum. No script, no external reference. */
export function invoiceSvg(inv) {
  const number = inv.ref.slice('finance:inv:'.length);
  const net = inv.lines.reduce((n, l) => n + l.amount, 0);
  const vat = inv.amount - net;
  const rows = [...inv.lines.map(l => [l.text, money(l.amount)]), ['Moms 25 %', money(vat)]];
  const text = (x, y, s, attrs = '') => `<text x="${x}" y="${y}" ${attrs}>${escapeXml(s)}</text>`;
  const right = 'text-anchor="end"';
  const lineRows = rows
    .map(
      ([label, amount], i) =>
        `<line x1="48" y1="${268 + i * 32}" x2="592" y2="${268 + i * 32}" stroke="#e4e4e7"/>` +
        text(48, 290 + i * 32, label) +
        text(592, 290 + i * 32, amount, right),
    )
    .join('');
  const sumY = 268 + rows.length * 32;
  const height = sumY + 120;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${height}" viewBox="0 0 640 ${height}" role="img" aria-label="${escapeXml(`Faktura ${number} från ${inv.supplier}, ${money(inv.amount)}`)}">` +
    `<rect width="640" height="${height}" fill="#ffffff"/>` +
    `<g font-family="Inter, system-ui, sans-serif" font-size="14" fill="#18181b">` +
    text(48, 64, inv.supplier, 'font-size="22" font-weight="700"') +
    text(48, 86, 'Leverantörsfaktura', 'fill="#52525b"') +
    text(592, 64, `FAKTURA ${number}`, `${right} font-size="18" font-weight="600"`) +
    text(592, 86, `Fakturadatum ${inv.issued} · Förfaller ${inv.due}`, `${right} fill="#52525b"`) +
    text(48, 140, 'Mottagare', 'font-size="12" fill="#52525b"') +
    text(48, 160, `Kostnadsställe ${inv.costCentre} · konto ${inv.account}`) +
    text(336, 140, 'Referens', 'font-size="12" fill="#52525b"') +
    text(336, 160, inv.order ? `Beställning ${inv.order}` : 'Ingen beställning angiven') +
    text(48, 240, 'Specifikation', 'font-size="12" font-weight="600" fill="#52525b"') +
    text(592, 240, 'Belopp', `${right} font-size="12" font-weight="600" fill="#52525b"`) +
    lineRows +
    `<line x1="48" y1="${sumY}" x2="592" y2="${sumY}" stroke="#18181b" stroke-width="2"/>` +
    text(48, sumY + 30, 'Att betala', 'font-size="16" font-weight="700"') +
    text(592, sumY + 30, money(inv.amount), `${right} font-size="16" font-weight="700"`) +
    text(48, sumY + 80, `OCR ${number} · betalningsvillkor 30 dagar`, 'font-size="12" fill="#52525b"') +
    `</g></svg>`
  );
}

export function createConnector({
  secret,
  jwks,
  clewUrl = process.env.CLEW_URL ?? '',
  fetch: fetchImpl = globalThis.fetch,
  state = memoryState(),
  clock = () => new Date(),
  fault = '',
  unitMap = {},
  personMap = {},
  fresh = false,
} = {}) {
  if (!FAULTS.includes(fault)) throw new Error(`FIXTURE_FAULT must be one of ${FAULTS.filter(Boolean).join(', ')}`);
  const verify = createVerifier({ secret, jwks, clewUrl, fetch: fetchImpl }, CONNECTOR);
  const today = () => dateIn(clock());
  const now = () => clock().toISOString();
  if (fresh) for (const key of state.keys('')) state.delete(key);
  if (!state.get('records')) state.set('records', seed(today()));
  const records = () => state.get('records');

  const unitOf = actor => unitMap[actor.unitId] ?? actor.unitId;
  const personOf = actor => personMap[actor.id] ?? actor.id;
  const personKey = actor => unitOf(actor) + ':' + personOf(actor);
  /** The cost centre a manager attests for: the unit's. A unit the system has no cost centre for sees nothing. */
  const costCentre = actor => (actor.role === 'manager' ? costCentreOf[unitOf(actor)] : undefined);
  const approved = () => state.get('approved', {});
  const pending = actor => {
    const done = approved();
    const cc = costCentre(actor);
    return records().invoices.filter(i => i.costCentre === cc && !done[i.ref]);
  };
  const budgetOf = actor => records().budgets.find(b => b.costCentre === costCentre(actor));
  const deviation = b => Math.round((1000 * (b.budget - b.forecast)) / b.budget) / 10;

  const reads = {
    'finance.invoices': actor => ({
      rows: pending(actor).map(i => ({
        ref: i.ref,
        supplier: i.supplier,
        amount: i.amount,
        due: i.due,
        order: i.order,
        account: i.account,
      })),
    }),
    'finance.budget': actor => {
      const b = budgetOf(actor);
      if (!b) return { label: 'Inget kostnadsställe för enheten', deviationPct: 0, driver: '', budget: 0, forecast: 0 };
      return {
        label: `Kostnadsställe ${b.costCentre}`,
        deviationPct: deviation(b),
        driver: b.driver,
        budget: b.budget,
        forecast: b.forecast,
      };
    },
    'finance.open': (_actor, input) => ({
      url: `https://finance.example.invalid/faktura/${encodeURIComponent(input.ref)}`,
    }),
    // The invoice as the person would see it in the economy system (D70): drawn from its lines, for the person's own cost centre only.
    'finance.preview': (actor, input) => {
      const inv = records().invoices.find(i => i.ref === input.ref && i.costCentre === costCentre(actor));
      if (!inv) throw new Invalid('Fakturan finns inte.');
      return {
        title: `Faktura ${inv.ref.slice('finance:inv:'.length)} · ${inv.supplier}`,
        mediaType: 'image/svg+xml',
        data: Buffer.from(invoiceSvg(inv)).toString('base64'),
      };
    },
    'finance.lookup': (actor, input) => {
      const op = state.get('op:' + input.operationId);
      return op && op.person === personKey(actor) ? { found: true, result: op.result } : { found: false };
    },
  };

  const writes = {
    'finance.approve': (actor, input) => {
      if (fault === 'conflict')
        return {
          headline: 'Fakturorna har ändrats i ekonomisystemet.',
          rows: input.refs.map(ref => ({
            ref,
            label: 'Faktura',
            outcome: 'failed',
            detail: 'ändrad av någon annan, läs tillbaka och försök igen',
          })),
        };
      const done = approved();
      const cc = costCentre(actor);
      const rows = input.refs.map(ref => {
        const inv = records().invoices.find(i => i.ref === ref && i.costCentre === cc);
        if (!inv) return { ref, label: 'Faktura', outcome: 'failed', detail: 'finns inte i ekonomisystemet' };
        // One invoice answers slowly in the fixture so the "unknown" state is exercised end to end.
        if (ref.endsWith('55140'))
          return {
            ref,
            label: `${inv.supplier} ${money(inv.amount)}`,
            outcome: 'unknown',
            detail: 'Ekonomisystemet svarade inte, kontrolleras igen om 15 min',
          };
        done[ref] = now();
        return {
          ref,
          label: `${inv.supplier} ${money(inv.amount)}`,
          outcome: 'done',
          detail: 'attesterad i ekonomisystemet',
        };
      });
      state.set('approved', done);
      const ok = rows.filter(r => r.outcome === 'done').length;
      const unknown = rows.filter(r => r.outcome === 'unknown').length;
      return {
        headline: `${ok} ${ok === 1 ? 'faktura attesterad' : 'fakturor attesterade'}${unknown ? `, ${unknown} väntar på svar` : ''}.`,
        rows,
        undoCapability: 'finance.unapprove',
        undoMinutes: 10,
      };
    },
    'finance.unapprove': (_actor, input) => {
      const done = approved();
      for (const ref of input.refs) delete done[ref];
      state.set('approved', done);
      return {
        headline: 'Attesten är återtagen.',
        rows: input.refs.map(ref => ({
          ref,
          label: 'Faktura',
          outcome: 'done',
          detail: 'väntar igen i ekonomisystemet',
        })),
      };
    },
  };

  function execute(actor, name, input, operationId) {
    return state.transaction(() => {
      const digest = hash({ person: personKey(actor), name, input });
      if (operationId) {
        const existing = state.get('op:' + operationId);
        if (existing) {
          if (existing.person !== personKey(actor) || existing.digest !== digest)
            throw new Conflict('Beslutet gäller annat innehåll.');
          return existing.result;
        }
      }
      const result = writes[name](actor, input);
      if (operationId) state.set('op:' + operationId, { person: personKey(actor), name, digest, result, at: now() });
      return result;
    });
  }

  function scan(actor) {
    const rows = pending(actor);
    if (!rows.length) return [];
    const due = rows.map(r => r.due).sort()[0];
    const total = rows.reduce((n, r) => n + r.amount, 0);
    const draft = {
      topic: 'finance:invoices',
      area: 'budget',
      title:
        rows.length === 1
          ? `Attestera en faktura, ${money(total)}`
          : `Attestera ${rows.length} fakturor, ${money(total)}`,
      summary: rows.every(r => r.order)
        ? rows.length === 1
          ? 'Matchar sin beställning och ryms i budgeten.'
          : 'Alla matchar sina beställningar och ryms i budgeten.'
        : rows.length === 1
          ? 'Saknar beställning.'
          : `${rows.filter(r => r.order).length} matchar en beställning, ${rows.filter(r => !r.order).length} saknar beställning.`,
      reason: `Den första förfaller ${shortDate(due)}`,
      deadline: due,
      items: rows.map(r => ({
        ref: r.ref,
        label: `${r.supplier} · ${money(r.amount)}`,
        detail: `${r.account} · förfaller ${shortDate(r.due)}${r.order ? ' · beställning ' + r.order : ' · ingen beställning'}`,
        selectable: true,
        selected: !!r.order,
      })),
      actions: [
        {
          id: 'approve',
          label: 'Attestera valda',
          capability: 'finance.approve',
          kind: 'execute',
          role: 'primary',
          usesItems: true,
          // Each invoice is looked at before it is attested (D70): Clew opens the review flow and writes once at its end.
          review: 'each',
          preview: 'finance.preview',
        },
        {
          id: 'open',
          label: 'Öppna i ekonomisystemet',
          capability: 'finance.open',
          kind: 'read',
          role: 'secondary',
          target: 'link',
          input: { ref: rows[0].ref },
        },
      ],
    };
    return [
      {
        ...draft,
        occurrences: draft.items.map(i => ({
          key: i.ref,
          revision: hash([i.label, i.detail, draft.summary, draft.actions]),
          period: 'once',
        })),
      },
    ];
  }

  function figure(actor, area) {
    if (area !== 'budget') return null;
    const b = budgetOf(actor);
    if (!b) return null;
    const pct = deviation(b);
    return {
      label: `${pct > 0 ? '+' : ''}${String(pct).replace('.', ',')} % · ${b.driver}`,
      tone: pct < -1.5 ? 'alert' : pct < 0 ? 'warn' : 'ok',
    };
  }

  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return json(manifest);
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/')) return fail('not-found', 'Okänd adress.', 404);
    if (fault === 'unavailable') return fail('unavailable', 'Ekonomisystemet svarar inte just nu.', 503);
    if (fault === 'slow') await new Promise(resolve => setTimeout(resolve, 1500));
    if (fault === 'unauthorized') return fail('denied', 'Ekonomisystemet godtar inte anslutningens behörighet.', 401);
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(token, request.headers.get('x-clew-connector-key'));
    if (!actor) return fail('denied', 'Ogiltigt behörighetsbevis.', 401);
    let body;
    try {
      body = await request.json();
    } catch {
      return fail('invalid', 'Ogiltig förfrågan.', 400);
    }
    try {
      if (url.pathname === '/clew/scan') {
        const drafts = scan(actor);
        return json({
          drafts,
          observation: {
            scope: unitOf(actor) + ':' + actor.role,
            observedAt: now(),
            version: hash(drafts),
            completeness: 'complete',
            exhausted: true,
          },
        });
      }
      if (url.pathname === '/clew/figure') return json({ figure: figure(actor, body.area) });
      const name = decodeURIComponent(url.pathname.slice('/clew/capabilities/'.length));
      const declared = manifest.capabilities.find(c => c.name === name);
      if (!declared) return fail('not-found', 'Okänd förmåga.', 404);
      if (declared.scope.roles && !declared.scope.roles.includes(actor.role))
        return fail('denied', 'Du saknar behörighet för åtgärden.', 403);
      const input = body && typeof body.input === 'object' && body.input ? body.input : {};
      let output;
      if (reads[name]) output = reads[name](actor, input);
      else {
        output = execute(actor, name, input, request.headers.get('x-clew-operation-id') ?? undefined);
        if (fault === 'crash-after-commit') return fail('unavailable', 'Ekonomisystemet svarar inte just nu.', 503);
      }
      return json({ output });
    } catch (error) {
      if (error instanceof Invalid) return fail('invalid', error.message, 400);
      if (error instanceof Conflict) return fail('invalid', error.message, 409);
      console.error(error);
      return fail('unavailable', 'Ekonomisystemet svarar inte just nu.', 503);
    }
  }

  return { manifest, handle, close: () => state.close() };
}
