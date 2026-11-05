import { useQueries } from '@tanstack/react-query';
import type { ConnectorAudience, ConnectorPreview, Role } from '@clew/contracts';
import { CheckboxList, CheckboxListItem, Collapsible, MultiSelector, RadioList, RadioListItem, Text, VStack } from '@clew/ui';
import { adminQueries } from '../../queries';
import { roleLabel } from './labels';

/**
 * "Vem ser det" (D23): everyone, or a selection of roles, units and (later) groups. Any of the three lists admits a
 * person. Groups wait for SCIM and are shown disabled with the reason, so the editor does not change shape later.
 */
/** What the editor says about the thing it governs: a connector (D23) or a model (D24). */
const wording = {
  connector: { label: 'Vem ser anslutningen', all: 'Anslutningens eget regelverk avgör sedan vad var och en får göra.', selected: 'En person som inte är med ser inte att anslutningen finns: inget område, inga frågor, inga kort.' },
  model: { label: 'Vem kan välja modellen', all: 'Alla kan välja modellen i frågerutan när den är på.', selected: 'En person som inte är med ser inte modellen och får standardmodellen i stället.' },
};
export function AudienceEditor({ value, onChange, units, of = 'connector' }: { value: ConnectorAudience; onChange: (a: ConnectorAudience) => void; units: Array<{ id: string; label: string }>; of?: keyof typeof wording }) {
  const selected = value.mode === 'selected' ? value : null;
  const update = (patch: Partial<Extract<ConnectorAudience, { mode: 'selected' }>>) => onChange({ mode: 'selected', roles: selected?.roles ?? [], units: selected?.units ?? [], groups: selected?.groups ?? [], ...patch });
  const words = wording[of];
  return <VStack gap={3}>
    <RadioList label={words.label} value={value.mode} onChange={mode => onChange(mode === 'all' ? { mode: 'all' } : { mode: 'selected', roles: [], units: [], groups: [] })}>
      <RadioListItem value="all" label="Alla som är inloggade" description={words.all} />
      <RadioListItem value="selected" label="Endast valda" description={words.selected} />
    </RadioList>
    {selected && <VStack gap={3}>
      <CheckboxList label="Roller" value={selected.roles ?? []} onChange={roles => update({ roles: roles as Role[] })}>
        {(['manager', 'employee'] as Role[]).map(r => <CheckboxListItem key={r} value={r} label={roleLabel[r]} />)}
      </CheckboxList>
      <MultiSelector label="Enheter" placeholder="Välj enheter" value={selected.units ?? []} onChange={u => update({ units: u })} hasSearch={units.length > 15} triggerDisplay="badges" presentation="adaptive"
        options={units.map(u => ({ value: u.id, label: u.label }))} emptyText="Inga enheter" emptySearchText="Inga träffar" searchPlaceholder="Sök enhet" />
      <MultiSelector label="Grupper" placeholder="Kommer med SCIM" value={selected.groups ?? []} onChange={() => undefined} options={[]} isDisabled disabledMessage="Grupper kommer när katalogen provisionerar dem genom SCIM." />
    </VStack>}
  </VStack>;
}
/** The structural preview: what a manager and an employee would get from this connector. No data, no call to the service. */
const roles: Role[] = ['manager', 'employee'];
export function AudiencePreview({ connectorId }: { connectorId: string }) {
  // One query per role from the admin cache (D33); every action on the page invalidates them, so the preview follows the saved audience.
  const results = useQueries({ queries: roles.map(role => adminQueries.preview(connectorId, role)) });
  if (results.some(r => r.isPending)) return <Text type="supporting" role="status">Räknar fram vad var och en ser …</Text>;
  const previews = results.map(r => r.data).filter((p): p is ConnectorPreview => !!p);
  return <VStack gap={2} as="section" aria-label="Så här ser det ut">
    {previews.map(p => <Collapsible key={p.role} defaultIsOpen={false} chevronPosition="start" trigger={<Text type="supporting"><Text as="span" weight="semibold">Så här ser det ut för {roleLabel[p.role].toLowerCase()}:</Text> {p.visible ? `${p.areas.length} ${p.areas.length === 1 ? 'område' : 'områden'}, ${p.tools.length} frågor till assistenten` : 'ingenting'}</Text>}>
      <VStack gap={1}>
        {!p.visible && <Text type="supporting">Anslutningen finns inte för den här rollen.</Text>}
        {p.areas.map(a => <Text key={a.id} type="supporting"><Text as="span" weight="semibold">{a.title}</Text>{a.standing.length ? ` · Gör själv: ${a.standing.join(', ')}` : ''}</Text>)}
        {p.visible && p.tools.length > 0 && <Text type="supporting">Assistenten kan använda: {p.tools.join(', ')}</Text>}
        {p.visible && p.tools.length === 0 && <Text type="supporting">Inga frågor till assistenten för den här rollen (förmågornas egna regler kan kräva en viss person).</Text>}
      </VStack>
    </Collapsible>)}
  </VStack>;
}
