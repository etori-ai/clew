import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { type Actor } from '../../packages/connectors/src/index';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector, createManifest, type Message } from '../../connectors/supportmanagement/connector.mjs';
import {
  SourceDenied,
  createFixtureErrands,
  ownerOf,
  toMessages,
  type FixtureErrands,
} from '../../connectors/supportmanagement/errands.mjs';
import {
  byOwner,
  channelOf,
  escapeMarkdown,
  mailLink,
  mailSubject,
  ownWords,
  requestState,
  shownTo,
  toOwner,
} from '../../connectors/supportmanagement/owner.mjs';
import { assertionFor, testJwks } from '../connector-authority';

/**
 * An errand's owner in SupportManagement (docs/reviews/2026-11-23-an-errand-owner-answers-supportmanagement-from-clew.md):
 * a manager who sent something to Lön och pension or Intern kundtjänst sees it in "Mina beställningar", reads the
 * messages between the drake and them, and answers: by mail from their own mailbox, or through Open-E from Clew.
 * SupportManagement does not decide access today, so the connector checks the person's token and holds the rule. These
 * tests are about that boundary: nothing of another person's errand, and nothing on an errand that passed between
 * handlers or to someone else, leaves the connector. The made-up SupportManagement stands in for the system.
 */
const secret = 'test-secret-test-secret';
const at = Date.parse('2026-11-23T09:00:00Z');
/** The fixture's clock: still, unless a test moves it on. */
let clock = at;
const now = () => clock;
const day = 86_400_000;
const issuer = 'https://idp.test/realms/clew';

const person = (userName: string, name: string): Actor => ({
  id: 'person-' + userName,
  name,
  unitId: 'unit-skola',
  unitLabel: 'Bergsåkers skola',
  role: 'employee',
  userName,
});
const hillevi = person('hillevi', 'Hillevi Berg');
const hassan = person('hassan', 'Hassan Ali');
const mikael = person('mikael', 'Mikael Lind');

/** An identity provider: a key pair, its public key set, and tokens signed with it. */
function provider() {
  const keys = generateKeyPair('RS256', { extractable: true });
  return {
    jwks: async () => ({
      keys: [{ ...(await exportJWK((await keys).publicKey)), kid: 'idp-1', alg: 'RS256', use: 'sig' }],
    }),
    token: async (username: string, claims: Record<string, unknown> = {}) =>
      new SignJWT({
        preferred_username: username,
        iss: issuer,
        aud: 'supportmanagement',
        exp: at / 1000 + 60,
        ...claims,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'idp-1', typ: 'JWT' })
        .sign((await keys).privateKey),
  };
}
const idp = provider();
const stranger = provider();
const as = (username: string) => ({ delegate: async () => idp.token(username) });

type Row = Record<string, unknown>;
const LOP21 = 'request:sm:0000:LOP:b2e1d4c3-0002-4000-8000-000000000002';
const IK15 = 'request:sm:0000:IK:a1f0c3d2-0006-4000-8000-000000000006';
const IK04 = 'request:sm:0000:IK:a1f0c3d2-0002-4000-8000-000000000002';
const IK19 = 'request:sm:0000:IK:a1f0c3d2-0005-4000-8000-000000000005';
const NOT_FOUND = 'Ärendet finns inte, eller så har du inte tillgång till det.';

function stack(wrap: (source: FixtureErrands) => FixtureErrands = source => source) {
  const lines: Row[] = [];
  const source = createFixtureErrands({ now });
  const sm = createConnector({
    jwks: testJwks,
    secret,
    now,
    log: line => lines.push(line),
    source: wrap(source),
    owner: {
      identity: { issuer, jwks: idp.jwks },
      replyAddresses: { IK: 'ik@clew.test', LOP: 'lon@clew.test' },
    },
  });
  const seen: Response[] = [];
  const connectorFetch: FetchLike = async (input, init) => {
    const response = await sm.handle(new Request(input, init));
    seen.push(response.clone());
    return response;
  };
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest(sm.manifest, 'sm'), {
      url: 'http://sm-connector',
      key: secret,
      assert: assertionFor('sm', secret),
      fetch: connectorFetch,
    }),
  );
  return { registry, sm, source, lines, seen };
}
const requests = async (registry: Registry, who: Actor, context: object = as(who.userName!)) =>
  (await registry.run<{ rows: Row[] }>(who, 'sm.requests', {}, context)).rows;
