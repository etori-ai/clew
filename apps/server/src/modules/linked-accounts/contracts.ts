/**
 * Linked accounts (D147): what a person's link to one system is, and the ways linking and using it can fail. A system
 * that cannot take the identity provider's token issues its own; the person links their account there once and Clew
 * keeps the tokens.
 */

/** `linked` while the system accepts the tokens; `needs-link` once it refused them for good, with the tokens gone. */
export type LinkState = 'linked' | 'needs-link';

/**
 * One person's link to one connector's system. The tokens are plain text here; an adapter that keeps them seals them
 * at rest. They never reach the browser, an audit row, a log line or a trace.
 */
export interface LinkedAccount {
  /** The person's id (D122), never a user name. */
  personId: string;
  connectorId: string;
  /** The authorization server that issued the tokens. */
  issuer: string;
  /** The system the tokens are for. */
  resource: string;
  scopes: string[];
  state: LinkState;
  accessToken: string | null;
  refreshToken: string | null;
  /** When the access token stops being accepted; null when the system gave it no lifetime. */
  expiresAt: string | null;
  /** Why the link was lost, as a code; null while it is linked. */
  lastError: string | null;
  /** When the link was lost; null while it is linked. */
  lostAt: string | null;
  linkedAt: string;
}

/** An authorization a person started and has not returned from: used once, and only until it expires. */
export interface PendingLink {
  state: string;
  verifier: string;
  personId: string;
  connectorId: string;
  issuer: string;
  /** The page in Clew the person left from, as a local path. */
  returnTo: string;
  expiresAt: string;
}

/** A link as the person is shown it: never a token. */
export interface LinkView {
  connectorId: string;
  state: LinkState;
  issuer: string;
  linkedAt: string;
}

/** What unlinking could do about the tokens at the system. */
export type Revocation = 'revoked' | 'not-offered' | 'failed';

/** The system needs the person's account and they have none it accepts: nothing was sent, and the person links. */
export class LinkRequiredError extends Error {
  readonly code = 'link-required';
  constructor(
    readonly connectorId: string,
    /** Why, as a code: `not-linked`, or what the link was lost to. */
    readonly reason: string,
  ) {
    super('Systemet behöver ditt konto. Koppla ditt konto och försök igen.');
    this.name = 'LinkRequiredError';
  }
}

/** The system's authorization server did not answer, or refused for a passing reason: the link is kept. */
export class LinkUnavailableError extends Error {
  readonly code = 'source-unavailable';
  constructor(
    readonly connectorId: string,
    readonly reason: string,
  ) {
    super('Systemet svarar inte just nu. Försök igen om en stund.');
    this.name = 'LinkUnavailableError';
  }
}

/** Why a link could not be started or finished. */
export type LinkRefusal =
  /** No such connector for this person, or it declares no linked account. */
  | 'unknown-connector'
  /** The connector declares a linked account that no administrator has approved for its address. */
  | 'not-approved'
  /** The system now answers another authorization server than the one an administrator approved. */
  | 'issuer-changed'
  /** The system publishes no authorization server and none was entered. */
  | 'no-server'
  /** Clew has no client at the authorization server and cannot register one. */
  | 'no-client'
  /** The server does not say it checks PKCE, so a client without a secret is not used there. */
  | 'secret-required'
  /** The return carries a state nobody started, or one already used. */
  | 'state-unknown'
  | 'state-expired'
  /** The return reached another person's session than the one that started it. */
  | 'another-person'
  /** The authorization server refused the code. */
  | 'code-refused';

/** Linking was refused. The message is what a person reads; the reason is for the log and the administrator. */
export class LinkRefusedError extends Error {
  readonly code = 'link-refused';
  constructor(readonly reason: LinkRefusal) {
    super(
      reason === 'unknown-connector'
        ? 'Systemet finns inte eller går inte att koppla.'
        : 'Kopplingen kunde inte slutföras. Försök igen.',
    );
    this.name = 'LinkRefusedError';
  }
}
