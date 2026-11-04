import { CapabilityError, type Actor } from '@clew/modules';
import type { StateStore } from '@clew/modules/memory-state';
import type { ErrandDetail, ErrandProvider, ErrandSummary } from './model';
import { supportManagementFixtures, supportManagementMetadata as metadata, type SupportManagementFixture } from './support-management-fixtures';

const stateModule = 'errands-mock';
const prefix = 'errand:sm:2281:KC:';
/** Fixture bindings only. Real AD identities must come from a verified directory/IdP mapping. */
const accounts: Readonly<Record<string, { account: string; unitId: string }>> = {
  hillevi: { account: 'demo-hillevi', unitId: 'unit-skola' },
  hassan: { account: 'demo-hassan', unitId: 'unit-skola' },
};

/** Source-shaped fixtures behind Clew's contract. Only event acknowledgements enter the mock state store. */
export function mockSupportManagement(state: StateStore): ErrandProvider {
  const account = (actor: Actor) => {
    const binding = accounts[actor.id];
    return binding?.unitId === actor.unitId ? binding.account : undefined;
  };
  const relationships = (actor: Actor, fixture: SupportManagementFixture): ErrandSummary['relationships'] => {
    const ad = account(actor);
    return [
      ...(ad && fixture.errand.assignedUserId === ad ? ['handler' as const] : []),
      ...(ad && fixture.errand.reporterUserId === ad ? ['reporter' as const] : []),
    ];
  };
  const visible = (actor: Actor, ref: string) => supportManagementFixtures.find(f => prefix + f.errand.id === ref && relationships(actor, f).length > 0);
  const requireVisible = (actor: Actor, ref: string) => {
    const fixture = visible(actor, ref);
    if (!fixture) throw new CapabilityError('Ärendet finns inte eller är inte tillgängligt för dig.');
    return fixture;
  };
  const eventsFor = (actor: Actor, fixture: SupportManagementFixture) => {
    const ad = account(actor);
    return [
      ...fixture.notifications.filter(n => n.ownerId === ad),
      ...fixture.subscriberEvents.filter(n => n.subscriberId === ad),
    ].map(n => ({ id: n.id, label: n.subType === 'MESSAGE' ? 'Nytt meddelande' : 'Utredning att följa upp', at: n.created }));
  };
  const summary = async (actor: Actor, fixture: SupportManagementFixture): Promise<ErrandSummary> => {
    const e = fixture.errand;
    const phase = e.phases.filter(p => !p.ended).at(-1);
    const unreadEvents: ErrandSummary['unreadEvents'] = [];
    for (const event of eventsFor(actor, fixture)) {
      if (!await state.get<boolean>(stateModule, `${actor.id}:${event.id}`, false)) unreadEvents.push(event);
    }
    return {
      ref: prefix + e.id, errandNumber: e.errandNumber,
      category: metadata.categories[e.classification.category], type: metadata.types[e.classification.type],
      status: { code: e.status, ...metadata.statuses[e.status] }, phase: phase?.displayName ?? null,
      relationships: relationships(actor, fixture),
      waitingOn: phase?.name === 'WAITING' ? 'återkoppling från IT-support' : null,
      suspendedUntil: e.suspension?.suspendedTo ?? null,
      deadlines: fixture.investigations.filter(i => !i.completedAt).map(i => ({ ref: `${prefix}${e.id}:investigation:${i.id}`, label: 'Utredning', dueAt: i.dueAt })),
      unreadEvents, version: String(e.version),
    };
  };
  return {
    source: 'Support Management · exempeldata',
    available: actor => !!account(actor),
    async mine(actor) {
      return Promise.all(supportManagementFixtures.filter(f => relationships(actor, f).includes('handler')).map(f => summary(actor, f)));
    },
    async reported(actor) {
      return Promise.all(supportManagementFixtures.filter(f => relationships(actor, f).includes('reporter')).map(f => summary(actor, f)));
    },
    async get(actor, ref): Promise<ErrandDetail> {
      const fixture = requireVisible(actor, ref), e = fixture.errand;
      const communication = fixture.communication.at(-1);
      return {
        ...await summary(actor, fixture), title: e.title, description: e.description,
        lastCommunication: communication ? {
          channel: 'Webbmeddelande', direction: communication.direction === 'INBOUND' ? 'inbound' : 'outbound',
          body: communication.message, at: communication.sent,
        } : null,
      };
    },
    async access(actor, ref) {
      const fixture = visible(actor, ref);
      return { read: !!fixture, acknowledge: !!fixture && eventsFor(actor, fixture).length > 0 };
    },
    async acknowledge(actor, ref, eventIds) {
      const fixture = requireVisible(actor, ref);
      const allowed = new Set(eventsFor(actor, fixture).map(e => e.id));
      if (!eventIds.length || eventIds.some(id => !allowed.has(id))) throw new CapabilityError('Händelsen är inte tillgänglig för dig. Läs om ärendet.');
      for (const id of new Set(eventIds)) await state.set(stateModule, `${actor.id}:${id}`, true);
    },
  };
}
