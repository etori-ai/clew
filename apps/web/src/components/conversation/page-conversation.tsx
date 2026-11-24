import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  OPEN_THING_INPUT_MAX,
  type Chip,
  type ConversationResponse,
  type EntityDetail,
  type EntitySource,
  type OpenThing,
  type Prepared,
  type Thread,
  type ThreadMessage,
  type ViewEntry,
  type ViewRef,
} from '@clew/contracts';
import {
  Card,
  ChatLayout,
  EyeIcon,
  Heading,
  HStack,
  Icon,
  Link,
  List,
  ListItem,
  LockClosedIcon,
  PencilSquareIcon,
  StackItem,
  Text,
  VStack,
} from '@clew/ui';
import { areasQuery, assistantReachQuery, threadsQuery } from '../../queries';
import { declaredPage, viewPageHref } from '../../view-address';
import { entitySubject, type EntitySubjectKind } from '../../conversation-about';
import { Composer } from './composer';
import { Transcript } from './conversation';
import {
  ConversationContext,
  INERT_CONVERSATION,
  type ChipRef,
  type ConversationState,
  type ThingSubject,
} from './conversation-context';
import { askAboutHref, useAskAbout } from './thing-panel';
import { conversationOf, useTurns, type Send } from './turns';
import { itemSubject } from '../views/view-read';

/**
 * What the assistant beside a page is about (D141 rule 4): the thing or the list the page shows, as "Fråga assistenten"
 * asks about it (`ThingSubject`), with the words the pane says it in.
 */
export interface PageSubject extends ThingSubject {
  /** What the pane is about, in words a person reads ("Om mötet Morgonmöte ledningsgrupp"). */
  about: string;
  /**
   * What the box asks about ("Fråga om ärendet"). Under a picked thing (Att göra's item, Kalender's entry) it is what
   * the empty box says and its name; in the frame's pane, whose header already names the page, the empty box says the
   * same words on every page (`PANE_PLACEHOLDER`) and these words are in its name (`paneBoxName`).
   */
  placeholder: string;
  /**
   * What the pane says under its heading that the list of what the assistant cannot read (`cannotRead`) does not
   * (D141 rule 4, D136 item 4): why a page is never read (the competence search), that the assistant is not told who a
   * person is, or that not all of the page can be read where a closed read has no name to be listed by.
   */
  closed?: string | undefined;
  /**
   * What the page shows that the assistant cannot read, by name (D138 item 7): the systems whose reads are closed to it
   * and Clew's own closed reads by their labels, as written. The pane lists them before anything is asked.
   */
  cannotRead?: readonly string[] | undefined;
  /**
   * The thing that stands open on the page (D136 item 1): a person, a unit or a record, sent with every question so the
   * server can resolve it as the asker. A work item and a calendar entry have none: they go as their chip (`beside`).
   */
  thing?: OpenThing | undefined;
}

/**
 * The person's newest conversation about a subject (D141 rule 6). The server keeps the subject a conversation was
 * started beside (`Thread.askedBeside`), so it is found again after a reload and on any device, whichever page of the
 * subject it was asked on. A conversation from before that was kept is found by its question instead: one asked with
 * the subject's chip, as the server keeps the chips on a question (`MessageMeta.chips`). A read of a range
 * (`capability:calendar.week`) is the same chip for every week: there the chip's label, the week or the day it was asked
 * about, tells them apart. A record is found by its key alone (D136 item 1): its chip names its read, which every
 * record of the read shares, so a conversation found by the chip could be about another record. Read from the
 * conversations the browser already holds (the thread list, D33).
 */
export function conversationFor(
  threads: readonly Thread[],
  subject: Pick<PageSubject, 'key' | 'chips'> & { thing?: Pick<OpenThing, 'kind'> | undefined },
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
  if (!chip || subject.thing?.kind === 'record') return null;
  const asked = (m: ThreadMessage) =>
    m.role === 'user' &&
    !!m.meta?.chips?.some(c => c.ref === chip.ref && (chip.kind !== 'capability' || c.label === chip.label));
  return newest(t => t.messages.some(asked));
}

