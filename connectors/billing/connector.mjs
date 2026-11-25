// The billing connector's handlers and HTTP boundary: billing records in BillingPreprocessor that wait for attest, one
// card for them, and the decision on each. manifest.mjs owns the contract; records.mjs the port and the made-up
// records; billingpreprocessor.mjs the API. Independently runnable with Node; imports nothing from the rest of the
// repository (D21).
import { createHash } from 'node:crypto';
import { createVerifier } from './verification.mjs';
import { AREA, CONNECTOR, createManifest } from './manifest.mjs';
import { SourceNotFound, SourceRefused, SourceUnavailable, nextFifteenth } from './records.mjs';
import { recordSvg } from './document.mjs';

class Invalid extends Error {}
class Conflict extends Error {}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fail = (code, message, status) => json({ error: { code, message } }, status);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const REF = /^billing:([A-Za-z0-9-]{1,64})$/;
const MAX_REFS = 50;

const kronor = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 });
export const money = amount => kronor.format(amount) + ' kr';
const MONTHS = ['jan', 'feb', 'mars', 'apr', 'maj', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dec'];
const dayOf = at => (typeof at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : '');
const shortDate = day => {
  const [, m, d] = day.split('-').map(Number);
  return day ? `${d} ${MONTHS[m - 1]}` : '';
};
const TYPES = { INTERNAL: 'Intern', EXTERNAL: 'Extern' };
const STATUS_WORDS = {
  NEW: 'Väntar på attest',
  APPROVED: 'Attesterad',
  REJECTED: 'Avslagen',
  INVOICED: 'Överförd till ekonomisystemet',
};

/**
 * What a person reads of a record, from BillingPreprocessor's shape. Free text is the source's own. `customers` names a
 * customer number per type (`{ INTERNAL: { "10": "…" }, EXTERNAL: { … } }`), as Draken's own table does; the numbers
 * of internal and external customers overlap, so each type has its own.
 */
export function shownRecord(raw, customers = {}) {
  const invoice = raw?.invoice ?? {};
  const rows = Array.isArray(invoice.invoiceRows) ? invoice.invoiceRows : [];
  const lineAmount = row =>
    Number.isFinite(row?.totalAmount)
      ? row.totalAmount
      : (Number(row?.quantity) || 0) * (Number(row?.costPerUnit) || 0);
  const amount = Number.isFinite(invoice.totalAmount)
    ? invoice.totalAmount
    : rows.reduce((n, r) => n + lineAmount(r), 0);
  const extra = raw?.extraParameters && typeof raw.extraParameters === 'object' ? raw.extraParameters : {};
  const recipient = raw?.recipient ?? {};
  const accountOf = row => {
    const first = Array.isArray(row?.accountInformation) ? row.accountInformation[0] : row?.accountInformation;
    return first
      ? [first.costCenter && `ansvar ${first.costCenter}`, first.activity && `verksamhet ${first.activity}`]
          .filter(Boolean)
          .join(' · ')
      : '';
  };
  return {
    id: raw.id,
    ref: 'billing:' + raw.id,
    status: raw.status,
    description: String(invoice.description || 'Faktureringsunderlag'),
    amount,
    errand: typeof extra.errandNumber === 'string' ? extra.errandNumber : '',
    // Draken shows it as "Chef": the manager who ordered the work, at the customer.
    chef: typeof extra.referenceName === 'string' ? extra.referenceName : '',
    recipient: recipient.organizationName || [recipient.firstName, recipient.lastName].filter(Boolean).join(' ') || '',
    customerId: String(invoice.customerId ?? ''),
    customer: customerName(customers, raw?.type, invoice.customerId),
    customerReference: String(invoice.customerReference ?? ''),
    ourReference: String(invoice.ourReference ?? ''),
    type: TYPES[raw.type] ?? String(raw.type ?? ''),
    created: dayOf(raw.created),
    modified: String(raw.modified ?? raw.created ?? ''),
    updated: dayOf(raw.modified),
    transferDate: dayOf(raw.transferDate),
    approvedBy: String(raw.approvedBy ?? ''),
    lines: rows.map(row => ({
      text: (Array.isArray(row?.descriptions) ? row.descriptions : []).join(' ') || 'Rad',
      quantity: Number(row?.quantity) || 0,
      costPerUnit: Number(row?.costPerUnit) || 0,
      amount: lineAmount(row),
      account: accountOf(row),
    })),
  };
}

/** The customer's name from the configured table, else its number. */
function customerName(customers, type, id) {
  const number = String(id ?? '');
  const name = customers?.[type]?.[number];
  return name ? name : number ? `Kundnummer ${number}` : '';
}

/**
 * How much was billed, as Draken's list shows it and a person checks it: the first row as "3 × 300 kr", then each further
 * row by its own text ("+ Utvecklingskostnad 2%"), or by their number when there are more than two.
 */
export function quantityOf(shown) {
  const [first, ...rest] = shown.lines;
  if (!first) return '';
  const base =
    first.quantity && first.costPerUnit ? `${kronor.format(first.quantity)} × ${money(first.costPerUnit)}` : '';
  if (!base || rest.length === 0) return base;
  return rest.length <= 2
    ? [base, ...rest.map(line => '+ ' + (line.text.length > 40 ? line.text.slice(0, 39) + '…' : line.text))].join(' ')
    : `${base} + ${rest.length} rader`;
}

/**
 * source: the record port (records.mjs's fixture or billingpreprocessor.mjs). sourceLabel: the system's name as a
 * person reads it. errandLink: an address with `{errandNumber}` in it, the errand a record comes from; without it no
 * link is declared. `clock` and `log` are injectable for tests.
 */
export function createConnector({
  secret,
  jwks,
  clewUrl = process.env.CLEW_URL ?? '',
  fetch: fetchImpl = globalThis.fetch,
  source,
  sourceLabel = 'Lön och pension',
  errandLink,
  customers = {},
  clock = () => new Date(),
  log = () => {},
} = {}) {
  if (!source) throw new Error('A billing record source is required.');
  const show = raw => shownRecord(raw, customers);
  if (errandLink !== undefined && !/^https:\/\/[^\s]+\{errandNumber\}/.test(errandLink))
    throw new Error('BILLING_ERRAND_LINK must be an https address with {errandNumber} in it.');
  const manifest = createManifest({ source: sourceLabel, linked: !!errandLink });
  const verify = createVerifier({ secret, jwks, clewUrl, fetch: fetchImpl }, CONNECTOR);
  const now = () => clock().toISOString();
  const today = () => now().slice(0, 10);
  // The decisions made through this connector, by Clew's operation id (D45): a retry gets the first answer, and
  // `billing.lookup` reads back what is still unknown. Kept in memory: a restart forgets them, and a lookup after it
  // answers `found: false`, which leaves the outcome to be checked in the source.
  const operations = new Map();

  const idOf = ref => {
    const match = REF.exec(String(ref));
    if (!match) throw new Invalid('Okänd faktura.');
    return match[1];
  };
  const refsOf = input => {
    const refs = Array.isArray(input?.refs) ? input.refs : [];
    if (refs.length === 0 || refs.length > MAX_REFS) throw new Invalid(`Välj mellan en och ${MAX_REFS} fakturor.`);
    for (const ref of refs) idOf(ref);
    return [...new Set(refs)];
  };
  const labelOf = shown => `${shown.description} · ${money(shown.amount)}`;
  const nobody = actor => !actor.userName;

  const DECISIONS = {
    'billing.approve': {
      to: 'APPROVED',
      done: 'attesterad',
      many: n => `${n} ${n === 1 ? 'faktura attesterad' : 'fakturor attesterade'}`,
    },
    'billing.reject': {
      to: 'REJECTED',
      done: 'avslagen',
      many: n => `${n} ${n === 1 ? 'faktura avslagen' : 'fakturor avslagna'}`,
    },
  };
  const already = shown =>
    shown.status === 'APPROVED'
      ? `Fakturan är redan attesterad${shown.approvedBy ? ' av ' + shown.approvedBy : ''}.`
      : shown.status === 'REJECTED'
        ? `Fakturan är redan avslagen${shown.approvedBy ? ' av ' + shown.approvedBy : ''}.`
        : shown.status === 'INVOICED'
          ? 'Fakturan är redan överförd till ekonomisystemet.'
          : 'Fakturan väntar inte på attest.';

  /**
   * One record's decision: read it right before (the API's PUT replaces the whole record), write the decision as Draken
   * writes it (status, `approvedBy` and, on attest, our reference as the attester's name), read it back. A write whose
   * answer is missing is `unknown` and never sent again; `billing.lookup` settles it.
   */
  async function decideOne(actor, ref, decision) {
    let current;
    try {
      current = await source.get(actor.userName, idOf(ref));
    } catch (error) {
      if (error instanceof SourceNotFound)
        return { row: { ref, label: 'Faktura', outcome: 'failed', detail: `Finns inte i ${sourceLabel}.` } };
      return {
        row: { ref, label: 'Faktura', outcome: 'failed', detail: `${sourceLabel} svarar inte. Inget skickades.` },
      };
    }
    const shown = show(current);
    const label = labelOf(shown);
    if (current.status !== 'NEW') return { row: { ref, label, outcome: 'failed', detail: already(shown) } };
    const next = structuredClone(current);
    next.status = decision.to;
    next.approvedBy = actor.name;
    if (decision.to === 'APPROVED') next.invoice = { ...next.invoice, ourReference: actor.name };
    try {
      await source.put(actor.userName, next);
    } catch (error) {
      if (error instanceof SourceRefused || error instanceof SourceNotFound) {
        log({ event: 'refused', to: decision.to, error: error.name, reason: error.message });
        return { row: { ref, label, outcome: 'failed', detail: `${sourceLabel} tog inte emot beslutet.` } };
      }
      return {
        row: {
          ref,
          label,
          outcome: 'unknown',
          detail: `${sourceLabel} svarade inte på beslutet. Kontrollera status för besked.`,
        },
        target: decision.to,
      };
    }
    let after;
    try {
      after = await source.get(actor.userName, idOf(ref));
    } catch {
      return {
        row: { ref, label, outcome: 'unknown', detail: 'Beslutet skickades men kunde inte läsas tillbaka.' },
        target: decision.to,
      };
    }
    if (after.status !== decision.to)
      return {
        row: { ref, label, outcome: 'unknown', detail: 'Beslutet skickades men syns inte än. Kontrollera status.' },
        target: decision.to,
      };
    return {
      row: { ref, label, outcome: 'done', detail: `${decision.done} i ${sourceLabel}` },
      reference: String(current.invoice?.ourReference ?? ''),
    };
  }

  async function decide(actor, name, input) {
    const decision = DECISIONS[name];
    const refs = refsOf(input);
    if (nobody(actor))
      return {
        headline: 'Beslutet kunde inte skickas.',
        rows: refs.map(ref => ({
          ref,
          label: 'Faktura',
          outcome: 'failed',
          detail: `Clew känner inte ditt användarnamn, så ${sourceLabel} kan inte se vem som beslutar.`,
        })),
      };
    const outcomes = [];
    for (const ref of refs) outcomes.push(await decideOne(actor, ref, decision));
    const rows = outcomes.map(o => o.row);
    const done = outcomes.filter(o => o.row.outcome === 'done');
    const unknown = rows.filter(r => r.outcome === 'unknown').length;
    const failed = rows.filter(r => r.outcome === 'failed').length;
    return {
      headline:
        decision.many(done.length) +
        (unknown ? `, ${unknown} väntar på svar` : '') +
        (failed ? `, ${failed} gick inte` : '') +
        '.',
      rows,
      targets: Object.fromEntries(outcomes.filter(o => o.target).map(o => [o.row.ref, o.target])),
      ...(done.length
        ? {
            undoCapability: 'billing.reopen',
            undoMinutes: 10,
            undoInput: {
              refs: done.map(o => o.row.ref),
              references: Object.fromEntries(done.map(o => [o.row.ref, o.reference])),
            },
          }
        : {}),
    };
  }

  /** The undo: a record the person decided goes back to waiting, with the reference it had, until it has left. */
  async function reopen(actor, input) {
    const refs = refsOf(input);
    const references = input?.references && typeof input.references === 'object' ? input.references : {};
    const rows = [];
    for (const ref of refs) {
      let current;
      try {
        current = await source.get(actor.userName, idOf(ref));
      } catch (error) {
        rows.push({
          ref,
          label: 'Faktura',
          outcome: 'failed',
          detail:
            error instanceof SourceNotFound
              ? `Finns inte i ${sourceLabel}.`
              : `${sourceLabel} svarar inte. Inget ändrades.`,
        });
        continue;
      }
      const shown = show(current);
      const label = labelOf(shown);
      if (current.status === 'NEW') {
        rows.push({ ref, label, outcome: 'done', detail: 'väntar redan på attest' });
        continue;
      }
      if (current.status === 'INVOICED') {
        rows.push({ ref, label, outcome: 'failed', detail: 'Fakturan är redan överförd och kan inte ångras här.' });
        continue;
      }
      const next = structuredClone(current);
      next.status = 'NEW';
      delete next.approvedBy;
      delete next.approved;
      if (typeof references[ref] === 'string') next.invoice = { ...next.invoice, ourReference: references[ref] };
      try {
        await source.put(actor.userName, next);
        rows.push({ ref, label, outcome: 'done', detail: `väntar igen i ${sourceLabel}` });
      } catch (error) {
        if (error instanceof SourceRefused)
          log({ event: 'refused', to: 'NEW', error: error.name, reason: error.message });
        rows.push({
          ref,
          label,
          outcome: error instanceof SourceRefused ? 'failed' : 'unknown',
          detail:
            error instanceof SourceRefused
              ? `${sourceLabel} tog inte emot ångringen.`
              : `${sourceLabel} svarade inte. Kontrollera fakturan där.`,
        });
      }
    }
    const done = rows.filter(r => r.outcome === 'done').length;
    return {
      headline: done === rows.length ? 'Beslutet är ångrat.' : `${done} av ${rows.length} beslut ångrade.`,
      rows,
    };
  }

  /** Reads back an operation's unknown rows from the source: the decision there, or still waiting, settles them. */
  async function lookup(actor, input) {
    const op = operations.get(String(input?.operationId ?? ''));
    if (!op || op.person !== actor.id) return { found: false };
    const targets = op.result.targets ?? {};
    let changed = false;
    const rows = [];
    for (const row of op.result.rows) {
      if (row.outcome !== 'unknown' || !targets[row.ref]) {
        rows.push(row);
        continue;
      }
      try {
        const now = await source.get(actor.userName, idOf(row.ref));
        if (now.status === targets[row.ref]) {
          rows.push({ ...row, outcome: 'done', detail: `läst tillbaka: beslutet gäller i ${sourceLabel}` });
          changed = true;
        } else if (now.status === 'NEW') {
          rows.push({ ...row, outcome: 'failed', detail: 'Beslutet kom inte fram. Inget ändrades; besluta igen.' });
          changed = true;
        } else rows.push(row);
      } catch {
        rows.push(row);
      }
    }
    if (changed) op.result = { ...op.result, rows };
    const { targets: _, ...result } = op.result;
    return { found: true, result };
  }

  async function execute(actor, name, input, operationId) {
    const digest = hash({ person: actor.id, name, input });
    if (operationId) {
      const existing = operations.get(operationId);
      if (existing) {
        if (existing.person !== actor.id || existing.digest !== digest)
          throw new Conflict('Beslutet gäller annat innehåll.');
        const { targets: _, ...result } = existing.result;
        return result;
      }
    }
    const result = name === 'billing.reopen' ? await reopen(actor, input) : await decide(actor, name, input);
    if (operationId) operations.set(operationId, { person: actor.id, digest, result, at: now() });
    log({ event: 'decision', capability: name, rows: result.rows.length, outcomes: result.rows.map(r => r.outcome) });
    const { targets: _, ...answer } = result;
    return answer;
  }

  const reads = {
    'billing.records': async actor => ({
      rows: (await source.list(actor.userName)).map(show).map(r => ({
        ref: r.ref,
        description: r.description,
        amount: r.amount,
        chef: r.chef,
        customer: r.customer,
        errand: r.errand,
        created: r.created,
      })),
    }),
    'billing.record': async (actor, input) => {
      let raw;
      try {
        raw = await source.get(actor.userName, idOf(input.ref));
      } catch (error) {
        if (error instanceof SourceNotFound) throw new Invalid('Fakturan finns inte.');
        throw error;
      }
      const r = show(raw);
      return {
        title: r.description,
        description: r.description,
        amount: r.amount,
        status: STATUS_WORDS[r.status] ?? r.status,
        errand: r.errand,
        chef: r.chef,
        customer: r.customer,
        recipient: r.recipient,
        customerId: r.customerId,
        customerReference: r.customerReference,
        ourReference: r.ourReference,
        type: r.type,
        created: r.created,
        updated: r.updated,
        transferDate: r.transferDate || nextFifteenth(today()),
        approvedBy: r.approvedBy,
        lines: r.lines,
      };
    },
    'billing.open': async (actor, input) => {
      const raw = await source.get(actor.userName, idOf(input.ref));
      const errand = show(raw).errand;
      if (!errand) throw new Invalid('Fakturan hör inte till något ärende.');
      return { url: errandLink.replace('{errandNumber}', encodeURIComponent(errand)) };
    },
    // The record as one page, for the review one at a time (D70).
    'billing.preview': async (actor, input) => {
      let raw;
      try {
        raw = await source.get(actor.userName, idOf(input.ref));
      } catch (error) {
        if (error instanceof SourceNotFound) throw new Invalid('Fakturan finns inte.');
        throw error;
      }
      const shown = show(raw);
      const { svg } = recordSvg(
        { ...shown, status: shown.status === 'NEW' ? 'NEW' : (STATUS_WORDS[shown.status] ?? shown.status) },
        { sourceLabel, money, transferDate: shown.transferDate || nextFifteenth(today()) },
      );
      return {
        title: `${shown.description}${shown.errand ? ' · ' + shown.errand : ''}`.slice(0, 200),
        mediaType: 'image/svg+xml',
        data: Buffer.from(svg).toString('base64'),
      };
    },
    'billing.lookup': lookup,
  };

  async function scan(actor) {
    const observed = (completeness, drafts = []) => ({
      drafts,
      observation: {
        // Clew holds a scan to the assignment it asked for: the primary unit and role, as `unitId:role`.
        scope: actor.unitId + ':' + actor.role,
        observedAt: now(),
        version: hash(drafts).slice(0, 32),
        completeness,
        exhausted: completeness === 'complete',
      },
    });
    if (nobody(actor)) return observed('authorization-required');
    let rows;
    try {
      rows = (await source.list(actor.userName)).map(show);
    } catch (error) {
      log({ event: 'scan', outcome: 'unavailable', error: error?.name });
      return observed('unavailable');
    }
    if (!rows.length) return observed('complete');
    rows.sort((a, b) => a.created.localeCompare(b.created));
    const total = rows.reduce((n, r) => n + r.amount, 0);
    const transfers = rows
      .map(r => r.transferDate)
      .filter(Boolean)
      .sort();
    const draft = {
      topic: 'billing:records',
      area: AREA,
      title:
        rows.length === 1
          ? `Attestera en faktura, ${money(total)}`
          : `Attestera ${rows.length} fakturor, ${money(total)}`,
      summary:
        rows.length === 1
          ? `Ett faktureringsunderlag från ${sourceLabel} väntar på attest.`
          : `${rows.length} faktureringsunderlag från ${sourceLabel} väntar på attest.`,
      reason: transfers.length
        ? `Underlag som är attesterade förs över till ekonomisystemet ${shortDate(transfers[0])}`
        : `Den äldsta skapades ${shortDate(rows[0].created)}`,
      ...(transfers.length ? { deadline: transfers[0] } : {}),
      items: rows.map(r => ({
        ref: r.ref,
        revision: r.modified || r.created,
        label: labelOf(r),
        // What Draken's list shows of a record, so a person can tell the rows apart before opening one.
        detail: [r.chef && `Chef ${r.chef}`, r.customer, quantityOf(r), r.errand && `Ärende ${r.errand}`]
          .filter(Boolean)
          .join(' · '),
        selectable: true,
        selected: false,
      })),
      actions: [
        {
          id: 'approve',
          label: 'Attestera valda',
          capability: 'billing.approve',
          kind: 'execute',
          role: 'primary',
          usesItems: true,
          // Each record is looked at before it is attested (D70): Clew opens the review and writes once at its end.
          review: 'each',
          preview: 'billing.preview',
        },
        {
          id: 'reject',
          label: 'Avslå valda',
          capability: 'billing.reject',
          kind: 'execute',
          role: 'secondary',
          usesItems: true,
          confirm: 'Avslå de valda fakturorna? De förs inte över till ekonomisystemet.',
        },
      ],
    };
    return observed('complete', [
      {
        ...draft,
        occurrences: draft.items.map(i => ({
          key: i.ref,
          revision: hash([i.label, i.detail, i.revision]),
          period: 'once',
        })),
      },
    ]);
  }

  async function handle(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/clew/manifest') return json(manifest);
    if (request.method !== 'POST' || !url.pathname.startsWith('/clew/')) return fail('not-found', 'Okänd adress.', 404);
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const actor = await verify(token, request.headers.get('x-clew-connector-key'), request);
    if (!actor) return fail('denied', 'Ogiltigt behörighetsbevis.', 401);
    let body;
    try {
      body = await request.json();
    } catch {
      return fail('invalid', 'Ogiltig förfrågan.', 400);
    }
    try {
      if (url.pathname === '/clew/scan') return json(await scan(actor));
      if (!url.pathname.startsWith('/clew/capabilities/')) return fail('not-found', 'Okänd adress.', 404);
      const name = decodeURIComponent(url.pathname.slice('/clew/capabilities/'.length));
      const declared = manifest.capabilities.find(c => c.name === name);
      if (!declared) return fail('not-found', 'Okänd förmåga.', 404);
      // Every call to the source names the person (X-Sent-By): a person provisioned without a user name reads nothing.
      if (reads[name] && nobody(actor))
        return fail('denied', `Clew känner inte ditt användarnamn, så ${sourceLabel} kan inte visas för dig.`, 403);
      const input = body && typeof body.input === 'object' && body.input ? body.input : {};
      const output = reads[name]
        ? await reads[name](actor, input)
        : await execute(actor, name, input, request.headers.get('x-clew-operation-id') ?? undefined);
      return json({ output });
    } catch (error) {
      if (error instanceof Invalid) return fail('invalid', error.message, 400);
      if (error instanceof Conflict) return fail('invalid', error.message, 409);
      if (!(error instanceof SourceUnavailable)) log({ event: 'error', error: error?.name });
      return fail('unavailable', `${sourceLabel} svarar inte just nu.`, 503);
    }
  }

  return { manifest, handle };
}
