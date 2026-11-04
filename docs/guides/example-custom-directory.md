# Worked example: Fjällby kommun connects its own employee directory

Fjällby kommun is made up. It runs Clew and has a custom-built employee directory, **Personalregistret**,
with a JSON API its own IT team maintains. Nothing in Personalregistret knows about Clew. Fjällby wants
its employees to find a colleague's phone number and room from the Clew composer, see a colleague's
contact card in the side panel, and open the full record in Personalregistret.

This walks the guide in `creating-an-integration.md` from start to finish. Nothing below exists in the
repository yet; the code compiles against today's types in `packages/connectors` and is the shape a real
directory connector would take. In Sundsvall the same connector would get a `metakatalogen` adapter.

## 1. The note before writing

| Question | Fjällby's answer |
|---|---|
| Who owns the records? | Personalregistret. Clew stores nothing but refs and audit. **Pass-through.** Clew's own `people` core connector keeps only subject, name, unit and role from SCIM. |
| What makes a person act? | Nothing: this domain is find-and-look. Two reads (`search`, `person`) and a link-out. No propose, no execute, no scan. |
| Who may see what? | Every authenticated employee may search and see work contact details of every employee. Home address and personal number exist in Personalregistret and are never part of the contract. |
| How does it recognise the user? | Personalregistret has one API key for integrations. **`service` mode**; Clew narrows every call itself. |
| API? | Yes: `GET /api/v3/persons?q=` and `GET /api/v3/persons/{id}`, JSON, API key header. |
| Licence? | No client library; `fetch` only. Nothing to pin. |
| Already exposed by someone? | No. |

Because the auth mode is `service`, the connector's `scope` and `run` carry the whole authorization. The
contract excludes the fields the directory holds that Clew must never show, so the adapter cannot leak
them even by mistake.

## 2. Path one first: could Fjällby fulfil the contract itself?

Fjällby's IT team was asked whether Personalregistret could expose Clew's directory contract directly.
That would mean two endpoints shaped by Clew's schemas (section 3), accepting the IdP's tokens. They
declined for this year; the API key is what exists. So Clew gets an adapter. The contract is written
anyway, and published as OpenAPI, so the question can be asked again at the next procurement.

## 3. The contract: `packages/directory/src/model.ts`

```ts
import { Type, type Static } from '@sinclair/typebox';

/** A colleague as Clew shows them. Work contact details only; nothing private is in the contract. */
export const DirectoryPersonSchema = Type.Object({
  ref: Type.String(),            // `directory:person:<stable id>`
  name: Type.String(),
  title: Type.String(),          // "Undersköterska", "Rektor"
  unit: Type.String(),           // label, e.g. "Hemtjänst Norra"
  phone: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  room: Type.Optional(Type.String()),
  managerRef: Type.Optional(Type.String()),
  /** Deep link into the source system; rendered as a link-out, never followed by Clew. */
  link: Type.String(),
}, { additionalProperties: false });
export type DirectoryPerson = Static<typeof DirectoryPersonSchema>;

export const DirectorySearchResultSchema = Type.Object({
  ref: Type.String(), name: Type.String(), title: Type.String(), unit: Type.String(),
  /** One line for the result list: phone or room, whatever is most useful. */
  snippet: Type.String(),
  link: Type.String(),
}, { additionalProperties: false });
export type DirectorySearchResult = Static<typeof DirectorySearchResultSchema>;

/**
 * Clew's directory contract. Every directory system is an adapter behind it (D1, D10). The adapter
 * receives the query and the ref only; who may ask is decided in the connector, before this is called.
 */
export interface DirectoryProvider {
  search(query: string, limit: number): Promise<DirectorySearchResult[]>;
  person(ref: string): Promise<DirectoryPerson | null>;
}

export class DirectoryError extends Error {
  constructor(message: string, readonly reason: 'not-found' | 'denied' | 'unavailable') { super(message); this.name = 'DirectoryError'; }
}
```

