import { describe, expect, test } from 'bun:test';
import { changedSubjects, subjectRefusal } from '../../scripts/auth-setup-subjects';

/**
 * `bun run auth:setup` against a new Keycloak (BL-4's move to the stack's own): every persona's account gets a new
 * subject under the same issuer, which a sign-in refuses (D68 item 6). The check runs before anything changes in
 * Keycloak, so the realm, the clients and the BFF's settings are never left disagreeing.
 */
const issuer = 'http://keycloak.orb.local:8090/realms/clew';

describe('auth:setup refuses a persona bound to another Keycloak account before it changes anything', () => {
  test('a persona never bound, or bound to the account it will sign in as, stands in no way', () => {
    const personas = [
      { personId: 'hillevi', userName: 'hillevi', bound: undefined, account: undefined },
      { personId: 'hassan', userName: 'hassan', bound: 'subject-1', account: 'subject-1' },
      { personId: 'mikael', userName: 'mikael', bound: undefined, account: 'subject-2' },
    ];
    expect(changedSubjects(personas)).toEqual([]);
    expect(subjectRefusal(issuer, personas)).toBeUndefined();
  });
  test('a new Keycloak, with no account yet or another one, is refused with both ways forward', () => {
    const personas = [
      { personId: 'hillevi', userName: 'hillevi', bound: 'old-1', account: undefined },
      { personId: 'p-0042', userName: 'sara.nystrom', bound: 'old-2', account: 'new-2' },
      { personId: 'hassan', userName: 'hassan', bound: undefined, account: undefined },
    ];
    expect(changedSubjects(personas).map(p => p.personId)).toEqual(['hillevi', 'p-0042']);
    const refusal = subjectRefusal(issuer, personas)!;
    expect(refusal).toContain(`under ${issuer}`);
    expect(refusal).toContain(
      'hillevi (person hillevi): bound to subject old-1, while Keycloak has no such account yet',
    );
    expect(refusal).toContain('sara.nystrom (person p-0042): bound to subject old-2, while the account is now new-2');
    expect(refusal).toContain('Nothing was changed in Keycloak or in Clew.');
    // One release per person, by person id, which is not always the user name (D135).
    expect(refusal).toContain(
      `bun scripts/identity-rebind.ts --person hillevi --release --operator "<your name>" --issuer ${issuer}`,
    );
    expect(refusal).toContain(
      `bun scripts/identity-rebind.ts --person p-0042 --release --operator "<your name>" --issuer ${issuer}`,
    );
    expect(refusal).not.toContain('--person hassan');
    expect(refusal).toContain('or reset the development database');
    expect(refusal).toContain('Then run `bun run auth:setup` again.');
  });
});
