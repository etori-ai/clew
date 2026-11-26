import { describe, expect, test } from 'bun:test';
import type { LinkedAccountAdminView } from '@clew/contracts';
import {
  accountFact,
  accountForm,
  accountNotice,
  approvalOf,
  clientWords,
  draftOf,
  draftReady,
  manifestAccountRow,
  originWords,
  peopleWords,
  serverReview,
} from '../../apps/web/src/admin-account';

/**
 * A connector's linked account in an administrator's words (D147 items 3 and 4): the fact under Översikt, the notice,
 * the two reviews and what the dialog asks for and sends.
 */
const ISSUER = 'https://id.inkop.example';
const found = (issuer = ISSUER, registers = true) => ({ issuer, registers, revocable: true });
const approvedAt = (issuer = ISSUER, more: Partial<NonNullable<LinkedAccountAdminView['approved']>> = {}) => ({
  issuer,
  origin: 'discovered' as const,
  client: 'registered' as const,
  clientId: null,
  authorizationEndpoint: issuer + '/authorize',
  tokenEndpoint: issuer + '/token',
  revocationEndpoint: issuer + '/revoke',
  by: 'Mikael Lund',
  at: '2026-11-25T13:02:00.000Z',
  ...more,
});
const account = (more: Partial<LinkedAccountAdminView> = {}): LinkedAccountAdminView => ({
  connectorId: 'purchasing',
  resource: 'https://inkop.kommunen.example',
  scopes: ['purchases.read', 'purchases.approve'],
  state: 'approved',
  approved: approvedAt(),
  found: found(),
  answered: true,
  people: { linked: 14, again: 2 },
  returnAddress: 'https://startsidan.kommunen.example/api/linked-accounts/callback',
  offered: null,
  ...more,
});
const noServer = account({ state: 'no-server', approved: null, found: null, people: { linked: 0, again: 0 } });
const changed = account({ state: 'changed', found: found('https://login.inkop.example') });
const entered = account({
  approved: approvedAt('https://moln.kommunen.example', {
    origin: 'entered',
    client: 'entered',
    clientId: 'xK2v9QmP',
    authorizationEndpoint: 'https://moln.kommunen.example/apps/oauth2/authorize',
    tokenEndpoint: 'https://moln.kommunen.example/apps/oauth2/api/v1/token',
    revocationEndpoint: null,
  }),
  found: null,
  answered: false,
});

describe('the fact under Översikt and the block', () => {
  test('says whether people link an account of their own, and where', () => {
    expect(accountFact(null)).toBe('Nej');
    expect(accountFact(undefined)).toBe('Läser …');
    expect(accountFact(account())).toBe('Ja, hos https://id.inkop.example');
    expect(accountFact(changed)).toBe('Ja, hos https://id.inkop.example');
    expect(accountFact(noServer)).toBe('Inte klart: uppgifter saknas');
    expect(accountFact(account({ state: 'no-client' }))).toBe('Inte klart: uppgifter saknas');
    expect(accountFact(account({ state: 'waiting', approved: null }))).toBe('Inte klart: väntar på godkännande');
    // Declared only by a manifest that waits: nothing is approved to show.
    expect(accountFact(account({ resource: null, state: 'waiting', approved: null }))).toBe('Nej');
  });

  test('says who named the server, how Clew is known there and how many have linked, never who', () => {
    expect(originWords('discovered')).toBe('Systemet uppger den');
    expect(originWords('entered')).toBe('Angiven av en administratör');
    expect(clientWords(account())).toBe('Clew registrerade sig själv');
    expect(clientWords(entered)).toBe('Som en klient en administratör har registrerat');
    expect(clientWords(account({ approved: approvedAt(ISSUER, { client: 'none' }) }))).toBe(
      'Clew registrerar sig själv när den första personen kopplar',
    );
    expect(
      clientWords(account({ approved: approvedAt(ISSUER, { client: 'none' }), found: found(ISSUER, false) })),
    ).toBe('Inte registrerat');
    expect(peopleWords({ linked: 14, again: 2 })).toBe('14 kopplade · 2 behöver koppla igen');
    expect(peopleWords({ linked: 1, again: 0 })).toBe('1 kopplad');
    expect(peopleWords({ linked: 0, again: 0 })).toBe('Ingen har kopplat än');
  });
});