/**
 * A list's subject (D141 rule 4: the page's list), from its read's subject (`viewSubject`) and its title: what the pane
 * is about ("Om Beställningar och felanmälningar") and what its box asks ("Fråga om beställningar och felanmälningar").
 * Only the title's first letter is lowered, and not in a word written in capitals ("IT-ärenden"), so a name in it reads
 * as written ("Kompetenser för Anna Lindqvist").
 */
export function listSubject(read: ThingSubject, title: string): PageSubject {
  const named = lowered(title);
  return { ...read, label: named, about: `Om ${title}`, placeholder: `Fråga om ${named}` };
}
/** A title as words in a sentence: its first letter lowered, unless the word is written in capitals ("IT-ärenden"). */
const lowered = (title: string) =>
  /^\p{Lu}\p{Lu}/u.test(title) ? title : title.charAt(0).toLocaleLowerCase('sv-SE') + title.slice(1);

/** One read a page shows (D141 rule 4), as `pageSubject` is given it. */
export interface PageRead {
  /**
   * The read the assistant would make to read what the page shows: a list's own read, or the overview that answers a
   * lens's rows without keys (D127). Null where there is none it could make (a lens of another system with no overview).
   */
  capability: string | null;
  /** The system the read is from, by its Swedish name (`EntitySource.source`); absent for Clew's own domain. */
  source?: string | undefined;
  /** Clew's own domain (`EntitySource.own`): never named by a system in the line that says what is closed. */
  own?: boolean | undefined;
  /** The chip's words; the read's own title (`ViewEntry.title`) when absent. */
  label?: string | undefined;
  /**
   * The source's own read about a person or a unit (`EntitySource.capability`), which takes keys and is never a tool.
   * Where the assistant has no overview of it but may make another read of the same system (a capability is named
   * `<connector>.<verb>`), the page does not say the system is closed: the assistant can read from it, with a tool the
   * model picks itself (`competence.coverage` for a unit's competence, which takes the unit and so is no overview).
   */
  about?: string | undefined;
}
/**
 * What a source about a person or a unit shows, as the reads the assistant could make for it (D141 rule 4): a source's
 * own read takes keys and is never a tool, so the assistant reads its rows through the overviews of the same connector
 * that answer them without keys (`EntitySource.overviews`, D127). A source with none is a read it cannot make, named by
 * its system, or by its title for Clew's own.
 */
export function sourceReads(source: {
  capability: string;
  source: string;
  title: string;
  own?: true | undefined;
  overviews?: readonly string[] | undefined;
}): PageRead[] {
  const of = { source: source.source, own: !!source.own, label: source.title, about: source.capability };
  return source.overviews?.length
    ? source.overviews.map(capability => ({ capability, ...of }))
    : [{ capability: null, ...of }];
}
/** The prefix of the reads Clew joins across systems (`clew.errands`, `clew.news`): a profile, not a system. */
const JOINED = 'clew.';
/** Where the assistant may make no read on a page at all, said once (D122 item 5: the competence search). */
export type NeverRead = 'search';
/** Said under the pane's heading wherever nothing on the page can be read: the pane still answers. */
const STILL = 'Du kan ändå fråga om annat som du har tillgång till.';
const NEVER: Record<NeverRead, string> = {
  search: 'Assistenten läser aldrig din sökning eller det den hittar: sökningen görs bara av dig, här på sidan.',
};

/**
 * A page's subject (D141 rules 1 and 4), from its key, its title, the reads it shows and the person's reads (`views`
 * of `/api/areas`): a read the assistant may make for the person (`ViewEntry.assistant`) goes with every question as a
 * capability chip, so the server can tell the model which tool reads the open list; any other read, one the person may
 * not call (absent from `views`) among them, is closed, and the pane lists it before anything is asked (`cannotRead`,
 * D138 item 7). A source about a person or a unit with no overview the assistant may make is closed only when the
 * assistant may make no read of that system at all (`PageRead.about`). A closed read of another system is listed by its
 * system ("Qlik"), one of Clew's own by its name as written. Where a closed read of Clew's own has no name to be listed
 * by, the line under the pane's heading says that not all of the page can be read (`closed`), or, where nothing on it
 * can, that and that the assistant still answers about the rest (`STILL`). `never` is a page whose content is never the
 * assistant's to read, with the reason in words. The words of the pane are `listSubject`'s, from the title, or `named`
 * where the box asks about something other than the title says ("Fråga om ärendena" on Att göra). Null until the
 * person's reads are known.
 */
