import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Chip, ConversationResponse, Prepared, Thread, ThreadMessage, ViewRef } from '@clew/contracts';
import { ChatLayout, HStack, Link, StackItem, Text, VStack } from '@clew/ui';
import { areasQuery, threadsQuery } from '../queries';
import { declaredPage, viewPageHref } from '../view-address';
import { Composer } from './composer';
import { Transcript } from './conversation';
import {
  ConversationContext,
  INERT_CONVERSATION,
  type ConversationState,
  type ThingSubject,
} from './conversation-context';
import { askAboutHref, useAskAbout } from './thing-panel';
import { conversationOf, useTurns } from './turns';

/**
 * What the assistant beside a page is about (D130 rule 4): the thing or the list the page shows, as "Fråga assistenten"
 * asks about it (`ThingSubject`), with the words the pane says it in.
 */
export interface PageSubject extends ThingSubject {
  /** What the pane is about, in words a person reads ("Om mötet Morgonmöte ledningsgrupp"). */
  about: string;
  /** What the empty box says, and its name. */
  placeholder: string;
  /** Where the assistant cannot read what the page shows: the line that says so before anything is asked (D130 rule 4). */
  closed?: string | undefined;
}

/**
 * The person's newest conversation about a subject (D130 rule 6). The server keeps the subject a conversation was
 * started beside (`Thread.askedBeside`), so it is found again after a reload and on any device, whichever page of the
 * subject it was asked on. A conversation from before that was kept is found by its question instead: one asked with
 * the subject's chip, as the server keeps the chips on a question (`MessageMeta.chips`). A read of a range
 * (`capability:calendar.week`) is the same chip for every week: there the chip's label, the week or the day it was asked
 * about, tells them apart. Read from the conversations the browser already holds (the thread list, D33).
 */
export function conversationFor(
  threads: readonly Thread[],
  subject: Pick<ThingSubject, 'key' | 'chips'>,
): Thread | null {
  const newest = (match: (t: Thread) => boolean) => {
    let found: Thread | null = null;
    for (const t of threads)
      if (t.kind === 'question' && match(t) && (!found || t.updatedAt > found.updatedAt)) found = t;
    return found;
  };
  const beside = newest(t => t.askedBeside?.subject === subject.key);
  if (beside) return beside;
  const chip = subject.chips[0];
  if (!chip) return null;
  const asked = (m: ThreadMessage) =>
    m.role === 'user' &&
    !!m.meta?.chips?.some(c => c.ref === chip.ref && (chip.kind !== 'capability' || c.label === chip.label));
  return newest(t => t.messages.some(asked));
}

/**
 * A list's subject (D130 rule 4: the page's list), from its read's subject (`viewSubject`) and its title: what the pane
 * is about ("Om Beställningar och felanmälningar") and what its box asks ("Fråga om beställningar och felanmälningar").
 * Only the title's first letter is lowered, and not in a word written in capitals ("IT-ärenden"), so a name in it reads
 * as written ("Kompetenser för Anna Lindqvist").
 */
export function listSubject(read: ThingSubject, title: string): PageSubject {
  const named = /^\p{Lu}\p{Lu}/u.test(title) ? title : title.charAt(0).toLocaleLowerCase('sv-SE') + title.slice(1);
  return { ...read, label: named, about: `Om ${title}`, placeholder: `Fråga om ${named}` };
}

/** The conversation beside a page: what it is about, and the conversation's state as the pane's parts read it. */
export interface PageConversation {
  subject: PageSubject | null;
  /** The value of the conversation context inside the pane (`PageTalk`). */
  state: ConversationState;
}

const EMPTY: Thread[] = [];
const noop = () => undefined;

/**
 * The conversation about what a page shows (D130 rules 4 and 6), held by the page itself so it outlives the pane
 * becoming a drawer and back. It is the app's inert conversation (`INERT_CONVERSATION`) with turns of its own over it:
 * the drawer, `@`, another system's assistant, a new conversation and closing are the conversation's page's and stay
 * inert here, and nothing here navigates. Every question goes with the subject's chips, as what stands open
 * (`beside`), with the page's subject (`page`) and as Clew's own turn (`own`): it is never offered to another system's
 * assistant. The person's newest
 * conversation about the subject is shown and continued (`conversationFor`); with none, the first question makes one,
 * listed under Alla samtal like any other. Another subject stops a turn still running and lets go of the words in the
 * box. `onAnswer` hears each finished turn, so the page can make ready what the answer prepared (Kalender, D129).
 */
