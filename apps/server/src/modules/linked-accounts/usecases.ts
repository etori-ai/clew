import type { AuthenticatedContext, Capability, LinkedAccountEntry } from '@clew/contracts';
import { ForbiddenError, InputError } from '../../context';
import {
  LinkRefusedError,
  LinkRequiredError,
  LinkUnavailableError,
  type LinkedAccount,
  type LinkView,
  type PendingLink,
  type Revocation,
} from './contracts';
import { PENDING_MS, byNeed, clientChoice, entryOf, isFresh, localPath, lost, viewOf, withTokens } from './domain';
import {
  GrantRefused,
  type Approval,
  type AuthorizationServer,
  type ConnectorLinks,
  type LinkSetting,
  type LinkStore,
  type LinkTx,
  type OAuth,
  type OAuthClient,
} from './ports';

/**
 * Linked accounts (D147): a person links their account once at a system that issues its own credential, Clew keeps
 * the tokens, and a call to that system's connector carries a fresh access token whether or not the person is signed
 * in.
 *
 * `begin` and `complete` are the two halves of linking, either side of the system's authorization page; `tokenFor` is
 * what a call asks before it is sent; `refused` is what a call reports when the system would not take the token;
 * `unlink` is the person's own; `forgetPerson` and `forgetConnector` end the links of a person or a connector that
 * leaves. Linking, unlinking and a link lost each write an audit row in the transaction that changes the link
 * (`account.linked`, `account.unlinked`, `account.link-lost`), as do a system the person puts off
 * (`account.link-put-off`), a client Clew registers
 * (`account.client-registered`) and an administrator's approval (`account.server-approved`). A row names the connector, the issuer and the person's id, never a token, an account
 * or a name. A refresh that succeeds changes nothing a person or an administrator did and writes none, as a session's
 * refresh writes none.
 */
export const LINK_SYSTEM_ACTOR = 'system:linked-accounts';
/** Approving where a connector's people are sent is a connector administrator's (D23, D144). */
export const LINK_ADMIN_CAPABILITY: Capability = 'admin.connectors';
/** The operator's command line, where no person is signed in. */
const OPERATOR = { actor: 'bootstrap:linked-accounts', name: 'Kommandoraden' };

/** What an administrator enters beside a connector's declaration: a server that publishes no metadata, a client, or both. */
export interface ApprovalInput {
  server?: {
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    revocationEndpoint?: string | null;
  };
  client?: { id: string; secret?: string | null };
}
/** An approval as an administrator is shown it: never the client's secret. */
export interface ApprovalView {
  connectorId: string;
  resource: string;
  issuer: string;
  origin: Approval['origin'];
  clientId: string | null;
  approvedBy: string;
  approvedAt: string;
}
const address = (value: string) => {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
};
export const linkSubject = (connectorId: string) => 'linked-account:' + connectorId;

export interface LinkedAccountDeps {
  store: LinkStore;
  connectors: ConnectorLinks;
  oauth: OAuth;
  clock: () => Date;
  /** Clew's own address the system returns the person to. */
  redirectUri: string;
  /** The address of the client metadata document Clew serves, when it serves one. */
  clientDocumentUrl: string | null;
  log: (message: string, ...details: unknown[]) => void;
}

