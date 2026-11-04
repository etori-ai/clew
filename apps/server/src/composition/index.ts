import { registry, runCapability } from '../connectors/registry';
import { liveModelProvider } from '../assistant/adapters/provider';
import { assistantUsecases } from '../assistant';
import { postgresMockResetStore } from '../modules/mocks/adapters/postgres';
import { mockUsecases } from '../modules/mocks/usecases';
import { postgresJobQueue, postgresPeople } from '../scheduler/adapters/postgres';
import { createScheduler } from '../scheduler/usecases';
import { postgresThreadStore } from '../threads/adapters/postgres';
import { temporalTimers } from '../threads/adapters/temporal';
import { reminderUsecases } from '../threads/usecases/reminders';
import { threadUsecases } from '../threads/usecases/cards';
import { clock, ids } from './ambient';
import { calendar } from './calendar';

/**
 * The composition root (D25): the one place that pairs use cases with their live adapters. Routes, the scheduler and
 * the assistant import the built use cases from here; nothing below this folder chooses an adapter, reads the clock
 * or draws an id on its own. The tests build the same use cases over the memory adapters. The calendar is wired in
 * `calendar.ts`, before the registry, because the registry's calendar connector is built over it.
 */
const store = postgresThreadStore();
export { calendar };
export const threads = threadUsecases({ store, registry, run: runCapability, calendar: { ensureProposalThread: calendar.ensureProposalThread, replan: calendar.replan, dismiss: calendar.dismiss }, clock, ids });
export const reminders = reminderUsecases({ store, timers: temporalTimers(), clock });
export const mocks = mockUsecases({ store: postgresMockResetStore(), registry, clock, enabled: process.env.CLEW_POC === 'true' });
const model = liveModelProvider();
export const assistant = assistantUsecases({ store, registry, run: runCapability, calendar, model, clock, ids, log: console.error });
/** The model's health probe (D8), started by main.ts beside the server. */
export const startAssistantProbe = () => model.startProbe();
export const scheduler = createScheduler({ jobs: postgresJobQueue(), people: postgresPeople(), threads, calendar, clock, log: console.error });
