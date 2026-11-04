import { useEffect, useState } from 'react';
import type { ConnectorAudience, ConnectorPreview, Role } from '@clew/contracts';
import { CheckboxList, CheckboxListItem, Collapsible, MultiSelector, RadioList, RadioListItem, Text, VStack } from '@clew/ui';
import { api } from '../../api';
import { roleLabel } from './labels';

/**
 * "Vem ser det" (D23): everyone, or a selection of roles, units and (later) groups. Any of the three lists admits a
 * person. Groups wait for SCIM and are shown disabled with the reason, so the editor does not change shape later.
 */
export function AudienceEditor({ value, onChange, units }: { value: ConnectorAudience; onChange: (a: ConnectorAudience) => void; units: Array<{ id: string; label: string }> }) {
  const selected = value.mode === 'selected' ? value : null;
  const update = (patch: Partial<Extract<ConnectorAudience, { mode: 'selected' }>>) => onChange({ mode: 'selected', roles: selected?.roles ?? [], units: selected?.units ?? [], groups: selected?.groups ?? [], ...patch });
  return <VStack gap={3}>
    <RadioList label="Vem ser anslutningen" value={value.mode} onChange={mode => onChange(mode === 'all' ? { mode: 'all' } : { mode: 'selected', roles: [], units: [], groups: [] })}>
      <RadioListItem value="all" label="Alla som är inloggade" description="Anslutningens eget regelverk avgör sedan vad var och en får göra." />
      <RadioListItem value="selected" label="Endast valda" description="En person som inte är med ser inte att anslutningen finns: inget område, inga frågor, inga kort." />
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
export function AudiencePreview({ connectorId, version }: { connectorId: string; version: number }) {
  const [previews, setPreviews] = useState<ConnectorPreview[] | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all((['manager', 'employee'] as Role[]).map(role => api.admin.preview(connectorId, role))).then(p => { if (alive) setPreviews(p); }).catch(() => { if (alive) setPreviews([]); });
    return () => { alive = false; };
  }, [connectorId, version]);
  if (!previews) return <Text type="supporting" role="status">Räknar fram vad var och en ser …</Text>;
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
