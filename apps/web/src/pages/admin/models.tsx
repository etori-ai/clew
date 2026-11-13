import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ModelSummary, ProviderSummary, SessionUser } from '@clew/contracts';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  HStack,
  Link,
  List,
  ListItem,
  Section,
  StatusDot,
  Switch,
  Table,
  Text,
  Toolbar,
  VStack,
  pixel,
  proportional,
  useMediaQuery,
  useToast,
} from '@clew/ui';
import { api } from '../../api';
import { adminQueries } from '../../queries';
import { keys } from '../../query-keys';
import { errorMessage } from '../../query-policy';
import { usePageTitle } from '../../page-title';
import { AddModelDialog, AddProviderDialog, PERSONAL_DATA_NOTICE } from './add-model';
import { audienceLabel, modelStatusOf, providerStatusOf } from './labels';
import { AdminShell } from './shell';
import { PageHeader } from '../../components/page-header';
import { DOT } from '../../dot';

/**
 * "Modeller" (D24): every provider with the models under it. A provider is a Card with its name, its health and "Lägg
 * till modell" in the toolbar, and its models as a Table (List rows on a phone) with the audience, the default, the
 * tools switch's state and an on/off switch. Astryx has no grouped table, so the grouping is one Card per provider.
 * Above the list, what a model reads and who answers for it (D122 item 1), as the add dialogs say it too.
 */
interface Row extends Record<string, unknown> {
  id: string;
  m: ModelSummary;
}
const EMPTY = { providers: [] as ProviderSummary[], models: [] as ModelSummary[] };

