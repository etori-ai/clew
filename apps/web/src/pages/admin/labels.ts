import type {
  Capability,
  ConnectorAudience,
  ConnectorSummary,
  ModelSummary,
  ProviderHealth,
  ProviderSummary,
  Role,
  StaffPerson,
} from '@clew/contracts';

/** Swedish words for what the administration page shows (D23). Colour never stands alone: every variant has its word. */
export const roleLabel: Record<Role, string> = { manager: 'Chefer', employee: 'Medarbetare' };
/** A person's role in one unit, singular. */
export const roleOfOne: Record<Role, string> = { manager: 'Chef', employee: 'Medarbetare' };
const instant = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  dateStyle: 'long',
  timeStyle: 'short',
});
/**
 * An instant as the administration writes it inside a sentence: "10 november 2026 kl. 06:02", in Swedish time whatever
 * zone the browser is in. One wording for the page: Astryx's Timestamp writes the same instant "10 nov. 2026 6:02".
 */
export const instantText = (iso: string) => instant.format(new Date(iso));
const unitNames = new Intl.ListFormat('sv', { type: 'conjunction' });
/**
 * The role as a list of people says it. A person assigned to the unit has their role on it; one who reports there from
 * below (D99) is named by the units they lead, or are placed on where nobody leads: "Chef för Utveckling".
 */
export const roleText = (p: StaffPerson) => {
  const below = p.below ?? [];
  if (!below.length) return roleOfOne[p.role];
  const led = below.filter(b => b.role === 'manager');
  return `${led.length ? 'Chef för' : 'Medarbetare på'} ${unitNames.format((led.length ? led : below).map(b => b.unitLabel))}`;
};
/** The closed list of capabilities (D85) in the administrator's words. */
export const capabilityLabel: Record<Capability, string> = {
  'admin.connectors': 'Administrera anslutna system',
  'admin.users': 'Administrera användare',
  'admin.appearance': 'Administrera utseende',
  'admin.competence': 'Administrera kompetenskatalogen',
};
export const kindLabel = {
  core: 'Startsidans egen',
  passthrough: 'Direkt från källan',
  derived: 'Räknas fram',
} as const;
export type Tone = 'success' | 'neutral' | 'warning' | 'error';
/** The status word and its colour: the state first (off is off whatever the health says), then the health of a live connector. */
export function statusOf(c: Pick<ConnectorSummary, 'state' | 'health' | 'bundled'>): { label: string; tone: Tone } {
  if (c.state === 'draft') return { label: 'Utkast', tone: 'neutral' };
  if (c.state === 'disabled') return { label: 'Avstängd', tone: 'neutral' };
  if (c.bundled || c.health.status === 'ok' || c.health.status === 'untested')
    return { label: 'Ansluten', tone: 'success' };
  if (c.health.status === 'unreachable') return { label: 'Svarar inte', tone: 'warning' };
  return { label: 'Fel', tone: 'error' };
}
export const healthLabel: Record<ConnectorSummary['health']['status'], string> = {
  ok: 'Svarar',
  unreachable: 'Svarar inte',
  'manifest-invalid': 'Fel i systemets beskrivning',
  'secret-rejected': 'Nyckeln avvisas',
  untested: 'Inte kontrollerad',
};
/** One line for the audience: "Alla", "Chefer", "Chefer · 2 enheter", "Ingen". */
export function audienceLabel(a: ConnectorAudience): string {
  if (a.mode === 'all') return 'Alla';
  const parts = [
    ...(a.roles ?? []).map(r => roleLabel[r]),
    ...(a.units?.length ? [`${a.units.length} ${a.units.length === 1 ? 'enhet' : 'enheter'}`] : []),
    ...(a.groups?.length ? [`${a.groups.length} ${a.groups.length === 1 ? 'grupp' : 'grupper'}`] : []),
  ];
  return parts.length ? parts.join('\u00a0· ') : 'Ingen';
}
export const capabilityKindLabel = { read: 'Läs', propose: 'Föreslå', execute: 'Utför' } as const;
export const actionLabel: Record<string, string> = {
  'connector.added': 'Tillagd',
  'connector.enabled': 'Påslagen',
  'connector.disabled': 'Avstängd',
  'connector.draft': 'Satt som utkast',
  'connector.audience': 'Vem ser det ändrat',
  'connector.scan': 'Kortutskick ändrat',
  'connector.tools': 'Assistentens verktyg ändrade',
  'connector.header': 'Sidhuvudet ändrat',
  'connector.menu': 'Verktyg i menyn ändrat',
  'connector.capability': 'Funktioner ändrade',
  'connector.url': 'Adress ändrad',
  'connector.secret': 'Nyckel bytt',
  'connector.manifest': 'Uppdaterat från systemet',
  'connector.removed': 'Borttagen',
  'provider.added': 'Tillagd',
  'provider.title': 'Namn ändrat',
  'provider.url': 'Adress ändrad',
  'provider.key': 'Nyckel bytt',
  'provider.removed': 'Borttagen',
  'model.added': 'Tillagd',
  'model.enabled': 'Påslagen',
  'model.disabled': 'Avstängd',
  'model.default': 'Standard ändrad',
  'model.audience': 'Vem kan välja den ändrat',
  'model.tools': 'Verktyg ändrade',
  'model.reasoning': 'Resonemang ändrat',
  'model.title': 'Namn ändrat',
  'model.description': 'Beskrivning ändrad',
  'model.model': 'Modellens id ändrat',
  'model.removed': 'Borttagen',
};
/** Modeller (D24): the provider's health in words, a model's status from its state and its endpoint, and the audit actions. */
export const providerHealthLabel: Record<ProviderHealth['status'], string> = {
  ok: 'Svarar',
  unreachable: 'Svarar inte',
  'key-rejected': 'Nyckeln avvisas',
  untested: 'Inte kontrollerad',
};
export function modelStatusOf(m: Pick<ModelSummary, 'state' | 'health'>): { label: string; tone: Tone } {
  if (m.state === 'disabled') return { label: 'Avstängd', tone: 'neutral' };
  if (m.health.status === 'ok' || m.health.status === 'untested') return { label: 'På', tone: 'success' };
  return m.health.status === 'unreachable'
    ? { label: 'Svarar inte', tone: 'warning' }
    : { label: 'Nyckeln avvisas', tone: 'error' };
}
export const providerStatusOf = (p: Pick<ProviderSummary, 'health'>): { label: string; tone: Tone } => ({
  label: providerHealthLabel[p.health.status],
  tone:
    p.health.status === 'ok'
      ? 'success'
      : p.health.status === 'untested'
        ? 'neutral'
        : p.health.status === 'unreachable'
          ? 'warning'
          : 'error',
});
export const actorLabel = (actor: string) =>
  actor.startsWith('person:')
    ? actor.slice(7)
    : actor === 'system:boot'
      ? 'Systemet vid start'
      : actor.startsWith('bootstrap:')
        ? 'Kommandoraden'
        : actor;
