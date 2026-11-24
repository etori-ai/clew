import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { VStack } from '@astryxdesign/core/VStack';
import { ToastViewport, useToast as useAstryxToast, type ShowToastFn } from '@astryxdesign/core/Toast';
import { useAnnounce } from '@astryxdesign/core/hooks';
import { signInHref } from './sign-in-address';
import { tabTitle } from './tab-title';

/**
 * What the browser holds of its session. `sessionKey` names the session and stays while it stands; `policyVersion`
 * changes with the person's access, which the provisioner can move at any time (a unit, a role, a capability).
 */
export interface BrowserSession {
  csrfToken: string;
  sessionKey: string;
  policyVersion: string;
  expiresAt: string;
}
/** The least an answer of `GET /api/auth/session` holds to be one: the session and whose it is. */
export type SessionShape = BrowserSession & { user: { id: string; name: string } };
let transport: { csrf: string; controller: AbortController } | undefined;
export const sessionFetch: typeof fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
  if (url.origin !== window.location.origin || !transport) throw new Error('Session unavailable');
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((v, k) => headers.set(k, v));
  headers.set('x-csrf-token', transport.csrf);
  const signal = AbortSignal.any([transport.controller.signal, ...(init?.signal ? [init.signal] : [])]);
  const response = await fetch(input, { ...init, headers, signal, cache: 'no-store' });
  if (response.status === 401) window.dispatchEvent(new Event('clew-session-ended'));
  return response;
}, fetch);

export async function signOut() {
  let url = '/login';
  const csrf = transport?.csrf;
  if (!csrf) return;
  // A concurrent poll may detect revocation and abort protected reads before this reply arrives.
  // Let the logout reply complete so its token-free provider redirect is retained.
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { 'x-csrf-token': csrf },
    cache: 'no-store',
  });
  // The page says it in its own words (`errorMessage`): neither this nor a network error's message is shown.
  if (!response.ok && response.status !== 401) throw new Error('The sign-out was not confirmed.');
  if (response.ok) url = (await response.json()).url;
  window.dispatchEvent(new Event('clew-session-ended'));
  window.location.replace(url);
}

/** How often an open page asks whether its session still stands. */
const POLL = 15_000;
/**
 * How old the last confirmation may be when the window gets the focus back without the page being hidden for the
 * check: the poll's interval and some slack for its round trip. A page that has kept the focus shows content confirmed
 * that long ago too, so a return within it shows nothing the poll would not.
 */
const FRESH = POLL + 5_000;
/** How long a question about the session may take before Clew counts as out of reach: a page is not left hidden longer. */
export const ASKING = 10_000;

/**
 * How long to wait before asking again after Clew could not be reached, for the `attempt`th time in a row (0 first):
 * two seconds, doubling to half a minute, each spread by a quarter either way, so the tabs of a whole organisation that
 * lost Clew in the same restart do not all ask again in the same second. The session's check and the change stream wait
 * the same way, and while Clew is out of reach nothing else of the session asks (`SessionBoundary`).
 */
export function retryDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 2_000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.75 + random() * 0.5));
}

