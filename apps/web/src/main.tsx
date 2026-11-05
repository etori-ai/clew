import { StrictMode, Suspense, forwardRef, lazy, useEffect, useState, type AnchorHTMLAttributes } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Routes, Route, useLocation, useSearchParams } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import '@clew/ui/styles.css';
import { createQueryClient } from './query-client';
import { LinkProvider, Providers, SessionBoundary, type BrowserSession } from '@clew/ui';
import type { SessionUser } from '@clew/contracts';
import { StartPage } from './pages/start';
import { CalendarPage } from './pages/calendar';
import { LoginPage } from './pages/login';
import { AdminConnectorsPage } from './pages/admin/connectors';
import { AdminConnectorPage } from './pages/admin/connector';
import { AdminModelsPage } from './pages/admin/models';
import { AdminModelPage } from './pages/admin/model';
import { AdminProviderPage } from './pages/admin/provider';
import { NotAdmin } from './pages/admin/shell';

type Shell = { session: BrowserSession; user: SessionUser; admin: boolean };
/** The cache inspector, development only: the production bundle, the a11y suite and a deployment never carry it. */
const Devtools = import.meta.env.DEV ? lazy(() => import('@tanstack/react-query-devtools').then(m => ({ default: m.ReactQueryDevtools }))) : null;
/**
 * The protected tree mounts only after a live session is confirmed. No user content is kept in browser storage: the
 * query cache (D33) is one client per confirmed session, in memory, emptied once the boundary has shown the ended card.
 */
function Protected({ children }: { children: (shell: Shell) => React.ReactNode }) {
  const [shell, setShell] = useState<Shell | 'loading' | 'anonymous'>('loading');
  const [client] = useState(createQueryClient);
  const location = useLocation();
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session', { cache: 'no-store' }).then(async response => {
      if (cancelled) return;
      if (!response.ok) { setShell('anonymous'); return; }
      const data = await response.json();
      setShell({ session: { csrfToken: data.csrfToken, sessionKey: data.sessionKey, expiresAt: data.expiresAt }, user: data.user, admin: data.admin === true });
    }).catch(() => { if (!cancelled) setShell('anonymous'); });
    return () => { cancelled = true; };
  }, []);
  if (shell === 'loading') return null;
  if (shell === 'anonymous') return <LoginPage returnTo={location.pathname} />;
  return <SessionBoundary session={shell.session} onEnded={() => client.clear()}>
    <QueryClientProvider client={client}>
      {children(shell)}
      {Devtools && <Suspense fallback={null}><Devtools initialIsOpen={false} buttonPosition="bottom-left" /></Suspense>}
    </QueryClientProvider>
  </SessionBoundary>;
}
/** Every Astryx link navigates client-side through react-router; API and external addresses stay plain anchors. */
const RouterLink = forwardRef<HTMLAnchorElement, { href?: string; to?: string } & AnchorHTMLAttributes<HTMLAnchorElement>>(function RouterLink({ href, to, ...rest }, ref) {
  const target = typeof to === 'string' ? to : href;
  if (!target || /^(https?:)?\/\//.test(target) || target.startsWith('/api/')) return <a ref={ref} href={target} {...rest} />;
  return <Link ref={ref} to={target} {...rest} />;
});
/**
 * Routes (D34): `/` is the box with the brief, `/samtal/:id` a conversation in the same column; `/oversikt` is the whole
 * picture, `/omrade/:area` filters it, `/pagar`, `/inte-nu` and `/hanterat` open the three piles (D28), `/vy/kort/…` a card's
 * view over the overview, `/vy/:capability` a view over the box (or over the overview when an area is named), all addressable.
 */
function App() {
  // One element for every start route: a route change between the box, the overview, a pile, a view and a conversation
  // re-renders the page and never remounts it, so focus, the cache's observers and the composer's draft survive the change.
  const start = <Protected>{shell => <StartRoute user={shell.user} admin={shell.admin} />}</Protected>;
  // Administration (D23): the entry point shows only to an administrator, and every call is checked again on the server.
  const admin = (page: (shell: Shell) => React.ReactNode) => <Protected>{shell => shell.admin ? page(shell) : <NotAdmin />}</Protected>;
  return <Routes>
    <Route path="/login" element={<LoginPage returnTo="/" />} />
    <Route path="/kalender" element={<Protected>{shell => <CalendarPage user={shell.user} admin={shell.admin} />}</Protected>} />
    <Route path="/admin" element={admin(shell => <AdminConnectorsPage user={shell.user} />)} />
    <Route path="/admin/anslutningar" element={admin(shell => <AdminConnectorsPage user={shell.user} />)} />
    <Route path="/admin/anslutningar/:id" element={admin(shell => <AdminConnectorPage user={shell.user} />)} />
    <Route path="/admin/modeller" element={admin(shell => <AdminModelsPage user={shell.user} />)} />
    <Route path="/admin/modeller/leverantorer/:id" element={admin(shell => <AdminProviderPage user={shell.user} />)} />
    <Route path="/admin/modeller/:id" element={admin(shell => <AdminModelPage user={shell.user} />)} />
    <Route path="/" element={start} />
    <Route path="/samtal/:conversationId" element={start} />
    <Route path="/vy/:capability" element={start} />
    <Route path="/oversikt" element={start} />
    <Route path="/omrade/:area" element={start} />
    <Route path="/hanterat" element={start} />
    <Route path="/pagar" element={start} />
    <Route path="/inte-nu" element={start} />
    <Route path="/vy/kort/:threadId/:actionId" element={start} />
    <Route path="*" element={start} />
  </Routes>;
}
/** Which face of the start page an address shows: the box, or the whole picture. A capability view opens over the page it was asked from: the overview when an area is named, else the box. */
export function modeOf(pathname: string, search: URLSearchParams): 'fraga' | 'oversikt' {
  if (pathname.startsWith('/vy/kort/')) return 'oversikt';
  if (pathname.startsWith('/vy/')) return search.has('omrade') ? 'oversikt' : 'fraga';
  if (pathname === '/oversikt' || pathname === '/hanterat' || pathname === '/pagar' || pathname === '/inte-nu' || pathname.startsWith('/omrade/')) return 'oversikt';
  return 'fraga';
}
function StartRoute({ user, admin }: { user: SessionUser; admin: boolean }) {
  const location = useLocation();
  const [search] = useSearchParams();
  return <StartPage user={user} admin={admin} mode={modeOf(location.pathname, search)} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode>
  <Providers>
    <BrowserRouter>
      <LinkProvider component={RouterLink}>
        <App />
      </LinkProvider>
    </BrowserRouter>
  </Providers>
</StrictMode>);
