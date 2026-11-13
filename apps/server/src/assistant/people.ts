import type { AuthenticatedContext, Subject, Thread } from '@clew/contracts';
import { namedAmong, namedSubjects } from '../threads/domain';
import { subjectCards } from '../threads/usecases/subjects';
import { threadAccess } from '../threads/access';
import { dueLabel, workItemLine } from './context';
import type { ClewTool } from './model';
import type { AssistantDeps, ManagedPerson } from './ports';

export type { ManagedPerson };

/**
 * A person a question names (D115). Clew, not the model and not a source, resolves a name the asker wrote among the
 * people the asker manages (the people module's list behind Personal) and nobody else. What a resolved person brings
 * into the turn is the asker's own open work about them (the index from entity to cards, D97 item 6): each work item's
 * title, source, last day and buttons. Never a source's rows about the person, and never a card's text or rows when the
 * card is about someone the conversation names: a work item's summary and rows may say what a source knows about a
 * person's health, and the model is not handed that (D97 item 7, D115). Whether a card is about such a person is read
 * from the card in hand (`guards`), so it holds wherever the card lies: under Behöver dig, set aside under Inte nu,
 * waiting on someone else, or handled.
 */

/** How one name as the asker wrote it resolves: one person, several, or nobody. */
export type NameMatch =
  { match: 'one'; person: ManagedPerson } | { match: 'several'; people: ManagedPerson[] } | { match: 'none' };
/** A name the question writes as a name, and who it is. */
export interface NamedPerson {
  written: string;
  found: Exclude<NameMatch, { match: 'none' }>;
}

/** The longest name worth matching; anything longer names nobody. */
const NAME_MAX = 200;
const fold = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('sv');
const partsOf = (p: ManagedPerson) => fold(p.name).split(' ');
const bySwedishName = (a: ManagedPerson, b: ManagedPerson) => a.name.localeCompare(b.name, 'sv');

function byTiers(people: readonly ManagedPerson[], wanted: string): NameMatch {
  const tiers: Array<(p: ManagedPerson) => boolean> = [
    p => fold(p.name) === wanted,
    p => partsOf(p)[0] === wanted,
    p => {
      const all = partsOf(p);
      return all.length > 1 && (all.slice(1).join(' ') === wanted || all.at(-1) === wanted);
    },
  ];
  for (const tier of tiers) {
    const found = people.filter(tier);
    if (found.length === 1) return { match: 'one', person: found[0]! };
    if (found.length > 1) return { match: 'several', people: [...found].sort(bySwedishName) };
  }
  return { match: 'none' };
}
/**
 * One name as the asker wrote it: "Anna", "anna lindqvist", "Lindqvist". Matched without regard to case on whole names
 * and name parts: the full name, else the first name, else the family name (everything after the first name, or its
 * last part). The first of the three that names anyone decides. A Swedish genitive ("Annas") is read as the name when
 * the word as written names nobody.
 */
export function matchName(people: readonly ManagedPerson[], written: string): NameMatch {
  const wanted = fold(written.slice(0, NAME_MAX + 1));
  if (!wanted || wanted.length > NAME_MAX) return { match: 'none' };
  const found = byTiers(people, wanted);
  if (found.match !== 'none' || wanted.length < 3 || !wanted.endsWith('s')) return found;
  return byTiers(people, wanted.slice(0, -1));
}

