import type { ConnectorAudience, ConnectorSummary, ModelSummary, ProviderHealth, ProviderSummary, Role } from '@clew/contracts';

/** Swedish words for what the administration page shows (D23). Colour never stands alone: every variant has its word. */
export const roleLabel: Record<Role, string> = { manager: 'Chefer', employee: 'Medarbetare' };
export const kindLabel = { core: 'Kärna', passthrough: 'Genomgång', derived: 'Härledd' } as const;
export type Tone = 'success' | 'neutral' | 'warning' | 'error';
/** The status word and its colour: the state first (off is off whatever the health says), then the health of a live connector. */
export function statusOf(c: Pick<ConnectorSummary, 'state' | 'health' | 'bundled'>): { label: string; tone: Tone } {
  if (c.state === 'draft') return { label: 'Utkast', tone: 'neutral' };
  if (c.state === 'disabled') return { label: 'Avstängd', tone: 'neutral' };
  if (c.bundled || c.health.status === 'ok' || c.health.status === 'untested') return { label: 'Ansluten', tone: 'success' };
  if (c.health.status === 'unreachable') return { label: 'Svarar inte', tone: 'warning' };
  return { label: 'Fel', tone: 'error' };
}
export const healthLabel: Record<ConnectorSummary['health']['status'], string> = { ok: 'Svarar', unreachable: 'Svarar inte', 'manifest-invalid': 'Fel i manifestet', 'secret-rejected': 'Nyckeln avvisas', untested: 'Inte kontrollerad' };
/** One line for the audience: "Alla", "Chefer", "Chefer · 2 enheter", "Ingen". */
export function audienceLabel(a: ConnectorAudience): string {
  if (a.mode === 'all') return 'Alla';
  const parts = [...(a.roles ?? []).map(r => roleLabel[r]), ...(a.units?.length ? [`${a.units.length} ${a.units.length === 1 ? 'enhet' : 'enheter'}`] : []), ...(a.groups?.length ? [`${a.groups.length} ${a.groups.length === 1 ? 'grupp' : 'grupper'}`] : [])];
  return parts.length ? parts.join(' · ') : 'Ingen';
}
export const capabilityKindLabel = { read: 'Läs', propose: 'Föreslå', execute: 'Utför' } as const;
export const actionLabel: Record<string, string> = {
  'connector.added': 'Tillagd', 'connector.enabled': 'Satt på', 'connector.disabled': 'Avstängd', 'connector.draft': 'Satt som utkast',
  'connector.audience': 'Vem ser det ändrat', 'connector.scan': 'Kortutskick ändrat', 'connector.tools': 'Assistentens verktyg ändrade',
  'connector.capability': 'Förmågor ändrade', 'connector.url': 'Adress ändrad', 'connector.secret': 'Nyckel bytt', 'connector.manifest': 'Manifest uppdaterat', 'connector.removed': 'Borttagen',
  'provider.added': 'Tillagd', 'provider.title': 'Namn ändrat', 'provider.url': 'Adress ändrad', 'provider.key': 'Nyckel bytt', 'provider.removed': 'Borttagen',
  'model.added': 'Tillagd', 'model.enabled': 'Satt på', 'model.disabled': 'Avstängd', 'model.default': 'Standard ändrad', 'model.audience': 'Vem kan välja den ändrat',
  'model.tools': 'Verktyg ändrade', 'model.title': 'Namn ändrat', 'model.description': 'Beskrivning ändrad', 'model.model': 'Modellens id ändrat', 'model.removed': 'Borttagen',
};
/** Modeller (D24): the provider's health in words, a model's status from its state and its endpoint, and the audit actions. */
export const providerHealthLabel: Record<ProviderHealth['status'], string> = { ok: 'Svarar', unreachable: 'Svarar inte', 'key-rejected': 'Nyckeln avvisas', untested: 'Inte kontrollerad' };
export function modelStatusOf(m: Pick<ModelSummary, 'state' | 'health'>): { label: string; tone: Tone } {
  if (m.state === 'disabled') return { label: 'Avstängd', tone: 'neutral' };
  if (m.health.status === 'ok' || m.health.status === 'untested') return { label: 'På', tone: 'success' };
  return m.health.status === 'unreachable' ? { label: 'Svarar inte', tone: 'warning' } : { label: 'Nyckeln avvisas', tone: 'error' };
}
export const providerStatusOf = (p: Pick<ProviderSummary, 'health'>): { label: string; tone: Tone } =>
  ({ label: providerHealthLabel[p.health.status], tone: p.health.status === 'ok' ? 'success' : p.health.status === 'untested' ? 'neutral' : p.health.status === 'unreachable' ? 'warning' : 'error' });
export const actorLabel = (actor: string) => actor.startsWith('person:') ? actor.slice(7) : actor === 'system:boot' ? 'Systemet vid start' : actor.startsWith('bootstrap:') ? 'Kommandoraden' : actor;
