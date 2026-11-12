import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { Actor, ThreadDraft } from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { manifestProblems, parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { ExecuteResultSchema, ScanResponseSchema, ThreadDraftSchema } from '../../packages/connectors/src/protocol';
import { createConnector, createManifest } from '../../connectors/nextcloud-approval/connector.mjs';
import {
  SourceDenied,
  SourceLost,
  SourceUnavailable,
  createFixtureApproval,
  type ApprovalSource,
  type DecideAnswer,
} from '../../connectors/nextcloud-approval/approvals.mjs';
import { createNextcloudApproval, parseSearch, searchBody } from '../../connectors/nextcloud-approval/nextcloud.mjs';
import { fileRefPattern, manifest as ncaManifest } from '../../connectors/nextcloud-approval/manifest.mjs';
import { assertionFor, testJwks } from '../connector-authority';

/**
 * The Nextcloud Approval connector (D101): the files that wait for a person's approval, one file's approval, a card per
 * waiting file and the person's decision, carried out as the person and read back from Nextcloud. The stand-in in
 * approvals.mjs decides as Approval 3.3.2 did in the recorded exchanges (connectors/nextcloud-approval/samples), and the
 * API adapter is run against those recordings, request for request.
 */
const ID = 'nextcloud-approval';
const secret = 'test-secret-test-secret';
const at = Date.parse('2026-11-10T13:00:00Z');

const person = (userName: string, name: string, role: Actor['role'] = 'employee'): Actor => ({
  id: 'person-' + userName,
  name,
  unitId: 'unit-skola',
  unitLabel: 'Bergsåkers skola',
  role,
  userName,
});
const hillevi = person('hillevi', 'Hillevi Berg', 'manager');
const hassan = person('hassan', 'Hassan Ali');
const mikael = person('mikael', 'Mikael Lind');

/** A token as the identity provider issues it for Nextcloud. The stand-in reads it unverified, as SupportManagement's does. */
const tokenFor = (username: string, claims: Record<string, unknown> = {}) =>
  'h.' +
  Buffer.from(
    JSON.stringify({ preferred_username: username, aud: 'nextcloud', exp: at / 1000 + 30 * 86400, ...claims }),
  ).toString('base64url') +
  '.s';
const as = (username: string, claims?: Record<string, unknown>) => ({
  delegate: async () => tokenFor(username, claims),
});
const ref = (id: number) => `${ID}:file:${id}`;
const ajv = addFormats(new Ajv({ strict: false }));
const valid = (schema: object) => ajv.compile(JSON.parse(JSON.stringify(schema)));
const isScan = valid(ScanResponseSchema),
  isDraft = valid(ThreadDraftSchema),
  isResult = valid(ExecuteResultSchema);

type Row = Record<string, unknown>;
type Result = { headline: string; rows: Array<{ ref: string; label: string; outcome: string; detail: string }> };

function stack(options: Parameters<typeof createConnector>[0] = {}) {
  let t = at;
  const now = () => t;
  const nextcloud = createFixtureApproval({ now });
  const service = createConnector({
    jwks: testJwks,
    secret,
    source: nextcloud,
    now,
    publicUrl: 'https://moln.example',
    ...options,
  });
  const connectorFetch: FetchLike = (input, init) => service.handle(new Request(input, init));
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest(service.manifest, ID), {
      url: 'http://nextcloud-approval',
      key: secret,
      assert: assertionFor(ID, secret),
      fetch: connectorFetch,
    }),
  );
  let op = 0;
  const pending = async (actor: Actor, token = actor.userName!) =>
    (await registry.run<{ rows: Row[] }>(actor, `${ID}.pending`, {}, as(token))).rows;
  const state = (actor: Actor, id: number, token = actor.userName!) =>
    registry.run<Row>(actor, `${ID}.state`, { ref: ref(id) }, as(token));
  const scan = (actor: Actor, token = actor.userName!) => registry.scanOne(actor, ID, as(token));
  const card = async (actor: Actor, id: number) => {
    const found = (await scan(actor)).drafts.find(d => d.topic === ref(id));
    if (!found) throw new Error(`No card for ${id}`);
    return found;
  };
  /** The decision as Clew's card decision makes it (threads/usecases/decisions.ts): the action's input and the refs. */
  const decide = (
    actor: Actor,
    verb: 'approve' | 'reject',
    draft: ThreadDraft,
    context: object = as(actor.userName!),
  ) => {
    const action = draft.actions.find(a => a.id === verb)!;
    const payload = {
      ...(action.input ?? {}),
      ...(action.usesItems ? { refs: draft.items!.filter(i => i.selected).map(i => i.ref) } : {}),
    };
    return registry.run<Result>(actor, action.capability, payload, { operationId: 'op-' + ++op, ...context });
  };
  /** A request straight to the service, signed for `actor`, as Clew sends it. */
  const post = async (actor: Actor, path: string, body: object, headers: Record<string, string> = {}) =>
    service.handle(
      new Request('http://nextcloud-approval' + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + (await assertionFor(ID, secret)(actor)),
          'x-clew-connector-key': secret,
          ...headers,
        },
        body: JSON.stringify({ actor, ...body }),
      }),
    );
  return {
    registry,
    nextcloud,
    service,
    connectorFetch,
    pending,
    state,
    scan,
    card,
    decide,
    post,
    advance: (seconds: number) => (t += seconds * 1000),
  };
}