const openRequest = (registry: Registry, who: Actor, ref: string, context: object = as(who.userName!)) =>
  registry.run<Row & { body: string }>(who, 'sm.request', { ref }, context);
let op = 0;
const reply = (registry: Registry, who: Actor, ref: string, text: string, operationId = 'op-' + ++op) =>
  registry.run<{ headline: string; rows: Row[] }>(
    who,
    'sm.reply',
    { ref, text },
    { operationId, ...as(who.userName!) },
  );
const scan = (registry: Registry, who: Actor) => registry.scanOne(who, 'sm', as(who.userName!));

describe('the owner’s side is declared', () => {
  test('only when switched on: the requests profile, one errand as text, the answer and its effect, and a scan', () => {
    const off = parseManifest(createManifest(), 'sm');
    expect(off.capabilities.map(c => c.name)).toEqual(['sm.errands', 'sm.errand']);
    expect(off.scan).toBe(false);
    const on = parseManifest(createManifest({ owner: true }), 'sm');
    expect(on.capabilities.map(c => [c.name, c.kind, c.model])).toEqual([
      ['sm.errands', 'read', true],
      ['sm.errand', 'read', false],
      ['sm.requests', 'read', true],
      ['sm.request', 'read', false],
      ['sm.reply', 'execute', false],
      ['sm.replyEffect', 'read', false],
    ]);
    expect(on.scan).toBe(true);
    const answer = on.capabilities.find(c => c.name === 'sm.reply')!;
    expect(answer.asks).toEqual([{ kind: 'long-text', property: 'text', label: 'Ditt svar', required: true }]);
    expect(answer.execution).toEqual({ strategy: 'manual' });
  });
});

describe('the errands a person owns', () => {
  test('are listed with what waits on them first, whatever the status says, and closed ones last', async () => {
    const { registry } = stack();
    const rows = await requests(registry, hillevi);
    expect(rows.map(r => [r.label, r.state, r.status])).toEqual([
      // The drake mailed her last.
      ['LOP-26110021 · Lön, Fråga', 'waiting-on-me', 'Komplettering'],
      // The drake wrote in the e-service last.
      ['IK-26110015 · Behörighet, Beställning', 'waiting-on-me', 'Komplettering'],
      // "Komplettering", but she has answered since the drake asked: it waits on the drake.
      ['IK-26110004 · Utrustning, Felanmälan', 'active', 'Komplettering'],
      ['IK-26110007 · Behörighet, Beställning', 'active', 'Pågående'],
      ['IK-26100019 · Utrustning, Felanmälan', 'closed', 'Löst'],
    ]);
    expect(rows[0]).toEqual({
      ref: LOP21,
      label: 'LOP-26110021 · Lön, Fråga',
      state: 'waiting-on-me',
      status: 'Komplettering',
      since: new Date(at - 3 * day).toISOString(),
    });
    // A row is a number and a type: never a title, a message or a name.
    for (const leaked of ['Vikarie', 'Sara', 'elevregistret', 'Lena', 'hillevi'])
      expect(JSON.stringify(rows)).not.toContain(leaked);
  });

  test('are the person’s own: the reporter, the handler and everyone else see none of them', async () => {
    const { registry } = stack();
    expect((await requests(registry, hassan)).map(r => [r.label, r.state])).toEqual([
      ['LOP-26110002 · Lön, Fråga', 'active'],
      ['IK-26110011 · Behörighet, Återställning', 'new'],
    ]);
    // Mikael handles Intern kundtjänst and Lena registered Lön och pension's errand: neither owns anything.
    expect(await requests(registry, mikael)).toEqual([]);
  });
});

