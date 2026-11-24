/**
 * The check `bun run auth:setup` (scripts/auth-setup.ts) makes before it changes anything in Keycloak. A persona's
 * person row may already be bound under the issuer to a Keycloak account (`auth_identity_binding`, D68 item 6). When
 * Keycloak is new, or its data was removed, the account auth:setup finds or makes has another subject under the same
 * issuer, and Clew refuses that subject at sign-in as a changed one: so auth:setup refuses first, while the realm, the
 * clients and the BFF's settings in `apps/server/.env.local` still agree with each other.
 */

/** A persona as auth:setup sees it: its person, the subject it is bound to, and today's Keycloak account, if any. */
export interface PersonaSubject {
  personId: string;
  userName: string;
  /** The subject the person is bound to under the issuer, if they are bound. */
  bound: string | undefined;
  /** The id of the persona's Keycloak account today; none when auth:setup would make the account. */
  account: string | undefined;
}

/** The personas whose binding names another subject than the account auth:setup would sign them in as. */
export const changedSubjects = (personas: readonly PersonaSubject[]) =>
  personas.filter(p => p.bound !== undefined && p.bound !== p.account);

/**
 * Why auth:setup refuses, in English for the person at the terminal, with both ways forward: release each binding, so
 * the next sign-in binds the person again as a first login does, or reset the development database. Undefined when no
 * binding stands in the way.
 */
export function subjectRefusal(issuer: string, personas: readonly PersonaSubject[]): string | undefined {
  const changed = changedSubjects(personas);
  if (!changed.length) return undefined;
  return [
    `Keycloak's accounts are not the ones Clew has bound these personas to under ${issuer}, so they could not sign in`,
    '(a changed subject is refused, D68 item 6):',
    ...changed.map(
      p =>
        `  ${p.userName} (person ${p.personId}): bound to subject ${p.bound}, ` +
        (p.account ? `while the account is now ${p.account}` : 'while Keycloak has no such account yet'),
    ),
    'This happens when Keycloak is new or its data was removed. Nothing was changed in Keycloak or in Clew. Either',
    'release each binding in the app container, so the next sign-in binds the persona again:',
    ...changed.map(
      p =>
        `  bun scripts/identity-rebind.ts --person ${p.personId} --release --operator "<your name>" --issuer ${issuer}`,
    ),
    'or reset the development database (docs/maintainers/local-development.md, "Moving to the stack\'s Keycloak").',
    'Then run `bun run auth:setup` again.',
  ].join('\n');
}
