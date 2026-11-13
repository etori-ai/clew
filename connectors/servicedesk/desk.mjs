// The service desk behind a port, and the one place its records become what Clew is shown (D123). The port speaks the
// desk's own records, the envelopes a typical service-desk API answers with (`{ Type, Data, Memo }`, fixture.mjs); a
// real desk is a second implementation of the same functions, and nothing in connector.mjs changes. The in-memory
// fixture below is the only implementation in this repository.
//
//   listRequests({ requester } | { contact })  the cases a person made, or the cases made for them: every open one, and
//                                               those closed in the last CLOSED_DAYS (how long is the desk's choice)
//   getRequest(number)                          one case by the desk's number, or null
//   createRequest({ requester, contact, item, note, reference, digest })
//                                               files an order from the catalogue and answers the case; a `reference`
//                                               the desk has filed before answers that case and files nothing, so an
//                                               order sent twice under one operation id is one order. The desk keeps
//                                               the `digest` of the order with the reference (as an external reference
//                                               field would), so the connector can tell the same order sent again from
//                                               another caller's or another input under the same id
//   findByReference(reference)                  the case filed under a reference, or null
//   listEquipment(person)                       the configuration items registered to a person
//   catalogueItem(item)                         the desk's entry for an orderable value: category, group, lead days
//
// Every function answers a promise, as a desk over HTTP would. Who may see what is not the port's: the connector checks
// that a case is the caller's own and that Clew vouched for the person an order or a read names (D117).
import { CATALOGUE, addDays, caseNumber, dateIn, seed } from './fixture.mjs';

/** How long a closed case stays in the person's list. */
export const CLOSED_DAYS = 30;
/** The connector's id, the first part of every ref. */
const ID = 'servicedesk';

/**
 * What each of the desk's statuses means for the person who waits (D123 item 3), and the desk's own word for it in
 * Swedish. A status the table does not know counts as being handled, under its own name.
 */
export const STATUSES = {
  Registered: { state: 'new', word: 'Mottagen' },
  'In Progress': { state: 'active', word: 'Pågår' },
  Ordered: { state: 'active', word: 'Beställd från leverantör' },
  'In Delivery': { state: 'active', word: 'Under leverans' },
  'Awaiting Customer': { state: 'waiting-on-me', word: 'Väntar på ditt svar' },
  'Ready for Pickup': { state: 'waiting-on-me', word: 'Klar att hämta' },
  Delivered: { state: 'closed', word: 'Levererad' },
  Resolved: { state: 'closed', word: 'Löst' },
  Cancelled: { state: 'closed', word: 'Makulerad' },
};
/** What a case is, in the person's words: an order or a fault report. */
const KIND = { 'Service Request': 'Beställning', Incident: 'Felanmälan' };

const fold = value => String(value).toLowerCase();
const meaningOf = status => STATUSES[status] ?? { state: 'active', word: String(status) };
const nonEmpty = value => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const clip = (value, limit) => (value.length <= limit ? value : value.slice(0, limit - 1).trimEnd() + '…');

// ---- The mapping: the desk's records as Clew's rows. The only code that reads `Data`. ----

export const isOpen = serviceCase => meaningOf(serviceCase.Data.Status).state !== 'closed';
export const requestRef = serviceCase => `request:${ID}:${serviceCase.Data.Number}`;
/** The desk's number in a ref this connector made, or undefined. */
export const numberOf = ref => /^request:servicedesk:(SD-[0-9]{4,12})$/.exec(String(ref))?.[1];

/**
 * One case as a row of the requests profile (D123): the number and the type, never the subject, the description or a
 * name; the shared state and the desk's own word for its status; when it was made and, where the desk promises one, the
 * day it is expected.
 */
export function requestRow(serviceCase) {
  const data = serviceCase.Data;
  const meaning = meaningOf(data.Status);
  return {
    ref: requestRef(serviceCase),
    label: `${data.Number} · ${data.Category}, ${KIND[serviceCase.Type] ?? 'Ärende'}`,
    state: meaning.state,
    status: meaning.word,
    since: new Date(data.OpenedAt).toISOString(),
    ...(data.ExpectedOn && meaning.state !== 'closed' ? { expectedAt: data.ExpectedOn } : {}),
  };
}
/** One case with its free text, for the person who made it: the row, the group handling it, the subject, what the person wrote and what the desk wrote last. */
export function requestDetail(serviceCase) {
  const data = serviceCase.Data;
  const latest = nonEmpty(data.Notes?.at(-1)?.Text);
  const description = nonEmpty(serviceCase.Memo);
  return {
    ...requestRow(serviceCase),
    group: data.ResponsibleGroup,
    title: clip(nonEmpty(data.Subject) ?? data.Category, 200),
    ...(description ? { description: clip(description, 4000) } : {}),
    ...(latest ? { latest: clip(latest, 1000) } : {}),
  };
}
/** One configuration item as a row of a person's equipment: what it is, the model, the inventory number and since when. */
export const equipmentRow = item => ({
  ref: `equipment:${ID}:${item.Data.InventoryNumber}`,
  kind: item.Data.Kind,
  model: item.Data.Model,
  inventoryNumber: item.Data.InventoryNumber,
  since: item.Data.AssignedOn,
});

