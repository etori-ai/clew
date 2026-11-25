import { describe, expect, test } from 'bun:test';
import type { LinkedAccountEntry } from '@clew/contracts';
import {
  accountLines,
  accountReturn,
  accountRowLine,
  needingAccount,
  returnAddress,
  returnMessage,
} from '../../apps/web/src/linked-accounts';

/**
 * What the pages say about a person's linked accounts (D147): the lines under "Behöver dig", a row of "Kopplade
 * konton", and the return from a system.
 */
const entry = (
  connectorId: string,
  source: string,
  state: LinkedAccountEntry['state'],
  more: Partial<LinkedAccountEntry> = {},
): LinkedAccountEntry => ({
  connectorId,
  source,
  state,
  linkedAt: state === 'not-linked' ? null : '2026-11-03T09:00:00.000Z',
  lostAt: state === 'needs-link' ? '2026-11-24T07:30:00.000Z' : null,
  putOff: false,
  revocable: true,
  ...more,
});
const buy = (state: LinkedAccountEntry['state'], more?: Partial<LinkedAccountEntry>) =>
  entry('purchasing', 'Inköpssystemet', state, more);
const ledger = (state: LinkedAccountEntry['state'], more?: Partial<LinkedAccountEntry>) =>
  entry('ledger', 'Ekonomisystemet', state, more);
const cloud = (state: LinkedAccountEntry['state'], more?: Partial<LinkedAccountEntry>) =>
  entry('cloud', 'Nextcloud', state, more);
const lms = (state: LinkedAccountEntry['state'], more?: Partial<LinkedAccountEntry>) =>
  entry('lms', 'Lärplattformen', state, more);
const words = (accounts: LinkedAccountEntry[]) =>
  accountLines(accounts).map(l => [l.weight, l.title, l.line, l.action, l.link?.connectorId ?? null, l.later]);

describe('the lines under Behöver dig', () => {
  test('nothing is said when every system is linked or put off', () => {
    expect(accountLines([])).toEqual([]);
    expect(accountLines([buy('linked'), ledger('not-linked', { putOff: true })])).toEqual([]);
  });

  test('a first link is quiet, named, linked from the line, and can be put off', () => {
    expect(words([buy('not-linked')])).toEqual([
      [
        'first',
        'Inköpssystemet behöver ditt konto',
        'Du loggar in hos Inköpssystemet en gång och kommer sedan tillbaka hit.',
        'Koppla ditt konto',
        'purchasing',
        ['purchasing'],
      ],
    ]);
  });

  test('a link that was lost says since when and cannot be put off', () => {
    expect(words([buy('needs-link')])).toEqual([
      [
        'lost',
        'Inköpssystemet godtar inte längre ditt konto',
        'Sedan 24 november. Det som är ditt där visas inte här.',
        'Koppla igen',
        'purchasing',
        [],
      ],
    ]);
    expect(accountLines([buy('needs-link', { lostAt: null })])[0]!.line).toBe('Det som är ditt där visas inte här.');
  });

  test('one of each is two lines, the lost one first', () => {
    expect(accountLines([lms('not-linked'), buy('needs-link')]).map(l => [l.weight, l.action])).toEqual([
      ['lost', 'Koppla igen'],
      ['first', 'Koppla ditt konto'],
    ]);
  });

  test('two or more of a kind are one line that leads to the page', () => {
    expect(words([buy('not-linked'), cloud('not-linked'), lms('not-linked'), ledger('linked')])).toEqual([
      [
        'first',
        '3 system behöver ditt konto',
        'Inköpssystemet, Nextcloud och Lärplattformen. Du loggar in hos vart och ett en gång.',
        'Visa kopplade konton',
        null,
        ['purchasing', 'cloud', 'lms'],
      ],
    ]);
    expect(words([buy('needs-link'), ledger('needs-link'), lms('not-linked')])).toEqual([
      [
        'lost',
        '2 system godtar inte längre ditt konto',
        'Inköpssystemet och Ekonomisystemet.',
        'Visa kopplade konton',
        null,
        [],
      ],
      [
        'first',
        'Lärplattformen behöver ditt konto',
        'Du loggar in hos Lärplattformen en gång och kommer sedan tillbaka hit.',
        'Koppla ditt konto',
        'lms',
        ['lms'],
      ],
    ]);
    // One lost and several new: the lost one is linked from its line, the new ones lead to the page.
    expect(accountLines([buy('needs-link'), cloud('not-linked'), lms('not-linked')]).map(l => l.action)).toEqual([
      'Koppla igen',
      'Visa kopplade konton',
    ]);
  });

  test('both kinds several are one line, so no two buttons lead to the same place', () => {
    expect(words([buy('needs-link'), ledger('needs-link'), cloud('not-linked'), lms('not-linked')])).toEqual([
      [
        'lost',
        '2 system godtar inte längre ditt konto',
        'Inköpssystemet och Ekonomisystemet. Nextcloud och Lärplattformen behöver också ditt konto.',
        'Visa kopplade konton',
        null,
        [],
      ],
    ]);
  });
});

describe('a row of Kopplade konton', () => {
  test('says since when it is linked, why it needs the person, or that it is not linked', () => {
    expect(accountRowLine(buy('linked'))).toBe('Kopplat 3 november 2026');
    expect(accountRowLine(ledger('needs-link'))).toBe(
      'Kopplat 3 november 2026 · Ekonomisystemet godtar inte längre kontot',
    );
    expect(accountRowLine(lms('not-linked'))).toBe('Inte kopplat');
  });

  test('the systems that need the account are the ones not linked, put off or not', () => {
    expect(needingAccount([buy('linked'), ledger('needs-link'), lms('not-linked', { putOff: true })])).toEqual([
      'ledger',
      'lms',
    ]);
  });
});

describe('the return from a system', () => {
  test('is read from the address, which is then the page as it was', () => {
    expect(accountReturn('?tab=mine&account=linked&system=purchasing')).toEqual({
      outcome: 'linked',
      system: 'purchasing',
      rest: '?tab=mine',
    });
    expect(accountReturn('?account=failed')).toEqual({ outcome: 'failed', system: null, rest: '' });
    expect(accountReturn('?account=other&system=x')).toBeNull();
    expect(accountReturn('?tab=mine')).toBeNull();
    // Leaving again from a page that still carries an earlier return does not take the old outcome along.
    expect(returnAddress('/todo', '?tab=mine&account=declined&system=ledger')).toBe('/todo?tab=mine');
    expect(returnAddress('/accounts', '')).toBe('/accounts');
  });

  test('is said once when the account was linked or linking failed, and not when the person declined', () => {
    expect(returnMessage('linked', 'Inköpssystemet')).toBe('Ditt konto i Inköpssystemet är kopplat');
    expect(returnMessage('failed', 'Inköpssystemet')).toBe(
      'Det gick inte att koppla ditt konto i Inköpssystemet. Försök igen.',
    );
    expect(returnMessage('failed', null)).toBe('Det gick inte att koppla ditt konto. Försök igen.');
    expect(returnMessage('declined', 'Inköpssystemet')).toBeNull();
  });
});
