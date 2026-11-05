// The phone book behind the connector: one port, two adapters. `createHttpDirectory` talks to the organisation's phone
// book API; `createFixtureDirectory` is a made-up organisation for development, the conformance check and the tests.
// This file is the only place that knows the phone book's own shapes. Everything it returns is a `Person` with work
// contact details and nothing else: a field that is not mapped here cannot reach Clew.
//
// The port:
//   search(query, { unit?, limit }) -> Person[]   every word of the query must match name, title, unit or a number
//   person(id)                      -> Person | null
// A Person: { id, name, title, unit, unitId, phone?, mobile?, email?, room?, manager?, link? }

export class DirectoryUnavailable extends Error { constructor(message = 'The phone book did not answer.') { super(message); this.name = 'DirectoryUnavailable'; } }

const text = value => typeof value === 'string' && value.trim() ? value.trim() : undefined;
/**
 * One record of the phone book API as a Person, or null when it must not be shown. THIS IS THE FUNCTION TO ADAPT to the
 * real API: the field names on the right are an assumption (see README.md, "The phone book API"). A record marked as
 * protected or hidden is dropped here, before anything else sees it, and private fields are never read.
 */
export function toPerson(raw, baseUrl = '') {
  if (!raw || typeof raw !== 'object' || raw.protected === true || raw.hidden === true) return null;
  const id = text(String(raw.id ?? '')), name = text(raw.name) ?? text([raw.givenName, raw.familyName].filter(Boolean).join(' '));
  if (!id || !/^[A-Za-z0-9_.@-]+$/.test(id) || !name) return null;
  const person = { id, name, title: text(raw.title) ?? '', unit: text(raw.unit?.name ?? raw.unitName) ?? '', unitId: text(String(raw.unit?.id ?? raw.unitId ?? '')) ?? '' };
  for (const [key, value] of [['phone', raw.phone], ['mobile', raw.mobile], ['email', raw.email], ['room', raw.room], ['manager', raw.manager?.name ?? raw.managerName]]) { const v = text(value); if (v) person[key] = v; }
  const link = text(raw.link) ?? (baseUrl ? `${baseUrl}/personer/${encodeURIComponent(id)}` : undefined);
  if (link && /^https?:\/\//.test(link)) person.link = link;
  return person;
}

/**
 * The organisation's phone book over HTTP with one integration key (`service` mode: the connector narrows every answer
 * itself). Expects `GET {url}/persons?q=&unit=&limit=` -> `{ persons: [...] }` and `GET {url}/persons/{id}` -> one record.
 */
export function createHttpDirectory({ url, apiKey, fetch: fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
  if (!url) throw new Error('TELEFONBOK_URL is required for the http adapter.');
  const base = url.replace(/\/+$/, '');
  async function get(path) {
    let response;
    try { response = await fetchImpl(base + path, { headers: { accept: 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) }, signal: AbortSignal.timeout(timeoutMs) }); }
    catch { throw new DirectoryUnavailable(); }
    if (response.status === 404) return null;
    if (!response.ok) throw new DirectoryUnavailable(`The phone book answered ${response.status}.`);
    try { return await response.json(); } catch { throw new DirectoryUnavailable('The phone book answered something that is not JSON.'); }
  }
  return {
    async search(query, { unit, limit = 50 } = {}) {
      const params = new URLSearchParams({ q: query ?? '', limit: String(limit) });
      if (unit) params.set('unit', unit);
      const body = await get('/persons?' + params);
      const rows = Array.isArray(body) ? body : body?.persons;
      return (Array.isArray(rows) ? rows : []).map(r => toPerson(r, base)).filter(Boolean).slice(0, limit);
    },
    async person(id) { return toPerson(await get('/persons/' + encodeURIComponent(id)), base); },
  };
}

// A made-up organisation. The numbers are from the ranges the Swedish Post and Telecom Authority reserves for fiction
// (0980-319 2xx and 070-174 06 xx), the addresses are under `.example`. The unit ids are the ones Clew's development
// seed uses, so "Mitt team" shows people for the seeded personas. One record is protected and must never be shown.
const FIXTURE = [
  ['p1001', 'Hillevi Berg', 'Rektor', 'unit-skola', 'Bergsåkers skola', '0980-319 201', '070-174 06 11', 'A101', null],
  ['p1002', 'Hassan Ali', 'Lärare', 'unit-skola', 'Bergsåkers skola', '0980-319 202', '070-174 06 12', 'B204', 'Hillevi Berg'],
  ['p1003', 'Anna Lindqvist', 'Lärare', 'unit-skola', 'Bergsåkers skola', '0980-319 203', null, 'B205', 'Hillevi Berg'],
  ['p1004', 'Erik Sandström', 'Skoladministratör', 'unit-skola', 'Bergsåkers skola', '0980-319 204', '070-174 06 14', 'A102', 'Hillevi Berg'],
  ['p1005', 'Maja Nordin', 'Vaktmästare', 'unit-skola', 'Bergsåkers skola', null, '070-174 06 15', null, 'Hillevi Berg'],
  ['p2001', 'Karin Holm', 'Enhetschef', 'unit-omsorg', 'Hemtjänst Centrum', '0980-319 221', '070-174 06 21', 'C12', null],
  ['p2002', 'Omar Said', 'Undersköterska', 'unit-omsorg', 'Hemtjänst Centrum', null, '070-174 06 22', null, 'Karin Holm'],
  ['p2003', 'Lena Åkesson', 'Undersköterska', 'unit-omsorg', 'Hemtjänst Centrum', null, '070-174 06 23', null, 'Karin Holm'],
  ['p2004', 'Jonas Öberg', 'Samordnare', 'unit-omsorg', 'Hemtjänst Centrum', '0980-319 224', '070-174 06 24', 'C14', 'Karin Holm'],
  ['p3001', 'Mikael Ström', 'IT-chef', 'unit-it', 'IT och digitalisering', '0980-319 241', '070-174 06 31', 'D301', null],
  ['p3002', 'Sara Lund', 'Systemförvaltare', 'unit-it', 'IT och digitalisering', '0980-319 242', '070-174 06 32', 'D302', 'Mikael Ström'],
  ['p3003', 'Robin Ek', 'Supporttekniker', 'unit-it', 'IT och digitalisering', '0980-319 243', null, 'D303', 'Mikael Ström'],
  ['p4001', 'Eva Granlund', 'HR-partner', 'unit-hr', 'HR-avdelningen', '0980-319 261', '070-174 06 41', 'E110', null],
  ['p4002', 'Peter Wallin', 'Löneadministratör', 'unit-hr', 'HR-avdelningen', '0980-319 262', null, 'E112', 'Eva Granlund'],
  ['p9001', 'Skyddad Person', 'Handläggare', 'unit-hr', 'HR-avdelningen', '0980-319 299', '070-174 06 99', 'E199', 'Eva Granlund', true],
].map(([id, name, title, unitId, unit, phone, mobile, room, managerName, isProtected]) => ({
  id, name, title, unit: { id: unitId, name: unit }, phone, mobile, room, managerName, protected: isProtected === true,
  email: name.toLowerCase().replace(/å|ä/g, 'a').replace(/ö/g, 'o').replace(/\s+/g, '.') + '@kommun.example',
  // The phone book also holds what Clew must never show; the mapping ignores it.
  homeAddress: 'Hemvägen 1', personalNumber: '19000101-0000',
}));
const fold = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const digits = s => String(s ?? '').replace(/\D/g, '');

/** The fixture as the same port, filtered the way a phone book API would: every word must be found somewhere on the person. */
export function createFixtureDirectory(records = FIXTURE, baseUrl = 'https://telefonbok.kommun.example') {
  const people = () => records.map(r => toPerson(r, baseUrl)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  return {
    async search(query, { unit, limit = 50 } = {}) {
      const words = fold(query).split(/\s+/).filter(Boolean);
      return people().filter(p => !unit || p.unitId === unit).filter(p => {
        const hay = fold(`${p.name} ${p.title} ${p.unit} ${p.email ?? ''}`), numbers = digits(`${p.phone ?? ''} ${p.mobile ?? ''}`);
        return words.every(w => hay.includes(w) || (digits(w).length >= 3 && numbers.includes(digits(w))));
      }).slice(0, limit);
    },
    async person(id) { return people().find(p => p.id === id) ?? null; },
  };
}