This is also what Fjällby would implement natively: `POST /clew/directory/v1/search` and
`GET /clew/directory/v1/persons/{ref}` with exactly these schemas.

## 4. The adapter factory: `packages/directory/src/adapters.ts`

```ts
import type { DirectoryProvider } from './model';
import { FjallbyPersonalregistret } from './adapters/fjallby';

export type DirectoryCredential =
  /** Fjällby kommun's Personalregistret: JSON API, one integration key. `service` mode. */
  | { kind: 'fjallby'; url: string; apiKey: string }
  /** Sundsvall's Metakatalogen. Decided in the landscape table, not built. */
  | { kind: 'metakatalogen'; url: string; token: () => Promise<string> };

export function createDirectoryProvider(credential: DirectoryCredential): DirectoryProvider {
  switch (credential.kind) {
    case 'fjallby': return new FjallbyPersonalregistret(credential.url, credential.apiKey);
    case 'metakatalogen': throw new Error('Directory adapter "metakatalogen" is not implemented yet.');
  }
}

/** Configuration is read here and nowhere else. The key comes from a secret, never from source. */
export function directoryCredentialFromEnv(env = process.env): DirectoryCredential {
  const kind = env.DIRECTORY_ADAPTER;
  if (kind === 'fjallby') {
    if (!env.DIRECTORY_URL || !env.DIRECTORY_API_KEY) throw new Error('DIRECTORY_URL and DIRECTORY_API_KEY are required for DIRECTORY_ADAPTER=fjallby.');
    return { kind, url: env.DIRECTORY_URL, apiKey: env.DIRECTORY_API_KEY };
  }
  throw new Error(`Unknown DIRECTORY_ADAPTER "${kind}". Known: fjallby.`);
}
```

## 5. The adapter: `packages/directory/src/adapters/fjallby.ts`

The only file that knows Personalregistret's API. It maps the system's fields onto the contract and
drops everything else on the floor. It stores nothing and logs nothing.

```ts
import { DirectoryError, type DirectoryPerson, type DirectoryProvider, type DirectorySearchResult } from '../model';

/** What Personalregistret returns. Private fields exist in the API and are deliberately not typed here. */
interface PrPerson { id: string; fornamn: string; efternamn: string; befattning: string; enhet: { namn: string }; telefon?: string; epost?: string; rum?: string; chefId?: string; }

export class FjallbyPersonalregistret implements DirectoryProvider {
  constructor(private readonly url: string, private readonly apiKey: string) {}

  private async get<T>(path: string): Promise<T> {
    let res: Response;
    try { res = await fetch(this.url + path, { headers: { 'X-Api-Key': this.apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(5000) }); }
    catch { throw new DirectoryError('Personalregistret svarar inte.', 'unavailable'); }
    if (res.status === 404) throw new DirectoryError('Personen finns inte i Personalregistret.', 'not-found');
    if (res.status === 401 || res.status === 403) throw new DirectoryError('Personalregistret nekade anropet.', 'denied');
    if (!res.ok) throw new DirectoryError('Personalregistret svarar inte.', 'unavailable');
    return res.json() as Promise<T>;
  }
  private ref = (id: string) => `directory:person:${id}`;
  private id = (ref: string) => ref.replace(/^directory:person:/, '');
  private link = (id: string) => `${this.url}/personer/${encodeURIComponent(id)}`;

  async search(query: string, limit: number): Promise<DirectorySearchResult[]> {
    const rows = await this.get<PrPerson[]>(`/api/v3/persons?q=${encodeURIComponent(query)}&limit=${limit}`);
    return rows.map(p => ({ ref: this.ref(p.id), name: `${p.fornamn} ${p.efternamn}`, title: p.befattning, unit: p.enhet.namn,
      snippet: p.telefon ?? p.rum ?? p.enhet.namn, link: this.link(p.id) }));
  }
  async person(ref: string): Promise<DirectoryPerson | null> {
    try {
      const p = await this.get<PrPerson>(`/api/v3/persons/${encodeURIComponent(this.id(ref))}`);
      return { ref, name: `${p.fornamn} ${p.efternamn}`, title: p.befattning, unit: p.enhet.namn, phone: p.telefon, email: p.epost, room: p.rum,
        managerRef: p.chefId ? this.ref(p.chefId) : undefined, link: this.link(p.id) };
    } catch (e) { if (e instanceof DirectoryError && e.reason === 'not-found') return null; throw e; }
  }
}
```

