import {
  EffectOutputSchema,
  PreviewOutputSchema,
  SUBJECT_CHANGED,
  subjectKeys,
  type AskValues,
  type AuthenticatedContext,
  type EffectPreview,
  type ReviewPreview,
  type DocumentReview,
  type ReviewEvidence,
  type Thread,
} from '@clew/contracts';
import { answersOf, asksFor, CapabilityError, givenBy, type Registry } from '@clew/connectors';
import { Value } from 'typebox/value';
import { InputError } from '../../context';
import { startedPerson } from '../domain';
import type { PersonKeys } from '../model';

export interface CardDecisionsDeps {
  documentPreview?: (persona: AuthenticatedContext, capability: string, ref: string) => Promise<DocumentReview>;
  read(persona: AuthenticatedContext, id: string): Promise<Thread | undefined>;
  registry: Pick<Registry, 'allowed' | 'viewFor'>;
  run(persona: AuthenticatedContext, name: string, input: unknown): Promise<unknown>;
  approve(
    persona: AuthenticatedContext,
    input: {
      decisionId: string;
      operation: string;
      payload: unknown;
      compensates?: string;
      presentation: { threadId: string; version: string; actionId: string };
      /** The person's answers to the asks (D112), already in `payload`; the audit row names them. */
      asked?: Record<string, string>;
      /**
       * The person a started action is about (D116): `payload[param]` is the user name `personId` held when the person
       * decided, and dispatch checks that it still is.
       */
      subject?: { param: string; personId: string };
    },
  ): Promise<unknown>;
  clock: () => Date;
  /**
   * Whose a source's key is (D116): a started action's person from Clew's key to the user name now, and the people a
   * read's records name to their ids. Absent: a started action about a person cannot be decided, and a record names nobody.
   */
  people?: PersonKeys;
}

