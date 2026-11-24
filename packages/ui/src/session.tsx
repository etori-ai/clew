import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast as useAstryxToast, type ShowToastFn } from '@astryxdesign/core/Toast';
import { useAnnounce } from '@astryxdesign/core/hooks';

export interface BrowserSession {
  csrfToken: string;
  sessionKey: string;
  expiresAt: string;
}
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
  if (!response.ok && response.status !== 401) throw new Error('Utloggningen kunde inte bekräftas. Försök igen.');
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
const ASKING = 10_000;

/**
 * How long to wait before asking again after Clew could not be reached, for the `attempt`th time in a row (0 first):
 * two seconds, doubling to half a minute, each spread by a quarter either way, so the tabs of a whole organisation that
 * lost Clew in the same restart do not all ask again in the same second. The session's check and the change stream wait
 * the same way.
 */
export function retryDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 2_000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.75 + random() * 0.5));
}

/** What one answer of `GET /api/auth/session` says of the session. */
export type SessionAnswer<T> = { state: 'signed-in'; session: T } | { state: 'signed-out' } | { state: 'unreachable' };
/**
 * Asks `GET /api/auth/session` once (D46: "explicit session denial ends the session; transient connection or database
 * failure allows reconnection"). Only the server's explicit denial is a sign-out: a 401 (no session, or it ended) and the
 * server's own 403 `denied` (the person's access was taken away, and the server revoked the session with it). Anything
 * else says nothing about the session, so Clew is out of reach: a network error, no answer within ten seconds, a 5xx of
 * the server or of the proxy while the server restarts, a 429, another 403 and an answer that is not the session's JSON.
 * Rejects only when `signal` aborts.
 */
export async function readSession<T>(signal?: AbortSignal): Promise<SessionAnswer<T>> {
  try {
    const response = await fetch('/api/auth/session', {
      cache: 'no-store',
      signal: AbortSignal.any([AbortSignal.timeout(ASKING), ...(signal ? [signal] : [])]),
    });
    if (response.status === 401) return { state: 'signed-out' };
    if (response.status === 403) {
      const answer = (await response.json().catch(() => null)) as { code?: unknown } | null;
      return answer?.code === 'denied' ? { state: 'signed-out' } : { state: 'unreachable' };
    }
    if (!response.ok) return { state: 'unreachable' };
    return { state: 'signed-in', session: (await response.json()) as T };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { state: 'unreachable' };
  }
}

/** Said while Clew is out of reach (D46). The page and whatever the person has typed on it stay. */
export const UNREACHABLE_WORDS = 'Startsidan går inte att nå just nu. Försöker igen om en stund.';
/** Said when Clew answers again after being out of reach. */
const REACHED_WORDS = 'Startsidan går att nå igen.';
/** The tab's title once the session has ended: the last page's name, which could name a person, does not stay (2.4.2). */
const ENDED_TITLE = 'Inloggningen har avslutats · Startsidan';
/** What the card in the page's place says once the session has ended; said aloud as it appears (4.1.3). */
const ENDED_WORDS = 'Din inloggning har avslutats. Logga in igen för att fortsätta.';

/** The dismissers of the toasts shown while a session stands, so that its end takes them down. */
const sessionToasts = new Set<() => void>();
/** False from a session's end until the next session's boundary is in place: no toast is shown over the ended card. */
let toastsOpen = true;
/** Every toast of the session goes: none keeps a work item's title or a button that can no longer work. */
function closeToasts() {
  toastsOpen = false;
  for (const dismiss of [...sessionToasts]) dismiss();
  sessionToasts.clear();
}
/**
 * Astryx's `useToast` for every toast the app shows. A toast shown while a session stands is taken down when the session
 * ends or its boundary leaves (a change of the person's access, the change stream's word that it ended), and a toast
 * asked for after that (the answer of a request the end stopped) is not shown: nothing of the session's work stays on
 * screen with a live button. Astryx has no way to take down every toast, so each toast's own dismiss is kept here.
 */
export function useToast(): ShowToastFn {
  const show = useAstryxToast();
  return useCallback<ShowToastFn>(
    options => {
      if (!toastsOpen) return () => undefined;
      let dismiss: () => void = () => undefined;
      dismiss = show({
        ...options,
        onHide: reason => {
          sessionToasts.delete(dismiss);
          options.onHide?.(reason);
        },
      });
      sessionToasts.add(dismiss);
      return dismiss;
    },
    [show],
  );
}