export function pageSubject(page: {
  key: string;
  title: string;
  reads: readonly PageRead[];
  views: readonly Pick<ViewEntry, 'capability' | 'title' | 'assistant'>[] | undefined;
  /** The conversation's page's address part (`ThingSubject.search`): a lens beside the conversation (`?lens=`). */
  search?: string | undefined;
  /** What the box asks about, where it is not the title in lower case. */
  named?: string | undefined;
  never?: NeverRead | undefined;
}): PageSubject | null {
  const { key, title, reads, views, search = '', named, never } = page;
  if (!views) return null;
  const offered = (capability: string | null) =>
    capability ? views.find(v => v.capability === capability && v.assistant === true) : undefined;
  // Another read of the same system that the assistant may make: the system is then not closed to it. Clew's joined
  // reads (`clew.<profile>`) are no one system, so one of them says nothing about another.
  const reaches = (about: string | undefined) => {
    const system = about?.includes('.') ? about.slice(0, about.indexOf('.') + 1) : null;
    return !!system && system !== JOINED && views.some(v => v.assistant === true && v.capability.startsWith(system));
  };
  const chips: ChipRef[] = [];
  const closed: PageRead[] = [];
  for (const read of never ? [] : reads) {
    const view = offered(read.capability);
    if (!view) {
      if (!reaches(read.about)) closed.push(read);
    } else if (!chips.some(c => c.ref === `capability:${view.capability}`))
      chips.push({ ref: `capability:${view.capability}`, kind: 'capability', label: read.label ?? view.title });
  }
  const subject = listSubject({ key, label: title, chips, search }, title);
  const words = named ?? subject.label;
  const unique = (names: (string | undefined)[]) => [...new Set(names.filter((n): n is string => !!n))];
  const systems = unique(closed.filter(r => !r.own && r.source).map(r => r.source));
  const own = closed
    .filter(r => r.own || !r.source)
    .map(r => r.label ?? views.find(v => v.capability === r.capability)?.title);
  // What is closed, by name: Clew's own by their labels as written, then the other systems.
  const cannotRead = unique([...own, ...systems]);
  // Nothing the page shows can be read; a page that shows no read (an empty register) has nothing to say about it.
  const nothing = chips.length === 0 && closed.length > 0;
  let line: string | undefined;
  if (never) line = `${NEVER[never]} ${STILL}`;
  // A read of Clew's own with no name to be listed by: the line says that not all of the page can be read.
  else if (!own.every(Boolean))
    line = nothing
      ? `Assistenten kan inte läsa det som visas här. ${STILL}`
      : 'Assistenten kan inte läsa allt som visas här.';
  return {
    ...subject,
    label: words,
    placeholder: `Fråga om ${words}`,
    ...(line ? { closed: line } : {}),
    ...(cannotRead.length ? { cannotRead } : {}),
  };
}

/**
 * What the pane says it can do here before anything is asked (D138 item 7), every line from what the assistant is
 * allowed: the reads it may make on the page (the subject's chips, which go with every question: a read with
 * `ViewEntry.assistant`, or the work item the page shows), by their words; the actions of what stands open it may fill
 * in, as the server says them (`prepares`; none while the server has not answered); and what the page shows that it
 * cannot read (`cannotRead`). An empty list is not drawn.
 *
 * `readsPage` (D138 item 7 as amended 2026-11-21): the one read is the page the pane's header already names ("Om
 * Avvikelser och tillbud" over the read "Avvikelser och tillbud") and nothing the page shows is closed, so a list of
 * it would say the page's name once more. The pane then says in one sentence that the assistant reads what the page
 * shows, which is exactly what the chip allows. With several reads, with a read under another name than the page's, or
 * with anything closed, the reads are listed by name: there the names say what the sentence could not.
 */
