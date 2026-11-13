import { inAudience, type AudiencedActor } from '@clew/connectors';
import type { ModelRecord } from './ports';

/**
 * Pure rules of model administration (D24): Clew's id for a model, which models a person may pick, and which one their
 * next question uses. No clock, no store, no network.
 */

/** Clew's own id for a model, from the id its endpoint uses: `gpt-oss:120b` becomes `gpt-oss-120b`, then `-2`, `-3` when taken. */
export function slugFor(model: string, taken: ReadonlySet<string>): string {
  const base =
    model
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^[^a-z]+/, '')
      .replace(/-+$/, '')
      .slice(0, 50)
      .replace(/-+$/, '') || 'modell';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}
/**
 * The models a person may pick: switched on, on a provider that exists, with the person in the audience by role, unit or
 * provisioned group (so the actor carries the groups). The default first, then in the order they were added.
 */
export function choicesFor(
  models: readonly ModelRecord[],
  providers: ReadonlySet<string>,
  actor: AudiencedActor,
): ModelRecord[] {
  const open = models.filter(
    m => m.state === 'enabled' && providers.has(m.providerId) && inAudience(m.audience, actor),
  );
  return [...open.filter(m => m.isDefault), ...open.filter(m => !m.isDefault)];
}
/** The person's pick when they may still use it, else the default, else the first they may use; nothing when they have none. */
export const pickModel = (choices: readonly ModelRecord[], saved: string | undefined): ModelRecord | undefined =>
  choices.find(m => m.id === saved) ?? choices[0];
