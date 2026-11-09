import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { CheckReport, ConnectorAudience, ConnectorDetail, ManifestDiff, SessionUser } from '@clew/contracts';
import {
  AlertDialog,
  AreaChip,
  Banner,
  Button,
  Card,
  Collapsible,
  Dialog,
  DialogHeader,
  DropdownMenu,
  EmptyState,
  FormLayout,
  HStack,
  Heading,
  InfoTip,
  List,
  ListItem,
  MetadataList,
  MetadataListItem,
  Section,
  StatusDot,
  Switch,
  SystemSwatch,
  Tab,
  TabList,
  Table,
  Text,
  TextInput,
  Timestamp,
  Toolbar,
  VStack,
  swatchWords,
  useMediaQuery,
  useToast,
  proportional,
} from '@clew/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api';
import { adminQueries } from '../../queries';
import { keys } from '../../query-keys';
import { useAdminAction } from '../../mutations';
import { errorMessage } from '../../query-policy';
import { usePageTitle } from '../../page-title';
import { AudienceEditor, AudiencePreview } from './audience';
import { CheckResult } from './check-result';
import {
  actionLabel,
  actorLabel,
  audienceLabel,
  capabilityKindLabel,
  healthLabel,
  kindLabel,
  roleLabel,
  statusOf,
} from './labels';
import { AdminShell } from './shell';
import { PageHeader } from '../../components/page-header';
import { DialogFrame } from './dialog-frame';

/** One connector (D23): overview and actions, capabilities with their switches, areas, who sees it, and its history. */
type TabId = 'oversikt' | 'formagor' | 'omraden' | 'publik' | 'historik';
const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'oversikt', label: 'Översikt' },
  { id: 'formagor', label: 'Funktioner' },
  { id: 'omraden', label: 'Områden' },
  { id: 'publik', label: 'Vem ser det' },
  { id: 'historik', label: 'Historik' },
];
interface CapRow extends Record<string, unknown> {
  name: string;
  c: ConnectorDetail['capabilities'][number];
}
const EMPTY_UNITS: Array<{ id: string; label: string }> = [];

type CapabilityView = ConnectorDetail['capabilities'][number];
/** The "Assistent" switch of one capability, disabled with its reason when the manifest, the kind or the connector says no. */
function ToolSwitch({
  row,
  toolsEnabled,
  onChange,
}: {
  row: CapabilityView;
  toolsEnabled: boolean;
  onChange: (on: boolean) => Promise<void>;
}) {
  const reason =
    row.kind === 'execute'
      ? 'En åtgärd är aldrig ett verktyg för assistenten (D8).'
      : !row.model
        ? 'Anslutningen har inte märkt funktionen som verktyg.'
        : !row.enabled
          ? 'Funktionen är avstängd.'
          : 'Assistenten är avstängd för hela anslutningen.';
  const disabled = !row.model || row.kind === 'execute' || !row.enabled || !toolsEnabled;
  return (
    <HStack gap={1} vAlign="center">
      <Switch
        size="sm"
        label={row.title + ' till assistenten'}
        isLabelHidden
        value={row.tool}
        isDisabled={disabled}
        disabledMessage={reason}
        changeAction={onChange}
      />
      {row.kind === 'execute' && (
        <InfoTip
          content="Åtgärder utförs bara genom att en person bekräftar på ett kort, aldrig av assistenten."
          label="Varför kan åtgärder inte bli verktyg"
        />
      )}
    </HStack>
  );
}