/** Human card decisions enter the durable execution boundary. Reads remain immediate. */
export function cardDecisions({ read, registry, run, approve, clock, documentPreview, people }: CardDecisionsDeps) {
  const required = async (persona: AuthenticatedContext, id: string) => {
    const t = await read(persona, id);
    if (!t) throw new InputError('Ärendet finns inte.');
    return t;
  };
  /**
   * The input an action on a card runs with, as the person decides it (D112): the action's own input, the selected
   * rows, the review's evidence and the answers to the asks the action does not already fill. An answer to anything
   * else, a required ask left empty or an answer that does not fit its kind is refused here, before anything runs.
   */
  async function decided(
    persona: AuthenticatedContext,
    id: string,
    actionId: string,
    refs?: string[],
    reviews?: ReviewEvidence[],
    values?: AskValues,
  ) {
    const t = await required(persona, id),
      action = t.actions.find(a => a.id === actionId);
    if (!action) throw new InputError('Okänd handling.');
    const found = registry.allowed(persona, action.capability);
    if (!found || found.connector.id !== t.connector) throw new InputError('Okänd förmåga.');
    const selected = refs ?? t.items.filter(i => i.selected).map(i => i.ref);
    if (action.usesItems && selected.some(ref => !t.items.some(i => i.ref === ref)))
      throw new InputError('Något val är inte längre aktuellt.');
    // The asks come from the registered declaration, never from the card (D112).
    const asks = found.capability.kind === 'read' ? [] : asksFor(found.capability, givenBy(found.capability, action));
    const answered = answersOf(asks, values, clock().toISOString(), found.capability.input);
    if ('problem' in answered) throw new InputError(answered.problem);
    // A started action keeps the person by id (D116); the source is sent the user name the person has as this is decided.
    const subject = startedPerson(t.topic, action, found.capability.about);
    const userName = subject && people ? await people.userName(subject.personId) : undefined;
    if (subject && !userName) throw new InputError('Personen finns inte längre i katalogen. Inget har skickats.');
    const payload = {
      ...(action.input ?? {}),
      ...answered.answers,
      ...(action.usesItems ? { refs: [...new Set(selected)].sort() } : {}),
      ...(found.capability.review ? { reviews: reviews ?? [] } : {}),
      ...(subject ? { [subject.param]: userName } : {}),
    };
    return { t, action, found, selected, payload, asked: answered.answers, subject };
  }
  async function act(
    persona: AuthenticatedContext,
    id: string,
    actionId: string,
    refs?: string[],
    reviews?: ReviewEvidence[],
    values?: AskValues,
  ) {
    const { t, action, found, selected, payload, asked, subject } = await decided(
      persona,
      id,
      actionId,
      refs,
      reviews,
      values,
    );
    if (found.capability.kind !== 'execute') {
      const output = await run(persona, action.capability, payload),
        view = registry.viewFor(persona, action.capability);
      // A record that names a person links to them by id (D116).
      const names = view ? subjectKeys(view, output) : [];
      const held = names.length && people ? await people.holders(persona.id, names) : undefined;
      return {
        kind: found.capability.kind,
        output,
        ...(view ? { view: held?.size ? { ...view, people: Object.fromEntries(held) } : view } : {}),
      };
    }
    // A started action that dispatch refused because its user name had moved to someone else (D116) is decided again,
    // as a new decision: the person decides on the user name the person has now.
    const refused = t.execution?.state === 'failed' && t.execution.reason === SUBJECT_CHANGED;
    const previous = t.execution && !t.execution.compensates && !refused ? t.execution : undefined;
    if (
      !previous &&
      found.capability.review &&
      selected.some(ref => {
        const revision = t.items.find(item => item.ref === ref)?.revision;
        return revision && reviews?.find(review => review.ref === ref)?.revision !== revision;
      })
    )
      throw new InputError('Underlaget och ärendet gäller olika versioner. Läs in ärendet igen.');
    if (!previous && t.state !== 'open') throw new InputError('Ärendet är redan hanterat.');
    if (previous && previous.operation !== action.capability)
      throw new InputError('Ett tidigare beslut väntar redan på besked.');
    try {
      await approve(persona, {
        decisionId: previous?.decisionId ?? `card:${id}:${actionId}:${Date.parse(t.updatedAt)}`,
        operation: action.capability,
        payload,
        presentation: { threadId: id, version: t.updatedAt, actionId },
        ...(Object.keys(asked).length ? { asked } : {}),
        ...(subject ? { subject } : {}),
      });
    } catch (error) {
      // An approved input the capability's schema refuses (the answers merged in, D112) is the person's to correct.
      throw error instanceof CapabilityError ? new InputError(error.message) : error;
    }
    return { kind: 'execute' as const, thread: await required(persona, id) };
  }
  /**
   * What an execute declares it will do (D112), for exactly the input the person would approve: its `effect` read of the
   * same connector, run as the person, its answer checked against the contract. A read: nothing is written and no audit
   * row is kept. Undefined input problems are the person's, in Swedish.
   */
  async function effectFor(
    persona: AuthenticatedContext,
    capability: string,
    input: Record<string, unknown>,
    connector?: string,
  ): Promise<EffectPreview> {
    const found = registry.allowed(persona, capability);
    if (!found || found.capability.kind !== 'execute' || (connector && found.connector.id !== connector))
      throw new InputError('Okänd förmåga.');
    const name = found.capability.effect;
    if (!name) throw new InputError('Åtgärden säger inte i förväg vad den gör.');
    const effect = registry.allowed(persona, name);
    if (!effect || effect.connector.id !== found.connector.id || effect.capability.kind !== 'read')
      throw new InputError('Okänd förmåga.');
    const output = await run(persona, name, input);
    if (!Value.Check(EffectOutputSchema, output))
      throw new InputError(`${found.connector.source} kunde inte säga vad som händer.`);
    return { ...output, source: found.connector.source };
  }
  /** "Det här händer" for an action on a card (D112): the input `act` would approve with these rows and answers. */
  async function effect(
    persona: AuthenticatedContext,
    id: string,
    actionId: string,
    refs?: string[],
    values?: AskValues,
  ): Promise<EffectPreview> {
    const { t, action, payload } = await decided(persona, id, actionId, refs, undefined, values);
    return effectFor(persona, action.capability, payload, t.connector);
  }
  async function undoReceipt(persona: AuthenticatedContext, id: string) {
    const t = await required(persona, id),
      r = t.receipt;
    if (!r?.undoCapability || !r.undoUntil || r.undoUntil <= clock().toISOString())
      throw new InputError('Ångerfönstret har gått ut.');
    if (!t.execution)
      throw new InputError('Det äldre kvittot behöver kontrolleras i källsystemet innan det kan ångras.');
    if (['pending', 'running', 'unknown'].includes(t.execution.state) && !t.execution.compensates)
      throw new InputError('Kontrollera källans besked innan åtgärden kan ångras.');
    const originalId = t.execution.compensates ?? t.execution.id;
    await approve(persona, {
      decisionId: `undo:${originalId}`,
      operation: r.undoCapability,
      payload: r.undoInput ?? {
        refs: r.rows
          .filter(row => row.outcome === 'done')
          .map(row => row.ref)
          .sort(),
      },
      compensates: originalId,
      presentation: { threadId: id, version: t.updatedAt, actionId: 'undo' },
    });
    return required(persona, id);
  }
  /**
   * One item's document for the review flow (D70): the preview read the card's reviewed action names, run for one of the
   * card's own items. A read, so no decision; the answer is checked against the contract before the browser draws it.
   */
  async function preview(persona: AuthenticatedContext, id: string, ref: string): Promise<ReviewPreview> {
    const t = await required(persona, id),
      action = t.actions.find(a => a.review === 'each' && a.preview);
    if (!action?.preview) throw new InputError('Ärendet har inget underlag att visa.');
    if (!t.items.some(i => i.ref === ref)) throw new InputError('Raden finns inte i ärendet.');
    const found = registry.allowed(persona, action.preview);
    if (!found || found.connector.id !== t.connector || found.capability.kind !== 'read')
      throw new InputError('Okänd förmåga.');
    if (documentPreview && (found.capability.view?.kind === 'document' || found.capability.view?.kind === 'record')) {
      const preview = await documentPreview(persona, action.preview, ref);
      const revision = t.items.find(item => item.ref === ref)?.revision;
      if (!t.receipt && !t.execution && t.state === 'open' && revision && revision !== preview.bundle.revision)
        throw new InputError('Underlaget har ändrats sedan ärendet skapades. Läs in ärendet igen.');
      return preview;
    }
    const output = await run(persona, action.preview, { ref });
    if (!Value.Check(PreviewOutputSchema, output)) throw new InputError('Underlaget kunde inte läsas.');
    return output;
  }
  return { act, effect, effectFor, undoReceipt, preview };
}