describe('the Nextcloud Approval connector', () => {
  test('declares what waits, one file and two decisions, acts as the person and scans', () => {
    expect(manifestProblems(ncaManifest, ID)).toEqual([]);
    const m = parseManifest(ncaManifest, ID);
    expect([m.kind, m.source, m.scan, m.delegation]).toEqual([
      'passthrough',
      'Nextcloud',
      true,
      { audience: 'nextcloud' },
    ]);
    expect(m.capabilities.map(c => [c.name, c.kind, c.model])).toEqual([
      [`${ID}.pending`, 'read', true],
      [`${ID}.state`, 'read', false],
      [`${ID}.open`, 'read', false],
      [`${ID}.approve`, 'execute', false],
      [`${ID}.reject`, 'execute', false],
    ]);
    // No operation id and a repeat refused like a forbidden decision: nothing makes a replay safe.
    for (const c of m.capabilities.filter(c => c.kind === 'execute'))
      expect(c.execution).toEqual({ strategy: 'manual' });
    // A tool, but the model is handed the count: file names are someone else's words and the rows name people.
    const pending = m.capabilities.find(c => c.name === `${ID}.pending`)!;
    expect([pending.view?.kind, pending.view && 'modelReads' in pending.view && pending.view.modelReads]).toEqual([
      'table',
      'summary',
    ]);
    expect(m.areas.map(a => [a.id, a.roles, a.standing])).toEqual([
      ['approvals', ['manager', 'employee'], [`${ID}.pending`]],
    ]);
    // The audience and the name are the installation's.
    const custom = parseManifest(createManifest({ audience: 'api://moln', source: 'Molnet' }), ID);
    expect([custom.delegation, custom.source]).toEqual([{ audience: 'api://moln' }, 'Molnet']);
  });

  test('passes the conformance check: without a session the reads are refused and the scan asks for authorization', async () => {
    const { connectorFetch } = stack();
    const sign = (key: string) => assertionFor(ID, key);
    const report = await checkConnector({
      key: secret,
      url: 'http://nextcloud-approval',
      id: ID,
      assert: sign(secret),
      assertForeign: sign('another-secret-entirely'),
      fetch: connectorFetch,
    });
    expect(report.findings.filter(f => f.level === 'fail')).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.findings.map(f => f.text)).toContain(
      `${ID}.pending as manager: refused without the person's token, as a delegating connector should (Din inloggning kan inte styrkas mot Nextcloud i den här sessionen.)`,
    );
  });

  test('lists what waits for each person, newest request first, and nothing for someone who approves nothing', async () => {
    const { pending } = stack();
    const rows = await pending(hillevi);
    expect(rows).toEqual([
      {
        ref: ref(625),
        file: 'Inköp av läsplattor.txt',
        requestedBy: 'Erik Sandström',
        requestedAt: '2026-11-10T12:57:00.000Z',
        link: 'https://moln.example/index.php/f/625',
      },
      expect.objectContaining({ ref: ref(627), file: 'Plan för klassresa.txt' }),
      expect.objectContaining({ ref: ref(626), file: 'Schema för studiedag.txt' }),
    ]);
    for (const row of rows) expect(String(row.ref)).toMatch(new RegExp(fileRefPattern));
    expect((await pending(hassan)).map(r => r.file)).toEqual([
      'Rutin för överlämning.txt',
      'Beställning av förbrukningsmaterial.txt',
    ]);
    expect(await pending(mikael)).toEqual([]);
  });

  test("one file's approval: waiting for the person, waiting for another approver, not found when out of reach", async () => {
    const { state, nextcloud, registry } = stack();
    expect(await state(hillevi, 625)).toEqual({
      ref: ref(625),
      file: 'Inköp av läsplattor.txt',
      status: 'Väntar på dig',
      requestedBy: 'Erik Sandström',
      requestedAt: '2026-11-10T12:57:00.000Z',
      link: 'https://moln.example/index.php/f/625',
    });
    // Hassan approves under the same rule but cannot reach the file; a file that does not exist reads the same.
    for (const [actor, id] of [
      [hassan, 625],
      [hillevi, 99999999],
    ] as const)
      await expect(state(actor, id)).rejects.toThrow('Filen finns inte, eller så kommer du inte åt den.');
    // Someone who reaches the file but approves nothing sees whose move it is.
    nextcloud.controls.share(625, 'mikael');
    expect((await state(mikael, 625)).status).toBe('Väntar på en annan godkännare');
    await expect(
      registry.run(hillevi, `${ID}.state`, { ref: 'nextcloud-approval:file:abc' }, as('hillevi')),
    ).rejects.toThrow();
  });

  test('a card per waiting file, bound to the version it lists, with an honest and stable snapshot', async () => {
    const { scan, nextcloud } = stack();
    const first = await scan(hillevi);
    expect(isScan(first)).toBe(true);
    expect(first.observation).toMatchObject({
      scope: 'unit-skola:manager',
      observedAt: '2026-11-10T13:00:00.000Z',
      completeness: 'complete',
      exhausted: true,
    });
    expect(first.drafts.map(d => d.topic)).toEqual([ref(625), ref(627), ref(626)]);
    for (const d of first.drafts) expect(isDraft(d)).toBe(true);
    const etag = (await nextcloud.versions(tokenFor('hillevi'), 'hillevi', [625]))[0]!.etag;
    expect(first.drafts[0]).toEqual({
      topic: ref(625),
      area: 'approvals',
      title: 'Godkänn eller avvisa Inköp av läsplattor.txt',
      summary: 'Godkännande begärt 10 nov kl. 13:57. Ditt beslut gäller för alla som kan godkänna filen.',
      reason: 'Du kan godkänna filen i Nextcloud',
      items: [
        {
          ref: ref(625),
          revision: etag,
          label: 'Inköp av läsplattor.txt',
          detail: 'Godkännande begärt 10 nov kl. 13:57',
          selectable: false,
          selected: true,
        },
      ],
      actions: [
        {
          id: 'approve',
          label: 'Godkänn',
          capability: `${ID}.approve`,
          kind: 'execute',
          role: 'primary',
          usesItems: true,
          input: { files: { [ref(625)]: { etag, name: 'Inköp av läsplattor.txt' } } },
        },
        {
          id: 'open',
          label: 'Öppna i Nextcloud',
          capability: `${ID}.open`,
          kind: 'read',
          role: 'secondary',
          target: 'link',
          input: { ref: ref(625) },
        },
        {
          id: 'state',
          label: 'Visa godkännandet',
          capability: `${ID}.state`,
          kind: 'read',
          role: 'secondary',
          target: 'panel',
          input: { ref: ref(625) },
        },
        {
          id: 'reject',
          label: 'Avvisa',
          capability: `${ID}.reject`,
          kind: 'execute',
          role: 'secondary',
          usesItems: true,
          input: { files: { [ref(625)]: { etag, name: 'Inköp av läsplattor.txt' } } },
          confirm: 'Avvisa filen? Ditt beslut gäller för alla som kan godkänna den.',
        },
      ],
      occurrences: [{ key: ref(625), revision: etag, period: String(at / 1000 - 180) }],
    });
    // The file name is the only source text a card carries: no requester, no account, no message.
    expect(JSON.stringify(first.drafts)).not.toMatch(/erik|Erik|Sandström/);
    // The same source state gives the same cards and the same version.
    expect(await scan(hillevi)).toEqual(first);
    expect(await scan(mikael)).toMatchObject({
      drafts: [],
      observation: { completeness: 'complete', exhausted: true },
    });
  });

  test('approves the version the card showed, and the receipt is what Nextcloud reads back', async () => {
    const { card, decide, pending, state, scan } = stack();
    const result = await decide(hillevi, 'approve', await card(hillevi, 625));
    expect(isResult(result)).toBe(true);
    expect(result).toEqual({
      headline: 'Filen är godkänd i Nextcloud.',
      rows: [
        {
          ref: ref(625),
          label: 'Inköp av läsplattor.txt',
          outcome: 'done',
          detail: 'Godkänd i Nextcloud av Hillevi Berg 10 nov kl. 14:00.',
        },
      ],
    });
    expect((await pending(hillevi)).map(r => r.ref)).toEqual([ref(627), ref(626)]);
    expect(await state(hillevi, 625)).toMatchObject({
      status: 'Godkänd',
      decidedBy: 'Hillevi Berg',
      decidedAt: '2026-11-10T13:00:00.000Z',
    });
    // The file no longer waits, and the complete snapshot lets Clew resolve its card by absence.
    expect(await scan(hillevi)).toMatchObject({ observation: { completeness: 'complete' } });
    expect((await scan(hillevi)).drafts.map(d => d.topic)).toEqual([ref(627), ref(626)]);
  });

  test('rejects, and the receipt says who rejected and when', async () => {
    const { card, decide, state } = stack();
    expect(await decide(hillevi, 'reject', await card(hillevi, 626))).toEqual({
      headline: 'Filen är avvisad i Nextcloud.',
      rows: [
        {
          ref: ref(626),
          label: 'Schema för studiedag.txt',
          outcome: 'done',
          detail: 'Avvisad i Nextcloud av Hillevi Berg 10 nov kl. 14:00.',
        },
      ],
    });
    expect((await state(hillevi, 626)).status).toBe('Avvisad');
  });

  test("a file changed after it was listed is refused by Nextcloud's own check, and the next card carries the new version", async () => {
    const { card, decide, nextcloud, state } = stack();
    const listed = await card(hillevi, 626);
    nextcloud.controls.edit(626);
    expect(await decide(hillevi, 'approve', listed)).toEqual({
      headline: 'Beslutet registrerades inte i Nextcloud.',
      rows: [
        {
          ref: ref(626),
          label: 'Schema för studiedag.txt',
          outcome: 'failed',
          detail: 'Filen har ändrats sedan kortet skapades. Granska den nya versionen i Nextcloud innan du beslutar.',
        },
      ],
    });
    expect((await state(hillevi, 626)).status).toBe('Väntar på dig');
    // Same work, changed: the same key and period, a new revision, and the new version in the decision.
    const changed = await card(hillevi, 626);
    expect(changed.occurrences![0]).toMatchObject({
      key: listed.occurrences![0]!.key,
      period: listed.occurrences![0]!.period,
    });
    expect(changed.occurrences![0]!.revision).not.toBe(listed.occurrences![0]!.revision);
    expect(changed.items![0]!.revision).toBe(changed.occurrences![0]!.revision);
    expect((await decide(hillevi, 'approve', changed)).rows[0]!.outcome).toBe('done');
  });

  test('a decision already made is reported as what it is: the same one by the person, the opposite one, someone else’s', async () => {
    const { card, decide, nextcloud, advance } = stack();
    const listed = await card(hillevi, 625);
    await decide(hillevi, 'approve', listed);
    advance(60);
    // Nextcloud refuses the repeat like a forbidden decision; the state read back shows the person's own approval.
    expect((await decide(hillevi, 'approve', listed)).rows[0]).toMatchObject({
      outcome: 'done',
      detail: 'Redan godkänd i Nextcloud av Hillevi Berg 10 nov kl. 14:00. Inget nytt beslut behövdes.',
    });
    expect((await decide(hillevi, 'reject', listed)).rows[0]).toMatchObject({
      outcome: 'failed',
      detail: 'Filen är redan godkänd av Hillevi Berg 10 nov kl. 14:00.',
    });
    // The first approver to decide decides for everyone.
    nextcloud.controls.share(631, 'hillevi');
    const hers = await card(hillevi, 631);
    await decide(hassan, 'approve', await card(hassan, 631));
    expect(await decide(hillevi, 'approve', hers)).toEqual({
      headline: 'Beslutet registrerades inte i Nextcloud.',
      rows: [
        {
          ref: ref(631),
          label: 'Beställning av förbrukningsmaterial.txt',
          outcome: 'failed',
          detail: 'Filen är redan godkänd av Hassan Ali 10 nov kl. 14:01.',
        },
      ],
    });
  });

  test('a file the person can no longer reach is refused and leaves their list', async () => {
    const { card, decide, nextcloud, pending, scan } = stack();
    const listed = await card(hillevi, 627);
    nextcloud.controls.unshare(627, 'hillevi');
    expect((await decide(hillevi, 'approve', listed)).rows[0]).toMatchObject({
      outcome: 'failed',
      detail: 'Du kommer inte längre åt filen i Nextcloud, eller så finns den inte kvar.',
    });
    expect((await pending(hillevi)).map(r => r.ref)).toEqual([ref(625), ref(626)]);
    expect(await scan(hillevi)).toMatchObject({ observation: { completeness: 'complete' } });
    // An approver of the rule who never reached the file, with someone else's card (sample 17): the same refusal.
    expect((await decide(hassan, 'approve', await card(hillevi, 625))).rows[0]!.detail).toBe(
      'Du kommer inte längre åt filen i Nextcloud, eller så finns den inte kvar.',
    );
  });

  test('a new request after a decision is new work on the same file', async () => {
    const { card, decide, nextcloud, advance } = stack();
    const first = await card(hillevi, 625);
    await decide(hillevi, 'approve', first);
    advance(86400);
    nextcloud.controls.request(625);
    const again = await card(hillevi, 625);
    expect(again.occurrences![0]!.key).toBe(first.occurrences![0]!.key);
    expect(again.occurrences![0]!.period).not.toBe(first.occurrences![0]!.period);
    expect((await decide(hillevi, 'reject', again)).rows[0]!.outcome).toBe('done');
  });

  test("without the person's token nothing is read or written, and the scan asks for authorization", async () => {
    const { registry, card, decide, post, state } = stack();
    const listed = await card(hillevi, 625);
    const none = { delegate: async () => undefined };
    for (const name of ['pending', 'state'])
      await expect(
        registry.run(hillevi, `${ID}.${name}`, name === 'state' ? { ref: ref(625) } : {}, none),
      ).rejects.toThrow('Din inloggning kan inte styrkas mot Nextcloud i den här sessionen.');
    expect(await decide(hillevi, 'approve', listed, none)).toEqual({
      headline: 'Beslutet registrerades inte i Nextcloud.',
      rows: [
        {
          ref: ref(625),
          label: 'Inköp av läsplattor.txt',
          outcome: 'failed',
          detail: 'Din inloggning kan inte styrkas mot Nextcloud i den här sessionen. Inget beslut skickades.',
        },
      ],
    });
    expect((await state(hillevi, 625)).status).toBe('Väntar på dig');
    // Clew does not call a delegating scan without a session; asked anyway, the connector says what it lacks.
    expect(await (await post(hillevi, '/clew/scan', {})).json()).toMatchObject({
      drafts: [],
      observation: { completeness: 'authorization-required', exhausted: false },
    });
    expect(await registry.scanOne(hillevi, ID, none)).toMatchObject({
      observation: { completeness: 'authorization-required' },
    });
  });

  test('a token Nextcloud refuses is denied, and no decision is made with it', async () => {
    const { registry, card, decide, nextcloud, scan, state } = stack();
    const listed = await card(hillevi, 625);
    for (const claims of [{ aud: 'eneo' }, { exp: at / 1000 - 1 }, { preferred_username: 'nobody' }]) {
      await expect(registry.run(hillevi, `${ID}.pending`, {}, as('hillevi', claims))).rejects.toThrow(
        'Nextcloud godtar inte din inloggning.',
      );
      expect((await decide(hillevi, 'approve', listed, as('hillevi', claims))).rows[0]).toMatchObject({
        outcome: 'failed',
        detail: 'Nextcloud godtar inte din inloggning. Inget beslut skickades.',
      });
    }
    nextcloud.controls.disable('hillevi');
    expect(await scan(hillevi)).toMatchObject({ drafts: [], observation: { completeness: 'authorization-required' } });
    nextcloud.controls.enable('hillevi');
    expect((await state(hillevi, 625)).status).toBe('Väntar på dig');
  });

  test("a token is used only under an assertion whose user name is the token's account id", async () => {
    const { registry, card, decide, scan, state } = stack();
    await expect(registry.run(hillevi, `${ID}.pending`, {}, as('hassan'))).rejects.toThrow(
      'Kontot i Nextcloud har ett annat användarnamn än ditt konto i Clew.',
    );
    // Hillevi's assertion with Hassan's token and Hassan's card: refused before anything is sent.
    expect((await decide(hillevi, 'approve', await card(hassan, 631), as('hassan'))).rows[0]).toMatchObject({
      outcome: 'failed',
      detail: 'Kontot i Nextcloud har ett annat användarnamn än ditt konto i Clew. Inget beslut skickades.',
    });
    expect((await state(hassan, 631)).status).toBe('Väntar på dig');
    expect(await scan(hillevi, 'hassan')).toMatchObject({
      drafts: [],
      observation: { completeness: 'authorization-required' },
    });
    // A person provisioned without a user name cannot be matched to an account, so nothing is read for them.
    const { userName: _, ...nameless } = hillevi;
    await expect(registry.run(nameless, `${ID}.pending`, {}, as('hillevi'))).rejects.toThrow(
      'Ditt konto i Clew saknar användarnamn, så din inloggning kan inte styrkas mot Nextcloud.',
    );
    // The user name is compared without regard to case.
    expect(await registry.run(person('Hillevi', 'Hillevi Berg'), `${ID}.pending`, {}, as('hillevi'))).toMatchObject({
      rows: expect.any(Array),
    });
    // Names are compared, not people: someone else given the name `hillevi` (another Clew id) reaches the account left
    // under it, which is why a leaver's account is deleted before the name is given again (README, Identity).
    const newcomer = { ...person('hillevi', 'Hillevi Nyström'), id: 'person-newcomer' };
    expect((await registry.run<{ rows: unknown[] }>(newcomer, `${ID}.pending`, {}, as('hillevi'))).rows).toHaveLength(
      3,
    );
  });

  test('a lost answer is settled by reading the state back, and stays unknown when the read-back does not show it', async () => {
    const { card, decide, nextcloud, state } = stack();
    nextcloud.controls.loseNextAnswer('after');
    expect((await decide(hillevi, 'approve', await card(hillevi, 625))).rows[0]).toMatchObject({
      outcome: 'done',
      detail: 'Godkänd i Nextcloud av Hillevi Berg 10 nov kl. 14:00.',
    });
    nextcloud.controls.loseNextAnswer('before');
    expect(await decide(hillevi, 'approve', await card(hillevi, 626))).toEqual({
      headline: 'Det är oklart om beslutet registrerades i Nextcloud.',
      rows: [
        {
          ref: ref(626),
          label: 'Schema för studiedag.txt',
          outcome: 'unknown',
          detail:
            'Svaret från Nextcloud kom inte fram, och filens status visar inte beslutet. Kontrollera filen i Nextcloud innan du beslutar igen.',
        },
      ],
    });
    expect((await state(hillevi, 626)).status).toBe('Väntar på dig');
  });

  test('an outage is unavailable: never an empty list, a completed snapshot or a decision', async () => {
    const { registry, card, decide, nextcloud, scan } = stack();
    const listed = await card(hillevi, 625);
    nextcloud.controls.outage();
    await expect(registry.run(hillevi, `${ID}.pending`, {}, as('hillevi'))).rejects.toThrow(
      'Nextcloud svarar inte just nu.',
    );
    expect((await decide(hillevi, 'approve', listed)).rows[0]).toMatchObject({
      outcome: 'failed',
      detail: 'Nextcloud svarar inte just nu. Inget beslut skickades.',
    });
    expect(await scan(hillevi)).toMatchObject({ drafts: [], observation: { completeness: 'unavailable' } });
  });

  test('links lead to the file in Nextcloud only when its address is configured', async () => {
    const linked = stack();
    expect(await linked.registry.run(hillevi, `${ID}.open`, { ref: ref(625) }, as('hillevi'))).toEqual({
      url: 'https://moln.example/index.php/f/625',
    });
    const bare = stack({ publicUrl: undefined });
    await expect(bare.registry.run(hillevi, `${ID}.open`, { ref: ref(625) }, as('hillevi'))).rejects.toThrow(
      'Det finns ingen adress till Nextcloud inställd.',
    );
    expect((await bare.card(hillevi, 625)).actions.map(a => a.id)).toEqual(['approve', 'state', 'reject']);
    expect((await bare.pending(hillevi))[0]).not.toHaveProperty('link');
  });

  test('the transport key and the assertion are checked before anything is read', async () => {
    const { service } = stack();
    expect((await service.handle(new Request('http://nextcloud-approval/clew/manifest'))).status).toBe(200);
    const call = (headers: Record<string, string>) =>
      service.handle(
        new Request(`http://nextcloud-approval/clew/capabilities/${ID}.pending`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-clew-delegated-token': tokenFor('hillevi'), ...headers },
          body: JSON.stringify({ input: {} }),
        }),
      );
    expect((await call({})).status).toBe(401);
    expect(
      (await call({ 'x-clew-connector-key': 'wrong-secret-wrong-secret', authorization: 'Bearer x.y.z' })).status,
    ).toBe(401);
    expect((await call({ 'x-clew-connector-key': secret, authorization: 'Bearer x.y.z' })).status).toBe(401);
  });
});