export interface PaneReach {
  reads: string[];
  readsPage: boolean;
  prepares: string[];
  cannotRead: string[];
}
export function paneReach(
  subject: Pick<PageSubject, 'chips' | 'cannotRead'> & Partial<Pick<PageSubject, 'about' | 'closed'>>,
  prepares?: readonly { title: string }[] | undefined,
): PaneReach {
  const unique = (names: readonly string[]) => [...new Set(names.filter(Boolean))];
  const reads = unique(subject.chips.map(c => c.label));
  const cannotRead = unique(subject.cannotRead ?? []);
  const folded = (words: string) => words.toLocaleLowerCase('sv-SE');
  const [only] = reads;
  const readsPage =
    reads.length === 1 &&
    cannotRead.length === 0 &&
    !subject.closed &&
    !!subject.about &&
    folded(subject.about).includes(folded(only!));
  return { reads, readsPage, prepares: unique((prepares ?? []).map(p => p.title)), cannotRead };
}

/** What the empty box of the frame's pane says, the same on every page (the product owner, 2026-11-21). */
export const PANE_PLACEHOLDER = 'Skriv din fråga';
/**
 * The name of the frame's pane's box: the words a person sees in it with what the page's box asks about ("Skriv din
 * fråga om ärendet", from "Fråga om ärendet"), so the name stays the page's own and holds the visible words (2.5.3).
 */
export const paneBoxName = (asks: string) =>
  asks.startsWith('Fråga ') ? `Skriv din ${lowered(asks)}` : `${PANE_PLACEHOLDER}: ${asks}`;

/** The longest subject a conversation keeps (`AskedBeside.subject`). */
export const SUBJECT_MAX = 1200;
/**
 * A value as JSON with every object's keys in order, so one input is one text however its address wrote it: the same
 * record is the same subject whether its input said `{ "a", "b" }` or `{ "b", "a" }`. Arrays keep their order.
 */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(v => (v === undefined ? 'null' : stableJson(v))).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
