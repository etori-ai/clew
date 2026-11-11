import type { StaffOverview } from '@clew/contracts';
import type { Reach } from '../modules/about/model';
import { ForbiddenError } from '../context';
import { systemContext } from '../system-context';
import { staff as staffUsecases } from './people';

/**
 * Who may be asked about (D97 item 8), the core rule per entity kind, read fresh on every call. A person: the reader
 * and the people who report to them now (D99 item 4), a deactivated person left out. A unit has no rule yet, so nobody
 * is asked about one. Its own file because the registry builds `clew.about` over it and `composition/index.ts` builds
 * the stream over the registry: this file imports neither.
 */
const NOBODY: StaffOverview = { units: [] };
export const aboutReach: Reach = async (actor, kind) => {
  if (kind !== 'person') return new Set();
  const reach = new Set([actor.id]);
  const persona = await systemContext(actor.id, 'connector:clew');
  if (!persona) return reach;
  let overview = NOBODY;
  try {
    overview = await staffUsecases.overview(persona);
  } catch (error) {
    // The people module refuses someone who manages no unit: they reach themselves only.
    if (!(error instanceof ForbiddenError)) throw error;
  }
  for (const unit of overview.units) for (const p of unit.people) if (p.enabled !== false) reach.add(p.id);
  return reach;
};