interface Word {
  text: string;
  folded: string;
  /** The first word of the text or of a sentence, which is written with a capital whatever it is. */
  opensSentence: boolean;
}
const WORD = /\p{L}[\p{L}\p{M}'’-]*/gu;
function wordsOf(text: string): Word[] {
  const words: Word[] = [];
  for (const m of text.matchAll(WORD)) {
    const before = text.slice(0, m.index).trimEnd();
    words.push({ text: m[0], folded: fold(m[0]), opensSentence: !before || /[.!?:]$/.test(before) });
  }
  return words;
}
const capitalised = (word: string) => word.length > 1 && word[0] !== word[0]!.toLocaleLowerCase('sv');

/**
 * The names a question writes as names, whole names first and then in the order written, each person once. A whole name counts in any case
 * ("anna lindqvist"); a single name only written as a name is, with a capital ("Anna", "Lindqvist"), so the words of a
 * question that happen to be someone's name ("frånvaro per person" and Per) are not read as one. Capitalised words in a
 * row are one name ("Anna Svensson" names nobody, not Anna Lindqvist); a sentence's first word is dropped from such a
 * run when the run names nobody ("Boka Anna"). A name that names nobody is left out: free text cannot tell it from
 * any other word.
 */
export function namesIn(people: readonly ManagedPerson[], text: string): NamedPerson[] {
  const words = wordsOf(text.slice(0, 2000));
  const used = new Set<number>();
  const out: NamedPerson[] = [];
  // A whole name, in any case.
  const whole = new Map<number, { end: number; people: ManagedPerson[] }>();
  for (const person of people) {
    const parts = partsOf(person);
    if (parts.length < 2) continue;
    for (let i = 0; i + parts.length <= words.length; i++) {
      const hit = parts.every((part, j) => {
        const w = words[i + j]!.folded;
        return w === part || (j === parts.length - 1 && w === part + 's');
      });
      if (!hit) continue;
      // The longest whole name at a place wins; two people with the same whole name are both there.
      const at = whole.get(i);
      if (at && at.end === i + parts.length) at.people.push(person);
      else if (!at || at.end < i + parts.length) whole.set(i, { end: i + parts.length, people: [person] });
    }
  }
  for (const [start, { end, people: found }] of [...whole].sort((a, b) => a[0] - b[0])) {
    if ([...Array(end - start).keys()].some(k => used.has(start + k))) continue;
    for (let k = start; k < end; k++) used.add(k);
    out.push({
      written: words
        .slice(start, end)
        .map(w => w.text)
        .join(' '),
      found: found.length === 1 ? { match: 'one', person: found[0]! } : { match: 'several', people: found },
    });
  }
  // Runs of capitalised words not taken by a whole name.
  for (let i = 0; i < words.length; i++) {
    if (used.has(i) || !capitalised(words[i]!.text)) continue;
    let j = i;
    while (j + 1 < words.length && !used.has(j + 1) && capitalised(words[j + 1]!.text) && !words[j + 1]!.opensSentence)
      j++;
    const run = words.slice(i, j + 1);
    const tries = run.length > 1 && run[0]!.opensSentence ? [run, run.slice(1)] : [run];
    for (const attempt of tries) {
      const written = attempt.map(w => w.text).join(' ');
      const found = matchName(people, written);
      if (found.match === 'none') continue;
      out.push({ written, found });
      break;
    }
    i = j;
  }
  // Each person once: the first name that resolved to them alone keeps them.
  const seen = new Set<string>();
  return out.filter(n => {
    if (n.found.match !== 'one') return true;
    const key = fold(n.found.person.key);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
/**
 * The people the asker's own words could name, in any case and by any part of the name: a superset of what
 * `namesIn` and `matchName` can resolve from them. Their work items are guarded in the turn, and the lookup tool resolves
 * no one else, so a card the model reads in full is never tied to a person by Clew.
 */
export function mentionedIn(people: readonly ManagedPerson[], texts: readonly string[]): ManagedPerson[] {
  const words = new Set(texts.flatMap(t => wordsOf(t.slice(0, 4000)).map(w => w.folded)));
  return people.filter(p => partsOf(p).some(part => words.has(part) || words.has(part + 's')));
}

/** What a turn knows about the people it names (D115). */
export interface PeopleInTurn {
  /** The people the asker manages; empty for someone who manages nobody. */
  people: ManagedPerson[];
  /** The names the question writes as names, resolved. */
  named: NamedPerson[];
  /** The people the asker's words in this conversation could name: the only ones the lookup tool resolves. */
  mentioned: ManagedPerson[];
  /**
   * Whether a card is about any of them, by its own rows or the thread itself: wherever such a card is in the turn, the
   * model is handed its title, last day and buttons, never its text or rows. Decided on the card in hand, never on a
   * list it might be missing from: a card pointed at may be set aside, waiting or handled.
   */
  guards: (thread: Pick<Thread, 'id' | 'items' | 'subjects'>) => boolean;
  /** The asker's open work about one of them: their cards under Behöver dig whose rows name them (D97 item 6). */
  work: (person: ManagedPerson) => Thread[];
}
const NOBODY: PeopleInTurn = { people: [], named: [], mentioned: [], guards: () => false, work: () => [] };

/**
 * The person part of one turn: the people the asker manages, the names in the question and the work about everyone
 * the conversation's own words could name, read once. `earlier` is what the asker wrote before in this conversation.
 */
export async function peopleInTurn(
  deps: Pick<AssistantDeps, 'people' | 'store' | 'registry' | 'clock'>,
  persona: AuthenticatedContext,
  text: string,
  earlier: readonly string[],
): Promise<PeopleInTurn> {
  if (!deps.people) return NOBODY;
  const keyed = new Map<string, ManagedPerson>();
  for (const p of await deps.people(persona)) if (p.key && !keyed.has(fold(p.key))) keyed.set(fold(p.key), p);
  const people = [...keyed.values()];
  if (!people.length) return NOBODY;
  const named = namesIn(people, text);
  const mentioned = mentionedIn(people, [text, ...earlier]);
  // Whom the question names is among whom it could name; held together anyway, so nothing named goes unguarded.
  const about = new Map(mentioned.map(p => [fold(p.key), p]));
  for (const n of named)
    for (const p of n.found.match === 'one' ? [n.found.person] : n.found.people) about.set(fold(p.key), p);
  const byKey = new Map<string, Thread[]>();
  const guarded = new Set<string>();
  if (about.size) {
    const cards = await subjectCards({
      store: deps.store,
      registry: deps.registry,
      clock: deps.clock,
    }).cardsNaming(
      persona,
      [...about.values()].map(p => ({ entity: 'person' as const, key: p.key })),
    );
    const access = threadAccess(deps.store, deps.registry);
    for (const card of cards) {
      const thread = await access.read(persona, card.threadId);
      if (!thread) continue;
      guarded.add(thread.id);
      for (const subject of card.subjects) {
        // Only a card whose rows name the person is their work here. A card of Clew's own that names its employee on
        // the thread alone (an action point, D96 item 6) is never read by the assistant: guarded, not listed.
        const byRow = thread.items.some(
          i => i.subject?.entity === 'person' && fold(i.subject.key) === fold(subject.key),
        );
        if (!byRow) continue;
        const list = byKey.get(fold(subject.key)) ?? [];
        if (!list.some(t => t.id === thread.id)) list.push(thread);
        byKey.set(fold(subject.key), list);
      }
    }
  }
  const asked: Subject[] = [...about.values()].map(p => ({ entity: 'person', key: p.key }));
  return {
    people,
    named,
    mentioned: [...about.values()],
    // The card's own subjects decide. The cards found through the index are kept beside them, so a card it named stays
    // guarded whatever the copy in hand says.
    guards: thread => guarded.has(thread.id) || namedAmong(namedSubjects(thread), asked).length > 0,
    work: person => byKey.get(fold(person.key)) ?? [],
  };
}

/** The one work item a turn is about when the question names one person with exactly one: the item the model may draft on. */
export function personSubject(turn: PeopleInTurn): Thread | undefined {
  const ones = turn.named.flatMap(n => (n.found.match === 'one' ? [n.found.person] : []));
  if (ones.length !== 1 || turn.named.length !== 1) return undefined;
  const work = turn.work(ones[0]!);
  return work.length === 1 ? work[0] : undefined;
}
/** The work items about the people the question names, in the order named: what the turn draws (D34, H1). */
export const namedWork = (turn: PeopleInTurn): Thread[] =>
  turn.named.flatMap(n => (n.found.match === 'one' ? turn.work(n.found.person) : []));

const swedishList = (items: string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} och ${items.at(-1)}`;

/**
 * The prompt's lines about the people the question names (Swedish, as the prompt is): who each name is, with the user
 * name a read about one person takes (D122: the registry resolves it as the asker's report, or refuses it), or that it
 * may be several, and the asker's open work about each one by title, source, last day and buttons.
 */
export function peopleLines(turn: PeopleInTurn, now: string): string[] {
  return turn.named.map(n => {
    if (n.found.match === 'several')
      return `"${n.written}" kan vara flera medarbetare: ${swedishList(n.found.people.map(p => p.name))}. Fråga vem personen menar.`;
    const person = n.found.person;
    const work = turn.work(person);
    return (
      `"${n.written}" är ${person.name} på ${person.unit}, användarnamn ${person.key}. ` +
      (work.length
        ? `Öppna ärenden om medarbetaren under Behöver dig: ${work.map(t => workItemLine(t, now)).join(' ')}`
        : 'Inga öppna ärenden om medarbetaren under Behöver dig.')
    );
  });
}

/** Clew's tool that looks up a person the asker named (D115): a read of Clew's own, never a source's. */
export const PERSON_TOOL = 'clew.findPerson';
/**
 * The lookup the model may use when the question's names were not written as names, or come from earlier in the
 * conversation: the name as the asker wrote it, resolved among the people the asker's own words could name. It answers
 * who it is, with the user name a read about one person takes (D122), or the names when several, or that nobody is
 * called so, and the open work about the one person: titles, last days and buttons. `found` hears each person found, so
 * the turn can draw their work.
 */
export function personTool(turn: PeopleInTurn, now: string, found: (person: ManagedPerson) => void): ClewTool {
  return {
    name: PERSON_TOOL,
    description:
      'Ta reda på vem en medarbetare som personen nämnt är, bland dem personen är chef för, och vilka öppna ärenden om ' +
      'medarbetaren som väntar på personen under Behöver dig. Svarar med namnet, användarnamnet som ett verktyg om en ' +
      'medarbetare tar som person, och ärendenas titel, sista dag och knappar, aldrig med uppgifter om hälsa eller frånvaro.',
    input: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          minLength: 1,
          maxLength: NAME_MAX,
          description:
            'Namnet som personen skrev det: förnamnet, efternamnet eller hela namnet. Aldrig ett användarnamn eller en e-postadress.',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
    execute: input => {
      const written = typeof input.name === 'string' ? input.name : '';
      const match = matchName(turn.mentioned, written);
      if (match.match === 'none')
        return {
          found: 'none',
          note: 'Ingen av medarbetarna som personen är chef för och har nämnt i samtalet heter så. Säg det.',
        };
      if (match.match === 'several')
        return {
          found: 'several',
          names: match.people.map(p => p.name),
          note: 'Flera medarbetare heter så. Räkna upp namnen och fråga vem personen menar.',
        };
      found(match.person);
      return {
        found: 'one',
        name: match.person.name,
        unit: match.person.unit,
        userName: match.person.key,
        workItems: turn.work(match.person).map(t => workItemLine(t, now)),
        note: 'Ärendena visas för personen i samtalet. Uppgifter om medarbetarens hälsa och frånvaro lämnas inte till dig.',
      };
    },
  };
}

/** A work item as the router names it to the asker: its title and its last day. */
const routerLine = (t: Thread) => `"${t.title}"${t.deadline ? `, senast ${dueLabel(t.deadline)}` : ''}`;
/**
 * The router's answer about the people a question names (D115), without a model: the asker's open work about each one
 * person, by title and last day under Behöver dig, or, when a name may be several people, the question which. Undefined
 * when there is neither, and the router goes on as before.
 */
export function personAnswer(turn: PeopleInTurn): { body: string; source: string } | undefined {
  const withWork = turn.named.flatMap(n =>
    n.found.match === 'one' && turn.work(n.found.person).length
      ? [{ person: n.found.person, work: turn.work(n.found.person) }]
      : [],
  );
  if (withWork.length)
    return {
      body: withWork
        .map(({ person, work }) =>
          work.length === 1
            ? `Under Behöver dig finns ett öppet ärende om ${person.name}: ${routerLine(work[0]!)}.`
            : `Under Behöver dig finns ${work.length} öppna ärenden om ${person.name}: ${work.map(routerLine).join('; ')}.`,
        )
        .join(' '),
      source: [...new Set(withWork.flatMap(w => w.work.map(t => t.trigger.source)))].join(', '),
    };
  const several = turn.named.find(n => n.found.match === 'several');
  if (several?.found.match === 'several')
    return {
      body: `Flera av dina medarbetare heter ${several.written}: ${swedishList(several.found.people.map(p => p.name))}. Vem menar du?`,
      source: 'Startsidan',
    };
  return undefined;
}
