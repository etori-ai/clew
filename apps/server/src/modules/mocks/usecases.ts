import type { AuthenticatedContext } from '@clew/contracts';
import type { Registry } from '@clew/connectors';
import { InputError } from '../../context';
import type { MockResetStore } from './model';

export interface MockDeps {
  store: MockResetStore;
  registry: Pick<Registry, 'list'>;
  clock: () => Date;
  /** `CLEW_POC=true`: the reset exists only in the development environment. */ enabled: boolean;
}
/** Development only: forget every mock decision and close the mocks' open cards, so the next scan starts from the fixtures. */
export function mockUsecases(deps: MockDeps) {
  async function resetMocks(persona: AuthenticatedContext) {
    if (!deps.enabled) throw new InputError('Bara i utvecklingsmiljön.');
    await deps.store.resetState();
    const mockIds = deps.registry
      .list()
      .filter(m => m.kind === 'passthrough' && m.id !== 'calendar')
      .map(m => m.id)
      .concat('kommunikation');
    const at = deps.clock().toISOString();
    await deps.store.transaction(async tx => {
      await tx.dismissOpenThreadsOf(mockIds, at);
      await tx.writeAudit({
        actor: persona.principal.id,
        action: 'mocks.reset',
        subject: 'module_state',
        at,
        details: { connectors: mockIds },
      });
    });
  }
  return { resetMocks };
}
