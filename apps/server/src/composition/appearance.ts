import { postgresAppearanceStore } from '../modules/appearance/adapters/postgres';
import { appearanceUsecases } from '../modules/appearance/usecases';
import { clock } from './ambient';

/** The installation's theme and logo (D98): one row in Postgres, read by every browser and changed on Administration › Utseende. */
export const appearance = appearanceUsecases({ store: postgresAppearanceStore(), clock });
