import type { CalendarProvider } from './model';
import { Microsoft365Provider } from './microsoft365';
import { NextcloudProvider } from './nextcloud';

/**
 * Calendar adapters. `CalendarProvider` in `model.ts` is Clew's contract; every calendar system is reached
 * through an adapter that implements it, chosen per account from the credential's `kind`. Nothing above
 * this file knows which protocol a person's calendar speaks (D11).
 */
export type CalendarAdapterKind = CalendarCredential['kind'];

export type CalendarCredential =
  /** CalDAV with iCalendar scheduling (RFC 4791, 6638). Nextcloud in dev; any CalDAV server in production. */
  | { kind: 'caldav'; url: string; user: string; password: string }
  /**
   * Microsoft 365 through Microsoft Graph. Exchange Online has no CalDAV endpoint and EWS is retired from
   * October 2026. `token` yields a delegated Graph access token for the account's user; see
   * `docs/architecture/identity.md` for how the BFF obtains it. The execution ledger calls it without a session (D69). `url` points at the local fake in development (D69).
   */
  | { kind: 'microsoft365'; token: () => Promise<string>; account: { email: string; name: string }; url?: string };

export function createCalendarProvider(credential: CalendarCredential): CalendarProvider {
  switch (credential.kind) {
    case 'caldav':
      return new NextcloudProvider(credential.user, credential.password, credential.url);
    case 'microsoft365':
      return new Microsoft365Provider(credential.token, credential.account, credential.url);
  }
}
