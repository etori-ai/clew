import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { VStack } from '@astryxdesign/core/VStack';

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

/** Memory only: no session/user content in browser storage. Children unmount on invalidation; `onEnded` is told afterwards. */
export function SessionBoundary({
  session,
  children,
  onEnded,
}: {
  session: BrowserSession;
  children: ReactNode;
  onEnded?: () => void;
}) {
  const [state, setState] = useState<'checking' | 'active' | 'ended'>('checking');
  const deadline = useRef(Date.parse(session.expiresAt));
  // Called after the commit that replaced the children with the ended card, so nothing is left observing what the caller clears.
  const ended = useRef(onEnded);
  ended.current = onEnded;
  useEffect(() => {
    if (state === 'ended') ended.current?.();
  }, [state]);
  useEffect(() => {
    const controller = new AbortController();
    transport = { csrf: session.csrfToken, controller };
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('clew-session');
    let ended = false,
      checking = false,
      lastActivity = 0;
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
      setState('ended');
      reveal();
      if (broadcast) channel?.postMessage({ type: 'ended', session: session.sessionKey });
    };
    const check = async () => {
      if (ended || checking) return;
      checking = true;
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return end();
        const current = await response.json();
        if (ended) return;
        if (current.sessionKey !== session.sessionKey) return end();
        deadline.current = Date.parse(current.expiresAt);
        setState('active');
        reveal();
      } catch {
        end();
      } finally {
        checking = false;
      }
    };
    const activity = async (event: Event) => {
      if (!event.isTrusted || ended || document.visibilityState !== 'visible' || Date.now() - lastActivity < 30_000)
        return;
      if (Date.now() >= deadline.current) return end();
      lastActivity = Date.now();
      try {
        const response = await sessionFetch('/api/auth/activity', { method: 'POST' });
        if (!response.ok) return end();
        const current = await response.json();
        if (ended) return;
        deadline.current = Date.parse(current.expiresAt);
        channel?.postMessage({ type: 'activity', session: session.sessionKey });
      } catch {
        end();
      }
    };
    const invalidate = () => end();
    const focus = () => {
      if (!ended) {
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
    }, 15_000);
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
    window.addEventListener('pageshow', focus);
    window.addEventListener('pagehide', pagehide);
    void check();
    return () => {
      // Abort callbacks can settle after cleanup (including React's development StrictMode replay).
      // They must neither update this component nor post to its now-closed BroadcastChannel.
      ended = true;
      controller.abort();
      channel?.close();
      clearInterval(timer);
      clearInterval(expiry);
      for (const name of ['pointerdown', 'keydown', 'wheel', 'touchmove']) window.removeEventListener(name, activity);
      window.removeEventListener('clew-session-ended', invalidate);
      window.removeEventListener('focus', focus);
      window.removeEventListener('pageshow', focus);
      window.removeEventListener('pagehide', pagehide);
      reveal();
      if (transport?.controller === controller) transport = undefined;
    };
  }, [session.sessionKey, session.csrfToken]);
  if (state !== 'active')
    return (
      <main>
        <Card padding={8}>
          <VStack gap={4}>
            <Heading level={1}>Startsidan</Heading>
            <Text role="status">
              {state === 'checking'
                ? 'Kontrollerar inloggning…'
                : 'Din inloggning har avslutats. Logga in igen för att fortsätta.'}
            </Text>
            {state === 'ended' && <Button label="Logga in igen" href="/api/auth/login" />}
          </VStack>
        </Card>
      </main>
    );
  return children;
}