export function usePageConversation(
  subject: PageSubject | null,
  opts?: { onAnswer?(response: ConversationResponse): void },
): PageConversation {
  const threads = useQuery(threadsQuery).data?.threads ?? EMPTY;
  const key = subject?.key ?? null;
  const chip = subject?.chips[0];
  const found = useMemo(
    () => (key ? conversationFor(threads, { key, chips: chip ? [chip] : [] }) : null),
    // The key and the chip's fields, not the object: a page builds its subject anew on every render.
    [threads, key, chip?.ref, chip?.kind, chip?.label],
  );
  const turns = useTurns(noop);
  const { reset, send, abortTurn, input } = turns;
  // Another subject: what was asked about the one before is let go of before the pane is painted again.
  const heldFor = useRef(key);
  useLayoutEffect(() => {
    if (heldFor.current === key) return;
    heldFor.current = key;
    reset();
  }, [key, reset]);
  const foundConversation = useMemo(() => (found ? conversationOf(found) : null), [found]);
  // The conversation the last answer here came back with, until the thread list has caught up with it; the list's own
  // when it has more (the conversation went on on its page).
  const mine = turns.conversation;
  const conversation =
    mine && !(found?.id === mine.id && found.messages.length > mine.messages.length) ? mine : foundConversation;
  const about = useRef(subject);
  about.current = subject;
  const continued = useRef(conversation);
  continued.current = conversation;
  const answered = useRef(opts?.onAnswer);
  answered.current = opts?.onAnswer;
  const submit = useCallback(
    async (raw: string) => {
      const thing = about.current;
      const text = raw.replace(/\s+/g, ' ').trim();
      if (!thing || !text) return;
      const chips = thing.chips.map(c => ({ ref: c.ref, kind: c.kind, label: c.label }) as Chip);
      await send({
        raw,
        text,
        chips,
        ...(chips[0] ? { beside: chips[0].ref } : {}),
        // What the page shows, by its key and in its words: a conversation this question starts is kept as asked
        // beside it (D130 rule 6), so it is found again on any device and stays out of the rail until opened.
        page: { subject: thing.key, label: thing.about.slice(0, 200) },
        current: continued.current,
        own: true,
        onAnswered: response => answered.current?.(response),
        // The box keeps the focus it has; it takes it back only from nowhere (Stoppa gone), never from a form or a
        // dialog the answer opened on the page (D129: "Flytta …", "Ställ in mötet?").
        refocus: () => !document.activeElement || document.activeElement === document.body,
      });
    },
    [send],
  );
  const ask = useCallback((text: string) => void submit(text), [submit]);
  const stop = useCallback(() => abortTurn('stop'), [abortTurn]);
  // The box is drawn in the same commit as what asked for it ("Fråga om veckan"): it takes the focus in the next frame.
  const focus = useCallback(() => {
    requestAnimationFrame(() => input.current?.focus());
  }, [input]);
  const { latest, pending, done, busy, error, value, setValue, performActions, cancelActions, makeCard } = turns;
  const state = useMemo<ConversationState>(
    () => ({
      ...INERT_CONVERSATION,
      conversation,
      latest,
      pending,
      done,
      busy,
      error,
      value,
      setValue,
      input,
      hasBox: false,
      submit,
      ask,
      stop,
      focus,
      performActions,
      cancelActions,
      makeCard,
    }),
    [
      conversation,
      latest,
      pending,
      done,
      busy,
      error,
      value,
      setValue,
      input,
      submit,
      ask,
      stop,
      focus,
      performActions,
      cancelActions,
      makeCard,
    ],
  );
  return useMemo(() => ({ subject, state }), [subject, state]);
}