## 6. The connector: `packages/directory/src/connector.ts`

The connector knows Clew: capabilities, scope, Swedish text. It receives a provider and never constructs one.

```ts
import { Type } from '@sinclair/typebox';
import type { Capability, Connector } from '@clew/connectors';
import { DirectoryError, DirectoryPersonSchema, DirectorySearchResultSchema, type DirectoryProvider } from './model';

const CONNECTOR = 'directory';

export function directoryConnector(provider: DirectoryProvider): Connector {
  const capabilities: Capability<any, any>[] = [
    {
      name: 'directory.search', kind: 'read', title: 'Hitta en kollega', model: true,
      description: 'Söker kollegor på namn, befattning eller enhet och ger arbetsrelaterade kontaktuppgifter.',
      input: Type.Object({ query: Type.String({ minLength: 2, maxLength: 80 }) }, { additionalProperties: false }),
      output: Type.Object({ rows: Type.Array(DirectorySearchResultSchema) }),
      scope: () => true,                       // every authenticated employee; the contract already excludes private fields
      run: async (_actor, input: { query: string }) => ({ rows: await provider.search(input.query, 20) }),
    },
    {
      name: 'directory.person', kind: 'read', title: 'Kontaktkort', model: true,
      description: 'Arbetsrelaterade kontaktuppgifter för en kollega: telefon, e-post, rum, enhet och chef.',
      input: Type.Object({ ref: Type.String({ pattern: '^directory:person:' }) }, { additionalProperties: false }),
      output: Type.Object({ person: Type.Union([DirectoryPersonSchema, Type.Null()]) }),
      scope: () => true,
      run: async (_actor, input: { ref: string }) => ({ person: await provider.person(input.ref) }),
    },
    {
      name: 'directory.open', kind: 'read', title: 'Öppna i Personalregistret', model: false,
      description: 'Länk till personens fullständiga post i källsystemet.',
      input: Type.Object({ ref: Type.String() }, { additionalProperties: false }),
      output: Type.Object({ url: Type.String() }),
      scope: () => true,
      run: async (_actor, input: { ref: string }) => {
        const p = await provider.person(input.ref);
        if (!p) throw new DirectoryError('Personen finns inte i Personalregistret.', 'not-found');
        return { url: p.link };
      },
    },
  ];
  return {
    id: CONNECTOR, kind: 'passthrough', source: 'Personalregistret',
    areas: [],            // find-and-look: no sidebar area, no figure, no schedules
    capabilities,         // no scan: the directory never pushes a card
  };
}
```

Three things to notice. `directory.open` is `model: false`: a link is for the person, not the model.
Nothing here is `execute`, so there is no receipt and no undo. And the `source` label is what cards and
the composer show; it is the system's name as employees know it, not the vendor's.

Where it lands on the page: `directory.search` is what the search fan-out in `integration-paths.md`
calls; its rows render as a Vy in the main column. Clicking a row opens `directory.person` in the side
panel as a view (D9), with "Öppna i Personalregistret" as the link-out. Any row can be added to the
conversation as a chip (D12), so "boka ett möte med @Anna Lind" works with the directory as the source
of the person and the calendar as the source of the time.

## 7. Register and configure

`apps/server/src/connectors.ts`, in the list of connectors:

```ts
import { createDirectoryProvider, directoryCredentialFromEnv } from '@clew/directory/adapters';
import { directoryConnector } from '@clew/directory/connector';
// …
directoryConnector(createDirectoryProvider(directoryCredentialFromEnv())),
```