/** What one answer of `GET /api/auth/session` says of the session. */
export type SessionAnswer<T> = { state: 'signed-in'; session: T } | { state: 'signed-out' } | { state: 'unreachable' };
const UNREACHABLE = { state: 'unreachable' } as const;
const filled = (value: unknown): value is string => typeof value === 'string' && value !== '';
/** Whether a 200's JSON is a session as the server answers one: anything else did not come from the session's route. */
function isSession(value: unknown): value is SessionShape {
  if (!value || typeof value !== 'object') return false;
  const { csrfToken, sessionKey, policyVersion, expiresAt, user } = value as Record<string, unknown>;
  const person = user && typeof user === 'object' ? (user as Record<string, unknown>) : null;
  return (
    filled(csrfToken) &&
    filled(sessionKey) &&
    filled(policyVersion) &&
    filled(expiresAt) &&
    Number.isFinite(Date.parse(expiresAt)) &&
    !!person &&
    filled(person.id) &&
    typeof person.name === 'string'
  );
}
/**
 * Asks `GET /api/auth/session` once (D46: "explicit session denial ends the session; transient connection or database
 * failure allows reconnection"). Only the server's explicit denial is a sign-out: a 401 (no session, or it ended) and the
 * server's own 403 `denied` (the person's access was taken away, and the server revoked the session with it). Anything
 * else says nothing about the session, so Clew is out of reach: a network error, no answer within `wait` (ten seconds), a
 * 5xx of the server or of the proxy while the server restarts, a 429, another 403, and a 200 whose body is not a session
 * (a proxy's HTML page, or JSON of another shape). Rejects only when `signal` aborts.
 */
export async function readSession<T extends SessionShape = SessionShape>(
  signal?: AbortSignal,
  wait = ASKING,
): Promise<SessionAnswer<T>> {
  // A timer of the page's own, not `AbortSignal.timeout`, so the wait runs on the page's clock.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), wait);
  try {
    const response = await fetch('/api/auth/session', {
      cache: 'no-store',
      signal: AbortSignal.any([timeout.signal, ...(signal ? [signal] : [])]),
    });
    let answer: SessionAnswer<T>;
    if (response.status === 401) answer = { state: 'signed-out' };
    else if (response.status === 403) {
      const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
      answer = body?.code === 'denied' ? { state: 'signed-out' } : UNREACHABLE;
    } else if (!response.ok) answer = UNREACHABLE;
    else {
      const body: unknown = await response.json().catch(() => null);
      answer = isSession(body) ? { state: 'signed-in', session: body as T } : UNREACHABLE;
    }
    signal?.throwIfAborted();
    return answer;
  } catch (error) {
    if (signal?.aborted) throw error;
    return UNREACHABLE;
  } finally {
    clearTimeout(timer);
  }
}
/**
 * What a check's answer means for the session the page stands in (`known`): `ended` for an explicit denial or another
 * session (the person signed in again as somebody else in another tab), `unreachable` for Clew out of reach,
 * `access-changed` for the same session with a new authorization version, which reads the session again as the change
 * stream's word of a new policy does and never ends it, and `same` otherwise.
 */
export type SessionStanding = 'same' | 'access-changed' | 'ended' | 'unreachable';
export function sessionStanding(
  known: Pick<BrowserSession, 'sessionKey' | 'policyVersion'>,
  answer: SessionAnswer<Pick<BrowserSession, 'sessionKey' | 'policyVersion'>>,
): SessionStanding {
  if (answer.state === 'signed-out') return 'ended';
  if (answer.state === 'unreachable') return 'unreachable';
  if (answer.session.sessionKey !== known.sessionKey) return 'ended';
  return answer.session.policyVersion === known.policyVersion ? 'same' : 'access-changed';
}

/**
 * Said while Clew is out of reach (D46), by the installation's name (D98, the appearance's `name`). The page and
 * whatever the person has typed on it stay.
 */
export const unreachableWords = (site: string) => `${site} går inte att nå just nu. Försöker igen om en stund.`;
/** Said when Clew answers again after being out of reach. */
const reachedWords = (site: string) => `${site} går att nå igen.`;
/** The tab's title once the session has ended: the last page's name, which could name a person, does not stay (2.4.2). */
const endedTitle = (site: string) => tabTitle('Inloggningen har avslutats', site);
/** What the card in the page's place says once the session has ended; said aloud as it appears (4.1.3). */
const ENDED_WORDS = 'Din inloggning har avslutats. Logga in igen för att fortsätta.';