/** Sign-in again, back to the address the session ended on with its query, so the step or the item open stays (D116). */
function signInAgainHref() {
  const here = window.location.pathname + window.location.search;
  return here.startsWith('/') && !here.startsWith('//')
    ? '/api/auth/login?returnTo=' + encodeURIComponent(here)
    : '/api/auth/login';
}
/**
 * The page in place of Clew's when there is no session to show it in: a heading, what is the matter and one move. A
 * region mounted with its words is not read out, so whoever draws it says them through the announcer.
 */
function SessionNotice({ words, action }: { words: string; action: ReactNode }) {
  return (
    <main>
      <Card padding={8}>
        <VStack gap={4}>
          <Heading level={1}>Startsidan</Heading>
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
export function SessionUnreachable({ onRetry }: { onRetry: () => Promise<boolean> }) {
  const announce = useAnnounce();
  useEffect(() => announce(UNREACHABLE_WORDS), [announce]);
  return (
    <SessionNotice
      words={UNREACHABLE_WORDS}
      action={
        <Button
          label="Försök igen"
          clickAction={async () => {
            if (!(await onRetry())) announce(UNREACHABLE_WORDS);
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
 * has typed, a toast says so and Clew is asked again with `retryDelay` until it answers.
 */
export function SessionBoundary({
  session,
  children,
  onEnded,
}: {
  session: BrowserSession;
  children: ReactNode;
  onEnded?: () => void;
}) {
  // `starting` draws nothing for the one commit before the session's transport is in place, so the children's first
  // reads leave with it; that commit is never painted.
  const [state, setState] = useState<'starting' | 'active' | 'ended'>('starting');
  const deadline = useRef(Date.parse(session.expiresAt));
  const toast = useToast();
  const announce = useAnnounce();
  const said = useRef({ toast, announce });
  said.current = { toast, announce };
  // Called after the commit that replaced the children with the ended card, so nothing is left observing what the caller clears.
  const ended = useRef(onEnded);
  ended.current = onEnded;
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
      closeToasts();
      document.title = ENDED_TITLE;
      said.current.announce(ENDED_WORDS);
      setState('ended');
      reveal();
      if (broadcast) channel?.postMessage({ type: 'ended', session: session.sessionKey });
    };
    // Clew is out of reach: the page is shown as it is (a page hidden for the check would otherwise stay blank), the
    // toast says so once, and the session is asked about again after a wait that grows.
    const unreachable = () => {
      reveal();
      if (!notice) notice = said.current.toast({ body: UNREACHABLE_WORDS, isAutoHide: false });
      window.clearTimeout(retry);
      retry = window.setTimeout(() => void check(), retryDelay(failures++));
    };
    const reached = () => {
      window.clearTimeout(retry);
      if (!failures) return;
      failures = 0;
      notice?.();
      notice = null;
      said.current.announce(REACHED_WORDS);
    };
    async function check() {
      if (ended || checking) return;
      checking = true;
      try {
        const answer = await readSession<{ sessionKey: string; expiresAt: string }>(controller.signal);
        if (ended) return;
        if (answer.state === 'signed-out') return end();
        if (answer.state === 'unreachable') return unreachable();
        if (answer.session.sessionKey !== session.sessionKey) return end();
        deadline.current = Date.parse(answer.session.expiresAt);
        confirmed = Date.now();
        reached();
        reveal();
      } catch {
        // Aborted: the session ended, or the boundary left.
      } finally {
        checking = false;
      }
    }
    const activity = async (event: Event) => {
      if (!event.isTrusted || ended || document.visibilityState !== 'visible' || Date.now() - lastActivity < 30_000)
        return;
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
    // Clew is out of reach the page stays shown, as it was.
    const focus = () => {
      if (ended) return;
      if (!failures && Date.now() - confirmed > FRESH) conceal();
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
    const timer = setInterval(() => {
      if (Date.now() >= deadline.current) end();
      else void check();
    }, POLL);
    const expiry = setInterval(() => {
      if (Date.now() >= deadline.current) end();
    }, 1000);
    channel?.addEventListener('message', event => {
      if (event.data?.session !== session.sessionKey) return;
      if (event.data.type === 'ended') end(false);
      else if (event.data.type === 'activity') void check();
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
      // The boundary leaves with the session it stood for (a change of access resets the tree): so do its toasts.
      closeToasts();
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
    return <SessionNotice words={ENDED_WORDS} action={<Button label="Logga in igen" href={signInAgainHref()} />} />;
  return children;
}
