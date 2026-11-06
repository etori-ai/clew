import { createHash } from 'node:crypto';
import type { Actor, ScanObservation, ThreadDraft } from './index';
/** Complete local fixtures have no pagination; persistent records use their source refs, renewals their expiry period. */
export function completeSnapshot(actor: Actor, drafts: ThreadDraft[]): ScanObservation {
  const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
  return {
    drafts: drafts.map(d => ({
      ...d,
      occurrences:
        d.occurrences ??
        (d.items?.length
          ? d.items.map(i => ({
              key: i.ref,
              revision: hash([i.label, i.detail, d.summary, d.actions]),
              period: d.topic.includes(':delegation:') ? (d.deadline ?? 'once') : 'once',
            }))
          : [{ key: d.topic, revision: hash(d), period: 'once' }]),
    })),
    observation: {
      scope: actor.unitId + ':' + actor.role,
      observedAt: new Date().toISOString(),
      version: hash(drafts),
      completeness: 'complete',
      exhausted: true,
    },
  };
}
