import { operationsUsecases } from '../modules/operations/usecases';
import { reliabilityCounts } from '../modules/operations/adapters/postgres';
export const operations = operationsUsecases(reliabilityCounts);