export function AdminModelsPage({ user }: { user: SessionUser }) {
  const mobile = useMediaQuery('(max-width: 720px)');
  const client = useQueryClient();
  const toast = useToast();
  const list = useQuery(adminQueries.models);
  const [addingProvider, setAddingProvider] = useState(false);
  const [addingModelTo, setAddingModelTo] = useState<ProviderSummary | null>(null);
  usePageTitle('Modeller');
  const data = list.data ?? (list.isError ? EMPTY : null);
  const error = list.isError && list.data === undefined ? errorMessage(list.error, 'Listan kunde inte läsas.') : null;
  // The one mutation on this page: a model on or off, live from the next question, announced through the toast (D33).
  const flip = async (m: ModelSummary, on: boolean) => {
    try {
      await api.admin.updateModel(m.id, { state: on ? 'enabled' : 'disabled' });
      toast({ body: `${m.title} ${on ? 'är på' : 'är avstängd'}.`, uniqueID: 'model:' + m.id });
    } catch (e) {
      toast({ body: errorMessage(e, 'Något gick fel.'), isAutoHide: false, uniqueID: 'model:' + m.id });
    }
    await client.invalidateQueries({ queryKey: keys.admin.all });
  };
  const status = (m: ModelSummary) => {
    const s = modelStatusOf(m);
    return (
      <HStack gap={1} vAlign="center">
        <StatusDot variant={s.tone} label={s.label} aria-hidden />
        <Text>{s.label}</Text>
      </HStack>
    );
  };
  const toggle = (m: ModelSummary) => (
    <Switch
      size="sm"
      label={`${m.title} på`}
      isLabelHidden
      value={m.state === 'enabled'}
      changeAction={on => flip(m, on)}
    />
  );
  const columns = [
    {
      key: 'model',
      header: 'Modell',
      width: proportional(2, { minWidth: 220 }),
      renderCell: (r: Row) => (
        <VStack gap={0} hAlign="start">
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Link href={`/admin/models/${r.m.id}`} weight="semibold">
              {r.m.title}
            </Link>
            {r.m.isDefault && <Badge variant="neutral" label="Standard" />}
          </HStack>
          <Text type="code" color="secondary">
            {r.m.model}
          </Text>
          {r.m.description && <Text type="supporting">{r.m.description}</Text>}
        </VStack>
      ),
    },
    {
      key: 'audience',
      header: 'Vem kan välja den',
      width: proportional(1, { minWidth: 130 }),
      renderCell: (r: Row) => <Text>{audienceLabel(r.m.audience)}</Text>,
    },
    {
      key: 'tools',
      header: 'Verktyg',
      width: pixel(90),
      renderCell: (r: Row) => <Text>{r.m.tools ? 'Ja' : 'Nej'}</Text>,
    },
    { key: 'status', header: 'Status', width: pixel(150), renderCell: (r: Row) => status(r.m) },
    { key: 'on', header: 'På', width: pixel(72), renderCell: (r: Row) => toggle(r.m) },
  ];
  const providers = data?.providers ?? [];
  const models = data?.models ?? [];
  const fallback = models.find(m => m.isDefault && m.state === 'enabled') ?? models.find(m => m.state === 'enabled');
  return (
    <AdminShell user={user} section="modeller" crumbs={[{ label: 'Modeller' }]} pending={list.isPending}>
      <PageHeader
        title="Modeller"
        end={<Button variant="primary" label="Lägg till leverantör" onClick={() => setAddingProvider(true)} />}
        meta={
          <VStack gap={1}>
            <Text as="p" color="secondary">
              Modellerna som svarar i frågerutan. Du avgör vilka som är på, vem som kan välja dem och vilken som är
              standard.
            </Text>
            {data && models.length > 0 && (
              <Text color="secondary">
                {fallback
                  ? `Den som inte valt själv får ${fallback.title}${fallback.isDefault ? ' (standard)' : ', eftersom ingen modell är standard'}.`
                  : 'Ingen modell är på: rutan hittar bara exakta saker.'}
              </Text>
            )}
          </VStack>
        }
      />
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      <Banner status="info" {...PERSONAL_DATA_NOTICE} />
      {data === null && (
        <Text type="supporting" role="status">
          Läser modellerna …
        </Text>
      )}
      {data && providers.length === 0 && (
        <Card>
          <EmptyState
            isCompact
            title="Inga modeller ännu"
            description="Lägg till en leverantör, adressen till en tjänst som följer OpenAI:s API, så kan du välja bland dess modeller. Utan modell hittar rutan bara exakta saker."
            actions={<Button label="Lägg till leverantör" onClick={() => setAddingProvider(true)} />}
          />
        </Card>
      )}
      {providers.map(p => {
        const mine = models.filter(m => m.providerId === p.id);
        const s = providerStatusOf(p);
        return (
          <Card key={p.id} padding={0}>
            <Toolbar
              label={p.title}
              size="sm"
              dividers={mine.length ? ['bottom'] : []}
              startContent={
                <VStack gap={0}>
                  <Link href={`/admin/models/providers/${p.id}`} weight="semibold">
                    {p.title}
                  </Link>
                  <HStack gap={1} vAlign="center">
                    <StatusDot variant={s.tone} label={s.label} aria-hidden />
                    <Text type="supporting">
                      {s.label}
                      {DOT}
                      {p.baseUrl}
                    </Text>
                  </HStack>
                </VStack>
              }
              endContent={
                <Button size="sm" variant="secondary" label="Lägg till modell" onClick={() => setAddingModelTo(p)} />
              }
            />
            {mine.length === 0 && (
              <Section variant="transparent" padding={4}>
                <Text type="supporting">Inga modeller under {p.title} ännu.</Text>
              </Section>
            )}
            {mine.length > 0 &&
              (mobile ? (
                <List aria-label={`Modeller hos ${p.title}`} hasDividers>
                  {mine.map(m => (
                    <ListItem
                      key={m.id}
                      href={`/admin/models/${m.id}`}
                      label={
                        <HStack gap={2} vAlign="center">
                          <Text weight="semibold">{m.title}</Text>
                          {m.isDefault && <Badge variant="neutral" label="Standard" />}
                        </HStack>
                      }
                      description={
                        <VStack gap={0} hAlign="start">
                          <Text type="code" color="secondary">
                            {m.model}
                          </Text>
                          <Text type="supporting">
                            {modelStatusOf(m).label}
                            {DOT}
                            {audienceLabel(m.audience)}
                          </Text>
                        </VStack>
                      }
                      endContent={toggle(m)}
                    />
                  ))}
                </List>
              ) : (
                <Table<Row>
                  data={mine.map(m => ({ id: m.id, m }))}
                  idKey="id"
                  columns={columns}
                  density="balanced"
                  hasHover
                />
              ))}
          </Card>
        );
      })}
      <AddProviderDialog
        isOpen={addingProvider}
        onClose={() => {
          setAddingProvider(false);
          void client.invalidateQueries({ queryKey: keys.admin.all });
        }}
      />
      <AddModelDialog provider={addingModelTo} onClose={() => setAddingModelTo(null)} />
    </AdminShell>
  );
}