/**
 * "Öppna som samtal" (D130 rules 6 and 10): where the conversation beside a page continues at full size, its page with
 * the subject beside it where a thing can stand there (`subject.search`); before anything is asked, a new conversation
 * about the subject. Null while an answer is on its way, since leaving the page would stop it.
 */
export function useOpenAsConversation(
  talk: PageConversation,
): { href: string; onClick?: (e: { preventDefault(): void }) => void } | null {
  // Read outside the pane's provider: a new conversation is the app's conversation, with the subject in its drawer.
  const askAbout = useAskAbout();
  const { subject, state } = talk;
  if (!subject || state.pending) return null;
  if (state.conversation) return { href: `/conversations/${state.conversation.id}${subject.search}` };
  return {
    href: askAboutHref(subject),
    onClick: e => {
      e.preventDefault();
      askAbout(subject);
    },
  };
}

/**
 * The conversation beside a page (D130, "One component"; canvas boards AskArende-empty and AskArende-more): the same
 * transcript and box as the conversation's page, in Astryx's `ChatLayout` with the box docked under the conversation,
 * read from a second provider of the one conversation context that wraps only what is drawn here, so the page's own
 * cards keep reading the app's conversation. Before anything is asked it says in plain words what asking here does and
 * what opening it as a conversation adds (rule 10). "Öppna som samtal" (`useOpenAsConversation`) stands once at the head
 * of the region, unless the host draws it in a header of its own (`headed`: the page frame's pane, whose header also
 * says what the pane is about and where the assistant cannot read). `prepared` draws what the page puts under an answer
 * that prepared one of its decisions (Kalender's "Använd tiden", D129). The region fills what its parent leaves it.
 */
export function PageTalk({
  talk,
  prepared,
  headed = false,
}: {
  talk: PageConversation;
  prepared?: ((prepared: Prepared) => ReactNode) | undefined;
  /** The host's header says what the pane is about and leads to the conversation: neither is drawn here a second time. */
  headed?: boolean;
}) {
  const { subject, state } = talk;
  const open = useOpenAsConversation(talk);
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const views = useQuery(areasQuery).data?.views;
  if (!subject) return null;
  const { conversation, pending } = state;
  const whole = conversation ? `/conversations/${conversation.id}${subject.search}` : null;
  // A view an answer names is a link to its own page, with this page as the way back (D126 rule 1, D130 rule 7).
  const viewHref = (v: ViewRef) => declaredPage(views, v.capability, v.input) ?? viewPageHref(v, pathname + search);
  const opener =
    open && !headed ? (
      <Link href={open.href} type="supporting" color="secondary" {...(open.onClick ? { onClick: open.onClick } : {})}>
        Öppna som samtal
      </Link>
    ) : null;
  const intro = (
    <VStack gap={3}>
      <Text weight="semibold">{`Fråga om ${subject.label}`}</Text>
      {subject.closed && !headed && <Text type="supporting">{subject.closed}</Text>}
      <Text as="p">Svaret visas här, bredvid sidan, och finns kvar när du kommer tillbaka.</Text>
      <Text as="p" type="supporting" color="secondary">
        Öppnar du frågan som ett samtal får den hela sidan. Där kan du ta med flera ärenden, se tabeller och dokument
        och resonera längre. Samtalet finns sedan under Alla samtal.
      </Text>
    </VStack>
  );
  return (
    <ConversationContext.Provider value={state}>
      <VStack gap={2} height="100%">
        {opener && <HStack hAlign="end">{opener}</HStack>}
        <StackItem size="fill">
          <VStack height="100%">
            <ChatLayout composer={<Composer place="pane" placeholder={subject.placeholder} />}>
              {conversation || pending ? (
                <Transcript
                  room="pane"
                  about={subject.chips}
                  renderCard={() => null}
                  onOpenView={v => navigate(viewHref(v))}
                  viewHref={viewHref}
                  prepared={prepared}
                  conversationHref={whole ?? undefined}
                />
              ) : (
                intro
              )}
            </ChatLayout>
          </VStack>
        </StackItem>
      </VStack>
    </ConversationContext.Provider>
  );
}