// ---- The fixture: the desk's records in the connector's own store, seeded from today. ----

/**
 * The made-up desk over the fixture's store (state.mjs): its records are seeded relative to `clock` on first use and
 * kept under `records`. `advance` is the fixture's own, never the port's: it moves a case forward as the desk's staff
 * would, so a developer or a test can see a card wait and resolve.
 */
export function fixtureDesk({ state, clock = () => new Date() }) {
  const today = () => dateIn(clock());
  const now = () => clock().toISOString();
  if (!state.get('records')) state.set('records', seed(today()));
  const records = () => state.get('records');
  const recent = serviceCase =>
    isOpen(serviceCase) ||
    (!!serviceCase.Data.ClosedAt &&
      Date.parse(serviceCase.Data.ClosedAt) >= clock().getTime() - CLOSED_DAYS * 86400000);
  const byOpened = (a, b) => Date.parse(b.Data.OpenedAt) - Date.parse(a.Data.OpenedAt);

  return {
    async listRequests({ requester, contact }) {
      const who = requester ?? contact;
      if (typeof who !== 'string') return [];
      const field = requester !== undefined ? 'Requester' : 'Contact';
      return records()
        .cases.filter(c => fold(c.Data[field]) === fold(who) && recent(c))
        .sort(byOpened);
    },
    async getRequest(number) {
      return records().cases.find(c => c.Data.Number === number) ?? null;
    },
    async findByReference(reference) {
      return (reference && records().cases.find(c => c.Data.Reference === reference)) ?? null;
    },
    async createRequest({ requester, contact, item, note, reference, digest }) {
      return state.transaction(() => {
        const all = records();
        const filed = reference && all.cases.find(c => c.Data.Reference === reference);
        if (filed) return filed;
        const entry = CATALOGUE[item];
        if (!entry) throw new Error('The catalogue has no such item.');
        const day = today();
        all.sequence += 1;
        const created = {
          Type: 'Service Request',
          Data: {
            Number: caseNumber(day, all.sequence),
            Status: 'Registered',
            Category: entry.Category,
            Subject: entry.Subject,
            Item: item,
            ResponsibleGroup: entry.ResponsibleGroup,
            Contact: contact,
            Requester: requester,
            OpenedAt: now(),
            ExpectedOn: addDays(day, entry.LeadDays),
            ...(reference ? { Reference: reference, ReferenceDigest: digest ?? null } : {}),
            Notes: [],
          },
          Memo: note ?? '',
        };
        all.cases.push(created);
        state.set('records', all);
        return created;
      });
    },
    async listEquipment(person) {
      return records().items.filter(i => typeof person === 'string' && fold(i.Data.AssignedTo) === fold(person));
    },
    async catalogueItem(item) {
      const entry = CATALOGUE[item];
      return entry ? { ...entry, ExpectedOn: addDays(today(), entry.LeadDays) } : null;
    },
    /**
     * The fixture's own: move a case to `active`, `waiting-on-me` or `closed`, as the desk's staff would, with the note
     * they would write. Answers the case, or null for a number the desk does not have.
     */
    advance(number, to) {
      return state.transaction(() => {
        const all = records();
        const found = all.cases.find(c => c.Data.Number === number);
        if (!found) return null;
        const data = found.Data;
        if (to === 'active') data.Status = 'In Progress';
        if (to === 'waiting-on-me') {
          data.Status = 'Awaiting Customer';
          data.Notes.push({ At: now(), Text: 'Servicedesken behöver ett svar från dig för att gå vidare.' });
        }
        if (to === 'closed') {
          data.Status = found.Type === 'Incident' ? 'Resolved' : 'Delivered';
          data.Notes.push({
            At: now(),
            Text: found.Type === 'Incident' ? 'Felet är åtgärdat.' : 'Beställningen är levererad.',
          });
          data.ClosedAt = now();
        } else delete data.ClosedAt;
        state.set('records', all);
        return found;
      });
    },
  };
}
