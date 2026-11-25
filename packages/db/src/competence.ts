import { eq } from 'drizzle-orm';
import type { Transaction } from './index';
import { competenceHoldings, competenceSourceMappings, competenceSources } from './schema';

/**
 * Forget what the competence register copied from a connector (D108 item 9): its record as a source, the holdings
 * copied from it and its type mappings, counted as they go (DE-L4). One function for the two ways it happens, an
 * operator forgetting a source (the competence module) and an administrator removing the connector (the connectors
 * module), so the two keep one lock order: the source's row first, as the copy's write and a mapping take it, so neither
 * can deadlock with this; then the holdings, the mappings and the source's row.
 */
export async function forgetCompetenceSource(
  tx: Transaction,
  connectorId: string,
): Promise<{ source: boolean; holdings: number; mappings: number }> {
  const [source] = await tx
    .select({ id: competenceSources.connectorId })
    .from(competenceSources)
    .where(eq(competenceSources.connectorId, connectorId))
    .for('update');
  const holdings = await tx
    .delete(competenceHoldings)
    .where(eq(competenceHoldings.connectorId, connectorId))
    .returning({ id: competenceHoldings.id });
  const mappings = await tx
    .delete(competenceSourceMappings)
    .where(eq(competenceSourceMappings.connectorId, connectorId))
    .returning({ type: competenceSourceMappings.sourceType });
  if (source) await tx.delete(competenceSources).where(eq(competenceSources.connectorId, connectorId));
  return { source: source !== undefined, holdings: holdings.length, mappings: mappings.length };
}