`apps/server/.env.example`:

```
DIRECTORY_ADAPTER=
DIRECTORY_URL=
DIRECTORY_API_KEY=
```

In Fjällby's `.env.local` (dev) or secret mount (production):

```
DIRECTORY_ADAPTER=fjallby
DIRECTORY_URL=https://personalregistret.fjallby.se
DIRECTORY_API_KEY=<from the secrets store>
```

The package: `packages/directory/package.json` with `exports` for `./model`, `./adapters` and `./connector`,
`@clew/connectors` and `@sinclair/typebox` as dependencies, added to the root `devDependencies` as
`workspace:*`, then:

```sh
docker exec -w /workspace clew-app-1 bun install --frozen-lockfile
```

## 8. Test

`tests/unit/directory.test.ts`, with a fake provider and no network:

```ts
import { describe, expect, test } from 'bun:test';
import { Registry, type Actor } from '../../packages/connectors/src/index';
import { directoryConnector } from '../../packages/directory/src/connector';
import type { DirectoryProvider } from '../../packages/directory/src/model';

const anna = { ref: 'directory:person:42', name: 'Anna Lind', title: 'Undersköterska', unit: 'Hemtjänst Norra', phone: '060-19 10 00', link: 'https://pr.test/personer/42' };
const fake: DirectoryProvider = {
  async search(q) { return q.toLowerCase().includes('anna') ? [{ ...anna, snippet: anna.phone }] : []; },
  async person(ref) { return ref === anna.ref ? anna : null; },
};
const hassan: Actor = { id: 'hassan', name: 'Hassan Ali', unitId: 'unit-hemtjanst', unitLabel: 'Hemtjänst Norra', role: 'employee' };
const registry = () => new Registry().register(directoryConnector(fake));

describe('directory connector', () => {
  test('search returns rows with refs and a link, and nothing private', async () => {
    const out = await registry().run<{ rows: Array<Record<string, unknown>> }>(hassan, 'directory.search', { query: 'Anna' });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ ref: 'directory:person:42', name: 'Anna Lind' });
    expect(Object.keys(out.rows[0]!)).not.toContain('personnummer');
  });
  test('person returns null for an unknown ref instead of throwing', async () => {
    const out = await registry().run<{ person: unknown }>(hassan, 'directory.person', { ref: 'directory:person:999' });
    expect(out.person).toBeNull();
  });
  test('exposes search and person as tools, never the link-out', () => {
    expect(registry().tools(hassan).map(t => t.name)).toEqual(['directory.search', 'directory.person']);
  });
});
```

The adapter gets its own test against a recorded fixture of Personalregistret's responses (two JSON
files under `tests/fixtures/fjallby/`), asserting the field mapping, the ref prefix, and each of the
three error mappings. The mapping test is the one that proves no private field crosses the contract.

Then in Chrome: type "anna" in the composer, see the Vy, open the contact card in the panel, follow the
link-out, add Anna as a chip and ask for a meeting.

## 9. Document

- Landscape table in `docs/architecture/integration-paths.md`: a row for Personalregistret, pass-through
  read in `service` mode, `directory.search` in the fan-out, link-out for everything else.
- `HANDOVER.md` section 3: no new dependency; section 8: `packages/directory`.
- No decision needed: a pass-through connector with reads only. If Fjällby later wants "update my phone
  number" from Clew, that is an `execute` with a receipt, and it still needs no decision; if they want
  Clew to be the directory, that is a core connector and does (see `docs/vision.md`, "Owning the model").

## What changes for Sundsvall

Same package, one more adapter: `adapters/metakatalogen.ts` implementing `DirectoryProvider` against
Metakatalogen's API, in whichever auth mode Metakatalogen supports, selected by
`DIRECTORY_ADAPTER=metakatalogen`. The connector, the capabilities, the tests above and the UI do not change.
That is the whole point of writing the contract first.