describe('the notice over the page', () => {
  test('is nothing while people can link, and for a connector that declares no account', () => {
    expect(accountNotice('Inköpssystemet', account())).toBeNull();
    expect(accountNotice('Inköpssystemet', null)).toBeNull();
    expect(accountNotice('Inköpssystemet', undefined)).toBeNull();
  });

  test('a system that names no server, or where Clew is no client, says so with the way to enter it', () => {
    expect(accountNotice('Nextcloud', noServer)).toEqual({
      title: 'Nextcloud: personer kan inte koppla sina konton än',
      description: 'Systemet uppger ingen inloggningsserver. Registrera Clew i Nextcloud och ange uppgifterna här.',
      action: 'enter',
      label: 'Ange uppgifter',
    });
    expect(accountNotice('Nextcloud', account({ state: 'no-client' }))).toMatchObject({
      description: 'Clew är inte registrerat hos Nextcloud. Registrera Clew där och ange uppgifterna här.',
      action: 'enter',
    });
    expect(
      accountNotice('Nextcloud', account({ state: 'waiting', approved: null, found: null, answered: false })),
    ).toMatchObject({ title: 'Nextcloud: personer kan inte koppla sina konton än', action: 'enter' });
  });

  test('another server than the approved one waits for a review, and says what holds meanwhile', () => {
    expect(accountNotice('Inköpssystemet', changed)).toEqual({
      title: 'Inköpssystemet: en annan inloggningsserver väntar på ditt godkännande',
      description:
        'Ingen skickas dit förrän du har granskat och godkänt den. De 14 kopplade kontona används som förut så länge systemet godtar dem.',
      action: 'review',
      label: 'Granska',
    });
    expect(accountNotice('Inköpssystemet', { ...changed, people: { linked: 1, again: 0 } })!.description).toBe(
      'Ingen skickas dit förrän du har granskat och godkänt den. Det kopplade kontot används som förut så länge systemet godtar det.',
    );
    // A server Clew cannot register itself at is approved with the client an administrator enters.
    expect(
      accountNotice('Inköpssystemet', { ...changed, found: found('https://login.inkop.example', false) }),
    ).toMatchObject({ action: 'enter', label: 'Ange uppgifter' });
    expect(accountNotice('Inköpssystemet', account({ state: 'waiting', approved: null }))).toEqual({
      title: 'Inköpssystemet: var personer loggar in väntar på ditt godkännande',
      description: 'Ingen kan koppla sitt konto förrän du har granskat och godkänt det.',
      action: 'review',
      label: 'Granska',
    });
  });
});

describe('the reviews', () => {
  test('the review of a changed system names the account: the server, what Clew asks for, how Clew is known', () => {
    const to = { resource: 'https://inkop.kommunen.example', scopes: ['purchases.read', 'purchases.approve'] };
    expect(manifestAccountRow({ to }, { ...to, found: found(), answered: true })).toEqual({
      key: 'account',
      tone: 'warning',
      dot: 'Konto',
      label: 'Personer kopplar ett eget konto i systemet',
      lines: [
        'De loggar in hos https://id.inkop.example, som systemet uppger.',
        'Clew ber om: purchases.read, purchases.approve.',
        'Clew registrerar sig själv där.',
      ],
    });
    expect(manifestAccountRow({ to: { ...to, scopes: [] } }, { ...to, found: null, answered: true }).lines).toEqual([
      'Systemet uppger ingen inloggningsserver: du anger den när du har godkänt.',
    ]);
    expect(manifestAccountRow({ to }, { ...to, found: found(ISSUER, false), answered: true }).lines.at(-1)).toBe(
      'Du anger hur Clew är känt där när du har godkänt.',
    );
    // Until the system has been asked, the row says what the manifest says and no more.
    expect(manifestAccountRow({ to }, undefined).lines).toEqual(['Clew ber om: purchases.read, purchases.approve.']);
    expect(manifestAccountRow({ to: null }, null)).toMatchObject({
      label: 'Personer kopplar inte längre ett eget konto i systemet',
      lines: ['Konton som är kopplade används inte mer.'],
    });
  });

  test('another server says from what to what, and how many people must link again, before the press', () => {
    expect(serverReview(changed)).toEqual({
      title: 'Systemet uppger en annan inloggningsserver',
      subtitle:
        'Godkänn den bara om du vet att systemet har bytt. Konton som är kopplade till den gamla används inte mer.',
      keep: 'Behåll den gamla',
      approve: 'Godkänn den nya',
      rows: [
        {
          key: 'server',
          tone: 'warning',
          dot: 'Ändrat',
          label: 'Personer loggar in hos https://login.inkop.example',
          lines: ['I dag: https://id.inkop.example.'],
        },
        {
          key: 'again',
          tone: 'error',
          dot: 'Kopplas om',
          label: '16 personer behöver koppla sina konton igen',
          lines: ['De får veta det där systemets innehåll saknas.'],
        },
      ],
    });
    expect(serverReview({ ...changed, people: { linked: 1, again: 0 } })!.rows[1]!.label).toBe(
      '1 person behöver koppla sitt konto igen',
    );
    expect(serverReview({ ...changed, people: { linked: 0, again: 0 } })!.rows).toHaveLength(1);
    expect(serverReview(account({ state: 'waiting', approved: null }))).toMatchObject({
      title: 'Godkänn var personer loggar in',
      approve: 'Godkänn',
      rows: [{ label: 'Personer loggar in hos https://id.inkop.example' }],
    });
    expect(serverReview(account())).toBeNull();
    expect(serverReview(noServer)).toBeNull();
  });
});

