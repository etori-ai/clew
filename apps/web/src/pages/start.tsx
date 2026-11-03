import { useCallback, useEffect, useState } from 'react';
import type { Attention, CalendarEvent, Figure, SessionUser, Thread, TodayView } from '@clew/contracts';
import { Badge, BottomSheet, Button, Heading, Text, signOut, useMediaQuery } from '@clew/ui';
import { api, ApiError } from '../api';
import { QuestionBox } from '../components/question';
import { Lage } from '../components/lage';
import { Today } from '../components/today';
import { ThreadCard } from '../components/thread';

/**
 * The chat-first start page. No navigation, no tabs, no blocks: the question box, "Läget", "I dag" and the threads.
 * Desktop: the answer unfolds under the box. Phone: a bottom sheet for asking, the thread on the page afterwards.
 */
export function StartPage({ user }: { user: SessionUser }) {
  const mobile = useMediaQuery('(max-width: 720px)');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [figures, setFigures] = useState<Figure[]>([]);
  const [today, setToday] = useState<TodayView | null>(null);
  const [attention, setAttention] = useState<Attention | null>(null);
  const [completions, setCompletions] = useState<string[]>([]);
  const [weeks, setWeeks] = useState<Record<string, CalendarEvent[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [sheet, setSheet] = useState(false);
  const load = useCallback(async () => {
    try {
      const [t, f, d, a, c] = await Promise.all([api.threads(), api.figures(), api.today(), api.attention(), api.completions()]);
      setThreads(t.threads); setFigures(f.figures); setToday(d); setAttention(a); setCompletions(c.completions); setError(null);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Sidan kunde inte läsas.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const loadWeek = useCallback((week: string) => {
    setWeeks(current => { if (current[week]) return current; void api.calendar(week).then(data => setWeeks(w => ({ ...w, [week]: data.events }))).catch(() => undefined); return current; });
  }, []);
  const replace = (thread: Thread) => { setThreads(list => list.some(t => t.id === thread.id) ? list.map(t => t.id === thread.id ? thread : t) : [thread, ...list]); void api.figures().then(f => setFigures(f.figures)).catch(() => undefined); };
  const ask = async (question: string) => {
    setAsking(true);
    try { replace(await api.ask(question)); setSheet(false); } catch (e) { setError(e instanceof ApiError ? e.message : 'Frågan kunde inte ställas.'); } finally { setAsking(false); }
  };
  const open = threads.filter(t => t.state === 'open'), handled = threads.filter(t => t.state !== 'open');
  return <main className="page">
    <header className="page-header">
      <div><Heading level={1}>Startsidan</Heading><Text type="supporting">{user.name} · {user.unitLabel}</Text></div>
      <div className="page-header-meta">
        {attention && <Badge variant={attention.used >= attention.budget ? 'warning' : 'neutral'} label={`${attention.used} av ${attention.budget} avbrott i dag${attention.bundledUntil ? ` · resten ${attention.bundledUntil}` : ''}`} />}
        <Button variant="ghost" size="sm" label="Kalender" href="/kalender" />
        <Button variant="ghost" size="sm" label="Logga ut" clickAction={() => signOut()} />
      </div>
    </header>
    {mobile
      ? <>
        <Button variant="primary" width="100%" size="lg" label="Fråga assistenten" onClick={() => setSheet(true)} />
        <BottomSheet isOpen={sheet} onOpenChange={setSheet} label="Fråga assistenten" height="tall" purpose="form">
          <QuestionBox completions={completions} onAsk={ask} busy={asking} />
        </BottomSheet>
      </>
      : <QuestionBox completions={completions} onAsk={ask} busy={asking} />}
    {error && <Text as="p" role="alert" color="accent">{error}</Text>}
    {figures.length > 0 && <Lage figures={figures} />}
    {today && <Today view={today} mobile={mobile} />}
    <section className="threads" aria-label="Behöver dig">
      {open.length === 0 && <Text as="p" type="supporting">Inget behöver dig just nu. Nästa genomgång i morgon 06:00.</Text>}
      {open.map(t => <ThreadCard key={t.id} thread={t} events={t.week ? weeks[t.week] : undefined} mobile={mobile} onChange={replace} onLoadWeek={loadWeek} />)}
    </section>
    {handled.length > 0 && <section className="threads" aria-labelledby="handled-heading">
      <Heading level={2} id="handled-heading">Redan hanterat</Heading>
      {handled.map(t => <ThreadCard key={t.id} thread={t} events={t.week ? weeks[t.week] : undefined} mobile={mobile} onChange={replace} onLoadWeek={loadWeek} />)}
    </section>}
  </main>;
}