export function AdminConnectorPage({ user }: { user: SessionUser }) {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mobile = useMediaQuery('(max-width: 720px)');
  // The connector and the units from the admin cache (D33); a 400 is the one answer the page turns into "finns inte".
  const client = useQueryClient();
  const detail = useQuery(adminQueries.connector(id));
  const units = useQuery(adminQueries.units).data?.units ?? EMPTY_UNITS;
  const c = detail.data ?? null;
  const missing = detail.isError && detail.error instanceof ApiError && detail.error.status === 400;
  const readError =
    detail.isError && !missing && detail.data === undefined
      ? errorMessage(detail.error, 'Anslutningen kunde inte läsas.')
      : null;
  const [tab, setTab] = useState<TabId>('oversikt');
  const [report, setReport] = useState<CheckReport | null>(null);
  const [diff, setDiff] = useState<ManifestDiff | null>(null);
  const [secretOpen, setSecretOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const [removeOpen, setRemoveOpen] = useState(false);
  // The audience draft follows the saved one whenever the connector itself changes, never on a refetch that changed nothing.
  const [audience, setAudience] = useState<ConnectorAudience | null>(null);
  useEffect(() => {
    if (c) setAudience(c.audience);
  }, [c?.id, c?.updatedAt]);
  usePageTitle(c ? c.source : null);
  // Every action re-reads the admin queries and then says what it did; removing re-reads the list alone and drops this page's own read before leaving.
  const {
    run,
    busy,
    error: actionError,
  } = useAdminAction({ invalidate: [keys.admin.all, keys.areas], toastId: 'connector:' + id });
  const removal = useAdminAction({ invalidate: [keys.admin.connectors], toastId: 'connector:' + id });
  const error = actionError ?? removal.error ?? readError;
  if (missing)
    return (
      <AdminShell user={user} crumbs={[{ label: 'Anslutna system', href: '/admin/connectors' }, { label: id }]}>
        <EmptyState
          headingLevel={1}
          title="Anslutningen finns inte"
          description="Den kan ha tagits bort."
          actions={<Button label="Till listan" href="/admin/connectors" />}
        />
      </AdminShell>
    );
  if (!c)
    return (
      <AdminShell
        pending={!error}
        user={user}
        crumbs={[{ label: 'Anslutna system', href: '/admin/connectors' }, { label: id }]}
      >
        {error ? (
          <Text as="p" role="alert" color="accent">
            {error}
          </Text>
        ) : (
          <Text type="supporting" role="status">
            Läser anslutningen …
          </Text>
        )}
      </AdminShell>
    );
  const s = statusOf(c);
  const unhealthy = c.state === 'enabled' && !c.bundled && c.health.status !== 'ok';
  const panel = (t: TabId) => `panel-${t}`;
  const capRows: CapRow[] = c.capabilities.map(x => ({ name: x.name, c: x }));
  // The views that can be tools in the menu (D40), each with the row it would be.
  const tools = c.capabilities.flatMap(x => (x.menu ? [{ ...x, menu: x.menu }] : []));
  const setCap = (name: string, patch: { enabled?: false; model?: false }) =>
    run(async () => {
      await api.admin.update(id, { capabilities: { [name]: patch } });
    });
  // Off is the only value an override can hold (narrowing only, D23); on clears it.
  const capPatch = (on: boolean, key: 'enabled' | 'model'): { enabled?: false; model?: false } =>
    on ? {} : key === 'enabled' ? { enabled: false } : { model: false };
  const capColumns = [
    // An id is one word in a typewriter face: its column holds it, so it does not break in the middle.
    {
      key: 'title',
      header: 'Funktion',
      width: proportional(1.5, { minWidth: 240 }),
      renderCell: (r: CapRow) => (
        <VStack gap={0}>
          <Text>{r.c.title}</Text>
          <Text type="code" color="secondary">
            {r.c.name}
          </Text>
        </VStack>
      ),
    },
    {
      key: 'kind',
      header: 'Typ',
      renderCell: (r: CapRow) => (
        <Text weight={r.c.kind === 'execute' ? 'semibold' : undefined}>{capabilityKindLabel[r.c.kind]}</Text>
      ),
    },
    {
      key: 'roles',
      header: 'Roller enligt systemet',
      width: proportional(1.5, { minWidth: 190 }),
      renderCell: (r: CapRow) => (
        <Text type="supporting">
          {r.c.roles ? r.c.roles.map(x => roleLabel[x]).join(', ') : 'Alla (regeln ligger i koden)'}
        </Text>
      ),
    },
    {
      key: 'on',
      header: 'På',
      renderCell: (r: CapRow) => (
        <Switch
          size="sm"
          label={`${r.c.title} på`}
          isLabelHidden
          value={r.c.enabled}
          changeAction={on => setCap(r.name, capPatch(on, 'enabled'))}
        />
      ),
    },
    {
      key: 'tool',
      header: 'Assistent',
      renderCell: (r: CapRow) => (
        <ToolSwitch row={r.c} toolsEnabled={c.toolsEnabled} onChange={on => setCap(r.name, capPatch(on, 'model'))} />
      ),
    },
  ];
  const removeLabel = `Ta bort ${c.source}`;
  // A Toolbar keeps one row, which four buttons cannot at 320 px: on a phone they wrap (1.4.10).
  const actions = (
    <>
      <Button
        variant="secondary"
        label="Testa anslutning"
        isDisabled={busy}
        clickAction={() =>
          run(async () => {
            const r = await api.admin.test(id);
            setReport(r);
            return r.ok ? 'Kontrollen gick bra.' : 'Kontrollen hittade fel, se listan.';
          })
        }
      />
      <Button
        variant="secondary"
        label="Läs in igen från systemet"
        isDisabled={busy}
        clickAction={() =>
          run(async () => {
            const r = await api.admin.refresh(id, false);
            if (r.diff.same) return 'Inget har ändrats i systemet.';
            setDiff(r.diff);
          })
        }
      />
      <Button variant="secondary" label="Byt nyckel" isDisabled={busy} onClick={() => setSecretOpen(true)} />
    </>
  );
  // Set apart from the rest: the one action here that cannot be taken back.
  const remove = <Button variant="destructive" label="Ta bort" isDisabled={busy} onClick={() => setRemoveOpen(true)} />;
  return (
    <AdminShell user={user} crumbs={[{ label: 'Anslutna system', href: '/admin/connectors' }, { label: c.source }]}>
      {/* The system's colour beside its name, and its place in the order under it (artboard 9, D71), in the one page header (D74). */}
      <PageHeader
        title={c.source}
        icon={<SystemSwatch ordinal={c.ordinal} />}
        end={
          <Switch
            label={c.state === 'enabled' ? 'På' : 'Av'}
            labelPosition="start"
            value={c.state === 'enabled'}
            isDisabled={busy || (c.state === 'draft' && !c.counts.capabilities)}
            disabledMessage="Utkastet är inte kontrollerat: kontrollera anslutningen först."
            changeAction={on =>
              run(async () => {
                await api.admin.update(id, { state: on ? 'enabled' : 'disabled' });
                return `${c.source} ${on ? 'är på' : 'är avstängd'}.`;
              })
            }
          />
        }
        meta={
          <VStack gap={1}>
            <Text type="supporting">
              {[
                swatchWords(c.ordinal),
                c.kind ? kindLabel[c.kind].toLowerCase() : null,
                c.protocol ? `protokoll ${c.protocol}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            <HStack gap={1} vAlign="center" wrap="wrap">
              <StatusDot variant={s.tone} label={s.label} />
              <Text color="secondary">
                {s.label}
                {c.bundled ? ' · körs i Startsidan' : c.url ? ` · ${c.url}` : ''}
              </Text>
            </HStack>
          </VStack>
        }
      />
      {unhealthy && (
        <Banner
          status={c.health.status === 'unreachable' ? 'warning' : 'error'}
          container="section"
          collapsible={false}
          title={`${c.source}: ${healthLabel[c.health.status].toLowerCase()}${c.health.at ? ' sedan ' : ''}`}
          description={`Kort och figurer visas från senast kända läge.${c.health.detail ? ` Teknisk orsak: ${c.health.detail}.` : ''}`}
          endContent={<Timestamp value={c.health.at} format="date_time" />}
        />
      )}
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      <Card padding={0}>
        {/* Five tabs do not fit 320 px without scrolling (1.4.10), so a phone gets the sections as a menu with the same panels. */}
        <Section variant="transparent" paddingInline={4} paddingBlock={mobile ? 3 : 0}>
          {mobile ? (
            <DropdownMenu
              button={{ label: `Visa: ${tabs.find(t => t.id === tab)!.label}`, size: 'sm', variant: 'secondary' }}
              presentation="adaptive"
              items={tabs.map(t => ({ id: t.id, label: t.label, onClick: () => setTab(t.id) }))}
            />
          ) : (
            <TabList value={tab} onChange={v => setTab(v as TabId)} role="tablist" hasDivider>
              {tabs.map(t => (
                <Tab key={t.id} value={t.id} label={t.label} panelId={panel(t.id)} />
              ))}
            </TabList>
          )}
        </Section>
        <Section variant="transparent" padding={4}>
          {tab === 'oversikt' && (
            <div id={panel('oversikt')} role={mobile ? 'region' : 'tabpanel'} aria-label="Översikt">
              <VStack gap={4}>
                {!c.bundled &&
                  (mobile ? (
                    <VStack gap={3}>
                      <HStack gap={2} wrap="wrap" role="group" aria-label="Åtgärder">
                        {actions}
                      </HStack>
                      <HStack>{remove}</HStack>
                    </VStack>
                  ) : (
                    <Toolbar label="Åtgärder" size="sm" variant="muted" startContent={actions} endContent={remove} />
                  ))}
                {/* What an administrator acts on stands open; what a technician looks up when something is wrong folds away. The name, the status and the address are in the page's head. */}
                <MetadataList columns={mobile ? 'single' : 'multi'}>
                  <MetadataListItem label="Vem ser det">{audienceLabel(c.audience)}</MetadataListItem>
                  <MetadataListItem label="Skickar kort">
                    {c.scan ? (c.scanEnabled ? 'Ja' : 'Avstängt') : 'Anslutningen skickar inga kort'}
                  </MetadataListItem>
                  <MetadataListItem label="Ger sidhuvudet">
                    {c.header ? 'Ja' : c.headerCapability ? 'Kan ge sidhuvudet' : 'Anslutningen kan inte ge sidhuvudet'}
                  </MetadataListItem>
                  <MetadataListItem label="I menyn">
                    {tools.some(t => t.menu.on)
                      ? tools
                          .filter(t => t.menu.on)
                          .map(t => t.menu.label)
                          .join(', ')
                      : tools.length
                        ? 'Ingen vy vald'
                        : 'Ingen vy kan ligga i menyn'}
                  </MetadataListItem>
                  <MetadataListItem label="Funktioner">{`${c.counts.capabilities} · ${c.counts.execute} utför · ${c.counts.tools} för assistenten`}</MetadataListItem>
                </MetadataList>
                <Collapsible
                  defaultIsOpen={false}
                  chevronPosition="start"
                  trigger={<Text type="supporting">Tekniska uppgifter</Text>}
                >
                  <MetadataList columns={mobile ? 'single' : 'multi'}>
                    <MetadataListItem label="Id">{c.id}</MetadataListItem>
                    <MetadataListItem label="Typ">
                      {c.kind ? kindLabel[c.kind] : '–'}
                      {c.bundled ? ' · inbyggd' : ''}
                    </MetadataListItem>
                    <MetadataListItem label="Hälsa">
                      {healthLabel[c.health.status]}
                      {c.bundled ? '' : ' · '}
                      {!c.bundled && <Timestamp value={c.health.at} format="auto" />}
                    </MetadataListItem>
                    <MetadataListItem label="Protokoll">{c.protocol ? `Version ${c.protocol}` : '–'}</MetadataListItem>
                    {c.manifestAt && (
                      <MetadataListItem label="Senast inläst">
                        <Timestamp value={c.manifestAt} format="date_time" />
                      </MetadataListItem>
                    )}
                    {c.secretChangedAt && (
                      <MetadataListItem label="Nyckel bytt">
                        <Timestamp value={c.secretChangedAt} format="date_time" />
                      </MetadataListItem>
                    )}
                    <MetadataListItem label="Tillagd">
                      {actorLabel(c.createdBy)} · <Timestamp value={c.createdAt} format="date_time" />
                    </MetadataListItem>
                  </MetadataList>
                </Collapsible>
                {report && (
                  <VStack gap={2}>
                    <Heading level={3} accessibilityLevel={2}>
                      Senaste kontroll
                    </Heading>
                    <CheckResult report={report} />
                  </VStack>
                )}
              </VStack>
            </div>
          )}
          {tab === 'formagor' && (
            <div id={panel('formagor')} role={mobile ? 'region' : 'tabpanel'} aria-label="Funktioner">
              <VStack gap={3}>
                <Toolbar
                  label="Funktioner"
                  size="sm"
                  startContent={
                    <Switch
                      size="sm"
                      label="Erbjud assistenten"
                      value={c.toolsEnabled}
                      isDisabled={busy}
                      changeAction={on =>
                        run(async () => {
                          await api.admin.update(id, { toolsEnabled: on });
                        })
                      }
                    />
                  }
                  endContent={
                    c.counts.execute > 0 && c.capabilities.some(x => x.kind === 'execute' && x.enabled) ? (
                      <Button
                        variant="secondary"
                        label="Stäng av alla åtgärder"
                        isDisabled={busy}
                        clickAction={() =>
                          run(async () => {
                            await api.admin.update(id, {
                              capabilities: Object.fromEntries(
                                c.capabilities
                                  .filter(x => x.kind === 'execute')
                                  .map(x => [x.name, { enabled: false as const }]),
                              ),
                            });
                            return 'Alla åtgärder är avstängda: anslutningen är skrivskyddad.';
                          })
                        }
                      />
                    ) : undefined
                  }
                />
                {mobile ? (
                  <List aria-label="Funktioner">
                    {capRows.map(r => (
                      <ListItem
                        key={r.name}
                        label={<Text>{r.c.title}</Text>}
                        description={
                          <VStack gap={0}>
                            <Text type="code" color="secondary">
                              {r.c.name}
                            </Text>
                            <Text type="supporting">{capabilityKindLabel[r.c.kind]}</Text>
                          </VStack>
                        }
                        endContent={
                          <Switch
                            size="sm"
                            label={`${r.c.title} på`}
                            isLabelHidden
                            value={r.c.enabled}
                            changeAction={on => setCap(r.name, capPatch(on, 'enabled'))}
                          />
                        }
                      />
                    ))}
                  </List>
                ) : (
                  <Table<CapRow> data={capRows} idKey="name" columns={capColumns} density="compact" />
                )}
              </VStack>
            </div>
          )}
          {tab === 'omraden' && (
            <div id={panel('omraden')} role={mobile ? 'region' : 'tabpanel'} aria-label="Områden">
              <VStack gap={3}>
                <Switch
                  label="Skicka kort"
                  description="Anslutningen får föreslå kort i strömmen."
                  value={c.scanEnabled}
                  isDisabled={busy || !c.scan}
                  disabledMessage="Anslutningen skickar inga kort."
                  changeAction={on =>
                    run(async () => {
                      await api.admin.update(id, { scanEnabled: on });
                    })
                  }
                />
                {/* The shared header (D88): one connector gives it; switching it on here takes it from the one that held it. */}
                <Switch
                  label="Ger sidhuvudet"
                  description="Anslutningens platser och logotyp ritas i sidhuvudet på varje sida. Bara en anslutning i taget; den som hade det släpper det."
                  value={c.header}
                  isDisabled={busy || !c.headerCapability}
                  disabledMessage="Anslutningens beskrivning pekar inte ut någon förmåga för sidhuvudet."
                  changeAction={on =>
                    run(async () => {
                      await api.admin.update(id, { header: on });
                      return on
                        ? 'Anslutningen ger sidhuvudet nu.'
                        : 'Anslutningen ger inte längre sidhuvudet; Clews eget visas.';
                    })
                  }
                />
                {/* Verktyg i menyn (D40): every view that can be a tool, with its own switch. The same list on a phone. */}
                {tools.length === 0 ? (
                  <Text type="supporting">
                    Ingen av anslutningens vyer kan ligga i menyn. Det kan en läsning med en vy som öppnas utan indata.
                  </Text>
                ) : (
                  <List
                    aria-label="Verktyg i menyn"
                    header={
                      <VStack gap={0}>
                        <Text weight="semibold">Verktyg i menyn</Text>
                        <Text type="supporting">
                          Välj vilka av anslutningens vyer som ligger under Verktyg i menyn, för alla som ser
                          anslutningen.
                        </Text>
                      </VStack>
                    }
                  >
                    {tools.map(t => (
                      <ListItem
                        key={t.name}
                        label={<Text>{t.menu.label}</Text>}
                        description={
                          <Text type="supporting">
                            Öppnar {t.title}
                            {t.enabled ? '' : ' · funktionen är avstängd'}
                          </Text>
                        }
                        endContent={
                          <Switch
                            size="sm"
                            label={`Visa ${t.menu.label} i menyn`}
                            isLabelHidden
                            value={t.menu.on}
                            isDisabled={busy || !t.enabled}
                            disabledMessage="Funktionen är avstängd under Funktioner."
                            changeAction={on =>
                              run(async () => {
                                await api.admin.update(id, { menu: { [t.name]: on } });
                                return on
                                  ? `${t.menu.label} visas i menyn under Verktyg.`
                                  : `${t.menu.label} visas inte längre i menyn.`;
                              })
                            }
                          />
                        }
                      />
                    ))}
                  </List>
                )}
                {/* Each area with its chip, where the area is governed (artboard 9): the system's colour, the area's icon and word, and "Visa nyckeltalet" (D54) for an area with a figure. */}
                {c.areas.length === 0 ? (
                  <Text type="supporting">Anslutningen har inga områden i sidopanelen.</Text>
                ) : (
                  <List aria-label="Områden">
                    {c.areas.map(a => (
                      <ListItem
                        key={a.id}
                        label={
                          <HStack>
                            <AreaChip ordinal={c.ordinal} icon={a.icon} label={a.title} />
                          </HStack>
                        }
                        description={
                          <Text type="supporting">
                            {a.roles.map(r => roleLabel[r]).join(', ')}
                            {a.standing.length ? ` · Gör själv: ${a.standing.join(', ')}` : ''}
                            {a.figure
                              ? a.figureShown
                                ? ' · nyckeltalet är en ruta på Hem'
                                : ' · nyckeltalet visas inte'
                              : ''}
                          </Text>
                        }
                        endContent={
                          a.figure ? (
                            <Switch
                              size="sm"
                              label="Visa nyckeltalet"
                              labelPosition="start"
                              value={a.figureShown}
                              isDisabled={busy}
                              changeAction={on =>
                                run(async () => {
                                  await api.admin.update(id, { figures: { [a.id]: on } });
                                  return on
                                    ? `Nyckeltalet för ${a.title} visas på Hem.`
                                    : `Nyckeltalet för ${a.title} visas inte längre på Hem.`;
                                })
                              }
                            />
                          ) : undefined
                        }
                      />
                    ))}
                  </List>
                )}
              </VStack>
            </div>
          )}
          {tab === 'publik' && audience && (
            <div id={panel('publik')} role={mobile ? 'region' : 'tabpanel'} aria-label="Vem ser det">
              <VStack gap={4}>
                <AudienceEditor value={audience} onChange={setAudience} units={units} />
                <HStack gap={2}>
                  <Button
                    variant="primary"
                    label="Spara"
                    isDisabled={busy || JSON.stringify(audience) === JSON.stringify(c.audience)}
                    clickAction={() =>
                      run(async () => {
                        await api.admin.update(id, { audience });
                        return 'Sparat: ' + audienceLabel(audience) + '.';
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    label="Ångra ändringar"
                    isDisabled={JSON.stringify(audience) === JSON.stringify(c.audience)}
                    onClick={() => setAudience(c.audience)}
                  />
                </HStack>
                <AudiencePreview connectorId={id} />
              </VStack>
            </div>
          )}
          {tab === 'historik' && (
            <div id={panel('historik')} role={mobile ? 'region' : 'tabpanel'} aria-label="Historik">
              {c.history.length === 0 ? (
                <Text type="supporting">Ingen historik ännu.</Text>
              ) : (
                <List density="compact" aria-label="Historik">
                  {[...c.history].reverse().map((h, i) => (
                    <ListItem
                      key={i}
                      label={<Text>{actionLabel[h.action] ?? h.action}</Text>}
                      description={
                        <Text type="supporting">
                          {actorLabel(h.actor)}
                          {Object.keys(h.details).length ? ' · ' + JSON.stringify(h.details) : ''}
                        </Text>
                      }
                      endContent={<Timestamp value={h.at} format="date_time" />}
                    />
                  ))}
                </List>
              )}
            </div>
          )}
        </Section>
      </Card>
      <Dialog
        isOpen={secretOpen}
        onOpenChange={open => {
          if (!open) {
            setSecretOpen(false);
            setSecret('');
          }
        }}
        width={480}
        purpose="form"
        padding={4}
      >
        <VStack gap={4}>
          <DialogHeader
            title="Byt nyckel"
            subtitle="Den gamla nyckeln slutar gälla direkt. Starta om tjänsten med den nya."
            onOpenChange={() => {
              setSecretOpen(false);
              setSecret('');
            }}
          />
          <FormLayout>
            <TextInput
              label="Ny delad nyckel"
              type="password"
              value={secret}
              onChange={setSecret}
              description="Minst 16 tecken. Sparas förseglad och visas aldrig igen."
              isRequired
              autoComplete="new-password"
            />
          </FormLayout>
          <HStack justify="end" gap={2}>
            <Button
              variant="ghost"
              label="Avbryt"
              onClick={() => {
                setSecretOpen(false);
                setSecret('');
              }}
            />
            <Button
              variant="primary"
              label="Byt nyckel"
              isDisabled={secret.length < 16 || busy}
              clickAction={() =>
                run(async () => {
                  await api.admin.rotateSecret(id, secret);
                  setSecretOpen(false);
                  setSecret('');
                  return 'Nyckeln är bytt.';
                })
              }
            />
          </HStack>
        </VStack>
      </Dialog>
      {/* Astryx's form-wizard-dialog frame: a manifest with many changes scrolls its list, the two choices stay pinned in the
        footer. The frame and its DialogHeader are always rendered: the Dialog takes its name from a title present when it mounts. */}
      <Dialog
        isOpen={!!diff}
        onOpenChange={open => {
          if (!open) setDiff(null);
        }}
        width={520}
      >
        <DialogFrame
          error={actionError}
          scrollLabel="Ändringarna i systemet"
          header={
            <DialogHeader
              title="Systemet har ändrats"
              subtitle="Så här skiljer sig systemet från det Startsidan använder i dag."
              onOpenChange={() => setDiff(null)}
              hasDivider={false}
            />
          }
          secondary={<Button variant="ghost" label="Behåll det gamla" onClick={() => setDiff(null)} />}
          primary={
            <Button
              variant="primary"
              label="Använd det nya"
              isDisabled={busy || !diff}
              clickAction={() =>
                run(async () => {
                  await api.admin.refresh(id, true);
                  setDiff(null);
                  return 'Uppdaterat från systemet.';
                })
              }
            />
          }
        >
          {diff && (
            <List density="compact" aria-label="Ändringar">
              {diff.added.map(n => (
                <ListItem
                  key={'a' + n}
                  startContent={<StatusDot variant="success" label="Ny" />}
                  label={<Text>Ny funktion: {n}</Text>}
                />
              ))}
              {diff.removed.map(n => (
                <ListItem
                  key={'r' + n}
                  startContent={<StatusDot variant="error" label="Borttagen" />}
                  label={<Text>Borttagen funktion: {n}</Text>}
                  description={<Text type="supporting">Kort som pekar på den slutar fungera.</Text>}
                />
              ))}
              {diff.changed.map(n => (
                <ListItem
                  key={'c' + n}
                  startContent={<StatusDot variant="warning" label="Ändrad" />}
                  label={<Text>Ändrad funktion: {n}</Text>}
                />
              ))}
              {diff.areasAdded.map(n => (
                <ListItem
                  key={'aa' + n}
                  startContent={<StatusDot variant="success" label="Nytt" />}
                  label={<Text>Nytt område: {n}</Text>}
                />
              ))}
              {diff.areasRemoved.map(n => (
                <ListItem
                  key={'ar' + n}
                  startContent={<StatusDot variant="error" label="Borttaget" />}
                  label={<Text>Borttaget område: {n}</Text>}
                />
              ))}
            </List>
          )}
        </DialogFrame>
      </Dialog>
      <AlertDialog
        isOpen={removeOpen}
        onOpenChange={setRemoveOpen}
        title={removeLabel}
        description={`Anslutningen försvinner från alla sidor och dess öppna kort stängs. Kvitton i Redan hanterat finns kvar. Nyckeln raderas.`}
        actionLabel="Ta bort"
        cancelLabel="Avbryt"
        isActionLoading={removal.busy}
        onAction={() =>
          removal.run(async () => {
            const r = await api.admin.remove(id);
            setRemoveOpen(false);
            client.removeQueries({ queryKey: keys.admin.connector(id) });
            navigate('/admin/connectors');
            return `${c.source} är borttagen${r.closedCards ? `, ${r.closedCards} kort stängdes` : ''}.`;
          })
        }
      />
    </AdminShell>
  );
}
