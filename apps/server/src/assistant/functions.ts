import type { AuthenticatedContext } from '@clew/contracts';
import { audiencedActorOf, type Registry } from '@clew/connectors';
import { capabilityRunner } from '../connectors/run';
import { managedPeople } from './people';
import type { AssistantDeps } from './ports';

/** What the `people` port is built from: the people module's reach and the user name a read takes. */
export interface PeopleSource<P extends { id: string; name: string }> {
  /** The asker's units and their people (`staffUsecases(...).reach`, Personal's list, D115). */
  reach: (persona: AuthenticatedContext) => Promise<{
    managed: ReadonlyArray<{ unitLabel: string; people: readonly P[] }>;
  }>;
  /** The user name a read about a person takes (the entities module's `personKey`), undefined for someone who cannot be asked about (D97). */
  userNameOf: (person: P) => string | undefined;
}

/**
 * The assistant's function ports as the server binds them (AM-13 of the 2026-11-23 assistant review): `run` and
 * `handover` through the connector registry as the person, with their live authority and their own token for a source;
 * `people` from the people module's reach, each person by Clew's key and the user name a read takes (`managedPeople`);
 * `start` as the threads' `startCard`, handed through. Composition builds the ports here over the live registry and
 * stores, and the unit suite over the memory adapters (`tests/unit/assistant-ports.test.ts`), so a test world binds what
 * the server binds and the contract holds the binding itself.
 */
export function assistantFunctions<P extends { id: string; name: string }>(sources: {
  registry: Pick<Registry, 'find' | 'run' | 'assistantsFor' | 'ask'>;
  people?: PeopleSource<P>;
  start?: AssistantDeps['start'];
}): Pick<AssistantDeps, 'run' | 'handover' | 'people' | 'start'> {
  const { registry, people, start } = sources;
  return {
    run: capabilityRunner(registry),
    // The assistants of other systems (the assistants profile): listed and asked through the registry as the person,
    // with their live authority and their own token for the source, so the registry's checks hold on every question.
    handover: {
      list: persona =>
        registry.assistantsFor(audiencedActorOf(persona), {
          authorize: () => persona.authorize(),
          delegate: persona.delegate,
        }),
      ask: (persona, assistant, ask, signal) =>
        registry.ask(audiencedActorOf(persona), assistant, ask, {
          authorize: () => persona.authorize(),
          delegate: persona.delegate,
          ...(signal ? { signal } : {}),
        }),
    },
    // The people the asker manages (D115): Personal's list, read on every turn, by Clew's key (D122) and the user name a
    // read takes (D117); only people who can be asked about (D97).
    ...(people
      ? { people: async persona => managedPeople((await people.reach(persona)).managed, people.userNameOf) }
      : {}),
    ...(start ? { start } : {}),
  };
}