describe('one errand, as its owner reads it', () => {
  test('shows the drake’s mail and the owner’s own, and the mail answer with Clew’s own subject', async () => {
    const { registry } = stack();
    const seen = await openRequest(registry, hillevi, LOP21);
    expect(seen.state).toBe('waiting-on-me');
    expect(seen.body).toContain('## Lena Ström, Lön och pension · E-post');
    expect(seen.body).toContain('anställningsnummer');
    expect(seen.body).toContain('Bilagor: Tidrapport\\-oktober.pdf');
    // Her own first mail, as "Du".
    expect(seen.body).toContain('## Du · E-post');
    expect(seen.body).toContain(
      '[Svara via e-post till Lön och pension](mailto:lon@clew.test?subject=SV%3A%20%C3%84rende%20%23LOP-26110021)',
    );
    expect(seen.body).toContain('Ändra inte ärendenumret i ämnesraden.');
  });

  test('never shows what passed between handlers, a mail to someone else, or quoted history', async () => {
    const { registry } = stack();
    const lop = (await openRequest(registry, hillevi, LOP21)).body;
    expect(lop).not.toContain('Per, kan du'); // internal
    expect(lop).not.toContain('Hej Sara'); // to the employee the errand is about
    expect(lop).not.toContain('Ursprungligt meddelande'); // the quoted history under the drake's mail
    // The employee's own mail copies her: she sees it under the employee's name, and it is not her answer.
    expect(lop).toContain('## Sara Lund · E-post');
    expect(lop).toContain('Jag arbetade den 3, 4 och 10 oktober');
    expect((await openRequest(registry, hillevi, LOP21)).state).toBe('waiting-on-me');
    const ik = (await openRequest(registry, hillevi, IK15)).body;
    expect(ik).toContain('## Sofia Nord, Intern kundtjänst · E-tjänsten');
    expect(ik).not.toContain('godkännande'); // an internal conversation
    expect(ik).not.toContain('Överlämnat'); // the conversation KC shares through a relation, though she takes part
    expect(ik).not.toContain('mailto:');
    expect(ik).toContain('Svara med knappen Svara på kortet');
  });

  test('a closed errand offers no answer, and an answered one says so', async () => {
    const { registry } = stack();
    const closed = await openRequest(registry, hillevi, IK19);
    expect(closed.state).toBe('closed');
    expect(closed.body).toContain('Ärendet är avslutat.');
    expect(closed.body).not.toContain('mailto:');
    // She has answered the mail since the drake asked, and the drake's next mail only copies her: nothing waits on her.
    const answered = await openRequest(registry, hillevi, IK04);
    expect(answered.state).toBe('active');
    expect(answered.body).toContain('Kan ni byta lampan');
  });

  test('another person’s errand answers exactly as one that does not exist', async () => {
    const { registry } = stack();
    await expect(openRequest(registry, hassan, LOP21)).rejects.toThrow(NOT_FOUND);
    await expect(openRequest(registry, mikael, IK15)).rejects.toThrow(NOT_FOUND);
    await expect(openRequest(registry, hillevi, LOP21.replace(':0000:', ':2281:'))).rejects.toThrow(NOT_FOUND);
    await expect(openRequest(registry, hillevi, 'request:sm:0000:LOP:nobody')).rejects.toThrow(NOT_FOUND);
  });

  test('is answered with no-store, and the log names the errand, never a message', async () => {
    const { registry, lines, seen } = stack();
    await openRequest(registry, hillevi, LOP21);
    expect(seen.at(-1)!.headers.get('cache-control')).toBe('no-store');
    expect(lines.at(-1)).toMatchObject({ event: 'open-request', account: 'hillevi', outcome: 'shown' });
    expect(JSON.stringify(lines)).not.toContain('anställningsnummer');
    expect(JSON.stringify(lines)).not.toContain('lon@clew.test');
  });
});

