import type { AssistantStatus, AuthenticatedContext } from '@clew/contracts';
import type { Registry } from '@clew/connectors';
import type { CalendarUsecases } from '../modules/calendar/usecases/samtal';
import type { ThreadStore } from '../threads/model';
import type { ModelGenerate } from './model';

/**
 * The ports of the assistant (D25). `ThreadStore` holds the conversations (question threads) and the drafts on cards;
 * `ModelProvider` is the optional model behind the question box (D8): its health is a status the UI shows, and a
 * failed generation flips it until the probe brings it back. `adapters/provider.ts` is the live one.
 */
export interface ModelProvider {
  status(): AssistantStatus;
  /** Absent when no model is configured; the deterministic router answers instead (D8). */
  generate?: ModelGenerate;
  markAvailable(): void;
  markUnavailable(): void;
}
export interface AssistantDeps {
  store: ThreadStore;
  registry: Pick<Registry, 'tools' | 'areas' | 'list' | 'find' | 'allowed' | 'capabilitiesFor'>;
  run: <O = unknown>(persona: AuthenticatedContext, name: string, input: unknown) => Promise<O>;
  calendar: Pick<CalendarUsecases, 'listWeek' | 'readToday' | 'samtalStatus' | 'ensureProposalThread' | 'replan'>;
  model: ModelProvider;
  clock: () => Date;
  ids: () => string;
  log: (message: string, ...details: unknown[]) => void;
}