/** A 64-bit digest of a text, as 16 hex digits: the same text gives the same digest in every browser. */
function digest(text: string): string {
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
/**
 * A record's subject (D136 item 1): its read and the input that draws it, so two records of one read are two
 * conversations (`view:supplier.card:{"id":"42"}`). A list is its read alone (`view:<capability>`, `viewSubject`). An
 * input too long for the subject to keep (`SUBJECT_MAX`) is kept as its digest instead (`view:<capability>#<16 hex>`):
 * the same input still finds the same conversation.
 */
export function recordKey(capability: string, input: Record<string, unknown>): string {
  const json = stableJson(input);
  const key = `view:${capability}:${json}`;
  return key.length <= SUBJECT_MAX ? key : `view:${capability}#${digest(json)}`;
}
/**
 * A record as the thing that stands open (D136 item 1): its read and its input. None where the input is longer than the
 * server takes (`OPEN_THING_INPUT_MAX`): the record is then told as nothing, as one the server cannot resolve.
 */
export function recordThing(capability: string, input: Record<string, unknown>): OpenThing | undefined {
  return stableJson(input).length <= OPEN_THING_INPUT_MAX ? { kind: 'record', capability, input } : undefined;
}

/**
 * A work item's page and its review (D136 item 1, board AskArende): about the item, by the key "Fråga assistenten" has
 * always asked it under (`thread:<id>`), so a conversation asked about it before is found again; its chip stands open
 * (`beside`) and the item stands beside the conversation it opens as (`?card=`). No `thing`: the chip is how a work item
 * is told.
 */
export function itemPageSubject(thread: { id: string; title: string }): PageSubject {
  return { ...itemSubject(thread), about: `Om ärendet ${thread.title}`, placeholder: 'Fråga om ärendet' };
}

/**
 * A record's page (D136 items 1 and 6): one conversation per record (`recordKey`), the record as the thing that stands
 * open, and the read's chip only where the assistant may make the read for the person (`pageSubject`, whose line says
 * so where it may not). The pane says it by the record's own name, as written (a supplier, a person's name); the record
 * stands beside the conversation it opens as (`search`, `?open=`).
 */
export function recordSubject(page: {
  capability: string;
  input: Record<string, unknown>;
  /** The record's own name, the page's title. */
  name: string;
  /** The read's title, its chip's words; the read's own (`ViewEntry.title`) when absent. */
  title?: string | undefined;
  /** The system the read is from, by its Swedish name; absent for Clew's own domain. */
  source?: string | undefined;
  /** The name is Clew's own words (a plan's "Introduktion för …"): lowered in a sentence, as a list's title is. */
  common?: boolean | undefined;
  views: readonly Pick<ViewEntry, 'capability' | 'title' | 'assistant'>[] | undefined;
  /** The conversation's page's address part: the record beside it (`?open=`), or nothing for a read whose rows are a page. */
  search: string;
}): PageSubject | null {
  const { capability, input, name, title, source, common = false, views, search } = page;
  const subject = pageSubject({
    key: recordKey(capability, input),
    title: name,
    ...(common ? {} : { named: name }),
    reads: [{ capability, ...(title ? { label: title } : {}), ...(source ? { source } : {}) }],
    views,
    search,
  });
  const thing = recordThing(capability, input);
  return subject && { ...subject, ...(thing ? { thing } : {}) };
}

/**
 * Said under the pane's heading on the page of a person the reader neither is nor manages (D136 item 4): the server
 * names nobody to the model there, and the reader is told so before anything is asked.
 */
export const UNNAMED_PERSON = 'Assistenten får inte veta vem sidan gäller, eftersom du inte är chef för personen.';

/**
 * A person's or a unit's page (D136 items 1 to 5 and 7): one subject for every tab (`person:<id>`, `unit:<id>`, as
 * "Fråga assistenten" asked about them), the person or the unit by Clew's id as the thing that stands open, and no chip:
 * what a source says about them is never the assistant's (D97 item 7), so the pane names a section's system it cannot
 * read otherwise by the rule of D141's stage 2 (`sourceReads`). On the page of a person the reader neither is nor
 * manages (`relation` `colleague`) the pane also says that the assistant is not told who it is (`UNNAMED_PERSON`); the
 * thing still goes, and the server decides. They stand beside the conversation the pane opens as (`?person=`, `?unit=`,
 * with the tab the pane shows first).
 */
export function entityPageSubject(page: {
  kind: EntitySubjectKind;
  /** Clew's id: the person's or the unit's, as their page's address names them. */
  id: string;
  name: string;
  relation: EntityDetail['relation'];
  sections: readonly EntitySource[];
  views: readonly Pick<ViewEntry, 'capability' | 'title' | 'assistant'>[] | undefined;
  /** The tab the pane beside the conversation shows first, where it has it. */
  tab?: string | null | undefined;
}): PageSubject | null {
  const { kind, id, name, relation, sections, views, tab } = page;
  const ask = entitySubject(kind, id, tab);
  const subject = pageSubject({
    key: ask.key,
    title: name,
    named: name,
    reads: sections.flatMap(sourceReads),
    views,
    search: ask.search,
  });
  if (!subject) return null;
  const unnamed = kind === 'person' && relation === 'colleague' ? UNNAMED_PERSON : undefined;
  const closed = [unnamed, subject.closed].filter(Boolean).join(' ');
  const { closed: _read, ...rest } = subject;
  return { ...rest, chips: [], thing: { kind, id }, ...(closed ? { closed } : {}) };
}

/**
 * What goes with every question asked in the pane beside a page: the subject's chips, the first of them as what stands
 * open (`beside`); the page's subject by its key and in its words (`page`), so a conversation the question starts is
 * kept as asked beside it (D141 rule 6), found again on any device and left out of the rail until opened; and the thing
 * that stands open, where the page has one (`thing`, D136 item 1), which the server resolves as the asker on every turn.
 */
export function pageTurn(subject: PageSubject): Pick<Send, 'chips' | 'beside' | 'page' | 'thing'> {
  const chips = subject.chips.map(c => ({ ref: c.ref, kind: c.kind, label: c.label }) as Chip);
  return {
    chips,
    ...(chips[0] ? { beside: chips[0].ref } : {}),
    page: { subject: subject.key, label: subject.about.slice(0, 200) },
    ...(subject.thing ? { thing: subject.thing } : {}),
  };
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
 * The conversation about what a page shows (D141 rules 4 and 6), held by the page itself so it outlives the pane
 * becoming a drawer and back. It is the app's inert conversation (`INERT_CONVERSATION`) with turns of its own over it:
 * the drawer, `@`, another system's assistant, a new conversation and closing are the conversation's page's and stay
 * inert here, and nothing here navigates. Every question goes with the subject's chips, as what stands open
 * (`beside`), with the page's subject (`page`), with the thing that stands open where there is one (`thing`, D136 item
 * 1) and as Clew's own turn (`own`): it is never offered to another system's assistant. The person's newest
 * conversation about the subject is shown and continued (`conversationFor`); with none, the first question makes one,
 * listed under Alla samtal like any other. Another subject stops a turn still running and lets go of the words in the
 * box. `onAnswer` hears each finished turn, so the page can make ready what the answer prepared (Kalender, D140).
 */
export function usePageConversation(
  subject: PageSubject | null,
  opts?: { onAnswer?(response: ConversationResponse): void },
): PageConversation {
  const threads = useQuery(threadsQuery).data?.threads ?? EMPTY;
  const key = subject?.key ?? null;
  const chip = subject?.chips[0];
  const kind = subject?.thing?.kind;
  const found = useMemo(
    () =>
      key ? conversationFor(threads, { key, chips: chip ? [chip] : [], ...(kind ? { thing: { kind } } : {}) }) : null,
    // The key and the chip's fields, not the object: a page builds its subject anew on every render.
    [threads, key, chip?.ref, chip?.kind, chip?.label, kind],
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
      const subject = about.current;
      const text = raw.replace(/\s+/g, ' ').trim();
      if (!subject || !text) return;
      await send({
        raw,
        text,
        ...pageTurn(subject),
        current: continued.current,
        own: true,
        onAnswered: response => answered.current?.(response),
        // The box keeps the focus it has; it takes it back only from nowhere (Stoppa gone), never from a form or a
        // dialog the answer opened on the page (D140: "Flytta …", "Ställ in mötet?").
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
 * "Öppna som samtal" (D141 rules 6 and 10): where the conversation beside a page continues at full size, its page with
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

/** One of the pane's lists of what it can do here (D138 item 7), under its eyebrow, each row with its mark. */
function ReachList({ title, mark, rows }: { title: string; mark: typeof EyeIcon; rows: readonly string[] }) {
  return (
    <VStack gap={1}>
      <Text type="eyebrow">{title}</Text>
      <List density="compact" aria-label={title}>
        {rows.map(row => (
          <ListItem key={row} startContent={<Icon icon={mark} size="sm" color="secondary" />} label={row} />
        ))}
      </List>
    </VStack>
  );
}

/**
 * What the pane says before anything is asked (D138 item 7 as amended 2026-11-21, D141 rule 10), in one box under the
 * header, which alone names the page ("Om …"): what the assistant may do here, every line built from what it is allowed
 * and none of them free text or a suggested question. The reads it may make on the page: one sentence where the one
 * read is the page itself (`PaneReach.readsPage`), a named list where the names say more; the actions of what stands
 * open it may fill in, with the person always sending them; and what it cannot read. A list with nothing in it is not
 * drawn. Last, in one line, where the answer stays and what opening the question as a conversation adds. The box is
 * Astryx's muted card with a heading of its own under the pane's "Fråga AI", so the introduction is one stop in the
 * outline and the three lists keep their names.
 */
function Explains({ reach }: { reach: PaneReach }) {
  return (
    <Card variant="muted" padding={4}>
      <VStack gap={4}>
        <Heading level={4} accessibilityLevel={3}>
          Innan du frågar
        </Heading>
        {reach.readsPage ? (
          <HStack gap={2} vAlign="start" wrap="nowrap">
            <Icon icon={EyeIcon} size="sm" color="secondary" />
            <StackItem size="fill">
              <Text as="p">Jag kan läsa det som sidan visar.</Text>
            </StackItem>
          </HStack>
        ) : (
          reach.reads.length > 0 && <ReachList title="Det här kan jag läsa här" mark={EyeIcon} rows={reach.reads} />
        )}
        {reach.prepares.length > 0 && (
          <VStack gap={1}>
            <ReachList title="Det här kan jag fylla i åt dig" mark={PencilSquareIcon} rows={reach.prepares} />
            <Text as="p" type="supporting" color="secondary">
              Du granskar och skickar alltid själv.
            </Text>
          </VStack>
        )}
        {reach.cannotRead.length > 0 && (
          <ReachList title="Det här kan jag inte läsa" mark={LockClosedIcon} rows={reach.cannotRead} />
        )}
        <Text as="p" type="supporting" color="secondary">
          Svaret visas här bredvid sidan och finns kvar när du kommer tillbaka. Öppna som samtal ger frågan hela sidan,
          och samtalet finns sedan under Samtal.
        </Text>
      </VStack>
    </Card>
  );
}

/**
 * The conversation beside a page (D141, "One component"; canvas boards AskArende-empty and AskArende-more): the same
 * transcript and box as the conversation's page, in Astryx's `ChatLayout` with the box docked under the conversation,
 * read from a second provider of the one conversation context that wraps only what is drawn here, so the page's own
 * cards keep reading the app's conversation. `headed` is the page frame's pane, whose header says what the pane is about
 * and leads to the conversation: before anything is asked it says what the assistant can do here (`Explains`, D138 item
 * 7), with what it may fill in for what stands open as the server answers it (`assistantReachQuery`, the turn's own
 * rules). In a page's own pane under a picked thing (Att göra's item, Kalender's entry) there is nothing before the box:
 * the part is as low as the box until something is asked, and "Öppna som samtal" (`useOpenAsConversation`) stands at
 * the head of the region once there is a conversation to open. The box keeps its place in the tree from the first state
 * to the conversation, so the focus and the words in it stay. `prepared` draws what the page puts under an answer that
 * prepared one of its decisions (Kalender's "Använd tiden", D140). The region fills what its parent leaves it.
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
  const { conversation, pending } = state;
  const asked = !!(conversation || pending);
  // What the assistant may fill in for what stands open, asked only while the pane says it (`Explains`).
  const standing = subject ? pageTurn(subject) : null;
  const reachInput = {
    ...(standing?.beside ? { beside: standing.beside } : {}),
    ...(standing?.thing ? { thing: standing.thing } : {}),
  };
  const fills = useQuery({
    ...assistantReachQuery(reachInput, standing?.thing ? stableJson(standing.thing) : null),
    enabled: !!subject && headed && !asked && (!!reachInput.beside || !!reachInput.thing),
  }).data;
  if (!subject) return null;
  const whole = conversation ? `/conversations/${conversation.id}${subject.search}` : null;
  // A view an answer names is a link to its own page, with this page as the way back (D126 rule 1, D141 rule 7).
  const viewHref = (v: ViewRef) => declaredPage(views, v.capability, v.input) ?? viewPageHref(v, pathname + search);
  const opener =
    open && !headed && conversation ? (
      <Link href={open.href} type="supporting" color="secondary" {...(open.onClick ? { onClick: open.onClick } : {})}>
        Öppna som samtal
      </Link>
    ) : null;
  return (
    <ConversationContext.Provider value={state}>
      <VStack gap={2} height="100%">
        {opener && <HStack hAlign="end">{opener}</HStack>}
        <StackItem size="fill">
          <VStack height="100%">
            {/* Before anything is asked there is nothing to scroll to: no room is kept over the box for the button. */}
            <ChatLayout
              composer={
                headed ? (
                  // The header names the page: the box says the same words on every page and keeps the page in its name.
                  <Composer place="pane" placeholder={PANE_PLACEHOLDER} name={paneBoxName(subject.placeholder)} />
                ) : (
                  <Composer place="pane" placeholder={subject.placeholder} />
                )
              }
              {...(asked ? {} : { scrollButton: null })}
            >
              {asked ? (
                <Transcript
                  room="pane"
                  about={subject.chips}
                  renderCard={() => null}
                  onOpenView={v => navigate(viewHref(v))}
                  viewHref={viewHref}
                  prepared={prepared}
                  conversationHref={whole ?? undefined}
                />
              ) : headed ? (
                <Explains reach={paneReach(subject, fills)} />
              ) : null}
            </ChatLayout>
          </VStack>
        </StackItem>
      </VStack>
    </ConversationContext.Provider>
  );
}