describe('the e-service’s messages are its flow instance owner’s', () => {
  test('the errand’s owner sees none of another person’s e-service messages, and cannot answer them', async () => {
    const { registry, source } = stack();
    const IK11 = 'request:sm:0000:IK:a1f0c3d2-0003-4000-8000-000000000003';
    const seen = await openRequest(registry, hassan, IK11);
    expect(seen.state).toBe('new');
    expect(seen.body).not.toContain('Vilket system');
    expect(seen.body).toContain('Intern kundtjänst har inte skrivit till dig på ärendet.');
    await expect(reply(registry, hassan, IK11, 'Schemasystemet')).rejects.toThrow(
      'Intern kundtjänst har inte skrivit till dig på ärendet.',
    );
    expect(source.posted()).toEqual([]);
  });
});

describe('a source that answers more than it should', () => {
  /** SupportManagement with access control off: every errand and every message, for whoever is named. */
  const leaky = (source: FixtureErrands): FixtureErrands => ({
    ...source,
    owned: async () => [...(await source.owned('hillevi')), ...(await source.owned('hassan'))],
  });

  test('changes nothing: the connector keeps the person’s own errands and the messages that are theirs', async () => {
    const { registry } = stack(leaky);
    expect((await requests(registry, hassan)).map(r => r.label)).toEqual([
      'LOP-26110002 · Lön, Fråga',
      'IK-26110011 · Behörighet, Återställning',
    ]);
    expect((await requests(registry, hillevi)).map(r => r.label)).not.toContain('LOP-26110002 · Lön, Fråga');
    // The record is asked for by id, whoever owns it; the connector refuses what is not the person's.
    await expect(openRequest(registry, hassan, LOP21)).rejects.toThrow(NOT_FOUND);
  });
});

describe('the person proves who they are', () => {
  test('without a token, with another person’s, or with one the provider did not sign, nothing is read', async () => {
    const { registry } = stack();
    await expect(requests(registry, hillevi, { delegate: async () => undefined })).rejects.toThrow(
      'Din inloggning kan inte styrkas',
    );
    await expect(requests(registry, hillevi, as('hassan'))).rejects.toThrow('hör till en annan person');
    await expect(requests(registry, hillevi, { delegate: async () => stranger.token('hillevi') })).rejects.toThrow(
      'godtar inte din inloggning',
    );
  });
});

describe('the answer through Open-E', () => {
  test('goes to the errand’s flow instance as its owner, once, and the errand stops waiting', async () => {
    const { registry, source } = stack();
    const receipt = await reply(registry, hillevi, IK15, '  Från den 1 december, och tills vidare.  ', 'same');
    expect(receipt).toEqual({
      headline: 'Svaret är skickat',
      rows: [
        {
          ref: IK15,
          label: 'IK-26110015 · Behörighet, Beställning',
          outcome: 'done',
          detail: 'Ditt svar finns nu i e-tjänsten och syns för Intern kundtjänst inom några minuter.',
        },
      ],
    });
    await reply(registry, hillevi, IK15, 'Från den 1 december, och tills vidare.', 'same');
    expect(source.posted()).toEqual([
      { flowInstanceId: '48213', userId: 'hillevi', message: 'Från den 1 december, och tills vidare.' },
    ]);
    const after = await openRequest(registry, hillevi, IK15);
    expect(after.state).toBe('active');
    expect(after.body).toContain('## Du · E-tjänsten');
    expect(after.body).toContain('Du har svarat.');
  });

  test('is refused where the drake mailed, on a closed errand, without words, and for someone else’s errand', async () => {
    const { registry, source } = stack();
    await expect(reply(registry, hillevi, LOP21, 'Hej')).rejects.toThrow('Svara via e-postlänken på ärendet.');
    await expect(reply(registry, hillevi, IK19, 'Hej')).rejects.toThrow('Ärendet är avslutat.');
    await expect(reply(registry, hillevi, IK15, '   ')).rejects.toThrow('Skriv ditt svar.');
    await expect(reply(registry, hassan, IK15, 'Hej')).rejects.toThrow(NOT_FOUND);
    expect(source.posted()).toEqual([]);
  });

  test('says what will happen before anything is sent', async () => {
    const { registry, source } = stack();
    const effect = await registry.run<{ rows: Row[] }>(
      hillevi,
      'sm.replyEffect',
      { ref: IK15, text: 'Hej' },
      as('hillevi'),
    );
    expect(effect.rows).toEqual([
      {
        label: 'Ditt svar skickas till Intern kundtjänst genom e-tjänsten',
        detail:
          'Du svarar på Sofia Nords meddelande från 22 nov. i ärende IK-26110015. Svaret syns för handläggaren inom några minuter och kan inte tas tillbaka.',
      },
    ]);
    expect(source.posted()).toEqual([]);
  });
});

