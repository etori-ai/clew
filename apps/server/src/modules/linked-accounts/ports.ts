import type { AuthenticatedContext } from '@clew/contracts';
import type { LinkedAccount, PendingLink } from './contracts';

/**
 * The ports of linked accounts (D25, D147): where links are kept, what the connectors' side knows, and the OAuth
 * protocol toward a system's authorization server. Composition pairs them with live adapters; the unit suite runs on
 * the memory store and the real OAuth adapter over an authorization server in memory.
 */

/** A system's authorization server, as its metadata says it is or as an administrator entered it. */
export interface AuthorizationServer {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string | null;
  registrationEndpoint: string | null;
  /** The server says it checks PKCE with S256. False for a server that says nothing. */
  pkce: boolean;
  /** The server says it returns its issuer with the code (RFC 9207). */
  issuerOnReturn: boolean;
  /** The server says it reads a client metadata document. */
  clientDocuments: boolean;
}

/** Clew's identity at one authorization server. */
export interface OAuthClient {
  id: string;
  secret: string | null;
  /** `entered` by an administrator, a metadata `document` Clew serves, or `registered` dynamically (RFC 7591). */
  source: 'entered' | 'document' | 'registered';
}

/**
 * What an administrator approved for one connector that declares `linkedAccount` (D144, D147 item 4), as it is kept:
 * the authorization server people are sent to and Clew's client there, for the address the manifest named then.
 */
export interface Approval {
  /** The system's address the approval is for. A manifest that names another address is not approved. */
  resource: string;
  server: AuthorizationServer;
  /**
   * `discovered`: read from the system's metadata, and read again each time a person links, so a system that starts
   * answering another issuer sends nobody anywhere. `entered`: typed by an administrator for a system that publishes
   * none.
   */
  origin: 'discovered' | 'entered';
  /** The client an administrator registered at the system, when there is one. */
  client: OAuthClient | null;
  approvedBy: string;
  approvedAt: string;
}

/** A connector's declaration and its approval together: what linking and a call need. */
export interface LinkSetting {
  connectorId: string;
  resource: string;
  scopes: string[];
  server: AuthorizationServer;
  origin: Approval['origin'];
  client: OAuthClient | null;
}

/** The connectors' side, which this module does not own: the registry and the approved manifests. */
export interface ConnectorLinks {
  /** What the connector's approved manifest declares as its linked account; null for a connector that declares none. */
  declared(connectorId: string): Promise<{ resource: string; scopes: string[] } | null>;
  /** Whether the connector is in this person's scope and audience today. A person outside it cannot tell it exists. */
  reaches(persona: AuthenticatedContext, connectorId: string): Promise<boolean>;
}

export interface TokenSet {
  accessToken: string;
  /** Null when the answer carried none: the one already held is kept. */
  refreshToken: string | null;
  /** Seconds the access token lives; null when the server did not say. */
  expiresIn: number | null;
  /** The scopes granted; null when the server did not say. */
  scopes: string[] | null;
}

/**
 * The authorization server refused a grant. `final`: for good (`invalid_grant`, or a 400 or 401 that names no passing
 * cause), so the link is lost. Otherwise for a passing reason (a 5xx, a 429, a timeout), and the link is kept.
 */
export class GrantRefused extends Error {
  constructor(
    readonly code: string,
    readonly final: boolean,
  ) {
    super('The authorization server refused the grant: ' + code);
    this.name = 'GrantRefused';
  }
}

/** The OAuth protocol toward one authorization server. Every method throws `GrantRefused` for a refusal. */
export interface OAuth {
  /** The authorization server the system at `resource` names (RFC 9728, RFC 8414); null when it publishes none. */
  discover(resource: string): Promise<AuthorizationServer | null>;
  /** Registers Clew as a client (RFC 7591): without a secret where the server checks PKCE, with one elsewhere. */
  register(server: AuthorizationServer, redirectUri: string): Promise<OAuthClient>;
  /** The address the person is sent to, with the state and the PKCE verifier to keep until they return. */
  begin(
    server: AuthorizationServer,
    client: OAuthClient,
    ask: { redirectUri: string; resource: string; scopes: string[] },
  ): Promise<{ url: string; state: string; verifier: string }>;
  /** Trades the code the person returned with for tokens, checking the state and the issuer. */
  redeem(
    server: AuthorizationServer,
    client: OAuthClient,
    answer: { returned: string; state: string; verifier: string; redirectUri: string; resource: string },
  ): Promise<TokenSet>;
  refresh(server: AuthorizationServer, client: OAuthClient, refreshToken: string, resource: string): Promise<TokenSet>;
  /** Revokes a token where the server has a revocation endpoint. Throws when it has none or refuses. */
  revoke(server: AuthorizationServer, client: OAuthClient, token: string): Promise<void>;
}

export interface LinkAuditEntry {
  actor: string;
  action: string;
  subject: string;
  details: Record<string, unknown>;
}

export interface LinkTx {
  /**
   * One person's link, held for the rest of the transaction: a second transaction asking for the same link waits, so
   * two calls never spend the same refresh token.
   */
  link(personId: string, connectorId: string): Promise<LinkedAccount | null>;
  save(link: LinkedAccount): Promise<void>;
  remove(personId: string, connectorId: string): Promise<void>;
  linksOf(personId: string): Promise<LinkedAccount[]>;
  linksTo(connectorId: string): Promise<LinkedAccount[]>;
  /** Keeps an authorization a person started. */
  pend(pending: PendingLink): Promise<void>;
  /** The pending authorization with this state, taken away: a state is used once. Null when there is none. */
  take(state: string): Promise<PendingLink | null>;
  /** Removes the pending authorizations whose time passed at or before `now`: the ones nobody returned from. */
  expire(now: string): Promise<void>;
  /** The client Clew registered at this issuer for this connector, when it did. */
  client(connectorId: string, issuer: string): Promise<OAuthClient | null>;
  saveClient(connectorId: string, issuer: string, client: OAuthClient): Promise<void>;
  /** What an administrator approved for the connector; null when nothing is. */
  approval(connectorId: string): Promise<Approval | null>;
  approve(connectorId: string, approval: Approval): Promise<void>;
  audit(entry: LinkAuditEntry): Promise<void>;
}

export interface LinkStore {
  linksOf(personId: string): Promise<LinkedAccount[]>;
  /** One transaction: everything in it is written, with its audit rows, or nothing is. */
  transaction<T>(fn: (tx: LinkTx) => Promise<T>): Promise<T>;
}
