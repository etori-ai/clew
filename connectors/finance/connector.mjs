// The finance fixture's handlers and HTTP boundary. manifest.mjs owns the contract, fixture.mjs the generated records,
// state.mjs the store. Independently runnable with Node; imports nothing from the rest of the repository (D21).
import { createHash } from 'node:crypto';
import { createVerifier } from './verification.mjs';
import { manifest, CONNECTOR } from './manifest.mjs';
import { costCentreOf, dateIn, money, seed, shortDate } from './fixture.mjs';
import { memoryState } from './state.mjs';
import { invoiceDocuments } from './documents.mjs';

export { manifest };

class Invalid extends Error {}
class Conflict extends Error {}
export const FAULTS = ['', 'unavailable', 'slow', 'unauthorized', 'conflict', 'rejected', 'crash-after-commit'];

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
  const invoice = (actor, ref) => {
    const inv = records().invoices.find(i => i.ref === ref && i.costCentre === costCentre(actor));
    if (!inv) throw new Invalid('Fakturan finns inte.');
    return inv;
  };
  const history = inv => [
    { id: 'received', at: inv.issued + 'T09:00:00.000Z', title: 'Faktura mottagen', detail: inv.supplier },
    ...(approved()[inv.ref] ? [{ id: 'approved', at: approved()[inv.ref], title: 'Attesterad' }] : []),
  ];
  const budgetMetrics = actor => {
    const b = budgetOf(actor);
    return b
      ? [
          ['budget', 'Budget', b.budget],
          ['forecast', 'Prognos', b.forecast],
          ['outcome', 'Utfall', b.outcome],
        ].map(([id, label, value]) => ({
          id,
          label,
          value,
          unit: 'kr',
          period: 'Aktuellt budgetår',
          dataAt: today() + 'T00:00:00.000Z',
          tone: id === 'forecast' && b.forecast > b.budget ? 'warn' : 'none',
          ...(id === 'forecast' ? { target: b.budget, comparison: 'Mot budget' } : {}),
        }))
      : [];
  };
  const budgetSeries = (actor, chart) => {
    const b = budgetOf(actor);
    // Explicitly synthetic development series; no historical source observations are claimed.
    return {
      title: chart === 'bar' ? 'Budget, utfall och prognos' : 'Exempel på periodiserat utfall och prognos',
      unit: 'kr',
      period: 'Syntetiskt budgetår',
      dataAt: today() + 'T00:00:00.000Z',
      axis: 'category',
      categories: chart === 'bar' ? ['Aktuellt budgetår'] : ['Kvartal 1', 'Kvartal 2', 'Kvartal 3', 'Kvartal 4'],
      series: [
        {
          id: 'actual',
          label: 'Utfall',
          role: 'actual',
          values:
            chart === 'bar'
              ? [b?.outcome ?? null]
              : [b ? Math.round(b.outcome / 2) : null, b?.outcome ?? null, null, null],
        },
        {
          id: 'forecast',
          label: 'Prognos',
          role: 'forecast',
          values:
            chart === 'bar'
              ? [b?.forecast ?? null]
              : [null, b?.outcome ?? null, b ? Math.round(b.forecast * 0.75) : null, b?.forecast ?? null],
        },
        {
          id: 'target',
          label: 'Budget',
          role: 'target',
          values:
            chart === 'bar' ? [b?.budget ?? null] : [1, 2, 3, 4].map(q => (b ? Math.round((b.budget * q) / 4) : null)),
        },
      ],
    };
  };

  const reads = {
    'finance.record': (actor, input) => {
      const inv = invoice(actor, input.ref);
      return {
        title: `Faktura ${inv.ref.split(':').at(-1)}`,
        supplier: inv.supplier,
        amount: inv.amount,
        due: inv.due,
        account: inv.account,
        order: inv.order,
        document: invoiceDocuments(inv).bundle,
        recovery: {
          ...(!approved()[inv.ref]
            ? {
                correction: {
                  capability: 'finance.correct',
                  label: 'Spara rättelse',
                  fields: [
                    {
                      key: 'order',
                      label: 'Beställningsnummer',
                      value: inv.order ?? '',
                      required: true,
                      maxLength: 80,
                    },
                  ],
                },
              }
            : {}),
          source: { capability: 'finance.open', label: 'Öppna i ekonomisystemet' },
        },
        lines: inv.lines,
        activity: history(inv),
      };
    },
    'finance.documents': (actor, input) => ({ document: invoiceDocuments(invoice(actor, input.ref)).bundle }),
    'finance.metrics': actor => ({ metrics: budgetMetrics(actor) }),
    'finance.trend': actor => ({ series: budgetSeries(actor, 'line') }),
    'finance.comparison': actor => ({ series: budgetSeries(actor, 'bar') }),
    'finance.history': (actor, input) => ({ activity: history(invoice(actor, input.ref)) }),
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
    'finance.open': (actor, input) => ({
      url: `https://finance.example.invalid/faktura/${encodeURIComponent(invoice(actor, input.ref).ref)}`,
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
      if (!op || op.person !== personKey(actor)) return { found: false };
      // The delayed fixture validation eventually rejects a missing order instead of staying unknown forever.
      // This settles the operation log only; a read never approves an invoice.
      const rows = op.result.rows.map(row =>
        row.outcome === 'unknown' && row.ref.endsWith('55140')
          ? { ...row, outcome: 'failed', detail: 'Beställningsnummer saknas. Ange numret och granska fakturan igen.' }
          : row,
      );
      if (rows.some((row, index) => row !== op.result.rows[index])) {
        const ok = rows.filter(row => row.outcome === 'done').length;
        const failed = rows.filter(row => row.outcome === 'failed').length;
        const result = {
          ...op.result,
          rows,
          headline: `${ok} ${ok === 1 ? 'faktura attesterad' : 'fakturor attesterade'}, ${failed} avvisad.`,
        };
        state.set('op:' + input.operationId, { ...op, result });
        return { found: true, result };
      }
      return { found: true, result: op.result };
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
        if (done[ref])
          return {
            ref,
            label: `${inv.supplier} ${money(inv.amount)}`,
            outcome: 'failed',
            detail: 'Fakturan är redan attesterad. Kontrollera den i ekonomisystemet.',
          };
        const reviewed = input.reviews?.find(r => r.ref === ref);
        const current = invoiceDocuments(inv).bundle;
        if (
          !reviewed ||
          reviewed.revision !== current.revision ||
          JSON.stringify(reviewed.documents) !==
            JSON.stringify(current.documents.map(d => ({ id: d.id, revision: d.revision })))
        )
          return {
            ref,
            label: inv.supplier,
            outcome: 'failed',
            detail: 'Underlaget har ändrats eller saknar granskning. Granska fakturan igen.',
          };
        // One invoice answers slowly in the fixture so the "unknown" state is exercised end to end.
        if (fault === 'rejected' && !inv.order)
          return {
            ref,
            label: `${inv.supplier} ${money(inv.amount)}`,
            outcome: 'failed',
            detail: 'Beställningsnummer saknas. Ange numret och granska fakturan igen.',
          };
        if (fault !== 'rejected' && ref.endsWith('55140') && !inv.order)
          return {
            ref,
            label: `${inv.supplier} ${money(inv.amount)}`,
            outcome: 'unknown',
            detail: 'Ekonomisystemet validerar fakturan. Kontrollera status för besked.',
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
        undoInput: { refs: rows.filter(r => r.outcome === 'done').map(r => r.ref) },
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
    'finance.correct': (actor, input) => {
      const inv = invoice(actor, input.ref);
      const reject = detail => ({
        headline: 'Rättelsen kunde inte sparas.',
        rows: [{ ref: inv.ref, label: inv.supplier, outcome: 'failed', detail }],
      });
      if (approved()[inv.ref]) return reject('Fakturan är redan attesterad.');
      if (invoiceDocuments(inv).bundle.revision !== input.revision)
        return reject('Underlaget har ändrats. Läs in den senaste versionen.');
      if (
        !input.changes ||
        Object.keys(input.changes).some(k => k !== 'order') ||
        typeof input.changes.order !== 'string' ||
        !input.changes.order.trim() ||
        input.changes.order.length > 80
      )
        return reject('Ange ett giltigt beställningsnummer.');
      const current = records();
      current.invoices = current.invoices.map(i =>
        i.ref === inv.ref ? { ...i, order: input.changes.order.trim() } : i,
      );
      state.set('records', current);
      return {
        headline: 'Beställningsnumret är sparat.',
        rows: [
          {
            ref: inv.ref,
            label: inv.supplier,
            outcome: 'done',
            detail: 'Rättat i ekonomisystemet. Granska underlaget igen innan du attesterar.',
          },
        ],
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
        revision: invoiceDocuments(r).bundle.revision,
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
          preview: 'finance.record',
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
          revision: hash([
            i.label,
            i.detail,
            draft.summary,
            draft.actions,
            invoiceDocuments(invoice(actor, i.ref)).bundle.revision,
          ]),
          period: 'once',
        })),
      },
    ];
  }

  // The figure (D54): how much of the period's frame is spent, as a bar towards it. Over the frame is warn, well over is alert.
  function figure(actor, area) {
    if (area !== 'budget') return null;
    const b = budgetOf(actor);
    if (!b?.frame) return null;
    const used = Math.round((100 * b.outcome) / b.frame);
    return {
      label: 'Förbrukat av ramen',
      value: `${used} %`,
      comparison: 'av periodens ram',
      progress: { value: Math.min(used, 100), max: 100 },
      tone: used > 103 ? 'alert' : used > 100 ? 'warn' : 'ok',
      opens: 'finance.budget',
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
      if (url.pathname === '/clew/documents') {
        const request = body.request;
        if (
          !request ||
          !['finance.record', 'finance.documents'].includes(request.capability) ||
          request.input?.ref !== request.ref
        )
          throw new Invalid('Dokumentförfrågan gäller inte fakturan.');
        const { bundle, originals } = invoiceDocuments(invoice(actor, request.ref));
        const descriptor = bundle.documents.find(d => d.id === request.document);
        if (bundle.revision !== request.revision || !descriptor || descriptor.revision !== request.documentRevision)
          throw new Conflict('Underlaget har ändrats. Öppna fakturan igen.');
        return new Response(originals.find(d => d.id === descriptor.id).bytes, {
          headers: {
            'content-type': descriptor.mediaType,
            'x-clew-document-revision': descriptor.revision,
            'cache-control': 'no-store',
          },
        });
      }
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
