import { useQuery } from '@tanstack/react-query';
import {
  BOARDING_EVENTS,
  BOARDING_EVENT_WORDS,
  type BoardingEvent,
  type BoardingLayersOutput,
  type SessionUser,
} from '@clew/contracts';
import {
  Button,
  Card,
  EmptyState,
  List,
  ListItem,
  Table,
  Text,
  Toolbar,
  VStack,
  pixel,
  proportional,
  useMediaQuery,
} from '@clew/ui';
import { displayDate } from '@clew/calendar/dates';
import { ApiError } from '../../api-error';
import { BOARDING_IMPORT_PATH } from '../../boarding-address';
import { conditionWords, itemsWords, longDay, unitLabelOf } from '../../boarding';
import { boardingLayersQuery } from '../../queries';
import { errorMessage } from '../../query-policy';
import { usePageTitle } from '../../page-title';
import { PageHeader } from '../../components/page-header';
import { mobileQuery } from '../../components/shell';
import { AdminShell } from './shell';

type Layer = BoardingLayersOutput['layers'][number];
interface Row extends Record<string, unknown> {
  id: string;
  layer: Layer;
}
/** "Introduktion", "Avslut", per card: the event's word and how many layers it has. */
const layersWords = (n: number) => (n === 1 ? '1 lager' : `${n} lager`);

/**
 * Administration › Introduktion och avslut (D124 item 10): the layers a plan is assembled from, read only, one card per
 * event with each layer's name, whom it applies to in words, how many items it holds and when it last changed. Layers
 * come in from a file on "Importera från fil" (`/admin/boarding/import`), which replaces a layer by its event and name;
 * they are not edited here. Refused while the module is switched off under Anslutna system, and to an administrator
 * without `admin.boarding`; the rail draws this page's row only when neither is so.
 */
export function AdminBoardingPage({ user }: { user: SessionUser }) {
  usePageTitle('Introduktion och avslut');
  const mobile = useMediaQuery(mobileQuery);
  const query = useQuery(boardingLayersQuery);
  const refused = query.error instanceof ApiError && query.error.status === 403;
  const error = query.isError && !refused ? errorMessage(query.error, 'Lagren kunde inte läsas.') : null;
  const layers = query.data?.layers ?? [];
  return (
    <AdminShell
      user={user}
      section="introduktion"
      crumbs={[{ label: 'Introduktion och avslut' }]}
      pending={query.isPending}
    >
      <PageHeader
        title="Introduktion och avslut"
        meta={
          <Text as="p" color="secondary">
            Lagren som en chefs plan byggs av när en introduktion eller ett avslut startas. Varje lager är en lista med
            punkter och gäller alla, en enhet med enheterna under den, en befattning eller en anställningsform. En plan
            som redan har startats behåller sina punkter.
          </Text>
        }
        end={
          !refused && query.data ? (
            <Button variant="secondary" label="Importera från fil" href={BOARDING_IMPORT_PATH} />
          ) : undefined
        }
      />
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      {refused && (
        <Card>
          <EmptyState
            headingLevel={2}
            title="Lagren är inte tillgängliga för dig"
            description={`${errorMessage(query.error, 'Du saknar behörighet för åtgärden.')} Introduktion och avslut slås på under Anslutna system, och lagren kräver behörigheten Administrera introduktion och avslut.`}
            actions={<Button label="Till Anslutna system" href="/admin/connectors" />}
          />
        </Card>
      )}
      {query.data &&
        (layers.length === 0 ? (
          <Card>
            <EmptyState
              headingLevel={2}
              title="Inga lager ännu"
              description="Utan lager startar en plan utan punkter. Läs in lagren från en fil under Importera från fil."
            />
          </Card>
        ) : (
          BOARDING_EVENTS.map(event => (
            <EventLayers key={event} event={event} layers={layers.filter(l => l.event === event)} mobile={mobile} />
          ))
        ))}
    </AdminShell>
  );
}

/** One event's layers: a table, or a list of one layer per row on a phone. */
function EventLayers({ event, layers, mobile }: { event: BoardingEvent; layers: Layer[]; mobile: boolean }) {
  const title = BOARDING_EVENT_WORDS[event];
  const changed = (l: Layer) => longDay(displayDate(l.updatedAt));
  const columns = [
    {
      key: 'name',
      header: 'Lager',
      width: proportional(2, { minWidth: 180 }),
      renderCell: (r: Row) => <Text weight="semibold">{r.layer.name}</Text>,
    },
    {
      key: 'condition',
      header: 'Gäller',
      width: proportional(3, { minWidth: 220 }),
      renderCell: (r: Row) => <Text>{conditionWords(r.layer.condition, r.layer.value, unitLabelOf(r.layer))}</Text>,
    },
    {
      key: 'items',
      header: 'Punkter',
      width: pixel(110),
      renderCell: (r: Row) => <Text hasTabularNumbers>{r.layer.items.length}</Text>,
    },
    {
      key: 'changed',
      header: 'Ändrad',
      width: pixel(180),
      renderCell: (r: Row) => <Text>{changed(r.layer)}</Text>,
    },
  ];
  return (
    <Card padding={0}>
      <Toolbar
        label={title}
        size="sm"
        dividers={['bottom']}
        startContent={
          <VStack gap={0}>
            <Text weight="semibold">{title}</Text>
            <Text type="supporting">{layers.length ? layersWords(layers.length) : 'Inga lager'}</Text>
          </VStack>
        }
      />
      {layers.length === 0 ? (
        <EmptyState
          isCompact
          headingLevel={2}
          title={`Inga lager för ${title.toLowerCase()}`}
          description="En plan för den här händelsen startar utan punkter tills ett lager läses in."
        />
      ) : mobile ? (
        <List aria-label={`Lager för ${title.toLowerCase()}`} hasDividers>
          {layers.map(l => (
            <ListItem
              key={l.id}
              label={<Text weight="semibold">{l.name}</Text>}
              description={
                <Text type="supporting">{`${conditionWords(l.condition, l.value, unitLabelOf(l))} · ${itemsWords(l.items.length)} · ändrad ${changed(l)}`}</Text>
              }
            />
          ))}
        </List>
      ) : (
        <Table<Row>
          aria-label={`Lager för ${title.toLowerCase()}`}
          data={layers.map(l => ({ id: l.id, layer: l }))}
          idKey="id"
          columns={columns}
          density="balanced"
        />
      )}
    </Card>
  );
}
