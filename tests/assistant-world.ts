import { Registry } from './registry';
import type { AuthenticatedContext } from '../packages/contracts/src/index';
import { audiencedActorOf } from '../packages/connectors/src/index';
import { fixtureConnectors, type FixtureId } from './fixture-connectors';
import { memoryCalendar, occurrence } from '../packages/calendar/src/memory';
import { localInstant } from '../packages/calendar/src/dates';
import { memoryThreadStore } from '../apps/server/src/threads/adapters/memory';
import { threadUsecases } from '../apps/server/src/threads/usecases/cards';
import { memoryObligations, memoryProposalStore } from '../apps/server/src/modules/calendar/adapters/memory';
import { calendarUsecases } from '../apps/server/src/modules/calendar/usecases/samtal';
import { assistantUsecases } from '../apps/server/src/assistant';
import { memoryModelHealth, memoryModelStore, memoryModelWire } from '../apps/server/src/assistant/adapters/memory';
import { modelUsecases } from '../apps/server/src/assistant/usecases/models';
import type { ModelGenerate } from '../apps/server/src/assistant/model';
import type { ManagedPerson } from '../apps/server/src/assistant/ports';

/**
 * The assistant on memory adapters over the fixture connectors, built the way `tests/unit/conversation.test.ts` builds
 * it: the real router, registry and use cases, a fixed clock, and a model only when the caller plays one. It imports no
 * test runner, so the scenario suite (`tests/unit/assistant-scenarios.test.ts`) and the model matrix (`scripts/model-matrix.ts`)
 * stand on the same world.
 */
export const T0 = '2026-11-04T07:00:00.000Z';
const persona = (id: string, name: string, role: 'manager' | 'employee'): AuthenticatedContext => ({
  id,
  name,
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role,
  organisationId: 'sundsvall',
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  async authorize() {
    return { version: 'v1' };
  },
});
export const personas = {
  hillevi: persona('hillevi', 'Hillevi Berg', 'manager'),
  hassan: persona('hassan', 'Hassan Ali', 'employee'),
};
export type PersonaId = keyof typeof personas;
const account = { ref: 'memory:account:hillevi', email: 'hillevi@clew.test', name: 'Hillevi Berg' };
const members = ['Anna Lindqvist', 'Erik Sandström'].map(name => {
  const first = name.split(' ')[0]!.toLowerCase();
  return { personId: first, ref: 'memory:account:' + first, email: first + '@clew.test', name };
});
/** The people Hillevi manages (D115), by the user names the HR fixture knows them by; an employee manages nobody. */
const directory: ManagedPerson[] = [
  ['anna', 'Anna Lindqvist'],
  ['erik', 'Erik Sandström'],
  ['maria', 'Maria Källström'],
  ['maria.eriksson', 'Maria Eriksson'],
  ['per', 'Per Lindahl'],
  ['karin', 'Karin Lindqvist'],
  ['lena', 'Lena Öhman'],
].map(([key, name]) => ({ key: key!, name: name!, unit: 'Skönsmons skola' }));

export interface WorldOptions {
  /** The model the caller plays; without one nobody has a model and the router answers (D8). */
  generate?: ModelGenerate;
  /** Whether the played model is one that takes tools, as an administrator sets it on the model (D24). */
  modelTools?: boolean;
  fixtures?: readonly FixtureId[];
}
export function assistantWorld(options: WorldOptions = {}) {
  const registry = new Registry();
  registry.register({ id: 'calendar', kind: 'core', source: 'Kalendern', areas: [], capabilities: [] });
  for (const c of fixtureConnectors({ only: options.fixtures ?? ['hr', 'finance'], clock: () => new Date(T0) })
    .connectors)
    registry.register(c);
  const store = memoryThreadStore(),
    proposals = memoryProposalStore(),
    cal = memoryCalendar(account);
  cal.events.push(
    occurrence(
      { uid: 'apt', title: 'APT', start: localInstant('2026-11-04T10:00'), end: localInstant('2026-11-04T11:00') },
      account,
    ),
  );
  let time = Date.parse(T0),
    n = 0;
  const clock = () => new Date(time),
    ids = () => `id-${++n}`;
  const run = <O>(p: AuthenticatedContext, name: string, input: unknown) =>
    registry.run<O>(audiencedActorOf(p), name, input);
  const calendar = calendarUsecases({
    store: proposals,
    bind: () => ({ provider: cal }),
    team: async p => (p.role === 'manager' ? members : []),
    round: async () => ({ label: 'Utvecklingssamtal 2026', opensOn: '2026-09-01', dueOn: '2026-11-28', held: [] }),
    clock,
    ids,
    people: { personaFor: async () => undefined },
    notify: async () => undefined,
    obligations: memoryObligations(),
  });
  const threads = threadUsecases({
    store,
    registry,
    // Whose a source's user name is (D122): in this world every person's id is their user name.
    people: {
      holders: async (_reader: string, names: readonly string[]) =>
        new Map(names.filter(name => directory.some(d => d.key === name)).map(name => [name, name])),
      userName: async (id: string) => (directory.some(d => d.key === id) ? id : null),
    },
    run,
    calendar: { ...calendar, todayEvents: async () => [] },
    clock,
    ids,
  });
  // The administered model (D24): with a `generate`, one provider and one switched-on default model the caller plays.
  const modelStore = memoryModelStore(),
    health = memoryModelHealth();
  const wire = memoryModelWire({
    endpoints: { 'http://llm.test/v1': { models: ['open-model'] } },
    generate: options.generate,
  });
  const models = modelUsecases({ store: modelStore, wire, health, clock, sealer: { seal: v => v, open: v => v } });
  const seeded = options.generate
    ? modelStore.transaction(async tx => {
        await tx.insertProvider({
          id: 'llm',
          title: 'Kommunens modeller',
          baseUrl: 'http://llm.test/v1',
          apiKey: null,
          health: { status: 'ok', at: T0 },
          createdBy: 'test',
          at: T0,
        });
        await tx.insertModel({
          id: 'open-model',
          providerId: 'llm',
          model: 'open-model',
          title: 'Öppen modell',
          description: '',
          tools: options.modelTools ?? true,
          createdBy: 'test',
          at: T0,
        });
        await tx.updateModel('open-model', { state: 'enabled', isDefault: true }, 'test', T0);
      })
    : Promise.resolve();
  const assistant = assistantUsecases({
    store,
    registry,
    run,
    calendar,
    models: {
      resolve: async (p: AuthenticatedContext) => {
        await seeded;
        return models.resolve(p);
      },
      health,
    },
    clock,
    ids,
    trace: () => '0af7651916cd43dd8448eb211c80319c',
    log: () => undefined,
    people: async (p: AuthenticatedContext) => (p.role === 'manager' ? directory : []),
  });
  return {
    store,
    proposals,
    cal,
    registry,
    threads,
    assistant,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
export type AssistantWorld = ReturnType<typeof assistantWorld>;
