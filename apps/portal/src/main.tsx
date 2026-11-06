import { StrictMode, forwardRef, useEffect, useRef, useState, type AnchorHTMLAttributes } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Routes, Route, useLocation } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import '@clew/ui/styles.css';
import { LinkProvider, Providers, SessionBoundary, type BrowserSession } from '@clew/ui';
import type { SessionUser } from '@clew/contracts';
import { createQueryClient } from '../../web/src/query-client';
import { changeNotices } from '../../web/src/thread-cache';
import { ConversationProvider } from '../../web/src/components/conversation-context';
import { LoginPage } from '../../web/src/pages/login';
import { branding } from './branding';
import { PortalStart } from './pages/start';
import { ActivitiesPage } from './pages/activities';
import { CardPage } from './pages/card';
import { ViewPage } from './pages/tool';

type Shell = { session: BrowserSession; user: SessionUser };
type State = Shell | 'loading' | 'anonymous';

/** The same session read as the web app's (`/api/auth/session`); the BFF, the cookie and the CSRF token are shared. */
async function readSession(): Promise<State> {
  try {
    const response = await fetch('/api/auth/session', { cache: 'no-store' });
    if (!response.ok) return 'anonymous';
    const data = await response.json();
    return {
      session: { csrfToken: data.csrfToken, sessionKey: data.sessionKey, expiresAt: data.expiresAt },
      user: data.user,
    };
  } catch {
    return 'anonymous';
  }
}

/**
 * The protected tree, as in the web app (D33, D46): one in-memory query client per confirmed session, change notices
 * over SSE that invalidate the cache by committed revision, and a cleared tree when the person's policy changes.
 */
function Protected({ children }: { children: (shell: Shell) => React.ReactNode }) {
  const [shell, setShell] = useState<State>('loading');
  const [client] = useState(createQueryClient);
  const policy = useRef<string | undefined>(undefined);
  const location = useLocation();
  useEffect(() => {
    let cancelled = false;
    void readSession().then(next => {
      if (!cancelled) setShell(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (shell === 'loading' || shell === 'anonymous') return;
    let source: EventSource | undefined,
      stopped = false;
    const notices = changeNotices(client);
    const connect = () => {
      source?.close();
      if (document.visibilityState === 'hidden' || stopped) return;
      source = new EventSource('/api/changes');
      source.onmessage = event => {
        let change: { ended?: boolean; revision?: string; policy?: string };
        try {
          change = JSON.parse(event.data);
        } catch {
          return;
        }
        if (change.ended) {
          source?.close();
          void client.cancelQueries();
          client.clear();
          setShell('anonymous');
          return;
        }
        if (typeof change.policy !== 'string' || typeof change.revision !== 'string') return;
        const revoked = policy.current !== undefined && policy.current !== change.policy;
        policy.current = change.policy;
        if (revoked) {
          source?.close();
          void client.cancelQueries();
          client.clear();
          setShell('loading');
          void readSession().then(setShell);
        } else notices.arrived();
      };
    };
    connect();
    document.addEventListener('visibilitychange', connect);
    window.addEventListener('online', connect);
    return () => {
      stopped = true;
      notices.stop();
      source?.close();
      document.removeEventListener('visibilitychange', connect);
      window.removeEventListener('online', connect);
    };
  }, [client, shell]);
  if (shell === 'loading') return null;
  if (shell === 'anonymous') return <LoginPage returnTo={location.pathname} />;
  return (
    <SessionBoundary session={shell.session} onEnded={() => client.clear()}>
      <QueryClientProvider client={client}>
        <ConversationProvider>{children(shell)}</ConversationProvider>
      </QueryClientProvider>
    </SessionBoundary>
  );
}
/** Every Astryx link navigates client-side; API and external addresses stay plain anchors. */
const RouterLink = forwardRef<
  HTMLAnchorElement,
  { href?: string; to?: string } & AnchorHTMLAttributes<HTMLAnchorElement>
>(function RouterLink({ href, to, ...rest }, ref) {
  const target = typeof to === 'string' ? to : href;
  if (!target || /^(https?:)?\/\//.test(target) || target.startsWith('/api/'))
    return <a ref={ref} href={target} {...rest} />;
  return <Link ref={ref} to={target} {...rest} />;
});
/**
 * The portal's routes (D67): the start page at `/`, a conversation in its place at `/conversations/:id` (the route the
 * shared conversation provider expects), Mina aktiviteter, a card as a page and a view as a page.
 */
function App() {
  const start = <Protected>{shell => <PortalStart user={shell.user} />}</Protected>;
  return (
    <Routes>
      <Route path="/login" element={<LoginPage returnTo="/" />} />
      <Route path="/activities" element={<Protected>{shell => <ActivitiesPage user={shell.user} />}</Protected>} />
      <Route path="/cards/:threadId" element={<Protected>{shell => <CardPage user={shell.user} />}</Protected>} />
      <Route path="/tools/:capability" element={<Protected>{shell => <ViewPage user={shell.user} />}</Protected>} />
      <Route path="/" element={start} />
      <Route path="/conversations/:conversationId" element={start} />
      <Route path="*" element={start} />
    </Routes>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers branding={branding}>
      <BrowserRouter>
        <LinkProvider component={RouterLink}>
          <App />
        </LinkProvider>
      </BrowserRouter>
    </Providers>
  </StrictMode>,
);