describe('a card while an errand waits on its owner', () => {
  test('one per waiting errand, with "Svara" only where the answer goes through Open-E, and no message in it', async () => {
    const { registry } = stack();
    const seen = await scan(registry, hillevi);
    expect(seen.observation).toMatchObject({ completeness: 'complete', exhausted: true });
    expect(seen.drafts.map(d => [d.topic, d.area, d.title, d.actions.map(a => a.id)])).toEqual([
      ['sm:request:b2e1d4c3-0002-4000-8000-000000000002', 'requests', 'Lön och pension väntar på ditt svar', ['show']],
      [
        'sm:request:a1f0c3d2-0006-4000-8000-000000000006',
        'requests',
        'Intern kundtjänst väntar på ditt svar',
        ['reply', 'show'],
      ],
    ]);
    expect(seen.drafts[1]!.actions[0]).toMatchObject({ capability: 'sm.reply', kind: 'execute', input: { ref: IK15 } });
    expect(seen.drafts[0]!.summary).toBe(
      'LOP-26110021 · Lön, Fråga. Status: Komplettering. Lön och pension skrev till dig med e-post 22 nov.',
    );
    for (const leaked of ['anställningsnummer', 'elevregistret', 'Sara', 'Lena', 'Sofia'])
      expect(JSON.stringify(seen.drafts)).not.toContain(leaked);
  });

  test('goes when the owner answers, and a drake writing again brings it back', async () => {
    const { registry, source, sm } = stack();
    await reply(registry, hillevi, IK15, 'Från den 1 december.');
    // Half a minute on: the drake's next message is newer than her answer, and her token is still good.
    clock = at + 30_000;
    expect((await scan(registry, hillevi)).drafts.map(d => d.topic)).toEqual([
      'sm:request:b2e1d4c3-0002-4000-8000-000000000002',
    ]);
    // Her mail answer is filed by the e-mail reader; then the drake writes in the e-service again.
    source.mailFiled('LOP-26110021');
    source.handlerWrites('IK-26110015', 'webmessage');
    sm.forget();
    expect((await scan(registry, hillevi)).drafts.map(d => d.topic)).toEqual([
      'sm:request:a1f0c3d2-0006-4000-8000-000000000006',
    ]);
    clock = at;
  });

  test('a source that refuses the person is logged as a refusal, not as something unexpected', async () => {
    const { registry, lines } = stack(source => ({
      ...source,
      owned: async () => {
        throw new SourceDenied('access control is on');
      },
    }));
    const seen = await scan(registry, hillevi);
    expect(seen.observation).toMatchObject({ completeness: 'unavailable' });
    expect(lines.at(-1)).toMatchObject({ event: 'scan', outcome: 'refused-by-source' });
  });

  test('without the person’s token the scan says so, and keeps the cards', async () => {
    const { registry } = stack();
    const seen = await registry.scanOne(hillevi, 'sm', { delegate: async () => undefined });
    expect(seen.observation).toMatchObject({ completeness: 'authorization-required' });
  });
});