/** False from a session's end until the next session's boundary is in place: no toast is shown over the ended card. */
let toastsOpen = true;
/**
 * Astryx's `useToast` for every toast the app shows. Each toast of a session stands in that session's own toast region
 * (`SessionBoundary`), which leaves with the session, so its end takes every toast down, one still coming in included.
 * A toast asked for after the end (the answer of a request the end stopped) is neither shown nor announced: nothing of
 * the session's work stays on screen or is said with a live button.
 */
export function useToast(): ShowToastFn {
  const show = useAstryxToast();
  return useCallback<ShowToastFn>(options => (toastsOpen ? show(options) : () => undefined), [show]);
}
/** Hands the boundary the session's own toast region, which it raises its notice of Clew out of reach in. */
function SessionToasts({ into }: { into: RefObject<ShowToastFn | null> }) {
  const show = useAstryxToast();
  useLayoutEffect(() => {
    into.current = show;
    return () => {
      if (into.current === show) into.current = null;
    };
  }, [into, show]);
  return null;
}

/** Sign-in again, back to the address the session ended on with its query, so the step or the item open stays (D116). */
export const signInAgainHref = (location: { pathname: string; search: string }) =>
  signInHref(location.pathname + location.search);
/**
 * The page in place of Clew's when there is no session to show it in: the installation's name as its heading, what is
 * the matter and one move. A region mounted with its words is not read out, so whoever draws it says them through the
 * announcer. `focused` takes the focus to the heading as it appears, for a page that took the place of the one the
 * person was working on.
 */
function SessionNotice({
  site,
  words,
  action,
  focused = false,
}: {
  site: string;
  words: string;
  action: ReactNode;
  focused?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focused) heading.current?.focus();
  }, [focused]);
  return (
    <main>
      <Card padding={8}>
        <VStack gap={4}>
          <Heading level={1} ref={heading} tabIndex={-1}>
            {site}
          </Heading>
          <Text>{words}</Text>
          {action}
        </VStack>
      </Card>
    </main>
  );
}

/**
 * The page while Clew is out of reach and no session is known yet: on the first load, or when the session is read again
 * after a change to the person's access. Never the sign-in page, since an outage is not a sign-out (D46). The caller asks
 * again by itself with `retryDelay`; "Försök igen" asks at once, and `onRetry` says whether Clew answered. It is said on
 * arrival, and again when a press finds Clew still out of reach.
 */
export function SessionUnreachable({ site, onRetry }: { site: string; onRetry: () => Promise<boolean> }) {
  const announce = useAnnounce();
  const words = unreachableWords(site);
  useEffect(() => announce(words), [announce, words]);
  return (
    <SessionNotice
      site={site}
      words={words}
      action={
        <Button
          label="Försök igen"
          clickAction={async () => {
            if (!(await onRetry())) announce(words);
          }}
        />
      }
    />
  );
}

/**
 * Memory only: no session/user content in browser storage. Children unmount on invalidation; `onEnded` is told afterwards.
 * The caller has just read the session it passes (`readSession`), so the page is drawn at once and the session is asked
 * about again only on the poll, on focus, on `pageshow` and after activity elsewhere. Only an explicit denial ends it
 * (`readSession`), or its own deadline passing; while Clew is out of reach the page stays as it is, with what the person
 * has typed, a toast says so and only the growing wait asks again (`retryDelay`) until Clew answers. The same session
 * with a new authorization version is `onAccessChanged`, once the tab is in view: the caller reads the session again.
 * The session's toasts stand in a toast region of its own, Astryx's `ToastViewport`, which leaves with the session.
 * `site` is the installation's name, which the notices, the ended page and its tab's title say.
 */