// ---- The API adapter against the recorded exchanges: the request it sends is the one recorded, and it reads the answer
// ---- Nextcloud gave. Tokens were removed from the recordings; here every call carries the token "the-token".

const SAMPLES = join(import.meta.dir, '../../connectors/nextcloud-approval/samples');
type Sample = {
  request: { method: string; path: string; headers: Record<string, string>; body?: string };
  response: { status: number; headers: Record<string, string>; body: unknown };
};
const sample = (n: string): Sample =>
  JSON.parse(
    readFileSync(
      join(
        SAMPLES,
        readdirSync(SAMPLES).find(f => f.startsWith(n + '-'))!,
      ),
      'utf8',
    ),
  );

/** A Nextcloud that answers each request with the next recording, and keeps what it was asked. */
function recorded(...names: string[]) {
  const queue = names.map(sample);
  const calls: Array<{ method: string; path: string; headers: Record<string, string>; body?: string }> = [];
  const fetch = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    calls.push({
      method: init?.method ?? 'GET',
      path: url.pathname + url.search,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    });
    const next = queue.shift();
    if (!next) throw new Error('No recording left for ' + input);
    const { status, headers, body } = next.response;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
  };
  return { source: createNextcloudApproval({ url: 'http://calendar', fetch, allowHttp: true }), calls };
}
/** The recorded request, as this adapter must send it: the same method, path, OCS headers and body. */
function sentAsRecorded(
  call: { method: string; path: string; headers: Record<string, string>; body?: string },
  n: string,
) {
  const { request } = sample(n);
  expect([call.method, call.path]).toEqual([request.method, request.path]);
  expect(call.headers.authorization).toBe('Bearer the-token');
  for (const [name, value] of Object.entries(request.headers))
    if (name !== 'Authorization') expect(call.headers[name.toLowerCase()]).toBe(value);
  if (request.body !== undefined) expect(call.body).toBe(request.body);
}

