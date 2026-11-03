import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router';
import '@clew/ui/styles.css';
import { Providers, SessionBoundary, type BrowserSession } from '@clew/ui';
import type { SessionUser } from '@clew/contracts';
import { StartPage } from './pages/start';
import { CalendarPage } from './pages/calendar';
import { LoginPage } from './pages/login';

type Shell = { session: BrowserSession; user: SessionUser };
/** The protected tree mounts only after a live session is confirmed. No user content is kept in browser storage. */
function Protected({ children }: { children: (shell: Shell) => React.ReactNode }) {
  const [shell, setShell] = useState<Shell | 'loading' | 'anonymous'>('loading');
  const location = useLocation();
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session', { cache: 'no-store' }).then(async response => {
      if (cancelled) return;
      if (!response.ok) { setShell('anonymous'); return; }
      const data = await response.json();
      setShell({ session: { csrfToken: data.csrfToken, sessionKey: data.sessionKey, expiresAt: data.expiresAt }, user: data.user });
    }).catch(() => { if (!cancelled) setShell('anonymous'); });
    return () => { cancelled = true; };
  }, []);
  if (shell === 'loading') return null;
  if (shell === 'anonymous') return <LoginPage returnTo={location.pathname} />;
  return <SessionBoundary session={shell.session}>{children(shell)}</SessionBoundary>;
}
function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage returnTo="/" />} />
    <Route path="/kalender" element={<Protected>{shell => <CalendarPage user={shell.user} />}</Protected>} />
    <Route path="/" element={<Protected>{shell => <StartPage user={shell.user} />}</Protected>} />
    <Route path="*" element={<Protected>{shell => <StartPage user={shell.user} />}</Protected>} />
  </Routes>;
}
createRoot(document.getElementById('root')!).render(<StrictMode>
  <Providers>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </Providers>
</StrictMode>);