export function SessionBoundary({
  site,
  session,
  children,
  onEnded,
  onAccessChanged,
}: {
  site: string;
  session: BrowserSession;
  children: ReactNode;
  onEnded?: () => void;
  onAccessChanged?: () => void;
}) {
  // `starting` draws nothing for the one commit before the session's transport is in place, so the children's first
  // reads leave with it; that commit is never painted.
  const [state, setState] = useState<'starting' | 'active' | 'ended'>('starting');
  const deadline = useRef(Date.parse(session.expiresAt));
  const known = useRef(session);
  known.current = session;
  // The session's own toast region's `show`, once it is drawn.
  const toasts = useRef<ShowToastFn | null>(null);
  const announce = useAnnounce();
  const said = useRef(announce);
  said.current = announce;
  // Called after the commit that replaced the children with the ended card, so nothing is left observing what the caller clears.
  const ended = useRef(onEnded);
  ended.current = onEnded;
  const accessChanged = useRef(onAccessChanged);
  accessChanged.current = onAccessChanged;
  // The name as it is when something is said: an administrator's save reaches an open page without a new session.
  const named = useRef(site);
  named.current = site;
  useEffect(() => {
    if (state === 'ended') ended.current?.();
  }, [state]);
  useLayoutEffect(() => {
    const controller = new AbortController();
    transport = { csrf: session.csrfToken, controller };
    toastsOpen = true;
    deadline.current = Date.parse(session.expiresAt);
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('clew-session');
    let ended = false,
      checking = false,
      changed = false,
      lastActivity = 0,
      confirmed = Date.now(),
      // How many questions in a row found Clew out of reach, the next one's wait and the toast that says so.
      failures = 0,
      retry: number | undefined,
      notice: (() => void) | null = null;
    // Opacity, never visibility: a hidden document drops keyboard focus, so every return to the window would lose the person's place (2.4.3).
    const conceal = () => {
      document.documentElement.style.opacity = '0';
    };
    const reveal = () => {
      document.documentElement.style.opacity = '';
    };
    const end = (broadcast = true) => {
      if (ended) return;
      ended = true;
      controller.abort();
      window.clearTimeout(retry);
      // No toast after this one: the session's own region leaves with the children, every toast in it.
      toastsOpen = false;
      document.title = endedTitle(named.current);
      said.current(ENDED_WORDS);
      setState('ended');
      reveal();
      if (broadcast) channel?.postMessage({ type: 'ended', session: session.sessionKey });
    };
    // Clew is out of reach: the page is shown as it is (a page hidden for the check would otherwise stay blank), the
    // toast says so once, and the session is asked about again after a wait that grows. Nothing else asks meanwhile.
    const unreachable = () => {
      reveal();
      if (!notice) notice = toasts.current?.({ body: unreachableWords(named.current), isAutoHide: false }) ?? null;
      window.clearTimeout(retry);
      retry = window.setTimeout(() => void check(), retryDelay(failures++));
    };
    const reached = () => {
      window.clearTimeout(retry);
      if (!failures) return;
      failures = 0;
      notice?.();
      notice = null;
      said.current(reachedWords(named.current));
    };
    async function check() {
      if (ended || checking) return;
      checking = true;
      try {
        const answer = await readSession(controller.signal);
        if (ended) return;
        const standing = sessionStanding(known.current, answer);
        if (standing === 'ended') return end();
        if (standing === 'unreachable' || answer.state !== 'signed-in') return unreachable();
        deadline.current = Date.parse(answer.session.expiresAt);
        confirmed = Date.now();
        reached();
        reveal();
        // The person's access changed (the provisioner moved their unit, role or capabilities): never an end. The caller
        // reads the session again, as the change stream's word of a new policy does. A tab out of view waits until the
        // person is back (its next check), so an organisation's tabs do not all read again in the minute after a
        // reorganisation is pushed.
        if (standing === 'access-changed' && !changed && document.visibilityState === 'visible') {
          changed = true;
          accessChanged.current?.();
        }
      } catch {
        // Aborted: the session ended, or the boundary left.
      } finally {
        checking = false;
      }
    }
    const activity = async (event: Event) => {
      if (!event.isTrusted || ended || failures || document.visibilityState !== 'visible') return;
      if (Date.now() - lastActivity < 30_000) return;
      if (Date.now() >= deadline.current) return end();
      lastActivity = Date.now();
      try {
        const response = await sessionFetch('/api/auth/activity', { method: 'POST' });
        // A 401 has ended the session already (`sessionFetch`); any other failure says nothing of it, so it is asked.
        if (!response.ok) return void check();
        const current = await response.json();
        if (ended) return;
        deadline.current = Date.parse(current.expiresAt);
        channel?.postMessage({ type: 'activity', session: session.sessionKey });
      } catch {
        if (!ended) void check();
      }
    };
    const invalidate = () => end();
    // The window got the focus back: the session is asked about at once, and the page is hidden meanwhile only when
    // its last confirmation is older than the poll keeps it (a tab whose timers were held back while it was away).
    // Hiding it on every return made the whole page blink each time the person came back from another window. While
    // Clew is out of reach the page stays shown, as it was, and only the growing wait asks.
    const focus = () => {
      if (ended || failures) return;
      if (Date.now() - confirmed > FRESH) conceal();
      void check();
    };
    // A page shown again from the browser's back/forward cache may be one a sign-out left behind: always hidden first.
    // The first load's own `pageshow` is not one: its session was read just now (L9 of the web review of 2026-11-23).
    const pageshow = (event: PageTransitionEvent) => {
      if (!ended && event.persisted) {
        conceal();
        void check();
      }
    };
    const pagehide = () => {
      conceal();
    };
    // While Clew is out of reach the poll stands still and only the growing wait asks: thousands of browsers that lost
    // Clew in one restart come back spread over the wait, not together on the next quarter minute.
    const timer = setInterval(() => {
      if (Date.now() >= deadline.current) end();
      else if (!failures) void check();
    }, POLL);
    const expiry = setInterval(() => {
      if (Date.now() >= deadline.current) end();
    }, 1000);
    channel?.addEventListener('message', event => {
      if (event.data?.session !== session.sessionKey) return;
      if (event.data.type === 'ended') end(false);
      else if (event.data.type === 'activity' && !failures) void check();
    });
    for (const name of ['pointerdown', 'keydown', 'wheel', 'touchmove'])
      window.addEventListener(name, activity, { passive: true });
    window.addEventListener('clew-session-ended', invalidate);
    window.addEventListener('focus', focus);
    window.addEventListener('pageshow', pageshow);
    window.addEventListener('pagehide', pagehide);
    setState(current => (current === 'starting' ? 'active' : current));
    return () => {
      // Abort callbacks can settle after cleanup (including React's development StrictMode replay).
      // They must neither update this component nor post to its now-closed BroadcastChannel.
      ended = true;
      controller.abort();
      channel?.close();
      clearInterval(timer);
      clearInterval(expiry);
      window.clearTimeout(retry);
      // The boundary leaves with the session it stood for (a change of access resets the tree): so does its toast
      // region, every toast in it, and none is shown until the next session's boundary is in place.
      toastsOpen = false;
      for (const name of ['pointerdown', 'keydown', 'wheel', 'touchmove']) window.removeEventListener(name, activity);
      window.removeEventListener('clew-session-ended', invalidate);
      window.removeEventListener('focus', focus);
      window.removeEventListener('pageshow', pageshow);
      window.removeEventListener('pagehide', pagehide);
      reveal();
      if (transport?.controller === controller) transport = undefined;
    };
  }, [session.sessionKey, session.csrfToken]);
  if (state === 'starting') return null;
  if (state === 'ended')
    return (
      <SessionNotice
        site={site}
        words={ENDED_WORDS}
        focused
        action={<Button label="Logga in igen" href={signInAgainHref(window.location)} />}
      />
    );
  // The session's own toast region: Astryx's container for toasts, at the root of the session's page. Astryx has no
  // way to take down every toast, nor one still coming in, so the region leaves with the session instead.
  return (
    <ToastViewport>
      <SessionToasts into={toasts} />
      {children}
    </ToastViewport>
  );
}
