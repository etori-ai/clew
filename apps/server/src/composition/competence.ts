import type { StaffOverview } from '@clew/contracts';
import { postgresCompetenceStore } from '../modules/competence/adapters/postgres';
import { competenceUsecases } from '../modules/competence/usecases';
import type { Staff } from '../modules/competence/model';
import { ForbiddenError } from '../context';
import { staff as staffUsecases } from './people';
import { clock, ids } from './ambient';

/**
 * The competence module's live wiring (D107, D25). Its own file because the registry registers the built-in competence
 * connector over what is built here, and `composition/index.ts` builds the stream over the registry: this file imports
 * neither.
 */
export const competenceStore = postgresCompetenceStore();
const NOBODY: StaffOverview = { units: [] };
/** Personal's overview (D94, D99): the people module's refusal of someone who manages no unit is "nobody" to this module. */
const staff: Staff = async persona => {
  try {
    return await staffUsecases.overview(persona);
  } catch (error) {
    if (error instanceof ForbiddenError) return NOBODY;
    throw error;
  }
};
export const competence = competenceUsecases({ store: competenceStore, staff, clock, ids });