describe("the Nextcloud API adapter, against Nextcloud's recorded answers", () => {
  test('reads the account behind the token (01)', async () => {
    const { source, calls } = recorded('01');
    expect(await source.whoami('the-token')).toEqual({ id: 'hillevi', name: 'Hillevi Berg' });
    sentAsRecorded(calls[0]!, '01');
    expect(calls[0]!.headers['user-agent']).toBe('Clew');
  });

  test('reads what waits, complete, and an empty list as empty (02, 04)', async () => {
    const { source, calls } = recorded('02', '04');
    expect(await source.pending('the-token')).toEqual([
      {
        fileId: 625,
        name: 'Inköp av läsplattor.txt',
        mimetype: 'text/plain',
        request: { userId: 'erik', userName: 'Erik Sandström', at: 1794345257, message: '' },
      },
      expect.objectContaining({ fileId: 627 }),
      expect.objectContaining({ fileId: 626 }),
    ]);
    expect(await source.pending('the-token')).toEqual([]);
    sentAsRecorded(calls[0]!, '02');
  });

  test("reads one file's state: mine, nothing for no access and no file, decided with who, when and the message", async () => {
    const { source, calls } = recorded('06', '07', '08', '12', '22');
    expect(await source.state('the-token', 625)).toEqual({
      state: 4,
      userId: 'erik',
      userName: 'Erik Sandström',
      at: 1794345257,
      message: '',
    });
    expect(await source.state('the-token', 625)).toEqual({ state: 0 });
    expect(await source.state('the-token', 99999999)).toEqual({ state: 0 });
    expect(await source.state('the-token', 625)).toEqual({
      state: 2,
      userId: 'hillevi',
      userName: 'Hillevi Berg',
      at: 1794345263,
      message: 'Godkänt, beställ före fredag.',
    });
    expect((await source.state('the-token', 626)).state).toBe(3);
    for (const [i, n] of ['06', '07', '08', '12', '22'].entries()) sentAsRecorded(calls[i]!, n);
  });

  test('finds the etag by file id with the recorded WebDAV SEARCH, without its quotes (09, 16)', async () => {
    const { source, calls } = recorded('09', '16');
    expect(await source.versions('the-token', 'hillevi', [625])).toEqual([
      { fileId: 625, etag: '5629f2f17acb44987ae83f7b64f69ff5', name: 'Inköp av läsplattor.txt' },
    ]);
    expect(await source.versions('the-token', 'hillevi', [626])).toEqual([
      { fileId: 626, etag: 'aafcea6477f4cc8ccdeaabf7906f1e7f', name: 'Schema för studiedag.txt' },
    ]);
    sentAsRecorded(calls[0]!, '09');
    sentAsRecorded(calls[1]!, '16');
    // Several ids are one SEARCH with an `or`; a property the server did not find is not read.
    expect(searchBody('hillevi', [625, 626])).toContain(
      '<d:where><d:or><d:eq><d:prop><oc:fileid/></d:prop><d:literal>625</d:literal></d:eq><d:eq><d:prop><oc:fileid/></d:prop><d:literal>626</d:literal></d:eq></d:or></d:where>',
    );
    expect(
      parseSearch(
        '<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><oc:fileid>7</oc:fileid><d:displayname>A &amp; B</d:displayname></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><d:getetag/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response><d:response><d:propstat><d:prop><d:getetag>"e1"</d:getetag><oc:fileid>8</oc:fileid><d:displayname>A &amp; B</d:displayname></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>',
      ),
    ).toEqual([{ fileId: 8, etag: 'e1', name: 'A & B' }]);
  });

  test('tells accepted, stale and not allowed apart only as far as Nextcloud does (10, 11, 13, 14, 17 to 21)', async () => {
    const cases: Array<[string, number, 'approve' | 'reject', string | undefined, string | undefined, DecideAnswer]> = [
      ['10', 625, 'approve', undefined, 'Utan etag', { outcome: 'refused', reason: 'invalid' }],
      [
        '11',
        625,
        'approve',
        '5629f2f17acb44987ae83f7b64f69ff5',
        'Godkänt, beställ före fredag.',
        { outcome: 'accepted' },
      ],
      [
        '13',
        625,
        'approve',
        '5629f2f17acb44987ae83f7b64f69ff5',
        'Godkänt, beställ före fredag.',
        { outcome: 'refused', reason: 'not-allowed' },
      ],
      [
        '14',
        625,
        'reject',
        '5629f2f17acb44987ae83f7b64f69ff5',
        undefined,
        { outcome: 'refused', reason: 'not-allowed' },
      ],
      ['17', 627, 'approve', '31d19d46ff3881c5f960a1de9c079a7c', undefined, { outcome: 'refused', reason: 'stale' }],
      ['18', 627, 'approve', '', undefined, { outcome: 'refused', reason: 'not-allowed' }],
      ['19', 627, 'approve', '31d19d46ff3881c5f960a1de9c079a7c', undefined, { outcome: 'refused', reason: 'stale' }],
      [
        '20',
        626,
        'reject',
        'aafcea6477f4cc8ccdeaabf7906f1e7f',
        'Flytta passet efter lunch.',
        { outcome: 'refused', reason: 'stale' },
      ],
      ['21', 626, 'reject', '0da42acd7c4199eebc0f21150dc72fb7', 'Flytta passet efter lunch.', { outcome: 'accepted' }],
    ];
    for (const [n, id, decision, etag, message, answer] of cases) {
      const { source, calls } = recorded(n);
      expect(await source.decide('the-token', id, decision, etag as string, message)).toEqual(answer);
      sentAsRecorded(calls[0]!, n);
    }
  });

  test('a refused token is denied on every call (25 to 30); a failure is unavailable on a read and lost on a decision', async () => {
    for (const n of ['25', '26', '27', '28', '29', '30'])
      await expect(recorded(n).source.pending('the-token')).rejects.toBeInstanceOf(SourceDenied);
    await expect(recorded('25').source.whoami('the-token')).rejects.toBeInstanceOf(SourceDenied);
    await expect(recorded('25').source.decide('the-token', 625, 'approve', 'e')).rejects.toBeInstanceOf(SourceDenied);
    const failing = (status: number | 'throw'): ApprovalSource =>
      createNextcloudApproval({
        url: 'https://moln.example',
        fetch: async () => {
          if (status === 'throw') throw new TypeError('fetch failed');
          return new Response('', { status });
        },
      });
    await expect(failing(503).pending('t')).rejects.toBeInstanceOf(SourceUnavailable);
    await expect(failing('throw').state('t', 625)).rejects.toBeInstanceOf(SourceUnavailable);
    await expect(failing(502).decide('t', 625, 'approve', 'e')).rejects.toBeInstanceOf(SourceLost);
    await expect(failing('throw').decide('t', 625, 'approve', 'e')).rejects.toBeInstanceOf(SourceLost);
  });

  test('needs an address, and https unless told the network is private', () => {
    expect(() => createNextcloudApproval({})).toThrow('NEXTCLOUD_URL');
    expect(() => createNextcloudApproval({ url: 'http://moln.example' })).toThrow('https');
    expect(() => createNextcloudApproval({ url: 'http://calendar', allowHttp: true })).not.toThrow();
    expect(() => createNextcloudApproval({ url: 'http://localhost:3021' })).not.toThrow();
  });

  test('behind the connector, a decision and its receipt come from the recorded answers (01, 11, 12; 01, 13, 12; 01, 20, 06)', async () => {
    const run = async (names: string[], decision: 'approve' | 'reject', id: number, etag: string, now: number) => {
      const { source } = recorded(...names);
      const service = createConnector({ jwks: testJwks, secret, source, now: () => now });
      const registry = new Registry();
      registry.register(
        remoteConnector(parseManifest(service.manifest, ID), {
          url: 'http://nextcloud-approval',
          key: secret,
          assert: assertionFor(ID, secret),
          fetch: (input, init) => service.handle(new Request(input, init)),
        }),
      );
      return registry.run<Result>(
        hillevi,
        `${ID}.${decision}`,
        { refs: [ref(id)], files: { [ref(id)]: { etag, name: 'Fil' } } },
        { operationId: 'op', delegate: async () => 'the-token' },
      );
    };
    const sent = 1794345262_000;
    expect((await run(['01', '11', '12'], 'approve', 625, '5629f2f17acb44987ae83f7b64f69ff5', sent)).rows[0]).toEqual({
      ref: ref(625),
      label: 'Fil',
      outcome: 'done',
      detail: 'Godkänd i Nextcloud av Hillevi Berg 10 nov kl. 22:14. Meddelande: ”Godkänt, beställ före fredag.”.',
    });
    expect(
      (await run(['01', '13', '12'], 'approve', 625, '5629f2f17acb44987ae83f7b64f69ff5', sent + 60_000)).rows[0],
    ).toMatchObject({ outcome: 'done', detail: expect.stringMatching(/^Redan godkänd i Nextcloud av Hillevi Berg/) });
    expect(
      (await run(['01', '20', '06'], 'reject', 626, 'aafcea6477f4cc8ccdeaabf7906f1e7f', sent)).rows[0],
    ).toMatchObject({
      outcome: 'failed',
      detail: 'Filen har ändrats sedan kortet skapades. Granska den nya versionen i Nextcloud innan du beslutar.',
    });
  });

  test('the stand-in refuses as the recorded Nextcloud does, in the same situations', async () => {
    const nextcloud = createFixtureApproval({ now: () => at });
    const t = (user: string) => tokenFor(user);
    const etagOf = async (user: string, id: number) => (await nextcloud.versions(t(user), user, [id]))[0]!.etag;
    const hers = await etagOf('hillevi', 627);
    // 10: no etag. 17: an approver who cannot reach the file, with the etag Hillevi sees. 18: the same, empty etag.
    // 19: not an approver and no access. Then 11, 13, 14: approve, approve again, reject after approval. 20: stale.
    expect(await nextcloud.decide(t('hillevi'), 625, 'approve', undefined as unknown as string)).toEqual({
      outcome: 'refused',
      reason: 'invalid',
    });
    expect(await nextcloud.decide(t('hassan'), 627, 'approve', hers)).toEqual({ outcome: 'refused', reason: 'stale' });
    expect(await nextcloud.decide(t('hassan'), 627, 'approve', '')).toEqual({
      outcome: 'refused',
      reason: 'not-allowed',
    });
    expect(await nextcloud.decide(t('mikael'), 627, 'approve', hers)).toEqual({ outcome: 'refused', reason: 'stale' });
    const first = await etagOf('hillevi', 625);
    expect(await nextcloud.decide(t('hillevi'), 625, 'approve', first)).toEqual({ outcome: 'accepted' });
    expect(await nextcloud.decide(t('hillevi'), 625, 'approve', first)).toEqual({
      outcome: 'refused',
      reason: 'not-allowed',
    });
    expect(await nextcloud.decide(t('hillevi'), 625, 'reject', first)).toEqual({
      outcome: 'refused',
      reason: 'not-allowed',
    });
    const before = await etagOf('hillevi', 626);
    nextcloud.controls.edit(626);
    expect(await nextcloud.decide(t('hillevi'), 626, 'reject', before)).toEqual({
      outcome: 'refused',
      reason: 'stale',
    });
    // 07, 08: no access and no file both read as nothing.
    expect(await nextcloud.state(t('hassan'), 625)).toEqual({ state: 0 });
    expect(await nextcloud.state(t('hillevi'), 99999999)).toEqual({ state: 0 });
    // 25 to 30: every refused token is the same refusal.
    await expect(nextcloud.pending('not-a-token')).rejects.toBeInstanceOf(SourceDenied);
  });
});
