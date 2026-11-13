import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import type { ConnectorAudience, ConnectorPreview, Role } from '@clew/contracts';
import {
  CheckboxList,
  CheckboxListItem,
  Collapsible,
  MultiSelector,
  RadioList,
  RadioListItem,
  Text,
  VStack,
} from '@clew/ui';
import { adminQueries } from '../../queries';
import { roleLabel } from './labels';

/** A unit or a provisioned group as the editor offers it: the id is what an audience stores. */
type Offered = { id: string; label: string };
/** The page's reads of what the editor offers (D33), handed over as they stand. */
export type UnitsRead = UseQueryResult<{ units: Offered[] }>;
export type GroupsRead = UseQueryResult<{ groups: Offered[] }>;
/** What a field says when its read failed: which units or groups there are is not known, so it never says there are none. */
const UNITS_UNREAD = 'Enheterna kunde inte läsas.';
const GROUPS_UNREAD = 'Grupperna kunde inte läsas.';
/** What the editor says about the thing it governs: a connector (D23) or a model (D24). */
const wording = {
  connector: {
    label: 'Vem ser anslutningen',
    all: 'Anslutningens eget regelverk avgör sedan vad var och en får göra.',
    selected: 'En person som inte är med ser inte att anslutningen finns: inget område, inga frågor, inga ärenden.',
  },
  model: {
    label: 'Vem kan välja modellen',
    all: 'Alla kan välja modellen i frågerutan när den är på.',
    selected: 'En person som inte är med ser inte modellen och får standardmodellen i stället.',
  },
};
/**
 * "Vem ser det" (D23): everyone, or a selection of roles, units and provisioned groups (D68). Any of the three lists admits a
 * person. Groups wait for SCIM and are shown disabled with the reason, so the editor does not change shape later. The
 * units and the groups are reads of their own: a field is busy while its read is on its way, says so when the read
 * failed, and only a read that holds none says that there are none.
 */
export function AudienceEditor({
  value,
  onChange,
  units,
  groups,
  of = 'connector',
}: {
  value: ConnectorAudience;
  onChange: (a: ConnectorAudience) => void;
  /** The read of the organisation's units. */
  units: UnitsRead;
  /** The read of the provisioned groups with an external id: none until a provisioner has pushed any. */
  groups: GroupsRead;
  of?: keyof typeof wording;
}) {
  const selected = value.mode === 'selected' ? value : null;
  const unitList = units.data?.units ?? [];
  const unitsUnread = units.isError && units.data === undefined;
  const groupList = groups.data?.groups ?? [];
  const groupsUnread = groups.isError && groups.data === undefined;
  // The group field is disabled with its reason once its read has answered with no group to offer, or failed.
  const noGroups = !groups.isPending && groupList.length === 0;
  const update = (patch: Partial<Extract<ConnectorAudience, { mode: 'selected' }>>) =>
    onChange({
      mode: 'selected',
      roles: selected?.roles ?? [],
      units: selected?.units ?? [],
      groups: selected?.groups ?? [],
      ...patch,
    });
  const words = wording[of];
  return (
    <VStack gap={3}>
      <RadioList
        label={words.label}
        value={value.mode}
        onChange={mode =>
          onChange(mode === 'all' ? { mode: 'all' } : { mode: 'selected', roles: [], units: [], groups: [] })
        }
      >
        <RadioListItem value="all" label="Alla som är inloggade" description={words.all} />
        <RadioListItem value="selected" label="Endast valda" description={words.selected} />
      </RadioList>
      {selected && (
        <VStack gap={3}>
          <CheckboxList
            label="Roller"
            value={selected.roles ?? []}
            onChange={roles => update({ roles: roles as Role[] })}
          >
            {(['manager', 'employee'] as Role[]).map(r => (
              <CheckboxListItem key={r} value={r} label={roleLabel[r]} />
            ))}
          </CheckboxList>
          <MultiSelector
            label="Enheter"
            placeholder={unitsUnread ? UNITS_UNREAD : 'Välj enheter'}
            value={selected.units ?? []}
            onChange={u => update({ units: u })}
            hasSearch={unitList.length > 15}
            triggerDisplay="badges"
            presentation="adaptive"
            isLoading={units.isPending}
            options={unitList.map(u => ({ value: u.id, label: u.label }))}
            emptyText={unitsUnread ? UNITS_UNREAD : 'Inga enheter'}
            emptySearchText="Inga träffar"
            searchPlaceholder="Sök enhet"
          />
          <MultiSelector
            label="Grupper"
            placeholder={groupsUnread ? GROUPS_UNREAD : noGroups ? 'Inga grupper provisionerade' : 'Välj grupper'}
            value={selected.groups ?? []}
            onChange={g => update({ groups: g })}
            hasSearch={groupList.length > 15}
            triggerDisplay="badges"
            presentation="adaptive"
            isLoading={groups.isPending}
            options={groupList.map(g => ({ value: g.id, label: g.label }))}
            emptyText={groupsUnread ? GROUPS_UNREAD : 'Inga grupper'}
            emptySearchText="Inga träffar"
            searchPlaceholder="Sök grupp"
            isDisabled={noGroups}
            disabledMessage={
              groupsUnread ? GROUPS_UNREAD : 'Grupper visas när katalogen har provisionerat dem genom SCIM.'
            }
          />
        </VStack>
      )}
    </VStack>
  );
}
/** The structural preview: what a manager and an employee would get from this connector. No data, no call to the service. */
const roles: Role[] = ['manager', 'employee'];
export function AudiencePreview({ connectorId }: { connectorId: string }) {
  // One query per role from the admin cache (D33); every action on the page invalidates them, so the preview follows the saved audience.
  const results = useQueries({ queries: roles.map(role => adminQueries.preview(connectorId, role)) });
  if (results.some(r => r.isPending))
    return (
      <Text type="supporting" role="status">
        Räknar fram vad var och en ser …
      </Text>
    );
  const previews = results.map(r => r.data).filter((p): p is ConnectorPreview => !!p);
  return (
    <VStack gap={2} as="section" aria-label="Så här ser det ut">
      {previews.map(p => (
        <Collapsible
          key={p.role}
          defaultIsOpen={false}
          chevronPosition="start"
          trigger={
            <Text type="supporting">
              Så här ser det ut för {roleLabel[p.role].toLowerCase()}:{' '}
              {p.visible
                ? `${p.areas.length} ${p.areas.length === 1 ? 'område' : 'områden'}, ${p.tools.length} frågor till assistenten`
                : 'ingenting'}
            </Text>
          }
        >
          <VStack gap={1}>
            {!p.visible && <Text type="supporting">Anslutningen finns inte för den här rollen.</Text>}
            {p.areas.map(a => (
              <Text key={a.id} type="supporting">
                {a.title}
                {a.standing.length ? ` · Gör själv: ${a.standing.join(', ')}` : ''}
              </Text>
            ))}
            {p.menu.length > 0 && <Text type="supporting">I menyn under Verktyg: {p.menu.join(', ')}</Text>}
            {p.visible && p.tools.length > 0 && (
              <Text type="supporting">Assistenten kan använda: {p.tools.join(', ')}</Text>
            )}
            {p.visible && p.tools.length === 0 && (
              <Text type="supporting">
                Inga frågor till assistenten för den här rollen (förmågornas egna regler kan kräva en viss person).
              </Text>
            )}
          </VStack>
        </Collapsible>
      ))}
    </VStack>
  );
}