export function linkedAccountUsecases(deps: LinkedAccountDeps) {
  /** The key of the person's link: their id (D122). The audit row's actor is their principal. */
  const person = (persona: AuthenticatedContext) => persona.id;
  const actorOf = (persona: AuthenticatedContext) => persona.principal.id;

  /** The setting of a connector this person may link, or the refusal that tells them nothing about one they may not. */
  async function settingFor(persona: AuthenticatedContext, connectorId: string): Promise<LinkSetting> {
    const setting = await settingOf(connectorId);
    if (setting === 'undeclared' || !(await deps.connectors.reaches(persona, connectorId)))
      throw new LinkRefusedError('unknown-connector');
    if (setting === 'unapproved') throw new LinkRefusedError('not-approved');
    return setting;
  }

  /**
   * What the connector declares together with what an administrator approved for it. `unapproved` until somebody has
   * approved the address the manifest names now: an approval for another address approves nothing.
   */
  async function settingOf(connectorId: string): Promise<LinkSetting | 'undeclared' | 'unapproved'> {
    const declared = await deps.connectors.declared(connectorId);
    if (!declared) return 'undeclared';
    const approval = await deps.store.transaction(tx => tx.approval(connectorId));
    if (!approval || approval.resource !== declared.resource) return 'unapproved';
    return {
      connectorId,
      resource: declared.resource,
      scopes: declared.scopes,
      server: approval.server,
      origin: approval.origin,
      client: approval.client,
    };
  }

  /** One approval, with its audit row, as whoever `by` is. */
  async function approved(
    by: { actor: string; name: string },
    connectorId: string,
    input: ApprovalInput,
  ): Promise<ApprovalView> {
    const declared = await deps.connectors.declared(connectorId);
    if (!declared) throw new LinkRefusedError('unknown-connector');
    const entered = input.server;
    if (
      entered &&
      ![
        entered.issuer,
        entered.authorizationEndpoint,
        entered.tokenEndpoint,
        entered.revocationEndpoint ?? entered.issuer,
      ].every(address)
    )
      throw new InputError('Adresserna måste vara fullständiga webbadresser.');
    if (input.client && !input.client.id.trim()) throw new InputError('Klientens id saknas.');
    let server: AuthorizationServer | null;
    if (entered)
      server = {
        issuer: entered.issuer,
        authorizationEndpoint: entered.authorizationEndpoint,
        tokenEndpoint: entered.tokenEndpoint,
        revocationEndpoint: entered.revocationEndpoint ?? null,
        registrationEndpoint: null,
        // Nothing says what an entered server checks, so Clew is never a client without a secret there (item 3).
        pkce: false,
        issuerOnReturn: false,
        clientDocuments: false,
      };
    else
      try {
        server = await deps.oauth.discover(declared.resource);
      } catch (error) {
        throw failed(connectorId, error, () => new LinkRefusedError('no-server'));
      }
    if (!server) throw new LinkRefusedError('no-server');
    const approval: Approval = {
      resource: declared.resource,
      server,
      origin: entered ? 'entered' : 'discovered',
      client: input.client
        ? { id: input.client.id.trim(), secret: input.client.secret || null, source: 'entered' }
        : null,
      approvedBy: by.name,
      approvedAt: deps.clock().toISOString(),
    };
    await deps.store.transaction(async tx => {
      await tx.approve(connectorId, approval);
      await tx.audit({
        actor: by.actor,
        action: 'account.server-approved',
        subject: linkSubject(connectorId),
        details: {
          connector: connectorId,
          resource: approval.resource,
          issuer: server.issuer,
          origin: approval.origin,
          client: approval.client?.id ?? null,
        },
      });
    });
    return approvalView(connectorId, approval);
  }
  const approvalView = (connectorId: string, approval: Approval): ApprovalView => ({
    connectorId,
    resource: approval.resource,
    issuer: approval.server.issuer,
    origin: approval.origin,
    clientId: approval.client?.id ?? null,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
  });
  const administrator = (persona: AuthenticatedContext) => {
    if (!persona.capabilities.includes(LINK_ADMIN_CAPABILITY)) throw new ForbiddenError();
  };

  /** A failure of the authorization server as this module's errors: lost for good, or passing. */
  function failed(connectorId: string, error: unknown, final: () => Error): Error {
    if (error instanceof GrantRefused && error.final) return final();
    deps.log('The authorization server did not answer', {
      connector: connectorId,
      reason: error instanceof GrantRefused ? error.code : 'unreachable',
    });
    return new LinkUnavailableError(connectorId, error instanceof GrantRefused ? error.code : 'unreachable');
  }

  /**
   * The authorization server people are sent to: the one an administrator approved. Where it was discovered it is
   * discovered again, and a system that now names another issuer sends nobody anywhere (D147 item 4).
   */
  async function approvedServer(setting: LinkSetting): Promise<AuthorizationServer> {
    if (setting.origin === 'entered') return setting.server;
    let found: AuthorizationServer | null;
    try {
      found = await deps.oauth.discover(setting.resource);
    } catch (error) {
      throw failed(setting.connectorId, error, () => new LinkRefusedError('no-server'));
    }
    if (!found) throw new LinkRefusedError('no-server');
    if (found.issuer !== setting.server.issuer) throw new LinkRefusedError('issuer-changed');
    return found;
  }

  /** The client Clew already is at this server for this connector, without registering one. */
  async function knownClient(tx: LinkTx, setting: LinkSetting, server: AuthorizationServer) {
    return clientChoice(server, {
      entered: setting.client,
      registered: await tx.client(setting.connectorId, server.issuer),
      documentUrl: deps.clientDocumentUrl,
    });
  }

  /** The client to link with, registering one where the server offers it and Clew has none (D147 item 3). */
  async function clientFor(actor: string, setting: LinkSetting, server: AuthorizationServer): Promise<OAuthClient> {
    const choice = await deps.store.transaction(tx => knownClient(tx, setting, server));
    if ('refused' in choice) throw new LinkRefusedError(choice.refused);
    if ('use' in choice) return choice.use;
    let created: OAuthClient;
    try {
      created = await deps.oauth.register(server, deps.redirectUri);
    } catch (error) {
      throw failed(setting.connectorId, error, () => new LinkRefusedError('no-client'));
    }
    if (!created.secret && !server.pkce) throw new LinkRefusedError('secret-required');
    return deps.store.transaction(async tx => {
      // Two people linking the same system for the first time both register; the first one kept is the one used.
      const kept = await tx.client(setting.connectorId, server.issuer);
      if (kept) return kept;
      await tx.saveClient(setting.connectorId, server.issuer, created);
      await tx.audit({
        actor,
        action: 'account.client-registered',
        subject: linkSubject(setting.connectorId),
        details: { connector: setting.connectorId, issuer: server.issuer },
      });
      return created;
    });
  }

  /** Writes the link as lost, with its audit row, inside the caller's transaction. */
  async function lose(tx: LinkTx, link: LinkedAccount, reason: string) {
    await tx.save(lost(link, reason, deps.clock()));
    await tx.audit({
      actor: LINK_SYSTEM_ACTOR,
      action: 'account.link-lost',
      subject: linkSubject(link.connectorId),
      details: { connector: link.connectorId, issuer: link.issuer, person: link.personId, reason },
    });
  }

  /** Revokes a removed link's tokens at the system, best effort: the row is already gone whatever the system answers. */
  async function revokeAt(link: LinkedAccount): Promise<Revocation> {
    const token = link.refreshToken ?? link.accessToken;
    const setting = await settingOf(link.connectorId);
    if (
      !token ||
      typeof setting === 'string' ||
      setting.server.issuer !== link.issuer ||
      !setting.server.revocationEndpoint
    )
      return 'not-offered';
    const choice = await deps.store.transaction(tx => knownClient(tx, setting, setting.server));
    if (!('use' in choice)) return 'not-offered';
    try {
      await deps.oauth.revoke(setting.server, choice.use, token);
      return 'revoked';
    } catch (error) {
      deps.log('A removed link was not revoked at its system', {
        connector: link.connectorId,
        reason: error instanceof GrantRefused ? error.code : 'unreachable',
      });
      return 'failed';
    }
  }

  /** Removes links with one audit row each, then revokes them at their systems. */
  async function end(
    actor: string,
    reason: string | null,
    pick: (tx: LinkTx) => Promise<LinkedAccount[]>,
    /** What else the same transaction does, once the links are gone. */
    also?: (tx: LinkTx, links: LinkedAccount[]) => Promise<void>,
  ): Promise<Array<{ link: LinkedAccount; revocation: Revocation }>> {
    const removed = await deps.store.transaction(async tx => {
      const links = await pick(tx);
      for (const link of links) {
        await tx.remove(link.personId, link.connectorId);
        await tx.audit({
          actor,
          action: 'account.unlinked',
          subject: linkSubject(link.connectorId),
          details: {
            connector: link.connectorId,
            issuer: link.issuer,
            person: link.personId,
            ...(reason ? { reason } : {}),
          },
        });
      }
      await also?.(tx, links);
      return links;
    });
    const ended: Array<{ link: LinkedAccount; revocation: Revocation }> = [];
    for (const link of removed) ended.push({ link, revocation: await revokeAt(link) });
    return ended;
  }

  /** The rest of finishing a link, once its state is known, in time and the person's own. */
  async function finish(
    persona: AuthenticatedContext,
    pending: PendingLink,
    params: URLSearchParams,
    returned: string,
    now: Date,
  ): Promise<{ connectorId: string; returnTo: string; linked: boolean }> {
    const setting = await settingFor(persona, pending.connectorId);
    if (setting.server.issuer !== pending.issuer) throw new LinkRefusedError('issuer-changed');
    const done = { connectorId: pending.connectorId, returnTo: pending.returnTo };
    if (params.has('error')) return { ...done, linked: false };
    const choice = await deps.store.transaction(tx => knownClient(tx, setting, setting.server));
    if (!('use' in choice)) throw new LinkRefusedError('refused' in choice ? choice.refused : 'no-client');
    let link: LinkedAccount;
    try {
      const tokens = await deps.oauth.redeem(setting.server, choice.use, {
        returned,
        state: pending.state,
        verifier: pending.verifier,
        redirectUri: deps.redirectUri,
        resource: setting.resource,
      });
      link = withTokens(
        {
          personId: pending.personId,
          connectorId: pending.connectorId,
          issuer: pending.issuer,
          resource: setting.resource,
          scopes: setting.scopes,
          state: 'linked',
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          lastError: null,
          lostAt: null,
          linkedAt: now.toISOString(),
        },
        tokens,
        now,
      );
    } catch (error) {
      throw failed(pending.connectorId, error, () => new LinkRefusedError('code-refused'));
    }
    await deps.store.transaction(async tx => {
      await tx.save(link);
      // Linked now, so no longer put off: taken away again later, it is put off anew by that press.
      await tx.takeUp(link.personId, link.connectorId);
      await tx.audit({
        actor: actorOf(persona),
        action: 'account.linked',
        subject: linkSubject(link.connectorId),
        details: { connector: link.connectorId, issuer: link.issuer, person: link.personId, scopes: link.scopes },
      });
    });
    return { ...done, linked: true };
  }

  return {
    /**
     * An administrator approves where a connector's people are sent (D147 item 4): the authorization server the
     * system names, discovered from the address in its approved manifest, or the addresses the administrator enters
     * for a system that publishes none, and the client they registered there. It replaces an earlier approval, and
     * links to another issuer than the new one are not used from then on.
     */
    async approve(persona: AuthenticatedContext, connectorId: string, input: ApprovalInput = {}) {
      administrator(persona);
      await persona.authorize();
      return approved({ actor: actorOf(persona), name: persona.name }, connectorId, input);
    },
    /** The same from the operator's command line (`scripts/connector-link.ts`). */
    approveAsOperator: (connectorId: string, input: ApprovalInput = {}) => approved(OPERATOR, connectorId, input),
    /** What is approved for a connector, from the operator's command line. */
    async approvalAsOperator(connectorId: string): Promise<ApprovalView | null> {
      const approval = await deps.store.transaction(tx => tx.approval(connectorId));
      return approval ? approvalView(connectorId, approval) : null;
    },
    /** What is approved for a connector, for its administrator: never the client's secret. */
    async approval(persona: AuthenticatedContext, connectorId: string): Promise<ApprovalView | null> {
      administrator(persona);
      const approval = await deps.store.transaction(tx => tx.approval(connectorId));
      return approval ? approvalView(connectorId, approval) : null;
    },

    /**
     * Starts linking: where to send the person. Nothing about them is changed yet; the state and the PKCE verifier are
     * kept until they return, for ten minutes.
     */
    async begin(
      persona: AuthenticatedContext,
      connectorId: string,
      returnTo?: string | null,
    ): Promise<{ url: string }> {
      const setting = await settingFor(persona, connectorId);
      const server = await approvedServer(setting);
      const client = await clientFor(actorOf(persona), setting, server);
      const asked = await deps.oauth.begin(server, client, {
        redirectUri: deps.redirectUri,
        resource: setting.resource,
        scopes: setting.scopes,
      });
      const now = deps.clock();
      await deps.store.transaction(async tx => {
        await tx.expire(now.toISOString());
        await tx.pend({
          state: asked.state,
          verifier: asked.verifier,
          personId: person(persona),
          connectorId,
          issuer: server.issuer,
          returnTo: localPath(returnTo),
          expiresAt: new Date(now.getTime() + PENDING_MS).toISOString(),
        });
      });
      return { url: asked.url };
    },

    /**
     * Finishes linking with the address the system returned the person to. The state is used once and only by the
     * person who started it. A return that carries the system's refusal (the person declined) links nothing and says
     * where they came from.
     */
    async complete(
      persona: AuthenticatedContext,
      returned: string,
    ): Promise<{ connectorId: string; returnTo: string; linked: boolean }> {
      let params: URLSearchParams;
      try {
        params = new URL(returned).searchParams;
      } catch {
        throw new LinkRefusedError('state-unknown');
      }
      const state = params.get('state');
      const pending = state ? await deps.store.transaction(tx => tx.take(state)) : null;
      if (!pending) throw new LinkRefusedError('state-unknown');
      const now = deps.clock();
      if (Date.parse(pending.expiresAt) <= now.getTime()) throw new LinkRefusedError('state-expired');
      if (pending.personId !== person(persona)) throw new LinkRefusedError('another-person');
      try {
        return await finish(persona, pending, params, returned, now);
      } catch (error) {
        // The link is this person's own: a refusal says which system and where they came from.
        if (error instanceof LinkRefusedError || error instanceof LinkUnavailableError)
          error.finishing = { connectorId: pending.connectorId, returnTo: pending.returnTo };
        throw error;
      }
    },

    /**
     * The access token a call to this connector carries for this person (D147 items 7 and 8). No session is asked
     * for: the caller has already checked that the person is enabled and reaches the connector. Throws
     * `LinkRequiredError` when there is no link the system accepts (nothing is sent) and `LinkUnavailableError` when
     * the authorization server could not be asked (the link is kept).
     */
    async tokenFor(personId: string, connectorId: string): Promise<string> {
      const setting = await settingOf(connectorId);
      if (setting === 'undeclared') throw new LinkRefusedError('unknown-connector');
      // Declared, and no administrator has approved where its people are sent: no call can carry a token yet.
      if (setting === 'unapproved') throw new LinkUnavailableError(connectorId, 'not-approved');
      // The link is held while its token is refreshed, so a second call waits and reads the token the first one got.
      const outcome = await deps.store.transaction(
        async (tx): Promise<{ token: string } | { required: string } | { unavailable: string }> => {
          const link = await tx.link(personId, connectorId);
          if (!link || link.state !== 'linked') return { required: link?.lastError ?? 'not-linked' };
          const dropped = async (reason: string) => {
            await lose(tx, link, reason);
            return { required: reason };
          };
          // A link to an issuer or a system the administrator no longer approves is not used (item 4).
          if (link.issuer !== setting.server.issuer || link.resource !== setting.resource)
            return dropped('issuer-changed');
          if (isFresh(link, deps.clock())) return { token: link.accessToken! };
          if (!link.refreshToken) return dropped('access-token-expired');
          const choice = await knownClient(tx, setting, setting.server);
          if (!('use' in choice)) return { unavailable: 'no-client' };
          try {
            const tokens = await deps.oauth.refresh(setting.server, choice.use, link.refreshToken, setting.resource);
            const next = withTokens(link, tokens, deps.clock());
            await tx.save(next);
            return { token: next.accessToken! };
          } catch (error) {
            if (error instanceof GrantRefused && error.final) return dropped(error.code);
            return { unavailable: error instanceof GrantRefused ? error.code : 'unreachable' };
          }
        },
      );
      if ('token' in outcome) return outcome.token;
      if ('required' in outcome) throw new LinkRequiredError(connectorId, outcome.required);
      deps.log('A linked account could not be refreshed', { connector: connectorId, reason: outcome.unavailable });
      throw new LinkUnavailableError(connectorId, outcome.unavailable);
    },

    /**
     * The system would not take the token Clew sent (the connector answered `authorization-required`): the link is
     * lost, unless it has been refreshed since and the refused token is no longer the one held.
     */
    async refused(personId: string, connectorId: string, token: string): Promise<void> {
      await deps.store.transaction(async tx => {
        const link = await tx.link(personId, connectorId);
        if (link && link.state === 'linked' && link.accessToken === token) await lose(tx, link, 'refused-by-system');
      });
    },

    /** The person's linked systems, never a token. */
    async list(persona: AuthenticatedContext): Promise<LinkView[]> {
      return (await deps.store.linksOf(person(persona))).map(viewOf);
    },

    /**
     * Every system this person can link an account at, as their pages show it: the systems in their scope and audience
     * that declare a linked account an administrator has approved, each with what its link is, since when, and whether
     * the person put it off. What needs them stands first. A system outside their audience is not in the list, so
     * nothing here tells them it exists.
     */
    async accounts(persona: AuthenticatedContext): Promise<LinkedAccountEntry[]> {
      const systems = await deps.connectors.linkable(persona);
      if (!systems.length) return [];
      const [links, putOff] = await Promise.all([
        deps.store.linksOf(person(persona)),
        deps.store.putOffBy(person(persona)),
      ]);
      const entries: LinkedAccountEntry[] = [];
      for (const system of systems) {
        const setting = await settingOf(system.connectorId);
        if (typeof setting === 'string') continue;
        entries.push(
          entryOf(
            { ...system, revocable: !!setting.server.revocationEndpoint },
            links.find(link => link.connectorId === system.connectorId),
            putOff.includes(system.connectorId),
          ),
        );
      }
      return entries.sort(byNeed);
    },

    /**
     * "Inte nu": the person puts off linking these systems, and Hem stops saying that they need the account. Only a
     * system never linked can be put off: a link that is held or was lost is left as it is. Each system put off writes
     * its audit row in the same transaction; saying it again changes nothing and writes none.
     */
    async later(persona: AuthenticatedContext, connectorIds: string[]): Promise<{ putOff: string[] }> {
      for (const connectorId of connectorIds) await settingFor(persona, connectorId);
      const personId = person(persona);
      const at = deps.clock().toISOString();
      const putOff = await deps.store.transaction(async tx => {
        const already = await tx.putOffBy(personId);
        const done: string[] = [];
        for (const connectorId of new Set(connectorIds)) {
          if (already.includes(connectorId) || (await tx.link(personId, connectorId))) continue;
          await tx.putOff(personId, connectorId, at);
          await tx.audit({
            actor: actorOf(persona),
            action: 'account.link-put-off',
            subject: linkSubject(connectorId),
            details: { connector: connectorId, person: personId },
          });
          done.push(connectorId);
        }
        return done;
      });
      return { putOff };
    },

    /**
     * The person takes their link away. The row goes with its audit row; the tokens are then revoked at the system
     * where it offers that, and the answer says whether it did, so the page can say when a token lives on there. The
     * system is put off in the same transaction: a person who took their link away is not told on Hem to link it.
     */
    async unlink(
      persona: AuthenticatedContext,
      connectorId: string,
    ): Promise<{ unlinked: boolean; revocation: Revocation }> {
      const at = deps.clock().toISOString();
      const [ended] = await end(
        actorOf(persona),
        null,
        async tx => {
          const link = await tx.link(person(persona), connectorId);
          return link ? [link] : [];
        },
        async (tx, links) => {
          for (const link of links) await tx.putOff(link.personId, link.connectorId, at);
        },
      );
      return ended ? { unlinked: true, revocation: ended.revocation } : { unlinked: false, revocation: 'not-offered' };
    },

    /** A person who is disabled or removed keeps no link (D147 item 10). `actor` is who or what removed them. */
    async forgetPerson(personId: string, actor: string): Promise<number> {
      return (
        await end(
          actor,
          'person-removed',
          tx => tx.linksOf(personId),
          tx => tx.takeUp(personId),
        )
      ).length;
    },

    /**
     * A connector that is removed keeps no links. Called while the connector's setting can still be read, so that the
     * tokens can be revoked at its system.
     */
    async forgetConnector(connectorId: string, actor: string): Promise<number> {
      return (await end(actor, 'connector-removed', tx => tx.linksTo(connectorId))).length;
    },

    /** A person who is now outside a connector's audience keeps no link to it. */
    async forgetLink(personId: string, connectorId: string, actor: string): Promise<boolean> {
      const ended = await end(
        actor,
        'outside-audience',
        async tx => {
          const link = await tx.link(personId, connectorId);
          return link ? [link] : [];
        },
        tx => tx.takeUp(personId, connectorId),
      );
      return ended.length > 0;
    },
  };
}
export type LinkedAccounts = ReturnType<typeof linkedAccountUsecases>;

/**
 * What a change of a person's `active` means to linked accounts (D147 item 10), in the shape the people module's
 * leavers port tells every domain: a person who is deactivated keeps no link. It runs on the transaction that
 * deactivates them, so the links go and their audit rows are written if and only if the deactivation commits. Nothing
 * is asked of a system here: a transaction that holds the person's row waits for no network. The tokens are deleted,
 * not revoked, and a system that shares the installation's directory has lost the account by the same change.
 */
export function linkedAccountLeavers(tx: LinkTx) {
  return {
    async deactivated(change: { actor: string; personId: string }): Promise<void> {
      for (const link of await tx.linksOf(change.personId)) {
        await tx.remove(link.personId, link.connectorId);
        await tx.audit({
          actor: change.actor,
          action: 'account.unlinked',
          subject: linkSubject(link.connectorId),
          details: {
            connector: link.connectorId,
            issuer: link.issuer,
            person: link.personId,
            reason: 'person-deactivated',
          },
        });
      }
      await tx.takeUp(change.personId);
    },
    /** A person who is active again links again themselves. */
    async reactivated(): Promise<void> {},
  };
}
