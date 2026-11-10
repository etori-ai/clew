import type { Actor, Registry } from '@clew/connectors';
import type { HelpOutput, HelpOverview } from './contracts';
import { helpText } from './domain';

export interface HelpDeps {
  /** What the person may see, asked of the registry at call time: a system connected a minute ago is in the next read. */
  registry: Pick<Registry, 'areas' | 'connector' | 'menu'>;
}
/**
 * The help's use cases (D97): the person's page as the registry knows it, and the text made from it. A read only:
 * nothing is stored, so there is no transaction and no audit row, and the registry has already checked the scope.
 */
export function helpUsecases({ registry }: HelpDeps) {
  /** The areas of the connected systems, without Startsidan's own (the text explains those itself), and the tools in the menu. */
  async function overview(actor: Actor): Promise<HelpOverview> {
    const areas = await registry.areas(actor, { figures: false });
    return {
      areas: areas
        .filter(a => registry.connector(a.connector)?.kind !== 'core')
        .map(a => ({
          title: a.title,
          source: a.source,
          schedules: a.schedules,
          standing: a.standing.map(s => s.label),
        })),
      tools: registry.menu(actor).map(row => row.label),
    };
  }
  async function read(actor: Actor): Promise<HelpOutput> {
    return { body: helpText(await overview(actor)) };
  }
  return { overview, read };
}
export type HelpUsecases = ReturnType<typeof helpUsecases>;