describe('the dialog', () => {
  test('asks for the addresses only where the system names no server, and for a client wherever Clew cannot register', () => {
    expect(accountForm(noServer)).toEqual({ addresses: true, clientRequired: true });
    expect(accountForm(entered)).toEqual({ addresses: true, clientRequired: true });
    expect(accountForm(account())).toEqual({ addresses: false, clientRequired: false });
    expect(accountForm(account({ found: found(ISSUER, false) }))).toEqual({ addresses: false, clientRequired: true });
  });

  test('opens with what is approved and never a secret, and is saved once what is required is there', () => {
    expect(draftOf(noServer)).toEqual({ clientId: '', secret: '', authorize: '', token: '', revoke: '' });
    const draft = draftOf(entered);
    expect(draft).toEqual({
      clientId: 'xK2v9QmP',
      secret: '',
      authorize: 'https://moln.kommunen.example/apps/oauth2/authorize',
      token: 'https://moln.kommunen.example/apps/oauth2/api/v1/token',
      revoke: '',
    });
    // The same client keeps its saved secret; another needs its own.
    expect(draftReady(entered, draft)).toBe(true);
    expect(draftReady(entered, { ...draft, clientId: 'another' })).toBe(false);
    expect(draftReady(entered, { ...draft, clientId: 'another', secret: 's' })).toBe(true);
    expect(draftReady(noServer, { ...draft, clientId: 'clew' })).toBe(false);
    expect(draftReady(noServer, { ...draft, clientId: 'clew', secret: 's', token: ' ' })).toBe(false);
    // A system that names its server and lets Clew register is saved with nothing typed.
    expect(draftReady(account(), draftOf(account()))).toBe(true);
  });

  test('sends a client when one is typed and the addresses when it asked for them', () => {
    expect(approvalOf(account(), draftOf(account()))).toEqual({});
    expect(approvalOf(account(), { ...draftOf(account()), clientId: ' clew ', secret: 's' })).toEqual({
      client: { id: 'clew', secret: 's' },
    });
    expect(
      approvalOf(noServer, {
        clientId: 'clew',
        secret: 's',
        authorize: ' https://moln.kommunen.example/apps/oauth2/authorize ',
        token: 'https://moln.kommunen.example/apps/oauth2/api/v1/token',
        revoke: '',
      }),
    ).toEqual({
      client: { id: 'clew', secret: 's' },
      server: {
        authorizationEndpoint: 'https://moln.kommunen.example/apps/oauth2/authorize',
        tokenEndpoint: 'https://moln.kommunen.example/apps/oauth2/api/v1/token',
      },
    });
    expect(approvalOf(entered, draftOf(entered))).toMatchObject({ client: { id: 'xK2v9QmP' } });
    expect(approvalOf(entered, draftOf(entered)).client).not.toHaveProperty('secret');
  });
});
