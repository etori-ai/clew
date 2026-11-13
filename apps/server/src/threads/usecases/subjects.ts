import {
  cardKind,
  isSnoozed,
  type AuthenticatedContext,
  type CardKind,
  type EntityCard,
  type Subject,
  type Thread,
} from '@clew/contracts';
import type { Registry } from '@clew/connectors';
import { visibleThread } from '../access';
import type { SubjectErasure, ThreadStore } from '../model';

/**
 * The cards about an entity (D97 items 5 and 6): a card's rows may name a person or a unit, and Clew keeps an index from
 * entity to cards in the thread store. These use cases read it for the entities module and erase one entity from it.
 */
export interface SubjectCardsDeps {
  store: Pick<ThreadStore, 'threadsNaming'>;
  registry: Pick<Registry, 'visible' | 'allowed' | 'connector'>;
  clock: () => Date;
}
/** A card of the reader's that names some of the entities asked about, with those it names, by Clew's key (D116). */
export type NamedCard = EntityCard & { subjects: Subject[] };
/** How Hem files a card (D34) in the words of the entity's page: a requirement waits for the reader's decision, a proposal is Clew's, an event is for information. */
const KIND: Record<CardKind, EntityCard['kind']> = { krav: 'act', forslag: 'proposal', handelse: 'fyi' };
const ORDER: Record<EntityCard['kind'], number> = { act: 0, proposal: 1, fyi: 2 };
const byDeadline = (a: Thread, b: Thread) =>
  (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.createdAt.localeCompare(b.createdAt);

export function subjectCards({ store, registry, clock }: SubjectCardsDeps) {
  /**
   * The reader's own cards that are still asking for them and whose rows name one of these entities: what Hem lists
   * under "Behöver dig" (unresolved, not waiting on someone else, not set aside under Inte nu) and only while the card is
   * the reader's to see (its connector visible, its source content under their current authority). Cards that wait for
   * the reader first, then Clew's proposals, then what is only for information; by deadline within each. The caller
   * decides which entities the reader may ask about; nothing here checks that a key exists.
   */
  async function cardsNaming(persona: AuthenticatedContext, subjects: readonly Subject[]): Promise<NamedCard[]> {
    if (!subjects.length) return [];
    const now = clock().toISOString();
    const found = await store.threadsNaming(persona.id, subjects);
    return found
      .filter(
        ({ thread: t }) =>
          t.kind === 'pushed' && !t.waitingOn && !isSnoozed(t, now) && visibleThread(registry, persona, t),
      )
      .map(({ thread, subjects: named }) => ({ thread, named, kind: KIND[cardKind(thread)] }))
      .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || byDeadline(a.thread, b.thread))
      .map(({ thread, named, kind }) => ({
        threadId: thread.id,
        title: thread.title,
        source: thread.trigger.source,
        kind,
        subjects: named,
      }));
  }
  return { cardsNaming };
}

export interface SubjectErasureDeps {
  store: Pick<ThreadStore, 'transaction'>;
  clock: () => Date;
  /** Whether a person is active, or undefined for an id the people table does not hold (composition: the user reads). */
  people: { enabled(personId: string): Promise<boolean | undefined> };
}
/** The audit action of an erased subject. */
export const SUBJECT_ERASED = 'thread.subject_erased';

export function subjectErasure({ store, clock, people }: SubjectErasureDeps) {
  /**
   * Erase one entity from every card (D97): the `subject` of each row that names it and the card's own, with the index,
   * in one transaction with one audit row about it (`person:<id>`, `unit:<id>`), counts only. An entity is named by
   * Clew's key (D116): a person by their id, which reaches every card about them whatever user names they have held, and
   * never another person's; a unit by its id. The rows' text stays as the source wrote it, and a source that still names
   * the entity names it again on its next scan. A person id the people table does not hold (a user name, a typo) and a
   * person who is still active erase nothing and write no audit row: only a person the source has deactivated is erased
   * (D117 item 3). A unit is erased by any id, since a removed unit may still be named. `actor` is the operator's.
   */
  async function eraseSubject(
    actor: string,
    subject: Subject,
  ): Promise<SubjectErasure | { refused: 'unknown' | 'active' }> {
    if (subject.entity === 'person') {
      const enabled = await people.enabled(subject.key);
      if (enabled === undefined) return { refused: 'unknown' };
      if (enabled) return { refused: 'active' };
    }
    const at = clock().toISOString();
    return store.transaction(async tx => {
      const erased = await tx.eraseSubject(subject);
      await tx.writeAudit({
        actor,
        action: SUBJECT_ERASED,
        subject: `${subject.entity}:${subject.key}`,
        at,
        details: { entity: subject.entity, ...erased },
      });
      return erased;
    });
  }
  return { eraseSubject };
}
export type SubjectCards = ReturnType<typeof subjectCards>;
export type SubjectErasureUsecases = ReturnType<typeof subjectErasure>;