describe('the rules', () => {
  const owner = { username: 'hillevi', email: 'hillevi@clew.test', eService: true };
  const message = (over: Partial<Message>): Message => ({
    id: 'm',
    channel: 'email',
    direction: 'out',
    at: new Date(at).toISOString(),
    text: 'Hej',
    ...over,
  });

  test('what an owner sees is what passed between the drake and them', () => {
    expect(toOwner(message({ to: ['Hillevi@Clew.test'] }), owner)).toBe(true);
    expect(toOwner(message({ cc: ['hillevi@clew.test'], to: ['a@clew.test'] }), owner)).toBe(true);
    expect(toOwner(message({ direction: 'in', from: { address: 'hillevi@clew.test' } }), owner)).toBe(true);
    expect(toOwner(message({ to: ['hillevi@clew.test'], internal: true }), owner)).toBe(false);
    expect(toOwner(message({ to: ['sara@clew.test'] }), owner)).toBe(false);
    expect(toOwner(message({ to: ['hillevi@clew.test'] }), { username: 'hillevi' })).toBe(false);
    expect(toOwner(message({ channel: 'webmessage' }), owner)).toBe(true);
    // The flow instance is someone else's: its messages are theirs.
    expect(toOwner(message({ channel: 'webmessage' }), { ...owner, eService: false })).toBe(false);
    const conversation = (type: 'EXTERNAL' | 'INTERNAL', related: boolean, participants: string[]) =>
      message({ channel: 'conversation', conversation: { type, related, participants } });
    expect(toOwner(conversation('EXTERNAL', false, ['HILLEVI']), owner)).toBe(true);
    expect(toOwner(conversation('EXTERNAL', false, ['sofia']), owner)).toBe(false);
    expect(toOwner(conversation('EXTERNAL', true, ['hillevi']), owner)).toBe(false);
    expect(toOwner(conversation('INTERNAL', false, ['hillevi']), owner)).toBe(false);
  });

  test('the answer takes the channel the drake last wrote in, and a hidden message decides nothing', () => {
    const mailed = message({ to: ['hillevi@clew.test'], at: new Date(at - day).toISOString() });
    const webmessage = message({ channel: 'webmessage', at: new Date(at - 2 * day).toISOString() });
    const internal = message({ to: ['hillevi@clew.test'], internal: true, at: new Date(at).toISOString() });
    const shown = shownTo([webmessage, internal, mailed], owner);
    expect(channelOf(shown, owner)).toBe('email');
    expect(requestState({ kind: 'open', read: true, shown, owner })).toBe('waiting-on-me');
    expect(requestState({ kind: 'open', read: true, shown: shownTo([internal], owner), owner })).toBe('active');
    expect(requestState({ kind: 'closed', read: true, shown, owner })).toBe('closed');
    // Messages that could not be read: the status is taken at its word.
    expect(requestState({ kind: 'waiting-reporter', read: false })).toBe('waiting-on-me');
  });

  test('only the owner’s own words are an answer, and only a mail to them, not a copy, waits on them', () => {
    const asked = message({ to: ['hillevi@clew.test'], at: new Date(at - 2 * day).toISOString() });
    const copied = message({ to: ['sara@clew.test'], cc: ['hillevi@clew.test'], at: new Date(at).toISOString() });
    const fromSara = message({
      direction: 'in',
      from: { name: 'Sara Lund', address: 'sara@clew.test' },
      cc: ['hillevi@clew.test'],
      at: new Date(at - day).toISOString(),
    });
    const fromHer = message({
      direction: 'in',
      from: { address: 'Hillevi@clew.test' },
      at: new Date(at - day).toISOString(),
    });
    expect(byOwner(fromSara, owner)).toBe(false);
    expect(byOwner(fromHer, owner)).toBe(true);
    // Sara's mail does not answer the drake's question for her; her own does.
    expect(requestState({ kind: 'open', read: true, shown: shownTo([asked, fromSara], owner), owner })).toBe(
      'waiting-on-me',
    );
    expect(requestState({ kind: 'open', read: true, shown: shownTo([asked, fromHer], owner), owner })).toBe('active');
    // A copy after her answer is for her information: nothing waits on her, and it does not choose the channel.
    expect(requestState({ kind: 'open', read: true, shown: shownTo([asked, fromHer, copied], owner), owner })).toBe(
      'active',
    );
    expect(channelOf(shownTo([copied], owner), owner)).toBeNull();
  });

  test('the subject has one "#", whatever the drake wrote, and a doubtful address gets no link', () => {
    expect(mailSubject('LOP-26110021')).toBe('SV: Ärende #LOP-26110021');
    expect(mailLink('lon@clew.test?cc=x@evil.test', 'LOP-1')).toBeUndefined();
    expect(mailLink('lon@clew.test', 'LOP-1')).toBe('mailto:lon@clew.test?subject=SV%3A%20%C3%84rende%20%23LOP-1');
  });

  test('source text is made inert, and a mail’s quoted history is cut', () => {
    expect(escapeMarkdown('[klicka](javascript:alert(1))')).toBe('\\[klicka\\]\\(javascript\\:alert\\(1\\)\\)');
    expect(escapeMarkdown('# Rubrik\n1. punkt')).toBe('\\# Rubrik\n1\\. punkt');
    // An address in the text is never a link, even where a renderer links bare addresses.
    expect(escapeMarkdown('https://x.test www.x.test a@x.test')).toBe('https\\://x.test www\\.x.test a\\@x.test');
    expect(ownWords('Svar.\n\n> citat\n\n-----Ursprungligt meddelande-----\nFrån: X\nGammalt')).toBe('Svar.');
    expect(ownWords('Svar.\n\nFrån: Lena Ström\nSkickat: den 22 november\nGammalt')).toBe('Svar.');
    // A line that merely starts with "Från:", and a quoted line with the writer's own words after it, stay.
    expect(ownWords('Hej!\nFrån: 1 december gäller den nya lönen.\nVi behöver också datumen.')).toBe(
      'Hej!\nFrån: 1 december gäller den nya lönen.\nVi behöver också datumen.',
    );
    expect(ownWords('> 5 dagar\nDet stämmer, fem dagar.\n\n> gammalt\n> mer')).toBe(
      '> 5 dagar\nDet stämmer, fem dagar.',
    );
  });

  test('the owner is the PRIMARY stakeholder’s account, and messages come from SupportManagement’s own shape', () => {
    expect(
      ownerOf({
        stakeholders: [
          { role: 'CONTACT', parameters: [{ key: 'username', values: ['sofia'] }] },
          {
            role: 'PRIMARY',
            parameters: [{ key: 'username', values: ['hillevi'] }],
            contactChannels: [{ type: 'EMAIL', value: 'hillevi@clew.test' }],
          },
        ],
      }),
    ).toEqual({ username: 'hillevi', email: 'hillevi@clew.test' });
    expect(ownerOf({ stakeholders: [{ role: 'PRIMARY', parameters: [] }] })).toBeNull();
    const [mail] = toMessages({
      communications: [
        {
          communicationID: 'c1',
          communicationType: 'EMAIL',
          direction: 'OUTBOUND',
          sender: 'Lena Ström <lon@clew.test>',
          target: 'hillevi@clew.test',
          messageBody: 'Hej',
          sent: '2026-11-22T10:00:00Z',
        },
        { communicationID: 'c2', communicationType: 'SMS', direction: 'OUTBOUND', sent: '2026-11-22T10:00:00Z' },
      ],
    });
    expect(mail).toMatchObject({
      channel: 'email',
      direction: 'out',
      from: { name: 'Lena Ström', address: 'lon@clew.test' },
    });
  });
});
